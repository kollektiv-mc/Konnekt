package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ─── The snapshot run (#481) ──────────────────────────────────────────────
//
// runDHSnapshot is driven through fakes for the server and the bucket and a fake
// clock, so the order of warn, stop, copy and start is asserted from one log and
// no test waits. The databases are byte files: nothing here is SQLite and nothing
// opens one.

const dhRunConfig = "serverId = 7\nserverKey = \"frang\"\nlevelKeyPrefix = \"pfx\"\n"

// dhRunDB is a stand-in database: the SQLite header, then filler that differs by
// part. n is the whole length.
func dhRunDB(n int, seed byte) []byte {
	return append([]byte("SQLite format 3\x00"), dhBytes(n-16, seed)...)
}

type dhRunFixture struct {
	t          *testing.T
	workingDir string
	worldDir   string
	stageDir   string
	log        []string
	narration  []string
	now        time.Time
	host       *fakeDHHost
	plan       dhRunPlan
}

type fakeDHHost struct {
	f         *dhRunFixture
	running   bool
	canWarn   bool
	sayErr    error
	stopErr   error
	startErr  error
	onStop    func()
	stopTook  time.Duration
	startTook time.Duration
}

func (h *fakeDHHost) IsRunning() bool { return h.running }
func (h *fakeDHHost) CanWarn() bool   { return h.canWarn }
func (h *fakeDHHost) Say(message string) error {
	h.f.log = append(h.f.log, "say:"+message)
	return h.sayErr
}
func (h *fakeDHHost) Stop(grace time.Duration) error {
	h.f.log = append(h.f.log, "stop:"+grace.String())
	h.f.now = h.f.now.Add(h.stopTook)
	if h.onStop != nil {
		h.onStop()
	}
	return h.stopErr
}
func (h *fakeDHHost) Start() error {
	h.f.log = append(h.f.log, "start")
	h.f.now = h.f.now.Add(h.startTook)
	return h.startErr
}
func (h *fakeDHHost) Narrate(line string) { h.f.narration = append(h.f.narration, line) }

// fakeIndexReader stands in for the bucket's latest.json.
type fakeIndexReader struct {
	data  []byte
	found bool
	err   error
	keys  []string
}

func (r *fakeIndexReader) GetObject(_ context.Context, key string) ([]byte, bool, error) {
	r.keys = append(r.keys, key)
	return r.data, r.found, r.err
}

func newDHRunFixture(t *testing.T) *dhRunFixture {
	t.Helper()
	wd, world := dhServer(t, dhRunConfig, dhFabricJar, "DistantHorizons-3.3.3-b-1.21.1-fabric.jar")
	dhWrite(t, world, "data/DistantHorizons.sqlite", dhRunDB(5*dhTestPart+100, 1))
	f := &dhRunFixture{
		t: t, workingDir: wd, worldDir: world,
		stageDir: filepath.Join(t.TempDir(), "stage"),
		now:      time.Date(2026, 10, 11, 4, 0, 0, 0, time.UTC),
	}
	f.host = &fakeDHHost{f: f, running: true, canWarn: true, stopTook: 5 * time.Second, startTook: 30 * time.Second}
	f.plan = dhRunPlan{
		Host: f.host, WorkingDir: wd, WorldDir: world, StageDir: f.stageDir,
		Lead: 5 * time.Minute, Message: "Stopping in {time}", Grace: time.Minute,
		PartSize: dhTestPart,
		Now:      func() time.Time { return f.now },
		Sleep: func(ctx context.Context, d time.Duration) error {
			f.log = append(f.log, "sleep:"+d.String())
			f.now = f.now.Add(d)
			return ctx.Err()
		},
		FreeSpace: func(string) (uint64, error) { return 1 << 40, nil },
	}
	// The copy takes a minute and a half of the fake clock, and is logged so its
	// place between the stop and the start is part of the order under test.
	f.plan.Stage = func(ctx context.Context, src DHSnapshotSource, prev *DHIndex, dir string, keys SnapshotKeys, progress func(int64)) (DHIndex, []DHPart, error) {
		f.log = append(f.log, "copy")
		f.now = f.now.Add(90 * time.Second)
		return stageDHSnapshotRun(src, prev, keys, dhStage{Dir: dir, PartSize: dhTestPart, Ctx: ctx, Progress: progress})
	}
	return f
}

func (f *dhRunFixture) run() (dhRunResult, error) {
	return runDHSnapshot(context.Background(), f.plan)
}

func (f *dhRunFixture) logged(prefix string) bool {
	for _, l := range f.log {
		if strings.HasPrefix(l, prefix) {
			return true
		}
	}
	return false
}

func (f *dhRunFixture) db() string {
	return filepath.Join(f.worldDir, "data", "DistantHorizons.sqlite")
}

func (f *dhRunFixture) stagedParts() []string {
	f.t.Helper()
	entries, err := os.ReadDir(filepath.Join(f.stageDir, "parts"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		f.t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func (f *dhRunFixture) stagedIndex() DHIndex {
	f.t.Helper()
	data, err := os.ReadFile(filepath.Join(f.stageDir, dhIndexFile))
	if err != nil {
		f.t.Fatal(err)
	}
	ix, err := parseDHIndex(data)
	if err != nil {
		f.t.Fatal(err)
	}
	return ix
}

func (f *dhRunFixture) assertUntouched(what string) {
	f.t.Helper()
	for _, bad := range []string{"say:", "stop:", "start", "copy"} {
		if f.logged(bad) {
			f.t.Errorf("%s: %q happened (log %v)", what, bad, f.log)
		}
	}
	if _, err := os.Stat(f.stageDir); err == nil {
		f.t.Errorf("%s: the staging folder was created", what)
	}
}

// flipPart changes one byte inside part n of the stand-in database.
func (f *dhRunFixture) flipPart(n int) {
	f.t.Helper()
	data, err := os.ReadFile(f.db())
	if err != nil {
		f.t.Fatal(err)
	}
	data[n*dhTestPart+10] ^= 0xFF
	if err := os.WriteFile(f.db(), data, 0644); err != nil {
		f.t.Fatal(err)
	}
}

// --- the order ---

func TestDHRunWarnsStopsCopiesAndStartsInOrder(t *testing.T) {
	f := newDHRunFixture(t)
	res, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"say:Stopping in 5 minutes", "sleep:4m0s",
		"say:Stopping in 1 minute", "sleep:50s",
		"say:Stopping in 10 seconds", "sleep:10s",
		"stop:1m0s", "copy", "start",
	}
	if strings.Join(f.log, "|") != strings.Join(want, "|") {
		t.Errorf("order:\n got %v\nwant %v", f.log, want)
	}
	if res.PartsChanged != 6 || res.PartsTotal != 6 || res.BytesChanged != 5*dhTestPart+100 || res.Folder != f.stageDir {
		t.Errorf("result = %+v", res)
	}
	// The first snapshot stages every part and an index.
	if got := len(f.stagedParts()); got != 6 {
		t.Errorf("staged %d part files, want 6", got)
	}
	// Stop took 5s, the copy 90s, the start 30s; the warning's five minutes are
	// before the stop and are not downtime.
	if res.Downtime != 125*time.Second {
		t.Errorf("downtime = %v, want 2m5s", res.Downtime)
	}
}

func TestDHRunIndexMatchesTheJarAndTheConfig(t *testing.T) {
	f := newDHRunFixture(t)
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	ix := f.stagedIndex()
	if ix.DHVersion != "3.3.3-b" {
		t.Errorf("dhVersion = %q, want the jar's 3.3.3-b", ix.DHVersion)
	}
	if ix.ServerFolder != "7_frang" {
		t.Errorf("serverFolder = %q, want <serverId>_<serverKey>", ix.ServerFolder)
	}
	if len(ix.Levels) != 1 || ix.Levels[0].Folder != "pfx@minecraft@@overworld" {
		t.Errorf("levels = %+v", ix.Levels)
	}
	if ix.PartsBase != "../../parts/" || ix.CreatedAt != formatDHCreatedAt(time.Date(2026, 10, 11, 4, 5, 5, 0, time.UTC)) {
		t.Errorf("partsBase %q, createdAt %q", ix.PartsBase, ix.CreatedAt)
	}
}

func TestDHRunWarnsOnlyAsOftenAsTheLeadTimeReaches(t *testing.T) {
	tests := []struct {
		lead time.Duration
		want []string
	}{
		{2 * time.Minute, []string{"say:Stopping in 2 minutes", "sleep:1m0s", "say:Stopping in 1 minute", "sleep:50s", "say:Stopping in 10 seconds", "sleep:10s"}},
		{time.Minute, []string{"say:Stopping in 1 minute", "sleep:50s", "say:Stopping in 10 seconds", "sleep:10s"}},
		{45 * time.Second, []string{"say:Stopping in 45 seconds", "sleep:35s", "say:Stopping in 10 seconds", "sleep:10s"}},
		{10 * time.Second, []string{"say:Stopping in 10 seconds", "sleep:10s"}},
		{3 * time.Second, []string{"say:Stopping in 3 seconds", "sleep:3s"}},
		{90 * time.Second, []string{"say:Stopping in 1 minute 30 seconds", "sleep:30s", "say:Stopping in 1 minute", "sleep:50s", "say:Stopping in 10 seconds", "sleep:10s"}},
	}
	for _, tc := range tests {
		t.Run(tc.lead.String(), func(t *testing.T) {
			f := newDHRunFixture(t)
			f.plan.Lead = tc.lead
			if _, err := f.run(); err != nil {
				t.Fatal(err)
			}
			got := strings.Join(f.log[:len(f.log)-3], "|") // before stop, copy, start
			if got != strings.Join(tc.want, "|") {
				t.Errorf("got %v\nwant %v", f.log, tc.want)
			}
		})
	}
}

func TestDHRunWithNoLeadTimeWarnsNobodyAndNeedsNoWarningChannel(t *testing.T) {
	f := newDHRunFixture(t)
	f.plan.Lead = 0
	f.host.canWarn = false
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(f.log, "|") != "stop:1m0s|copy|start" {
		t.Errorf("log = %v", f.log)
	}
}

func TestDHRunPassesTheGraceToTheStop(t *testing.T) {
	f := newDHRunFixture(t)
	f.plan.Grace = 3 * time.Minute
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	if !f.logged("stop:3m0s") {
		t.Errorf("log = %v", f.log)
	}
}

// --- every refusal happens with the server up and nobody warned ---

func TestDHRunRefusesBeforeWarningOrStopping(t *testing.T) {
	tests := []struct {
		name  string
		setup func(f *dhRunFixture)
		want  []string
	}{
		{"empty serverKey", func(f *dhRunFixture) {
			dhWrite(t, f.workingDir, "config/DistantHorizons.toml", []byte("serverId = 7\nserverKey = \"\"\nlevelKeyPrefix = \"pfx\"\n"))
		}, []string{"serverKey is empty"}},
		{"empty levelKeyPrefix", func(f *dhRunFixture) {
			dhWrite(t, f.workingDir, "config/DistantHorizons.toml", []byte("serverId = 7\nserverKey = \"frang\"\nlevelKeyPrefix = \"\"\n"))
		}, []string{"levelKeyPrefix is empty"}},
		{"no config file", func(f *dhRunFixture) {
			if err := os.Remove(filepath.Join(f.workingDir, "config", "DistantHorizons.toml")); err != nil {
				t.Fatal(err)
			}
		}, []string{"DistantHorizons.toml was not found"}},
		{"no serverId", func(f *dhRunFixture) {
			dhWrite(t, f.workingDir, "config/DistantHorizons.toml", []byte(dhTestConfig))
		}, []string{"serverId is not set"}},
		{"a serverId that is not a number", func(f *dhRunFixture) {
			dhWrite(t, f.workingDir, "config/DistantHorizons.toml", []byte("serverId = \"abc\"\nserverKey = \"frang\"\nlevelKeyPrefix = \"pfx\"\n"))
		}, []string{"serverId", "not an integer"}},
		{"no Distant Horizons jar", func(f *dhRunFixture) {
			if err := os.RemoveAll(filepath.Join(f.workingDir, "mods")); err != nil {
				t.Fatal(err)
			}
		}, []string{"mods"}},
		{"no databases", func(f *dhRunFixture) {
			if err := os.RemoveAll(filepath.Join(f.worldDir, "data")); err != nil {
				t.Fatal(err)
			}
		}, []string{"DistantHorizons.sqlite"}},
		{"short disk", func(f *dhRunFixture) {
			f.plan.FreeSpace = func(string) (uint64, error) { return 3 << 20, nil }
		}, []string{"not enough free space", "3.0 MB is free", "5.1 KB", "databases"}},
		{"free space unreadable", func(f *dhRunFixture) {
			f.plan.FreeSpace = func(string) (uint64, error) { return 0, errors.New("statfs: boom") }
		}, []string{"statfs: boom"}},
		{"unreachable destination", func(f *dhRunFixture) {
			f.plan.Bucket = &fakeIndexReader{err: errors.New("s3 GetObject dh/latest.json: status 403 AccessDenied")}
			f.plan.BucketLabel = `"R2"`
			f.plan.KeyPrefix = "dh"
		}, []string{"cannot read the previous snapshot from", `"R2"`, "403"}},
		{"a latest.json that is not an index", func(f *dhRunFixture) {
			f.plan.Bucket = &fakeIndexReader{data: []byte("<html>"), found: true}
			f.plan.BucketLabel = `"R2"`
		}, []string{"latest.json", "not a Distant Horizons index"}},
		{"neither RCON nor stdin", func(f *dhRunFixture) { f.host.canWarn = false }, []string{"neither RCON nor the server's console"}},
		{"the server is not running", func(f *dhRunFixture) { f.host.running = false }, []string{"not running", "nothing to warn or stop"}},
		{"a lead time over the limit", func(f *dhRunFixture) { f.plan.Lead = time.Hour }, []string{"lead time"}},
		{"a negative lead time", func(f *dhRunFixture) { f.plan.Lead = -time.Second }, []string{"lead time"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newDHRunFixture(t)
			tc.setup(f)
			res, err := f.run()
			if err == nil {
				t.Fatal("the run was not refused")
			}
			for _, w := range tc.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("err = %q, want it to contain %q", err, w)
				}
			}
			f.assertUntouched(tc.name)
			if res.Downtime != 0 {
				t.Errorf("a refused run reports downtime %v", res.Downtime)
			}
		})
	}
}

func TestDHRunAnUnwarnableWarningStopsTheRunBeforeTheStop(t *testing.T) {
	f := newDHRunFixture(t)
	f.host.sayErr = errors.New("RCON: refused; console: server not running")
	_, err := f.run()
	if err == nil || !strings.Contains(err.Error(), "could not warn the players") {
		t.Fatalf("err = %v", err)
	}
	if f.logged("stop") || f.logged("copy") || f.logged("start") {
		t.Errorf("the server was touched after a failed warning: %v", f.log)
	}
}

func TestDHRunCancelledWhileWaitingNeverStops(t *testing.T) {
	f := newDHRunFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	f.plan.Sleep = func(ctx context.Context, d time.Duration) error {
		f.log = append(f.log, "sleep:"+d.String())
		cancel()
		return ctx.Err()
	}
	_, err := runDHSnapshot(ctx, f.plan)
	if err == nil || !strings.Contains(err.Error(), "cancelled") {
		t.Fatalf("err = %v", err)
	}
	if f.logged("stop") || f.logged("start") {
		t.Errorf("log = %v: a cancelled wait stopped a server it had not stopped", f.log)
	}
}

// --- after the stop, the server always comes back ---

func TestDHRunACopyFailureStillRestarts(t *testing.T) {
	f := newDHRunFixture(t)
	f.plan.Stage = func(context.Context, DHSnapshotSource, *DHIndex, string, SnapshotKeys, func(int64)) (DHIndex, []DHPart, error) {
		f.log = append(f.log, "copy")
		f.now = f.now.Add(20 * time.Second)
		return DHIndex{}, nil, errors.New("disk full")
	}
	res, err := f.run()
	if err == nil || !strings.Contains(err.Error(), "disk full") {
		t.Fatalf("err = %v", err)
	}
	if got := f.log[len(f.log)-3:]; strings.Join(got, "|") != "stop:1m0s|copy|start" {
		t.Errorf("tail of log = %v", got)
	}
	if res.Downtime != 55*time.Second {
		t.Errorf("downtime = %v: a failed run still reports how long the server was away", res.Downtime)
	}
	if res.Folder != "" {
		t.Errorf("a failed copy reports a staged folder: %+v", res)
	}
	if _, err := os.Stat(filepath.Join(f.stageDir, dhIndexFile)); err == nil {
		t.Error("an index was written for a failed copy")
	}
}

func TestDHRunAWalBesideADatabaseRefusesAndStillRestarts(t *testing.T) {
	for _, side := range []string{"-wal", "-shm"} {
		t.Run(side, func(t *testing.T) {
			f := newDHRunFixture(t)
			if err := os.WriteFile(f.db()+side, []byte("log"), 0644); err != nil {
				t.Fatal(err)
			}
			_, err := f.run()
			if err == nil || !strings.Contains(err.Error(), "DistantHorizons.sqlite"+side) || !strings.Contains(err.Error(), "did not close") {
				t.Fatalf("err = %v", err)
			}
			if !f.logged("start") {
				t.Errorf("log = %v: the server was not started again", f.log)
			}
			if f.logged("copy") {
				t.Errorf("log = %v: the copy ran with a log file beside the database", f.log)
			}
			if len(f.stagedParts()) != 0 {
				t.Errorf("parts were staged from an unclean database: %v", f.stagedParts())
			}
		})
	}
}

func TestDHRunACancelledContextDuringTheCopyStillRestarts(t *testing.T) {
	f := newDHRunFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	f.host.onStop = cancel // the limit runs out while the server is stopping
	res, err := runDHSnapshot(ctx, f.plan)
	if err == nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want it to wrap context.Canceled", err)
	}
	if !f.logged("start") {
		t.Errorf("log = %v: the server was not started again", f.log)
	}
	if res.Downtime == 0 {
		t.Error("downtime was not recorded")
	}
}

