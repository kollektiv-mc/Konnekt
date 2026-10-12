package services

import (
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"

	"konnekt/backend/models"
)

const (
	dhPublishBlockID = "action.dhPublish"

	// dhPublishTimeoutSeconds is the longest the block may run: 12 hours. The
	// first publish of a Distant Horizons snapshot sends about 20 GB, which a home
	// upstream of 5 Mbit/s moves in under 9 hours and 10 Mbit/s in under 5, and
	// the assembly that follows is copies inside the bucket, minutes at most. Every
	// later publish sends only the parts that changed. A run that reaches the limit
	// stops with latest.json untouched, so readers still see the previous
	// snapshot, and the next run resumes: a part already in the bucket is not sent
	// again.
	dhPublishTimeoutSeconds = 12 * 60 * 60

	// dhDefaultKeep is how many snapshots the bucket keeps when the node does not
	// say: enough that one bad run, or a restore from the one before it, is not a
	// loss.
	dhDefaultKeep = 3
)

// registerDHPublishBlock registers action.dhPublish. It lives beside
// registerBuiltins rather than in it, like registerDHSnapshotBlock.
func registerDHPublishBlock(r *BlockRegistry) {
	must(r.RegisterBlock(models.BlockDef{
		ID: dhPublishBlockID, Category: "action", Label: "Publish DH Snapshot",
		Description: "Uploads a staged Distant Horizons snapshot to a saved bucket destination, builds each level's whole " +
			"database in the bucket from the uploaded parts, and writes the download page. latest.json is written last, " +
			"so a reader never sees a snapshot whose files are missing. Afterwards it keeps the newest snapshots and deletes the " +
			"older ones and the parts only they used; a failure to do that is a warning, not a failed run. The server is not touched.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		// Port id == config key (resolveDataInputs), so the snapshot block's
		// folder output wires straight in and outranks the field.
		DataInputs: []models.DataPort{
			{ID: "folder", Label: "Staged folder", Type: "string"},
		},
		DataOutputs: []models.DataPort{
			{ID: "url", Label: "Snapshot URL", Type: "string"},
			{ID: "partsUploaded", Label: "Parts uploaded", Type: "number"},
			{ID: "partsSkipped", Label: "Parts skipped", Type: "number"},
			{ID: "bytesSent", Label: "Bytes sent", Type: "number"},
			{ID: "levelsAssembled", Label: "Levels assembled", Type: "number"},
			{ID: "snapshotsDeleted", Label: "Snapshots deleted", Type: "number"},
			{ID: "partsDeleted", Label: "Parts deleted", Type: "number"},
			{ID: "bytesFreed", Label: "Bytes freed", Type: "number"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "destination", Label: "Destination", Type: destinationFieldType, Required: true},
			{Key: "prefix", Label: "Key prefix", Type: "string"},
			{Key: "folder", Label: "Staged folder (default: this server's staging folder)", Type: "string"},
			{Key: "keep", Label: "Snapshots to keep (at least 1)", Type: "number", Default: dhDefaultKeep},
		},
		Source:         "native",
		TimeoutSeconds: dhPublishTimeoutSeconds,
	}, execDHPublish))
}

// dhStagingBase is the folder that holds every server's staging folder.
func dhStagingBase(dataDir string) string {
	return filepath.Join(dataDir, dhStagingFolder)
}

// dhPublishFolder is the staged folder this run reads. Empty means this server's
// own staging folder. A folder the node names must be an absolute path that
// exists, is not inside the server's folder (the staging rule, so a staged copy
// is never somewhere a server backup would carry it), and is not another
// server's staging folder, which would let one server's graph publish another's
// world data.
func dhPublishFolder(e *ExecContext, workingDir string) (string, error) {
	root, err := dhStagingRoot(e.svc.dataDir, e.ServerID)
	if err != nil {
		return "", err
	}
	folder := strings.TrimSpace(e.GetString("folder"))
	if folder == "" {
		return root, nil
	}
	if !filepath.IsAbs(folder) {
		return "", fmt.Errorf("the staged folder %q must be an absolute path, or empty to use this server's staging folder", folder)
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(folder))
	if err != nil {
		return "", fmt.Errorf("the staged folder %s cannot be read: %w", folder, err)
	}
	if insideAny([]string{workingDir}, resolved) {
		return "", fmt.Errorf("the staged folder %s is inside the server's folder: a snapshot is staged outside it", folder)
	}
	if insideAny([]string{dhStagingBase(e.svc.dataDir)}, resolved) && !insideAny([]string{root}, resolved) {
		return "", fmt.Errorf("the staged folder %s belongs to another server: a publish reads only this server's staging folder or a folder outside the app's data", folder)
	}
	return resolved, nil
}

