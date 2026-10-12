package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// The run behind action.dhPublish (#565): read the staged snapshot, send the
// parts the bucket lacks, have the bucket assemble each level's whole database,
// write the index and the download page, and only then latest.json. It owns the
// order and nothing else; the bucket sits behind one interface so the sequence is
// testable, and the block (scheduler_blocks_dhpublish.go) is a thin reader of
// config and services around it.
//
// The invariant the order exists for: latest.json is the last object written, so
// a reader that finds it finds an index whose parts, assembled files and page are
// all already there. A run cut off anywhere before it leaves the previous
// snapshot as the current one, and a second run resumes: parts are named by their
// hash and are never sent twice.

// dhPublishStore is the bucket as a publish uses it. *S3Client is the real one.
type dhPublishStore interface {
	dhPruneStore
	dhAssembleStore
	HeadObject(ctx context.Context, key string) (S3ObjectInfo, bool, error)
	PutObject(ctx context.Context, key, localPath string, opts S3PutOptions) error
	PutObjectBytes(ctx context.Context, key string, data []byte, opts S3PutOptions) error
	ObjectURL(key string) string
}

// dhPublishPlan is everything runDHPublish needs.
type dhPublishPlan struct {
	Store dhPublishStore
	// Label is what the narration calls the destination.
	Label string
	// KeyPrefix is the destination's prefix, then the node's.
	KeyPrefix string
	// Token is the destination's private link token, empty for the public
	// layout (#561). It is a credential: the run replaces it in everything it
	// narrates, reports or returns, and the URL in the result is the one with the
	// token marked out, since the link is copied from Settings and from nowhere else.
	Token string
	// StageDir is the staged folder, already resolved and checked. It is read and
	// never written.
	StageDir string
	// Keep is how many snapshots the bucket keeps once this one is published. Zero
	// prunes nothing; the block always passes at least 1.
	Keep int
	// PublicBaseURL, when the destination has one, is where the published
	// latest.json is linked from; otherwise the bucket's own object address is.
	PublicBaseURL string
	Narrate       func(line string)
}

// dhPublishResult is what a publish did. It is filled in as far as the run got.
type dhPublishResult struct {
	URL             string
	PartsUploaded   int
	PartsSkipped    int
	BytesSent       int64
	LevelsAssembled int

	// What the prune after the publish deleted, and Warning when it could not run
	// to the end. A failed prune is not a failed publish: the snapshot is up and
	// valid, and the next run prunes again.
	SnapshotsDeleted int
	PartsDeleted     int
	BytesFreed       int64
	Warning          string
}