func TestDHRunACancelledContextBetweenPartsStopsTheRead(t *testing.T) {
	f := newDHRunFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	read := 0
	f.plan.Stage = func(ctx context.Context, src DHSnapshotSource, prev *DHIndex, dir string, keys SnapshotKeys, progress func(int64)) (DHIndex, []DHPart, error) {
		return stageDHSnapshotRun(src, prev, keys, dhStage{Dir: dir, PartSize: dhTestPart, Ctx: ctx, Progress: func(n int64) {
			read++
			if read == 2 {
				cancel()
			}
			progress(n)
		}})
	}
	_, err := runDHSnapshot(ctx, f.plan)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if read != 2 {
		t.Errorf("read %d parts, want the read to stop after the 2nd", read)
	}
	if !f.logged("start") {
		t.Error("the server was not started again")
	}
}

func TestDHRunABothFailingRestartReportsBothErrors(t *testing.T) {
	f := newDHRunFixture(t)
	f.plan.Stage = func(context.Context, DHSnapshotSource, *DHIndex, string, SnapshotKeys, func(int64)) (DHIndex, []DHPart, error) {
		return DHIndex{}, nil, errors.New("read failed")
	}
	f.host.startErr = errors.New("another power action is in progress")
	_, err := f.run()
	if err == nil || !strings.Contains(err.Error(), "read failed") || !strings.Contains(err.Error(), "another power action is in progress") {
		t.Fatalf("err = %v, want both", err)
	}
}

