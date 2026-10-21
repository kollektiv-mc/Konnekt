package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// The run behind action.dhSnapshot (#481): refuse early, warn, stop the server,
// copy what changed, start the server again. It owns the order and the downtime
// and nothing else. The server and the bucket sit behind two small interfaces so
// a test drives the whole sequence without a process, a socket or a five minute
// wait, and the block (scheduler_blocks_dhsnapshot.go) is a thin reader of config
// and services around it. The reading and hashing is dhsnapshot_index.go's.
//
// The invariant the order exists for: everything that can be known to fail is
// checked while the server is still up and nobody has been warned, and once the
// server has been told to stop, it is started again whatever happens next.

const (
	// dhStagingFolder is the folder under the app data directory that holds each
	// server's staged snapshot, beside backups/. It is not under the server's own
	// folder, so a server backup never carries a second copy of the LOD data.
	dhStagingFolder = "dh-snapshots"

	// dhIndexFile is the index written beside the staged parts.
	dhIndexFile = "index.json"

	// dhDefaultLeadSeconds is the warning lead time when the block sets none, and
	// dhMaxLeadSeconds the longest it accepts: half an hour of a stopped-soon
	// server is already a long time to ask players to wait, and the block's time
	// limit (dhSnapshotTimeoutSeconds) is sized for it.
	dhDefaultLeadSeconds = 300
	dhMaxLeadSeconds     = 30 * 60

	// dhFreeSpaceMargin is kept free on the staging volume beyond the databases'
	// own size. The first snapshot stages every part, so the databases' size is
	// the most a run can need, and the margin is for the index and whatever else
	// shares the volume.
	dhFreeSpaceMargin int64 = 1 << 30

	// dhDefaultMessage is what the players read. {time} becomes the time left.
	dhDefaultMessage = "The server will stop in {time} for a world snapshot and be back shortly."
)

// dhProgressEvery is how often a long read narrates its progress. A variable so a
// test can shrink it.
var dhProgressEvery = 30 * time.Second

// reDHPartName is the name of a staged part: the SHA-256 of its bytes.
var reDHPartName = regexp.MustCompile(`^[0-9a-f]{64}$`)

// dhHost is the server as a snapshot run sees it.
type dhHost interface {
	IsRunning() bool
	// CanWarn reports whether a warning can reach the players at all: RCON is
	// confirmed, or the server is running and takes commands on its console.
	CanWarn() bool
	// Say sends one chat line to the players, over RCON when that is confirmed
	// and otherwise (or when it fails) through the server's console.
	Say(message string) error
	// WhileStopped stops the server, calls fn while it is down, and starts it
	// again, with no other power action able to start it in between.
	// stopErr means it was not stopped and fn was not called; startErr means it
	// could not be started again.
	WhileStopped(grace time.Duration, fn func()) (stopErr, startErr error)
	Narrate(line string)
}

// dhIndexReader is the part of S3Client the run uses: it reads latest.json and
// the index it points at.
type dhIndexReader interface {
	GetObject(ctx context.Context, key string) ([]byte, bool, error)
}

// dhRunPlan is everything runDHSnapshot needs. The seams at the bottom default to
// the real thing and are replaced by tests.
type dhRunPlan struct {
	Host dhHost
	// Bucket is where the previous snapshot's latest.json is read from, or nil
	// for a run with no destination, which reuses the index.json in StageDir.
	Bucket      dhIndexReader
	BucketLabel string // what the narration calls the destination
	KeyPrefix   string // the destination's prefix, then the node's
	// Token is the destination's private link token, empty for the public layout
	// (#561). It places the previous index and the new one's partsBase, and is
	// marked out of everything the run narrates.
	Token string

	WorkingDir string
	WorldDir   string
	StageDir   string

	Lead    time.Duration
	Message string
	Grace   time.Duration

	// PartSize is DHPartSize unless a test asks for a smaller one, so a fixture
	// database a few KB long still has several parts.
	PartSize int64

	Now       func() time.Time
	Sleep     func(ctx context.Context, d time.Duration) error
	FreeSpace func(dir string) (uint64, error)
	Stage     func(ctx context.Context, src DHSnapshotSource, prev *DHIndex, stageDir string, keys SnapshotKeys, progress func(n int64)) (DHIndex, []DHPart, error)
}

