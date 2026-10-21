package services

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"konnekt/backend/models"
)

const (
	dhSnapshotBlockID = "action.dhSnapshot"

	// dhSnapshotTimeoutSeconds is the longest the block may run: 3 hours. It is
	// the sum of what one run can legitimately spend, with room:
	//
	//	warning lead time   up to 30 min (dhMaxLeadSeconds)
	//	stop grace          up to 10 min (maxStopGrace), the wait for the world to save
	//	reading             up to 2 h: tens of GB, hashed and copied once, from a
	//	                    slow or networked disk at a few tens of MB/s
	//	start, previous index, margin   the rest
	//
	// The server is only down for the last three of those. A run that reaches the
	// limit during the read stops between parts and still starts the server again
	// (dhsnapshot_run.go), so the limit costs the snapshot and never the uptime.
	dhSnapshotTimeoutSeconds = 3 * 60 * 60
)

// registerDHSnapshotBlock registers action.dhSnapshot. It lives beside
// registerBuiltins rather than in it, like registerUploadBlock.
func registerDHSnapshotBlock(r *BlockRegistry) {
	must(r.RegisterBlock(models.BlockDef{
		ID: dhSnapshotBlockID, Category: "action", Label: "DH Snapshot",
		Description: "Stops the server to copy its Distant Horizons data into a staged snapshot, then starts it again. " +
			"Players are warned first, over RCON or the console. Only the parts that changed since the last snapshot " +
			"are staged, and the staged folder wires into Upload to Bucket.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataOutputs: []models.DataPort{
			{ID: "folder", Label: "Staged folder", Type: "string"},
			{ID: "bytesChanged", Label: "Bytes changed", Type: "number"},
			{ID: "partsChanged", Label: "Parts changed", Type: "number"},
			{ID: "partsTotal", Label: "Parts in all", Type: "number"},
			{ID: "downtime", Label: "Downtime (s)", Type: "number"},
		},
		ConfigSchema: []models.ConfigField{
			// Optional: with none, the previous snapshot is the index.json already in
			// the staging folder. With one, it is the bucket's latest.json, which
			// is the truth about which parts are already up.
			{Key: "destination", Label: "Destination of the last snapshot", Type: destinationFieldType},
			{Key: "prefix", Label: "Key prefix", Type: "string"},
			{Key: "output", Label: "Staging folder (default: in the app data folder)", Type: "string"},
			{Key: "leadSeconds", Label: "Warn players this many seconds before", Type: "number", Default: dhDefaultLeadSeconds},
			{Key: "message", Label: "Warning ({time} is the time left)", Type: "string", Default: dhDefaultMessage},
		},
		Source:         "native",
		TimeoutSeconds: dhSnapshotTimeoutSeconds,
		Effects:        []string{EffectStopsServer},
	}, execDHSnapshot))
}

// dhStagingRoot is this server's default staging folder:
// <dataDir>/dh-snapshots/<serverID>. The id is joined into the path here and
// nowhere else, so one that is not a single segment fails for the block and for
// the upload root alike.
func dhStagingRoot(dataDir, serverID string) (string, error) {
	if err := validServerID(serverID); err != nil {
		return "", err
	}
	if dataDir == "" {
		return "", errors.New("the app data folder is not known")
	}
	return filepath.Join(dataDir, dhStagingFolder, serverID), nil
}

// dhStageDir is where this run stages. The default is the server's own folder
// under the app data directory. A folder of the author's choosing must be an
// absolute path and must not be inside the server's folder, which is the one
// place a server backup would carry a second copy of the LOD data.
func dhStageDir(e *ExecContext, workingDir string) (string, error) {
	out := strings.TrimSpace(e.GetString("output"))
	if out == "" {
		return dhStagingRoot(e.svc.dataDir, e.ServerID)
	}
	if !filepath.IsAbs(out) {
		return "", fmt.Errorf("the staging folder %q must be an absolute path, or empty to use the default", out)
	}
	out = filepath.Clean(out)
	if insideAny([]string{workingDir}, resolveThroughExisting(out)) {
		return "", fmt.Errorf("the staging folder %s is inside the server's folder, so a backup of the server would carry a second copy of the Distant Horizons data: choose a folder outside it", out)
	}
	return out, nil
}