func TestDHRunARestartFailureAfterAGoodCopyIsStillAFailure(t *testing.T) {
	f := newDHRunFixture(t)
	f.host.startErr = errors.New("port 25565 is in use")
	res, err := f.run()
	if err == nil || !strings.Contains(err.Error(), "could not be started again") || !strings.Contains(err.Error(), "port 25565 is in use") {
		t.Fatalf("err = %v", err)
	}
	if res.Folder != f.stageDir || res.PartsChanged != 6 {
		t.Errorf("result = %+v: the staged snapshot is still reported", res)
	}
	if res.Downtime != 125*time.Second {
		t.Errorf("downtime = %v", res.Downtime)
	}
}

func TestDHRunAStopThatFailsMeansNothingWasStoppedAndNothingIsStarted(t *testing.T) {
	f := newDHRunFixture(t)
	f.host.stopErr = ErrPowerActionInProgress
	res, err := f.run()
	if err == nil || !strings.Contains(err.Error(), "could not stop the server") {
		t.Fatalf("err = %v", err)
	}
	if f.logged("copy") || f.logged("start") {
		t.Errorf("log = %v", f.log)
	}
	if res.Downtime != 0 {
		t.Errorf("downtime = %v for a server that was never stopped", res.Downtime)
	}
}

// --- what is staged ---