var (
	// reDHPublishFolder is what a level folder may be in an index being
	// published: DH's own charset plus the '@' that joins the parts. It keeps a
	// folder from being a path, a URL or a second key.
	reDHPublishFolder = regexp.MustCompile(`^[A-Za-z0-9_@-]+$`)
	reDHWholeHash     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// dhStaged is the staged snapshot after it has been read and checked.
type dhStaged struct {
	IndexBytes []byte
	Index      DHIndex
	Keys       SnapshotKeys
}

// dhPartPlan is one distinct part of the snapshot and what to do about it. Path
// is the staged file to send, or empty when the bucket is known to hold it.
type dhPartPlan struct {
	SHA256 string
	Size   int64
	Path   string
}

type dhPublisher struct {
	dhPublishPlan
	prev *dhLatestIndex
}

func (p *dhPublisher) narrate(line string) {
	if p.Narrate != nil {
		p.Narrate(p.redact(line))
	}
}

// redact marks the private link's token out of text the run hands to anyone:
// object keys and URLs carry it. A public run has none, and replacing the empty
// string would mark between every character, so it returns the text as it is.
func (p *dhPublisher) redact(s string) string {
	if p.Token == "" {
		return s
	}
	return strings.ReplaceAll(s, p.Token, s3Redacted)
}

// runDHPublish runs the sequence. It returns an error for any failure, with the
// result so far.
func runDHPublish(ctx context.Context, plan dhPublishPlan) (dhPublishResult, error) {
	p := &dhPublisher{dhPublishPlan: plan}
	var res dhPublishResult

	st, err := readStagedSnapshot(plan.StageDir, plan.KeyPrefix, plan.Token)
	if err != nil {
		return res, err
	}
	page, err := renderDHPage(st.Index)
	if err != nil {
		return res, err
	}
	if p.prev, err = readLatestIndex(ctx, plan.Store, st.Keys.Latest); err != nil {
		return res, fmt.Errorf("cannot read the previous snapshot from %s: %w", plan.Label, err)
	}
	if p.prev == nil {
		p.narrate(fmt.Sprintf("No %s in %s: this is a first publish", st.Keys.Latest, plan.Label))
	}

	parts, err := p.planParts(ctx, st)
	if err != nil {
		return res, err
	}
	if err := p.sendParts(ctx, st, parts, &res); err != nil {
		return res, err
	}
	if err := p.assembleLevels(ctx, st, &res); err != nil {
		return res, err
	}

	p.narrate("Writing the index and the download page")
	if err := plan.Store.PutObjectBytes(ctx, st.Keys.Index, st.IndexBytes, S3PutOptions{}); err != nil {
		return res, readableUploadError(err)
	}
	if err := plan.Store.PutObjectBytes(ctx, st.Keys.Page, page, S3PutOptions{}); err != nil {
		return res, readableUploadError(err)
	}
	if err := p.writeLatest(ctx, st); err != nil {
		return res, err
	}
	res.URL = p.redact(p.publishedURL(st.Keys.Latest))
	p.narrate("Published: " + res.URL)
	if p.Token != "" {
		p.narrate("The snapshot is under a private link: copy it from Settings, in the destination's Snapshot link row")
	}
	p.prune(ctx, st, &res)
	return res, nil
}

// prune is the last step: it keeps plan.Keep snapshots and deletes the rest. It
// runs only after latest.json is written and res.URL is set, and its failure is
// a warning on the result, never an error.
func (p *dhPublisher) prune(ctx context.Context, st dhStaged, res *dhPublishResult) {
	if p.Keep < 1 {
		return
	}
	pr, err := pruneDHSnapshots(ctx, p.Store, st.Keys, p.Keep, p.narrate)
	res.SnapshotsDeleted, res.PartsDeleted, res.BytesFreed = pr.SnapshotsDeleted, pr.PartsDeleted, pr.BytesFreed
	if err != nil {
		lead := "Prune skipped: "
		if pr.SnapshotsDeleted > 0 {
			lead = "Prune incomplete: "
		}
		res.Warning = p.redact(lead + err.Error())
		p.narrate(res.Warning)
	}
}

// --- reading what was staged ---

// readStagedSnapshot reads and checks the staged index.json, and lays out the
// snapshot's keys from the time it states. Everything in the index that becomes
// part of a path or a key is checked here, before anything is sent: the index is
// a file in a folder the graph names.
func readStagedSnapshot(stageDir, keyPrefix, token string) (dhStaged, error) {
	indexPath := filepath.Join(stageDir, dhIndexFile)
	data, err := readBounded(indexPath, s3GetBodyLimit)
	if errors.Is(err, os.ErrNotExist) {
		return dhStaged{}, fmt.Errorf("there is no %s in %s: run a Distant Horizons snapshot first, or point this block at its staged folder", dhIndexFile, stageDir)
	}
	if err != nil {
		return dhStaged{}, err
	}
	ix, err := parseDHIndex(data)
	if err != nil {
		return dhStaged{}, fmt.Errorf("%s in %s: %w", dhIndexFile, stageDir, err)
	}
	created, err := checkDHIndexForPublish(ix)
	if err != nil {
		return dhStaged{}, fmt.Errorf("%s in %s: %w", dhIndexFile, stageDir, err)
	}
	keys, err := snapshotKeys(keyPrefix, token, created)
	if err != nil {
		return dhStaged{}, err
	}
	if ix.PartsBase != keys.PartsBase {
		return dhStaged{}, fmt.Errorf("%s in %s was staged for a different layout (partsBase %q, expected %q): run the snapshot again", dhIndexFile, stageDir, ix.PartsBase, keys.PartsBase)
	}
	return dhStaged{IndexBytes: data, Index: ix, Keys: keys}, nil
}

// readBounded reads a whole file, refusing one over limit bytes.
func readBounded(p string, limit int64) ([]byte, error) {
	info, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file", p)
	}
	if info.Size() > limit {
		return nil, fmt.Errorf("%s is %s, over the %s a snapshot index may be", p, fmtBytes(info.Size()), fmtBytes(limit))
	}
	return os.ReadFile(p)
}

