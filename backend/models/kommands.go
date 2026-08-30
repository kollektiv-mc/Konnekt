package models

// The shared-file contract with Kommands (kollektiv-mc/Kommands).
//
// Kommands writes os.UserConfigDir()/kommands/saved-commands.json; Konnekt only
// ever reads it. Neither application has to discover the other: both derive
// both paths from the same os.UserConfigDir() call, so services.DataDir() is
// .../konnekt and KommandsService.Dir() is .../kommands by construction.
//
// Konnekt defines this schema rather than waiting for Kommands to, because
// Kommands has no persistence at all yet and the alternative was two repositories
// negotiating a format after both had shipped. It is mirrored verbatim in a
// Kommands issue; changing it here without changing it there breaks the link.
//
// The contract, in full, because this comment is what gets copied over:
//
//  1. version is an integer, currently 1, and must be present. Konnekt refuses
//     a file whose version it does not recognise rather than parsing it
//     optimistically, and a missing version is not "1 by default".
//  2. id is stable, opaque, never reused and never regenerated for the same
//     logical command. It is the only anchor; everything else may change.
//  3. revision increments on every saved edit to label or command. It is the
//     only change signal Konnekt reads. Konnekt never diffs strings, and a
//     timestamp is deliberately not the signal: clocks go backwards across
//     timezone changes and restored backups.
//  4. command is the literal text with no leading slash and no newline,
//     carriage return or other control character. One entry is one command.
//     Konnekt strips a single leading slash defensively and skips any entry
//     with a control character.
//  5. label may be empty; Konnekt falls back to the command text.
//  6. updatedAt is Unix milliseconds, for display only.
//  7. Deletion is by absence. Konnekt never deletes a button in response; it
//     marks the link broken and leaves the button alone.
//  8. The writer must replace the file atomically (temp file in the same
//     directory, then rename), or Konnekt can read a half-written one.
//     services.writeFileAtomic is the reference implementation.
//  9. Konnekt refuses a file over 2 MiB or beyond 2000 entries, and skips an
//     individual malformed entry rather than rejecting the whole file.
//  10. Konnekt never creates this file or its directory and never writes
//     anything under it. A missing file is the normal case and does not
//     surface as an error.

// KommandsSchemaVersion is the only version this build understands.
//
// A file declaring a higher version is refused rather than parsed optimistically:
// the fields we care about could plausibly survive a version bump, but a linked
// command silently resolving to a stale or half-understood value is exactly the
// failure this feature exists to avoid.
const KommandsSchemaVersion = 1

// KommandsFile is the whole of saved-commands.json.
type KommandsFile struct {
	Version  int                    `json:"version"`
	Commands []KommandsSavedCommand `json:"commands"`
}

// KommandsSavedCommand is one command saved in Kommands.
type KommandsSavedCommand struct {
	// ID is stable across edits and is what a CommandLink binds to. Kommands
	// must never reuse or regenerate it for the same logical command.
	ID string `json:"id"`
	// Revision increments on every saved edit. This, not UpdatedAt, is the
	// change signal: a clock that goes backwards (timezone change, restored
	// backup, two machines) would make an update look like it never happened.
	Revision int    `json:"revision"`
	Label    string `json:"label"`
	Command  string `json:"command"`
	// UpdatedAt is Unix milliseconds, for display only.
	UpdatedAt int64 `json:"updatedAt"`
}

// KommandsStatus is what the Commands tile shows about the other application.
//
// Every field is a normal state rather than an error condition. Kommands not
// being installed is the overwhelmingly common case today and must not read as
// something being wrong.
type KommandsStatus struct {
	// Installed is whether saved-commands.json exists at all. It is the closest
	// thing to "is Kommands here" that costs a single os.Stat.
	Installed bool   `json:"installed"`
	Path      string `json:"path"`
	// Unsupported is a file declaring a Version this build does not understand,
	// which includes a file with no version field at all. Distinct from Error
	// because the remedy is different: update Konnekt, rather than look at what
	// is wrong with the file.
	Unsupported bool `json:"unsupported"`
	// Version is what the file declared, so the UI can name it rather than only
	// saying it is unsupported.
	Version int `json:"version"`
	// Error is a parse or read failure, already formatted for display. Empty
	// when the file is fine or simply absent.
	Error string `json:"error"`
	// SavedCount is how many commands the file holds; LinkedCount how many
	// buttons here are bound to one.
	SavedCount  int `json:"savedCount"`
	LinkedCount int `json:"linkedCount"`
	// Rejected is how many entries were skipped as malformed. Surfaced rather
	// than dropped silently: a command that quietly never appears is worse to
	// diagnose than one the UI says it refused.
	Rejected int `json:"rejected"`
	// BrokenCount and ChangedCount drive the library's status chip.
	BrokenCount  int `json:"brokenCount"`
	ChangedCount int `json:"changedCount"`
}