func TestDHRunASecondRunStagesExactlyTheChangedPart(t *testing.T) {
	f := newDHRunFixture(t)
	first, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	if first.PartsChanged != 6 {
		t.Fatalf("first run changed %d parts", first.PartsChanged)
	}
	before := map[string]bool{}
	for _, n := range f.stagedParts() {
		before[n] = true
	}

	f.flipPart(2)
	f.log = nil
	second, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	if second.PartsChanged != 1 || second.PartsTotal != 6 || second.BytesChanged != dhTestPart {
		t.Errorf("second run = %+v, want 1 changed of 6", second)
	}
	// Without a bucket the previous index is the one in the staging folder, so
	// the parts it names stay and the replaced one goes.
	var added []string
	for _, n := range f.stagedParts() {
		if !before[n] {
			added = append(added, n)
		}
	}
	if len(added) != 1 {
		t.Errorf("the second run added %d part files, want 1", len(added))
	}
	if got := len(f.stagedParts()); got != 6 {
		t.Errorf("%d part files after the second run, want the 6 the index names", got)
	}
	ix := f.stagedIndex()
	for _, n := range f.stagedParts() {
		if _, ok := ix.partSet()[n]; !ok {
			t.Errorf("staged part %s is not in the index", n)
		}
	}
}

func TestDHRunWithABucketStagesOnlyWhatTheBucketLacks(t *testing.T) {
	f := newDHRunFixture(t)
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	latest, err := os.ReadFile(filepath.Join(f.stageDir, dhIndexFile))
	if err != nil {
		t.Fatal(err)
	}

	// The same staging folder, still holding the first run's six parts, and a
	// bucket whose latest.json is that first index: everything in it is up.
	f.flipPart(4)
	f.log = nil
	reader := &fakeIndexReader{data: latest, found: true}
	f.plan.Bucket, f.plan.BucketLabel, f.plan.KeyPrefix = reader, `"R2"`, "dh/snap"
	res, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.keys) != 1 || reader.keys[0] != "dh/snap/latest.json" {
		t.Errorf("read %v, want the public layout's dh/snap/latest.json", reader.keys)
	}
	if res.PartsChanged != 1 || res.PartsTotal != 6 {
		t.Errorf("result = %+v, want 1 changed of 6", res)
	}
	if got := f.stagedParts(); len(got) != 1 {
		t.Errorf("staging holds %d part files, want only the one that changed: %v", len(got), got)
	}
}