// checkDHIndexForPublish refuses an index that cannot be published as stated,
// and returns the time it was taken. A level needs at least one part, and at most
// as many as one multipart upload takes; every part but a level's last is the
// same length, which R2 requires of the parts of an upload; and a folder or hash
// that would become a path is refused.
func checkDHIndexForPublish(ix DHIndex) (time.Time, error) {
	if len(ix.Levels) == 0 {
		return time.Time{}, errors.New("the snapshot has no levels, so there is nothing to publish")
	}
	created, err := time.Parse(time.RFC3339, ix.CreatedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("createdAt %q is not an RFC 3339 time", ix.CreatedAt)
	}
	if !reDHKeyChars.MatchString(ix.ServerFolder) {
		return time.Time{}, fmt.Errorf("serverFolder %q must be letters, digits, '_' and '-'", ix.ServerFolder)
	}
	seen := map[string]struct{}{}
	for _, l := range ix.Levels {
		if !reDHPublishFolder.MatchString(l.Folder) {
			return time.Time{}, fmt.Errorf("level folder %q must be letters, digits, '_', '-' and '@'", l.Folder)
		}
		if _, dup := seen[l.Folder]; dup {
			return time.Time{}, fmt.Errorf("level folder %s is listed twice", l.Folder)
		}
		seen[l.Folder] = struct{}{}
		if err := checkDHLevelForPublish(l); err != nil {
			return time.Time{}, fmt.Errorf("level %s: %w", l.Folder, err)
		}
	}
	return created, nil
}

func checkDHLevelForPublish(l DHIndexLevel) error {
	switch {
	case len(l.Parts) == 0:
		return errors.New("has no parts, so there is no file to assemble")
	case len(l.Parts) > s3MaxMultipartParts:
		return fmt.Errorf("has %d parts, over the %d one assembled file may have", len(l.Parts), s3MaxMultipartParts)
	case !reDHWholeHash.MatchString(l.SHA256):
		return errors.New("has no whole-file sha256")
	}
	var total int64
	for i, part := range l.Parts {
		if !reDHPartName.MatchString(part.SHA256) {
			return fmt.Errorf("part %d has a name that is not a sha256", i+1)
		}
		if part.Size <= 0 || part.Size > maxUploadObjectBytes {
			return fmt.Errorf("part %d has size %d", i+1, part.Size)
		}
		if i < len(l.Parts)-1 && part.Size != l.Parts[0].Size {
			return fmt.Errorf("part %d is %d bytes where the first is %d: all parts but the last must be the same length", i+1, part.Size, l.Parts[0].Size)
		}
		total += part.Size
	}
	if total != l.Size {
		return fmt.Errorf("its parts add up to %d bytes where the index says %d", total, l.Size)
	}
	return nil
}

// --- the parts ---

