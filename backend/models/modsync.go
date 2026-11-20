package models

// PackSource is the pack a server's mods/ folder follows (#454, #456). It is
// bound once per server from the mods tile, and the scheduler's Check Modpack
// and Sync Modpack blocks read it rather than taking a URL of their own, so a
// graph can only ever sync from a source the desktop already chose (#523).
type PackSource struct {
	ServerID string `json:"serverID"`
	// Format is the pack's format. "packwiz" is the only one so far; the
	// field is there so a modrinth.index.json source is a parser, not a
	// migration.
	Format string `json:"format"`
	// Location says how Address is read: "url" (an https address of
	// pack.toml) or "folder" (an absolute path of the folder holding
	// pack.toml, such as a git checkout or a packwiz project).
	Location string `json:"location"`
	Address  string `json:"address"`
	// Exclude names pack entries this server never installs, on top of the
	// pack's own client-only marks: a metafile's name without ".pw.toml"
	// ("fancymenu") or a jar's file name.
	Exclude []string `json:"exclude"`
	// Include names client-side entries this server installs anyway, for a
	// mod a pack marks client-only by mistake. Same names as Exclude.
	Include []string `json:"include"`
}

// ModSyncPlan is what a sync would do to a server's mods/ folder, worked out
// without touching it. The mods tile shows it before Apply, and the scheduler
// blocks record it in the run.
type ModSyncPlan struct {
	ServerID string `json:"serverID"`
	// PlanID fingerprints the rows. Apply refuses a plan whose fresh PlanID
	// differs from the one the person read, so what runs is what was shown.
	PlanID      string `json:"planId"`
	PackName    string `json:"packName"`
	PackVersion string `json:"packVersion"`
	// Minecraft, Loader and LoaderVersion are what the pack declares.
	Minecraft     string `json:"minecraft"`
	Loader        string `json:"loader"`
	LoaderVersion string `json:"loaderVersion"`
	// Fingerprint is the hash of the pack's pack.toml, which carries the
	// index hash and so changes whenever any file in the pack does.
	Fingerprint string       `json:"fingerprint"`
	Rows        []ModSyncRow `json:"rows"`
	// Blockers are why the plan cannot be applied as it stands. A plan with
	// any is shown but never applied.
	Blockers []string `json:"blockers"`
	// Warnings are worth reading but do not stop an apply.
	Warnings []string `json:"warnings"`
	// Counts by action, so a caller need not walk Rows.
	Added    int `json:"added"`
	Updated  int `json:"updated"`
	Removed  int `json:"removed"`
	Disabled int `json:"disabled"`
	Kept     int `json:"kept"`
	Adopted  int `json:"adopted"`
	Skipped  int `json:"skipped"`
	// UpToDate is true when applying would change no file.
	UpToDate bool `json:"upToDate"`
	// Last is the most recent sync applied to this server, if any.
	Last *ModSyncRecord `json:"last"`
}

// ModSyncRow is one file in a plan.
//
// Action is one of:
//
//	add      the pack's file is not on the server
//	update   replaces From, an older copy of the same mod
//	remove   a file the pack installed and no longer lists
//	disable  the pack's file is on the server but not wanted here (client side, or excluded)
//	keep     the server already has the pack's file
//	adopt    the server already has the pack's file, installed by hand; the sync takes it over
//	skip     the pack lists it, the server does not want it, and it is not there
//	blocked  the pack lists it and Konnekt cannot fetch it; a blocker says why
type ModSyncRow struct {
	Action   string `json:"action"`
	FileName string `json:"fileName"`
	From     string `json:"from,omitempty"`
	Name     string `json:"name"`
	// Key is the pack entry's name as Exclude and Include take it.
	Key    string `json:"key"`
	Side   string `json:"side"`
	Reason string `json:"reason"`
	// Note is a warning about this entry that does not change the action,
	// such as Modrinth calling a "both" mod client only.
	Note string `json:"note,omitempty"`
}

// ModSyncRecord is one applied sync, kept so it can be rolled back.
type ModSyncRecord struct {
	ID          string `json:"id"`
	AppliedAt   int64  `json:"appliedAt"` // unix ms
	PackName    string `json:"packName"`
	PackVersion string `json:"packVersion"`
	Fingerprint string `json:"fingerprint"`
	Added       int    `json:"added"`
	Updated     int    `json:"updated"`
	Removed     int    `json:"removed"`
	Disabled    int    `json:"disabled"`
	// RolledBack is set once the record's changes have been undone.
	RolledBack bool `json:"rolledBack"`
}

// ModSyncState is what the mods tile reads to draw the pack section: the
// bound source, if any, and the syncs that can still be rolled back, newest
// first.
type ModSyncState struct {
	Source  *PackSource     `json:"source"`
	History []ModSyncRecord `json:"history"`
}