func TestDHRunABucketWithNoLatestJSONIsAFirstSnapshot(t *testing.T) {
	f := newDHRunFixture(t)
	// A stale local index must not be trusted over the bucket.
	if err := os.MkdirAll(f.stageDir, 0755); err != nil {
		t.Fatal(err)
	}
	stale := DHIndex{Format: 1, Levels: []DHIndexLevel{{Folder: "x", Parts: []DHPart{{SHA256: strings.Repeat("a", 64)}}}}}
	data, err := stale.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	dhWrite(t, f.stageDir, dhIndexFile, data)

	f.plan.Bucket, f.plan.BucketLabel, f.plan.KeyPrefix = &fakeIndexReader{found: false}, `"R2"`, "dh"
	res, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsChanged != 6 {
		t.Errorf("changed %d parts, want all 6", res.PartsChanged)
	}
	if !strings.Contains(strings.Join(f.narration, "\n"), "first snapshot") {
		t.Errorf("narration = %v", f.narration)
	}
}

func TestDHRunIgnoresALocalIndexItCannotReadAndSaysSo(t *testing.T) {
	f := newDHRunFixture(t)
	dhWrite(t, f.stageDir, dhIndexFile, []byte("not json"))
	res, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsChanged != 6 {
		t.Errorf("changed %d parts, want all 6", res.PartsChanged)
	}
	if !strings.Contains(strings.Join(f.narration, "\n"), "Ignoring the index.json") {
		t.Errorf("narration = %v", f.narration)
	}
}