// resolveThroughExisting resolves symlinks in the part of p that exists and
// appends the part that does not, so a folder about to be created can be
// compared with insideAny.
func resolveThroughExisting(p string) string {
	tail := ""
	for cur := p; ; {
		if real, err := filepath.EvalSymlinks(cur); err == nil {
			return filepath.Join(real, tail)
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return p
		}
		tail = filepath.Join(filepath.Base(cur), tail)
		cur = parent
	}
}

// dhLeadTime reads the warning lead time: a whole number of seconds, 300 when the
// field is absent.
func dhLeadTime(e *ExecContext) (time.Duration, error) {
	secs := float64(dhDefaultLeadSeconds)
	if n, ok := e.GetNumber("leadSeconds"); ok {
		secs = n
	}
	if secs < 0 || secs > dhMaxLeadSeconds || secs != float64(int(secs)) {
		return 0, fmt.Errorf("the warning lead time must be a whole number of seconds from 0 to %d", dhMaxLeadSeconds)
	}
	return time.Duration(secs) * time.Second, nil
}

// dhPlanFor reads the block's config and this run's server into a plan, and
// returns the function that scrubs the destination's secret out of error text.
// Everything in it is this run's server's: its folder, its world, its staging
// folder. Nothing is read from the active server.
func dhPlanFor(e *ExecContext) (dhRunPlan, func(string) string, error) {
	none := func(s string) string { return s }
	if e.Server() == nil || e.Config_() == nil || e.Backup() == nil {
		return dhRunPlan{}, none, errors.New("snapshots are not available")
	}
	cfg, err := e.Config_().GetServerConfig(e.ServerID)
	if err != nil {
		return dhRunPlan{}, none, err
	}
	world, err := e.Backup().worldPath(e.ServerID)
	if err != nil {
		return dhRunPlan{}, none, err
	}
	stageDir, err := dhStageDir(e, cfg.WorkingDir)
	if err != nil {
		return dhRunPlan{}, none, err
	}
	lead, err := dhLeadTime(e)
	if err != nil {
		return dhRunPlan{}, none, err
	}
	message := strings.TrimSpace(e.GetString("message"))
	if message == "" {
		message = dhDefaultMessage
	}

	plan := dhRunPlan{
		Host:       serverDHHost{e: e, cfg: *cfg},
		WorkingDir: cfg.WorkingDir, WorldDir: world, StageDir: stageDir,
		Lead: lead, Message: message, Grace: e.Config_().StopGrace(),
	}
	name := strings.TrimSpace(e.GetString("destination"))
	if name == "" {
		return plan, none, nil
	}
	if e.Destinations() == nil {
		return dhRunPlan{}, none, errors.New("destinations are not available")
	}
	prefix, err := cleanKeyPrefix(e.GetString("prefix"))
	if err != nil {
		return dhRunPlan{}, none, err
	}
	client, dest, err := e.Destinations().Open(name)
	if err != nil {
		return dhRunPlan{}, none, err
	}
	// The previous snapshot is read under the destination's private link, if it
	// has one, and the token is marked out of everything the client scrubs.
	token, err := e.Destinations().LinkToken(dest.ID)
	if err != nil {
		return dhRunPlan{}, none, err
	}
	client.AlsoRedact(token)
	plan.Bucket, plan.BucketLabel, plan.KeyPrefix, plan.Token = client, fmt.Sprintf("%q", dest.Name), joinKey(dest.Prefix, prefix), token
	plan.Host = serverDHHost{e: e, cfg: *cfg, scrub: client.scrub}
	return plan, client.scrub, nil
}