// dhRunResult is what the run did. Downtime is set whenever the server was
// stopped, so a failed run still reports how long the server was away.
type dhRunResult struct {
	Folder       string
	BytesChanged int64
	PartsChanged int
	PartsTotal   int
	Downtime     time.Duration
}

func (p *dhRunPlan) fillDefaults() {
	if p.Now == nil {
		p.Now = time.Now
	}
	if p.Sleep == nil {
		p.Sleep = sleepCtx
	}
	if p.FreeSpace == nil {
		p.FreeSpace = freeDiskBytes
	}
	if p.PartSize == 0 {
		p.PartSize = DHPartSize
	}
	if p.Stage == nil {
		p.Stage = func(ctx context.Context, src DHSnapshotSource, prev *DHIndex, stageDir string, keys SnapshotKeys, progress func(n int64)) (DHIndex, []DHPart, error) {
			return stageDHSnapshotRun(src, prev, keys, dhStage{Dir: stageDir, PartSize: p.PartSize, Ctx: ctx, Progress: progress})
		}
	}
}

func (p *dhRunPlan) narrate(line string) {
	if p.Token != "" {
		line = strings.ReplaceAll(line, p.Token, s3Redacted)
	}
	p.Host.Narrate(line)
}

// dhPreflight is what the checks before the warning learned.
type dhPreflight struct {
	src  DHSnapshotSource
	prev *DHIndex
	// prevFromBucket says the previous index is the bucket's latest.json, whose
	// parts are therefore all up, so staging need not keep them.
	prevFromBucket bool
}

// runDHSnapshot runs the sequence. It returns an error for any failure, with the
// result so far.
func runDHSnapshot(ctx context.Context, plan dhRunPlan) (dhRunResult, error) {
	p := &plan
	p.fillDefaults()
	pre, err := p.preflight(ctx)
	if err != nil {
		return dhRunResult{}, err
	}
	if err := p.warn(ctx); err != nil {
		return dhRunResult{}, err
	}
	return p.stopCopyStart(ctx, pre)
}

// --- before anything is said or stopped ---

// preflight refuses every failure that can be known while the server is up. It
// stops nothing, warns nobody and writes nothing.
func (p *dhRunPlan) preflight(ctx context.Context) (dhPreflight, error) {
	if !p.Host.IsRunning() {
		return dhPreflight{}, errors.New("the server is not running, so there is nothing to warn or stop: start it, then run the snapshot")
	}
	if p.Lead < 0 || p.Lead > dhMaxLeadSeconds*time.Second {
		return dhPreflight{}, fmt.Errorf("the warning lead time must be between 0 and %d seconds", dhMaxLeadSeconds)
	}
	src, err := resolveDHRunSource(p.WorkingDir, p.WorldDir)
	if err != nil {
		return dhPreflight{}, err
	}
	if err := p.checkFreeSpace(src); err != nil {
		return dhPreflight{}, err
	}
	if p.Lead > 0 && !p.Host.CanWarn() {
		return dhPreflight{}, errors.New("neither RCON nor the server's console can carry the warning, so the players could not be told before the stop: enable RCON (enable-rcon in server.properties) or start the server from Konnekt")
	}
	prev, fromBucket, err := p.previousIndex(ctx)
	if err != nil {
		return dhPreflight{}, err
	}
	return dhPreflight{src: src, prev: prev, prevFromBucket: fromBucket}, nil
}

// resolveDHRunSource is resolveDHSnapshotSource with the server id read from DH's
// own config, after the settings that have a message of their own are checked, so
// the first thing a person is told is the first thing to fix.
func resolveDHRunSource(workingDir, worldDir string) (DHSnapshotSource, error) {
	path := filepath.Join(workingDir, filepath.FromSlash(dhConfigFile))
	cfg, err := readDHConfig(path)
	if err != nil {
		return DHSnapshotSource{}, err
	}
	if err := checkDHConfig(cfg); err != nil {
		return DHSnapshotSource{}, err
	}
	serverID, err := readDHServerID(path)
	if err != nil {
		return DHSnapshotSource{}, err
	}
	if serverID == "" {
		return DHSnapshotSource{}, fmt.Errorf("serverId is not set in %s: Distant Horizons writes one when the server first saves its config, so start the server once with it installed", dhConfigFile)
	}
	return resolveDHSnapshotSource(workingDir, worldDir, serverID)
}