func TestDHRunNarratesTheStages(t *testing.T) {
	f := newDHRunFixture(t)
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	all := strings.Join(f.narration, "\n")
	for _, want := range []string{"the server stops in 5 minutes", "Stopping the server", "reading 1 database(s)", "Staged 6 of 6 part(s)", "Starting the server again", "after 2m 5s offline"} {
		if !strings.Contains(all, want) {
			t.Errorf("narration lacks %q:\n%s", want, all)
		}
	}
}

func TestDHRunNarratesProgressOfALongRead(t *testing.T) {
	old := dhProgressEvery
	dhProgressEvery = 0
	t.Cleanup(func() { dhProgressEvery = old })

	f := newDHRunFixture(t)
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range f.narration {
		if strings.HasPrefix(l, "Snapshot: ") && strings.HasSuffix(l, " read") {
			n++
		}
	}
	if n != 6 {
		t.Errorf("%d progress lines, want one per part:\n%s", n, strings.Join(f.narration, "\n"))
	}
}

// --- pieces ---

func TestPruneStagedParts(t *testing.T) {
	dir := t.TempDir()
	h := func(c string) string { return strings.Repeat(c, 64) }
	for _, name := range []string{h("a"), h("b"), h("c"), "README.txt", "short", strings.ToUpper(h("d"))} {
		dhWrite(t, dir, "parts/"+name, []byte("x"))
	}
	if err := os.MkdirAll(filepath.Join(dir, "parts", h("e")), 0755); err != nil {
		t.Fatal(err)
	}
	ix := DHIndex{Levels: []DHIndexLevel{{Parts: []DHPart{{SHA256: h("a")}, {SHA256: h("b")}}}}}
	up := DHIndex{Levels: []DHIndexLevel{{Parts: []DHPart{{SHA256: h("a")}}}}}

	if err := pruneStagedParts(dir, ix, &up); err != nil {
		t.Fatal(err)
	}
	// a is in the index but already up, c is stale. b is new and stays, and so
	// does everything that is not named like a part, a directory included.
	for _, gone := range []string{h("a"), h("c")} {
		if _, err := os.Stat(filepath.Join(dir, "parts", gone)); err == nil {
			t.Errorf("%s... was kept", gone[:4])
		}
	}
	for _, kept := range []string{h("b"), "README.txt", "short", strings.ToUpper(h("d")), h("e")} {
		if _, err := os.Stat(filepath.Join(dir, "parts", kept)); err != nil {
			t.Errorf("%s was removed: %v", kept, err)
		}
	}

	if err := pruneStagedParts(filepath.Join(dir, "missing"), ix, nil); err != nil {
		t.Errorf("a staging folder with no parts is not an error: %v", err)
	}
}

