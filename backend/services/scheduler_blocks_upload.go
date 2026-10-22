package services

import (
	"errors"
	"fmt"
	"strings"

	"konnekt/backend/models"
)

const (
	uploadBlockID = "action.upload"

	// uploadTimeoutSeconds is the longest the block may run: 12 hours. The first
	// upload of a Distant Horizons snapshot is about 20 GB, which a home upstream
	// of 5 Mbit/s moves in under 9 hours and 10 Mbit/s in under 5; 12 hours covers
	// the slow end with room for the retries. Every later run sends only what
	// changed and takes minutes. A run that does hit the limit stops cleanly (an
	// object is sent whole or not at all) and the next run resumes, because it
	// skips what is already in the bucket.
	uploadTimeoutSeconds = 12 * 60 * 60

	// destinationFieldType is the ConfigField.Type of a select over the saved
	// bucket destinations, shared by validation and the block's own schema.
	destinationFieldType = "destination"
)

// registerUploadBlock registers action.upload. It lives beside registerBuiltins
// rather than in it, which is already the largest function in the tree.
func registerUploadBlock(r *BlockRegistry) {
	must(r.RegisterBlock(models.BlockDef{
		ID: uploadBlockID, Category: "action", Label: "Upload to Bucket",
		Description:   "Uploads a file or folder from the server to a bucket, skipping what is already there.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		// Port id == config key (resolveDataInputs), so a wired value outranks the
		// field. The destination is not a port: it is chosen from Settings.
		DataInputs: []models.DataPort{
			{ID: "source", Label: "Source", Type: "string"},
			{ID: "prefix", Label: "Key prefix", Type: "string"},
		},
		DataOutputs: []models.DataPort{
			{ID: "uploaded", Label: "Objects uploaded", Type: "number"},
			{ID: "skipped", Label: "Objects skipped", Type: "number"},
			{ID: "bytes", Label: "Bytes sent", Type: "number"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "destination", Label: "Destination", Type: destinationFieldType, Required: true},
			{Key: "source", Label: "Source (file or folder)", Type: "string", Required: true},
			{Key: "prefix", Label: "Key prefix", Type: "string"},
		},
		Source:         "native",
		TimeoutSeconds: uploadTimeoutSeconds,
	}, execUpload))
}

// uploadRoots are the folders a source may be inside for this server: its working
// directory, its own backups, and the folder its Distant Horizons snapshot is
// staged in, which is what lets a graph wire that block's output into this one.
// The app data directory holds more than that: the secret access keys, the Remote
// Access password hash and every other server's files, none of which a graph
// should be able to publish, so only these three folders of this one server are in.
func uploadRoots(e *ExecContext, workingDir string) []string {
	roots := []string{workingDir}
	if e.Backup() != nil {
		if dir, err := e.Backup().backupRoot(e.ServerID); err == nil {
			roots = append(roots, dir)
		}
	}
	if dir, err := dhStagingRoot(e.svc.dataDir, e.ServerID); err == nil {
		roots = append(roots, dir)
	}
	return roots
}

func execUpload(e *ExecContext) ExecResult {
	fail := func(err error) ExecResult { return ExecResult{Port: "onFailed", Err: err} }

	name := strings.TrimSpace(e.GetString("destination"))
	if name == "" {
		return fail(errors.New("no destination chosen: pick a saved bucket in the Upload to Bucket block"))
	}
	if e.Destinations() == nil || e.Config_() == nil {
		return fail(errors.New("uploads are not available"))
	}
	prefix, err := cleanKeyPrefix(e.GetString("prefix"))
	if err != nil {
		return fail(err)
	}
	cfg, err := e.Config_().GetServerConfig(e.ServerID)
	if err != nil {
		return fail(err)
	}
	client, dest, err := e.Destinations().Open(name)
	if err != nil {
		return fail(err)
	}

	narrate, narrateFailed := func(string) {}, func(string) {}
	if e.Server() != nil {
		narrate = func(line string) { e.Server().Narrate(e.ServerID, line) }
		narrateFailed = func(line string) { e.Server().NarrateFailed(e.ServerID, line) }
	}

	res, err := runUpload(e.Ctx, uploadPlan{
		Store:      client,
		Source:     e.GetString("source"),
		WorkingDir: cfg.WorkingDir,
		Roots:      uploadRoots(e, cfg.WorkingDir),
		KeyPrefix:  joinKey(dest.Prefix, prefix),
		Label:      fmt.Sprintf("%q", dest.Name),
		Narrate:    narrate,
	})
	if err != nil {
		// The client scrubs its own errors; this covers the text around them, so
		// the secret is in no run record, event or console line whatever built it.
		err = errors.New(client.scrub(readableUploadError(err).Error()))
		narrateFailed("Upload failed: " + err.Error())
		out := fail(err)
		out.Narrated = e.Server() != nil
		return out
	}
	e.SetOutput("uploaded", float64(res.Uploaded))
	e.SetOutput("skipped", float64(res.Skipped))
	e.SetOutput("bytes", float64(res.Bytes))
	return ExecResult{Port: "onComplete"}
}
