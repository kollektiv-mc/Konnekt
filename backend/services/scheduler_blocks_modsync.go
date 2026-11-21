package services

import (
	"errors"
	"fmt"

	"konnekt/backend/models"
)

const (
	modpackCheckBlockID = "action.modpackCheck"
	modpackSyncBlockID  = "action.modpackSync"
	modpackBlockGroup   = "Modpack"

	// modpackTimeoutSeconds covers a first plan that downloads every jar of a
	// large pack: a hundred mods of a few MB each on a slow line.
	modpackTimeoutSeconds = 30 * 60
)

// errNoModSync is what both blocks fail with in a scheduler built without the
// mod service, which is every scheduler test that does not set one.
var errNoModSync = errors.New("pack sync is not available")

// registerModpackBlocks registers Check Modpack and Sync Modpack (#523). Both
// read the pack the server is bound to in the mods tile, and take no address
// of their own, so a graph syncs only from a source a person chose there.
//
// They are actions rather than a trigger. An Interval or Daily trigger in
// front of Check Modpack covers "when the pack changes" without a poller of its
// own, and onUpdate then leads wherever the author wants: a notification, or a
// stop, Sync Modpack and a start.
func registerModpackBlocks(r *BlockRegistry) {
	must(r.RegisterBlock(models.BlockDef{
		ID: modpackCheckBlockID, Category: "action", Group: modpackBlockGroup, Label: "Check Modpack",
		Description:   "Checks whether the server's mods differ from its bound pack, and stages the downloads.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onUpdate", "onUpToDate", "onFailed"},
		DataOutputs: []models.DataPort{
			{ID: "version", Label: "Applied version", Type: "string"},
			{ID: "newVersion", Label: "Pack version", Type: "string"},
			{ID: "changes", Label: "Files to change", Type: "number"},
		},
		Source:         "native",
		TimeoutSeconds: modpackTimeoutSeconds,
	}, execModpackCheck))
	must(r.RegisterBlock(models.BlockDef{
		ID: modpackSyncBlockID, Category: "action", Group: modpackBlockGroup, Label: "Sync Modpack",
		Description:   "Brings a stopped server's mods in line with its bound pack.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onUpToDate", "onFailed"},
		DataOutputs: []models.DataPort{
			{ID: "version", Label: "Pack version", Type: "string"},
			{ID: "added", Label: "Added", Type: "number"},
			{ID: "updated", Label: "Updated", Type: "number"},
			{ID: "removed", Label: "Removed", Type: "number"},
		},
		Source:         "native",
		TimeoutSeconds: modpackTimeoutSeconds,
	}, execModpackSync))
}

// Mods reaches the mod service. May be nil.
func (e *ExecContext) Mods() *ModService { return e.svc.mods }

// planChanges is how many files applying the plan would touch.
func planChanges(p models.ModSyncPlan) int {
	return p.Added + p.Updated + p.Removed + p.Disabled
}

// appliedVersion is the pack version last applied, or "" before any sync.
func appliedVersion(p models.ModSyncPlan) string {
	if p.Last == nil || p.Last.RolledBack {
		return ""
	}
	return p.Last.PackVersion
}

func execModpackCheck(e *ExecContext) ExecResult {
	if e.Mods() == nil {
		return ExecResult{Port: "onFailed", Err: errNoModSync}
	}
	plan, err := e.Mods().PlanModSyncContext(e.Ctx, e.ServerID)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	e.SetOutput("version", appliedVersion(plan))
	e.SetOutput("newVersion", plan.PackVersion)
	e.SetOutput("changes", float64(planChanges(plan)))
	if plan.UpToDate {
		return ExecResult{Port: "onUpToDate"}
	}
	return ExecResult{Port: "onUpdate"}
}

func execModpackSync(e *ExecContext) ExecResult {
	if e.Mods() == nil {
		return ExecResult{Port: "onFailed", Err: errNoModSync}
	}
	// An empty plan id applies the fresh plan as it stands. Nobody is there
	// to read it, so a plan with any blocker fails rather than asking.
	plan, err := e.Mods().ApplyModSyncContext(e.Ctx, e.ServerID, "")
	if err != nil {
		if e.Server() != nil {
			e.Server().NarrateFailed(e.ServerID, "Modpack sync failed: "+err.Error())
		}
		return ExecResult{Port: "onFailed", Err: err, Narrated: e.Server() != nil}
	}
	e.SetOutput("version", plan.PackVersion)
	e.SetOutput("added", float64(plan.Added))
	e.SetOutput("updated", float64(plan.Updated))
	e.SetOutput("removed", float64(plan.Removed))
	if plan.UpToDate {
		return ExecResult{Port: "onUpToDate"}
	}
	if e.Server() != nil {
		e.Server().NarrateDone(e.ServerID, fmt.Sprintf("Modpack synced to %s %s: %d added, %d updated, %d removed, %d disabled.",
			plan.PackName, plan.PackVersion, plan.Added, plan.Updated, plan.Removed, plan.Disabled))
	}
	return ExecResult{Port: "onComplete"}
}