// parseDHKeep reads the node's keep value: how many snapshots to leave in the
// bucket. Nothing, or an empty field, is the default. Anything else must be a
// whole number of at least 1; a text number from a hand-edited graph counts, and
// a bool, NaN or a number too big to count does not.
func parseDHKeep(v interface{}) (int, error) {
	if v == nil {
		return dhDefaultKeep, nil
	}
	if s, ok := v.(string); ok {
		s = strings.TrimSpace(s)
		if s == "" {
			return dhDefaultKeep, nil
		}
		v = s
	}
	bad := fmt.Errorf("keep must be a whole number of at least 1, not %v", v)
	if _, isBool := v.(bool); isBool {
		return 0, bad
	}
	var f float64
	switch n := v.(type) {
	case float64:
		f = n
	case int:
		f = float64(n)
	case int64:
		f = float64(n)
	case string:
		parsed, err := strconv.ParseFloat(n, 64)
		if err != nil {
			return 0, bad
		}
		f = parsed
	default:
		return 0, bad
	}
	if math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) || f < 1 || f > math.MaxInt32 {
		return 0, bad
	}
	return int(f), nil
}

func execDHPublish(e *ExecContext) ExecResult {
	narrate, narrateFailed := func(string) {}, func(string) {}
	if e.Server() != nil {
		narrate = func(line string) { e.Server().Narrate(e.ServerID, line) }
		narrateFailed = func(line string) { e.Server().NarrateFailed(e.ServerID, line) }
	}
	scrub := func(s string) string { return s }
	fail := func(err error) ExecResult {
		err = errors.New(scrub(err.Error()))
		narrateFailed("Publish failed: " + err.Error())
		return ExecResult{Port: "onFailed", Err: err}
	}

	// Held for the whole run: a snapshot staging into this folder, or a second
	// publish, must wait for it.
	if !dhClaim(e.ServerID) {
		return fail(errors.New(dhBusyMessage))
	}
	defer dhRelease(e.ServerID)

	name := strings.TrimSpace(e.GetString("destination"))
	if name == "" {
		return fail(errors.New("no destination chosen: pick a saved bucket in the Publish DH Snapshot block"))
	}
	keep, err := parseDHKeep(e.Config["keep"])
	if err != nil {
		return fail(err)
	}
	if e.Destinations() == nil || e.Config_() == nil {
		return fail(errors.New("publishing is not available"))
	}
	prefix, err := cleanKeyPrefix(e.GetString("prefix"))
	if err != nil {
		return fail(err)
	}
	cfg, err := e.Config_().GetServerConfig(e.ServerID)
	if err != nil {
		return fail(err)
	}
	stageDir, err := dhPublishFolder(e, cfg.WorkingDir)
	if err != nil {
		return fail(err)
	}
	client, dest, err := e.Destinations().Open(name)
	if err != nil {
		return fail(err)
	}
	scrub = client.scrub

	res, err := runDHPublish(e.Ctx, dhPublishPlan{
		Store:         client,
		Label:         fmt.Sprintf("%q", dest.Name),
		KeyPrefix:     joinKey(dest.Prefix, prefix),
		StageDir:      stageDir,
		Keep:          keep,
		PublicBaseURL: dest.PublicBaseURL,
		Narrate:       narrate,
	})
	if err != nil {
		// The client scrubs its own errors; fail covers the text around them, so
		// the secret is in no run record, event or console line whatever built it.
		return fail(err)
	}
	e.SetOutput("url", res.URL)
	e.SetOutput("partsUploaded", float64(res.PartsUploaded))
	e.SetOutput("partsSkipped", float64(res.PartsSkipped))
	e.SetOutput("bytesSent", float64(res.BytesSent))
	e.SetOutput("levelsAssembled", float64(res.LevelsAssembled))
	e.SetOutput("snapshotsDeleted", float64(res.SnapshotsDeleted))
	e.SetOutput("partsDeleted", float64(res.PartsDeleted))
	e.SetOutput("bytesFreed", float64(res.BytesFreed))
	// The snapshot is published whatever the prune did, so the node completes; the
	// prune's trouble rides on the record as a warning. The text came from the
	// client, which scrubs its own errors, and is scrubbed here too like a failure.
	return ExecResult{Port: "onComplete", Warning: scrub(res.Warning)}
}