// planParts decides, for each distinct part in index order, whether it is to be
// sent or is known to be up, and refuses the run if any part is neither before a
// byte is sent. A part is up when the previous snapshot's index names it
// (latest.json is written last, so everything its index names is there), or when
// a HEAD finds it at the size the index states. A staged part the previous index
// also names is not sent again.
func (p *dhPublisher) planParts(ctx context.Context, st dhStaged) ([]dhPartPlan, error) {
	var prevParts map[string]struct{}
	if p.prev != nil {
		prevParts = p.prev.Index.partSet()
	}
	seen := map[string]struct{}{}
	var plan []dhPartPlan
	var missing []string
	for _, l := range st.Index.Levels {
		for _, part := range l.Parts {
			if _, dup := seen[part.SHA256]; dup {
				continue
			}
			seen[part.SHA256] = struct{}{}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			_, upOnPrev := prevParts[part.SHA256]
			entry := dhPartPlan{SHA256: part.SHA256, Size: part.Size}
			staged, err := stagedPartPath(p.StageDir, part)
			switch {
			case err != nil:
				return nil, err
			case staged != "" && !upOnPrev:
				entry.Path = staged
			case staged == "" && !upOnPrev:
				info, found, err := p.Store.HeadObject(ctx, st.Keys.PartKey(part.SHA256))
				if err != nil {
					return nil, fmt.Errorf("check part %s: %w", part.SHA256, readableUploadError(err))
				}
				if !found || info.Size != part.Size {
					missing = append(missing, part.SHA256)
					continue
				}
			}
			plan = append(plan, entry)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("%d part(s) of this snapshot are neither staged nor in the bucket (the first is %s), so it cannot be published: run the snapshot again so they are staged", len(missing), missing[0])
	}
	return plan, nil
}

// stagedPartPath is the staged file for part, or "" when it is not staged. It
// must be a regular file (not a link out of the folder) of the length the index
// states.
func stagedPartPath(stageDir string, part DHPart) (string, error) {
	p := filepath.Join(stageDir, "parts", part.SHA256)
	info, err := os.Lstat(p)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("check staged part %s: %w", part.SHA256, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("staged part %s is not a regular file", part.SHA256)
	}
	if info.Size() != part.Size {
		return "", fmt.Errorf("staged part %s is %d bytes where the index says %d: run the snapshot again", part.SHA256, info.Size(), part.Size)
	}
	return p, nil
}

// sendParts PUTs each part that has a staged file, in order. The PUT carries
// If-None-Match, so a part the bucket already holds is left alone and its 412 is
// counted as skipped: parts are immutable and named by their hash.
func (p *dhPublisher) sendParts(ctx context.Context, st dhStaged, parts []dhPartPlan, res *dhPublishResult) error {
	var sendBytes int64
	toSend := 0
	for _, part := range parts {
		if part.Path != "" {
			toSend++
			sendBytes += part.Size
		}
	}
	if toSend > 0 {
		p.narrate(fmt.Sprintf("Uploading %d part(s), %s, to %s (%d more already there)", toSend, fmtBytes(sendBytes), p.Label, len(parts)-toSend))
	} else {
		p.narrate(fmt.Sprintf("All %d part(s) are already in %s", len(parts), p.Label))
	}
	last, done, sentSoFar := time.Now(), 0, int64(0)
	for _, part := range parts {
		if part.Path == "" {
			res.PartsSkipped++
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		err := p.Store.PutObject(ctx, st.Keys.PartKey(part.SHA256), part.Path, S3PutOptions{IfNoneMatch: true})
		var se *S3Error
		switch {
		case err == nil:
			res.PartsUploaded++
			res.BytesSent += part.Size
		case errors.As(err, &se) && se.PreconditionFailed():
			res.PartsSkipped++
		default:
			return fmt.Errorf("part %s: %w", part.SHA256, readableUploadError(err))
		}
		done++
		sentSoFar += part.Size
		if done < toSend && time.Since(last) >= uploadProgressEvery {
			last = time.Now()
			p.narrate(fmt.Sprintf("Upload: %d of %d part(s) done, %s of %s", done, toSend, fmtBytes(sentSoFar), fmtBytes(sendBytes)))
		}
	}
	if toSend > 0 {
		p.narrate(fmt.Sprintf("Upload finished: %d sent (%s), %d already there", res.PartsUploaded, fmtBytes(res.BytesSent), res.PartsSkipped))
	}
	return nil
}

// --- assembling ---

// assembleLevels builds each level's whole database in the bucket, in index
// order, and counts the levels done.
func (p *dhPublisher) assembleLevels(ctx context.Context, st dhStaged, res *dhPublishResult) error {
	for _, l := range st.Index.Levels {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := p.assembleLevel(ctx, st, l); err != nil {
			return fmt.Errorf("assemble %s: %w", l.Folder, readableUploadError(err))
		}
		res.LevelsAssembled++
	}
	return nil
}

// assembleLevel makes level l's file at its assembled key. A level whose
// whole-file hash is the same level's in the previous snapshot, and whose
// previous assembled file is still in the bucket at the right size, is copied
// from that file in large ranges; any other level, or one whose previous file
// cannot be confirmed, is built from its parts.
func (p *dhPublisher) assembleLevel(ctx context.Context, st dhStaged, l DHIndexLevel) error {
	dest := st.Keys.AssembledKey(l.Folder)
	steps := partCopySteps(st.Keys, l)
	how := fmt.Sprintf("from its %d part(s)", len(steps))
	if src, ok := p.unchangedPreviousFile(ctx, l); ok {
		steps = previousObjectCopies(src, l.Size)
		how = fmt.Sprintf("by copying the previous snapshot's file in %d range(s)", len(steps))
	}
	p.narrate(fmt.Sprintf("Assembling %s (%s) %s", l.Folder, fmtBytes(l.Size), how))
	last := time.Now()
	err := assembleDHObject(ctx, p.Store, dest, steps, func(done, total int) {
		if done < total && time.Since(last) >= uploadProgressEvery {
			last = time.Now()
			p.narrate(fmt.Sprintf("Assembling %s: %d of %d copied", l.Folder, done, total))
		}
	})
	if err != nil {
		return err
	}
	p.narrate("Assembled " + l.Folder)
	return nil
}

// unchangedPreviousFile returns the key of the previous snapshot's assembled
// file for level l when l did not change and that file is in the bucket at l's
// size. Any trouble confirming it, an error included, means "build it from
// parts": the copy is an optimisation, and the parts are always enough.
func (p *dhPublisher) unchangedPreviousFile(ctx context.Context, l DHIndexLevel) (string, bool) {
	if p.prev == nil {
		return "", false
	}
	for _, pl := range p.prev.Index.Levels {
		if pl.Folder != l.Folder || pl.SHA256 != l.SHA256 || pl.Size != l.Size {
			continue
		}
		key := path.Join(path.Dir(p.prev.IndexKey), l.Folder, dhDatabaseName)
		info, found, err := p.Store.HeadObject(ctx, key)
		if err != nil || !found || info.Size != l.Size {
			p.narrate(fmt.Sprintf("The previous file for %s could not be confirmed, so it is built from parts instead", l.Folder))
			return "", false
		}
		return key, true
	}
	return "", false
}

// --- the pointer, last ---

// writeLatest writes latest.json, which is what makes the run a publish. The
// pointer's path is checked by resolving it back through latestIndexKey, the
// reader's own rule, so a writer and a reader cannot disagree about it.
func (p *dhPublisher) writeLatest(ctx context.Context, st dhStaged) error {
	rel, err := dhRelativeKey(st.Keys.Latest, st.Keys.Index)
	if err != nil {
		return err
	}
	latest := DHLatest{Format: dhLatestFormat, CreatedAt: st.Index.CreatedAt, Index: rel}
	back, err := latestIndexKey(st.Keys.Latest, latest)
	if err != nil {
		return err
	}
	if back != st.Keys.Index {
		return fmt.Errorf("latest.json would point at %q instead of %s", back, st.Keys.Index)
	}
	data, err := latest.Marshal()
	if err != nil {
		return err
	}
	p.narrate("Writing " + st.Keys.Latest + ", the last object")
	if err := p.Store.PutObjectBytes(ctx, st.Keys.Latest, data, S3PutOptions{}); err != nil {
		return readableUploadError(err)
	}
	return nil
}

// publishedURL is where key can be reached: the destination's public base URL
// when it has one, else the bucket's own object address.
func (p *dhPublisher) publishedURL(key string) string {
	return dhObjectURL(p.PublicBaseURL, p.Store, key)
}

// dhObjectURL is where key can be reached: under the destination's public base
// URL when it has one, else at the bucket's own object address.
func dhObjectURL(publicBase string, store interface{ ObjectURL(key string) string }, key string) string {
	if base := strings.TrimRight(publicBase, "/"); base != "" {
		return base + "/" + s3URIEncode(key, false)
	}
	return store.ObjectURL(key)
}

var _ dhPublishStore = (*S3Client)(nil)