// readDHServerID reads DH's `serverId`, an integer the server generates once and
// keeps in the same file as serverKey (Config.Server.serverId). Empty when the
// file or the key is absent. Beside readDHConfig rather than in it so that
// function's callers and tests are untouched.
func readDHServerID(path string) (string, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if key, value, ok := dhTomlAssignment(strings.TrimRight(line, "\r")); ok && key == "serverId" {
			return value, nil
		}
	}
	return "", nil
}

// checkFreeSpace refuses when the staging volume cannot hold the databases plus
// the margin. What changed is only known after the read, and the first snapshot
// stages everything, so the whole size is the bound.
func (p *dhRunPlan) checkFreeSpace(src DHSnapshotSource) error {
	var total int64
	for _, l := range src.Levels {
		info, err := os.Stat(l.Path)
		if err != nil {
			return fmt.Errorf("stat %s: %w", l.Path, err)
		}
		total += info.Size()
	}
	probe := nearestExistingDir(p.StageDir)
	free, err := p.FreeSpace(probe)
	if err != nil {
		return err
	}
	need := total + dhFreeSpaceMargin
	if free < uint64(need) {
		return fmt.Errorf("not enough free space to stage the snapshot: %s is free on the volume holding %s, and the databases are %s (a first snapshot stages all of it, and %s is kept spare). Free some space or choose another output folder",
			fmtBytes(int64(free)), p.StageDir, fmtBytes(total), fmtBytes(dhFreeSpaceMargin))
	}
	return nil
}

// nearestExistingDir is dir, or the closest ancestor that exists, so the free
// space of a staging folder not yet created can still be asked for.
func nearestExistingDir(dir string) string {
	for {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return dir
		}
		dir = parent
	}
}

// previousIndex reads the index the new snapshot is measured against. With a
// bucket it is the index the bucket's latest.json points at, which says what
// is already up: the pointer must be there or be a clean 404 (a first snapshot),
// and anything else refuses the run, because carrying on would restage and
// re-upload everything on the strength of a network blip. Without a bucket it
// is the index.json left in the staging folder, a convenience that is only as
// true as the last publish; one that cannot be read is ignored, which costs a
// full restage and nothing else.
func (p *dhRunPlan) previousIndex(ctx context.Context) (*DHIndex, bool, error) {
	if p.Bucket == nil {
		return p.localIndex(), false, nil
	}
	keys, err := snapshotKeys(p.KeyPrefix, p.Token, p.Now())
	if err != nil {
		return nil, false, err
	}
	prev, err := readLatestIndex(ctx, p.Bucket, keys.Latest)
	if err != nil {
		return nil, false, fmt.Errorf("cannot read the previous snapshot from %s: %w", p.BucketLabel, err)
	}
	if prev == nil {
		p.narrate(fmt.Sprintf("No %s in %s: this is a first snapshot, every part will be staged", keys.Latest, p.BucketLabel))
		return nil, false, nil
	}
	return &prev.Index, true, nil
}

// dhLatestIndex is the snapshot a bucket's latest.json points at.
type dhLatestIndex struct {
	Index DHIndex
	// IndexKey is where the index was read from, which is also where the
	// snapshot's own folder is: its assembled files sit beside it.
	IndexKey string
}

// readLatestIndex reads latest.json, resolves the index it points at and reads
// that. It returns nil, with no error, only when there is no latest.json at all:
// a first snapshot. A pointer whose index is missing is an error, never a first
// snapshot, since treating it as one would restage and re-upload everything over
// what is probably a pruned or half-deleted bucket.
func readLatestIndex(ctx context.Context, r dhIndexReader, latestKey string) (*dhLatestIndex, error) {
	data, found, err := r.GetObject(ctx, latestKey)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	latest, err := parseDHLatest(data)
	if err != nil {
		return nil, fmt.Errorf("%s is not a Distant Horizons latest.json: %w", latestKey, err)
	}
	indexKey, err := latestIndexKey(latestKey, latest)
	if err != nil {
		return nil, err
	}
	data, found, err = r.GetObject(ctx, indexKey)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("%s points at %s, which is not in the bucket: delete %s to start over with a first snapshot", latestKey, indexKey, latestKey)
	}
	ix, err := parseDHIndex(data)
	if err != nil {
		return nil, fmt.Errorf("%s is not a Distant Horizons index: %w", indexKey, err)
	}
	return &dhLatestIndex{Index: ix, IndexKey: indexKey}, nil
}