func TestReadDHServerID(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name, content, want string
	}{
		{"bare integer", "serverId = 123456\n", "123456"},
		{"negative, in a table, with CRLF", "[server]\r\n\tserverId = -987 # random\r\n", "-987"},
		{"quoted", "serverId = \"55\"\n", "55"},
		{"absent", "serverKey = \"x\"\n", ""},
		{"commented out", "# serverId = 4\n", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := dhWrite(t, root, tc.name+".toml", []byte(tc.content))
			got, err := readDHServerID(p)
			if err != nil || got != tc.want {
				t.Errorf("got (%q, %v), want %q", got, err, tc.want)
			}
		})
	}
	if got, err := readDHServerID(filepath.Join(root, "absent.toml")); err != nil || got != "" {
		t.Errorf("a missing file = (%q, %v), want empty", got, err)
	}
	if _, err := readDHServerID(root); err == nil {
		t.Error("a directory read as a config")
	}
}

func TestDHDurations(t *testing.T) {
	remaining := map[time.Duration]string{
		time.Second: "1 second", 10 * time.Second: "10 seconds", time.Minute: "1 minute",
		5 * time.Minute: "5 minutes", 90 * time.Second: "1 minute 30 seconds", 61 * time.Second: "1 minute 1 second",
	}
	for d, want := range remaining {
		if got := dhRemaining(d); got != want {
			t.Errorf("dhRemaining(%v) = %q, want %q", d, got, want)
		}
	}
	spent := map[time.Duration]string{
		0: "0s", 45 * time.Second: "45s", 130 * time.Second: "2m 10s", 3725 * time.Second: "1h 2m",
	}
	for d, want := range spent {
		if got := dhDuration(d); got != want {
			t.Errorf("dhDuration(%v) = %q, want %q", d, got, want)
		}
	}
}

func TestNearestExistingDir(t *testing.T) {
	root := t.TempDir()
	if got := nearestExistingDir(filepath.Join(root, "a", "b", "c")); got != root {
		t.Errorf("got %s, want %s", got, root)
	}
	if got := nearestExistingDir(root); got != root {
		t.Errorf("got %s, want %s", got, root)
	}
	f := dhWrite(t, root, "file", []byte("x"))
	if got := nearestExistingDir(filepath.Join(f, "below")); got != root {
		t.Errorf("a file is not a directory: got %s, want %s", got, root)
	}
}

func TestFreeDiskBytesReadsTheRealVolume(t *testing.T) {
	free, err := freeDiskBytes(t.TempDir())
	if err != nil || free == 0 {
		t.Errorf("freeDiskBytes = (%d, %v)", free, err)
	}
	if _, err := freeDiskBytes(filepath.Join(t.TempDir(), "absent")); err == nil {
		t.Error("a folder that does not exist has no free space to read")
	}
}