func execDHSnapshot(e *ExecContext) ExecResult {
	// The claim is held for the whole run, so a publish cannot be reading the
	// staging folder while this one stages into it.
	if !dhClaim(e.ServerID) {
		err := errors.New(dhBusyMessage)
		if e.Server() != nil {
			e.Server().NarrateFailed(e.ServerID, "Distant Horizons snapshot failed: "+err.Error())
		}
		return ExecResult{Port: "onFailed", Err: err}
	}
	defer dhRelease(e.ServerID)
	plan, scrub, err := dhPlanFor(e)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	res, err := runDHSnapshot(e.Ctx, plan)
	return finishDHSnapshot(e, res, err, scrub)
}

// finishDHSnapshot turns a run's outcome into the block's result: the downtime
// goes to the engine for the run record whether the run worked or not, and the
// outputs are set only when it did.
func finishDHSnapshot(e *ExecContext, res dhRunResult, err error, scrub func(string) string) ExecResult {
	// Rounded up: Milliseconds() truncates, and a measured downtime under a
	// millisecond would otherwise reach the engine as 0, which it reads as
	// "this node stopped nothing" and leaves off the run record.
	out := ExecResult{DowntimeMs: (res.Downtime + time.Millisecond - 1).Milliseconds()}
	if res.Downtime > 0 {
		e.SetOutput("downtime", res.Downtime.Seconds())
	}
	if err != nil {
		// The client scrubs its own errors; this covers the text around them, so
		// the secret is in no run record, event or console line whatever built it.
		err = errors.New(scrub(err.Error()))
		e.Server().NarrateFailed(e.ServerID, "Distant Horizons snapshot failed: "+err.Error())
		out.Port, out.Err = "onFailed", err
		return out
	}
	e.SetOutput("folder", res.Folder)
	e.SetOutput("bytesChanged", float64(res.BytesChanged))
	e.SetOutput("partsChanged", float64(res.PartsChanged))
	e.SetOutput("partsTotal", float64(res.PartsTotal))
	out.Port = "onComplete"
	return out
}

// serverDHHost is the real server behind dhHost: this run's server, through the
// ExecContext's services.
type serverDHHost struct {
	e   *ExecContext
	cfg models.ServerConfig
	// scrub, when set, is applied to every line narrated to the console: a line
	// that names an object key carries the private link's token (#561).
	scrub func(string) string
}

func (h serverDHHost) IsRunning() bool { return h.e.Server().IsRunning(h.e.ServerID) }

func (h serverDHHost) rcon() (addr, password string, ok bool) {
	if h.e.Rcon() == nil {
		return "", "", false
	}
	return h.e.Server().RconConfig(h.e.ServerID)
}

func (h serverDHHost) CanWarn() bool {
	_, _, ok := h.rcon()
	return ok || h.IsRunning()
}

// Say sends the warning as a `say`, over RCON when it is confirmed, and through
// the server's console when it is not or when the RCON call fails.
func (h serverDHHost) Say(message string) error {
	line := "say " + strings.NewReplacer("\r", " ", "\n", " ").Replace(message)
	var rconErr error
	if addr, password, ok := h.rcon(); ok {
		if _, rconErr = h.e.Rcon().Execute(addr, password, line); rconErr == nil {
			return nil
		}
	}
	err := h.e.Server().SendCommand(h.e.ServerID, line)
	if err != nil && rconErr != nil {
		return fmt.Errorf("RCON: %v; console: %w", rconErr, err)
	}
	return err
}

func (h serverDHHost) WhileStopped(grace time.Duration, fn func()) (stopErr, startErr error) {
	return h.e.Server().WhileStopped(h.cfg.ID, h.cfg.JarPath, h.cfg.JvmArgs, h.cfg.WorkingDir, grace, fn)
}

func (h serverDHHost) Narrate(line string) {
	if h.scrub != nil {
		line = h.scrub(line)
	}
	h.e.Server().Narrate(h.e.ServerID, line)
}