func (p *dhRunPlan) localIndex() *DHIndex {
	data, err := os.ReadFile(filepath.Join(p.StageDir, dhIndexFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err == nil {
		var ix DHIndex
		if ix, err = parseDHIndex(data); err == nil {
			return &ix
		}
	}
	p.narrate("Ignoring the " + dhIndexFile + " in the staging folder (" + err.Error() + "): every part will be staged")
	return nil
}

// --- the warning ---

// warn tells the players at the lead time, then at one minute and ten seconds
// before the stop (each only when the lead time reaches it), waiting between. A
// warning that cannot be sent stops the run with the server still up: stopping
// players' server unannounced is the one thing this block promises not to do.
func (p *dhRunPlan) warn(ctx context.Context) error {
	if p.Lead == 0 {
		return nil
	}
	left := []time.Duration{p.Lead}
	for _, mark := range []time.Duration{time.Minute, 10 * time.Second} {
		if p.Lead > mark {
			left = append(left, mark)
		}
	}
	p.narrate(fmt.Sprintf("Distant Horizons snapshot: the server stops in %s", dhRemaining(p.Lead)))
	for i, remaining := range left {
		msg := strings.ReplaceAll(p.Message, "{time}", dhRemaining(remaining))
		if err := p.Host.Say(msg); err != nil {
			return fmt.Errorf("could not warn the players, so the server was not stopped: %w", err)
		}
		var next time.Duration
		if i+1 < len(left) {
			next = left[i+1]
		}
		if err := p.Sleep(ctx, remaining-next); err != nil {
			return fmt.Errorf("cancelled while waiting to stop the server: %w", err)
		}
	}
	return nil
}

// dhRemaining spells a time left for the players: "5 minutes", "10 seconds".
func dhRemaining(d time.Duration) string {
	secs := int(d.Round(time.Second) / time.Second)
	m, s := secs/60, secs%60
	var parts []string
	if m > 0 {
		parts = append(parts, plural(m, "minute"))
	}
	if s > 0 || m == 0 {
		parts = append(parts, plural(s, "second"))
	}
	return strings.Join(parts, " ")
}

func plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return fmt.Sprintf("%d %ss", n, unit)
}

// dhDuration spells a measured time: "2m 10s".
func dhDuration(d time.Duration) string {
	secs := int(d.Round(time.Second) / time.Second)
	switch {
	case secs >= 3600:
		return fmt.Sprintf("%dh %dm", secs/3600, secs%3600/60)
	case secs >= 60:
		return fmt.Sprintf("%dm %ds", secs/60, secs%60)
	}
	return fmt.Sprintf("%ds", secs)
}

// --- stop, copy, start ---

// stopCopyStart is the part that has the server down. The start call is made
// whatever the copy did, and the downtime ends when it returns. The host holds
// the server's power gate across all three, so nothing else (a graph triggered
// by the stop, a Start from the UI) can boot the server under the copy.
func (p *dhRunPlan) stopCopyStart(ctx context.Context, pre dhPreflight) (dhRunResult, error) {
	p.narrate("Stopping the server")
	stopAt := p.Now()
	var res dhRunResult
	var copyErr error
	stopErr, startErr := p.Host.WhileStopped(p.Grace, func() {
		res, copyErr = p.copy(ctx, pre)
		p.narrate("Starting the server again")
	})
	if stopErr != nil {
		// Stop fails without having stopped anything (another power action is in
		// progress, or the server is already gone), so there is nothing to start.
		return dhRunResult{}, fmt.Errorf("could not stop the server: %w", stopErr)
	}
	res.Downtime = p.Now().Sub(stopAt)

	switch {
	case copyErr != nil && startErr != nil:
		return res, fmt.Errorf("%w; the server could not be started again either: %v", copyErr, startErr)
	case copyErr != nil:
		p.narrate("The snapshot failed; the server was started again")
		return res, copyErr
	case startErr != nil:
		return res, fmt.Errorf("the snapshot was staged, but the server could not be started again: %w", startErr)
	}
	p.narrate(fmt.Sprintf("Server started again after %s offline", dhDuration(res.Downtime)))
	p.pruneStaging(pre)
	return res, nil
}

// copy reads the stopped databases and stages what the previous snapshot lacks.
func (p *dhRunPlan) copy(ctx context.Context, pre dhPreflight) (dhRunResult, error) {
	var res dhRunResult
	if err := checkNoWAL(pre.src.Levels); err != nil {
		return res, err
	}
	if err := os.MkdirAll(p.StageDir, 0755); err != nil {
		return res, fmt.Errorf("create %s: %w", p.StageDir, err)
	}
	keys, err := snapshotKeys(p.KeyPrefix, p.Token, p.Now())
	if err != nil {
		return res, err
	}

	p.narrate(fmt.Sprintf("Server stopped; reading %d database(s)", len(pre.src.Levels)))
	var read int64
	last := time.Now()
	ix, absent, err := p.Stage(ctx, pre.src, pre.prev, p.StageDir, keys, func(n int64) {
		read += n
		if time.Since(last) >= dhProgressEvery {
			last = time.Now()
			p.narrate(fmt.Sprintf("Snapshot: %s read", fmtBytes(read)))
		}
	})
	if err != nil {
		return res, fmt.Errorf("copying the databases failed: %w", err)
	}
	data, err := ix.Marshal()
	if err != nil {
		return res, err
	}
	if err := writeFileAtomic(filepath.Join(p.StageDir, dhIndexFile), data, 0644); err != nil {
		return res, fmt.Errorf("write %s: %w", dhIndexFile, err)
	}

	res.Folder = p.StageDir
	res.PartsChanged = len(absent)
	for _, part := range absent {
		res.BytesChanged += part.Size
	}
	for _, l := range ix.Levels {
		res.PartsTotal += len(l.Parts)
	}
	p.narrate(fmt.Sprintf("Staged %d of %d part(s), %s changed", res.PartsChanged, res.PartsTotal, fmtBytes(res.BytesChanged)))
	return res, nil
}

// checkNoWAL refuses a database with a -wal or -shm file beside it. SQLite
// removes both when the last connection closes cleanly, so one that is still
// there means the server did not shut down cleanly, and the main file alone may
// miss writes that only the log holds. The block never opens a database to
// replay it, so the run fails here; the server is started again, which is what
// lets DH recover its own file.
func checkNoWAL(levels []DHLevel) error {
	for _, l := range levels {
		for _, suffix := range []string{"-wal", "-shm"} {
			side := l.Path + suffix
			if _, err := os.Lstat(side); err == nil {
				return fmt.Errorf("%s sits beside %s: the server did not close the database cleanly, so a copy could miss writes. Nothing was staged; the server is started again so Distant Horizons can recover it, then run the snapshot once more",
					filepath.Base(side), l.Folder)
			} else if !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("check %s: %w", side, err)
			}
		}
	}
	return nil
}

// pruneStaging removes staged parts the snapshot no longer needs, so the staging
// folder holds what changed and does not grow by a snapshot's worth every run. A
// part is kept when the new index names it, unless the previous index came from
// the bucket and names it too, because then it is already up. Only files named
// like a part are touched, and a failure is narrated rather than failing a
// snapshot that is staged and whose server is already back.
func (p *dhRunPlan) pruneStaging(pre dhPreflight) {
	data, err := os.ReadFile(filepath.Join(p.StageDir, dhIndexFile))
	if err != nil {
		return
	}
	ix, err := parseDHIndex(data)
	if err != nil {
		return
	}
	var up *DHIndex
	if pre.prevFromBucket {
		up = pre.prev
	}
	if err := pruneStagedParts(p.StageDir, ix, up); err != nil {
		p.narrate("Could not clear old parts from the staging folder: " + err.Error())
	}
}

func pruneStagedParts(stageDir string, ix DHIndex, uploaded *DHIndex) error {
	dir := filepath.Join(stageDir, "parts")
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	live := ix.partSet()
	var up map[string]struct{}
	if uploaded != nil {
		up = uploaded.partSet()
	}
	var firstErr error
	for _, e := range entries {
		name := e.Name()
		if !e.Type().IsRegular() || !reDHPartName.MatchString(name) {
			continue
		}
		_, inIndex := live[name]
		_, isUp := up[name]
		if inIndex && !isUp {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
