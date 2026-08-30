package models

// CommandButton is one entry in the Commands tile's ordered button list,
// persisted as <dataDir>/command_buttons.json.
//
// This used to have no Go representation at all: GetCommandButtons returned the
// file's bytes as a string and SaveCommandButtons wrote a string back, so the
// shape lived entirely in the frontend. Promoted here because Go now has to
// reason about individual items to resolve Kommands links (#213 Phase 4) —
// deciding which button an edit in another application applies to is not
// something an opaque blob can answer.
//
// On disk this is still a bare JSON array, exactly as before. Group and Link
// are additive and optional, so a file written by an older build parses
// unchanged and a downgrade drops only the new fields. There is no migration.
type CommandButton struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Kind is "cmd", "lifecycle" or "special". Deliberately a string rather than
	// a Go enum: the frontend owns the vocabulary and Go only round-trips it.
	Kind  string `json:"kind"`
	Value string `json:"value"`
	// Group is the section a button sits in within the maximized library.
	// Empty means ungrouped, which is what every pre-existing button is.
	Group string `json:"group,omitempty"`
	// Link binds this button to a command saved in another application. Nil for
	// the ordinary case of a button authored here.
	Link *CommandLink `json:"link,omitempty"`
}

// CommandLink binds a CommandButton to its original in another application.
//
// The one source today is Kommands, which owns the canonical copy: Konnekt only
// ever reads it. That read-only posture is what makes divergence impossible
// rather than merely unlikely.
type CommandLink struct {
	// Source is "kommands". A field rather than a bool so a second source needs
	// no migration of everything already written.
	Source string `json:"source"`
	// ID is the stable identifier in the source's own store, not this button's
	// ID. It is the anchor the whole feature rests on.
	ID string `json:"id"`
	// Revision is the source revision Konnekt last applied. mtime says "look",
	// this says "what actually moved".
	Revision int `json:"revision"`
	// Status is "ok", "changed" or "broken".
	//
	// "changed" means an update was applied and has not been acknowledged yet;
	// it is a UI state, so resolving a link must never clear it on its own or
	// the badge disappears before the user has seen it.
	//
	// "broken" means the original is gone. The button is deliberately kept:
	// removing a working button because another application tidied up is
	// hostile, so this is surfaced with unlink/remove actions instead.
	Status string `json:"status"`
	// PrevLabel and PrevValue hold what this button said before the last applied
	// change, which is what makes an update reversible. One step only, not a
	// history — enough to undo a surprise, not an audit log.
	PrevLabel string `json:"prevLabel,omitempty"`
	PrevValue string `json:"prevValue,omitempty"`
}

// Link status values.
const (
	LinkStatusOK      = "ok"
	LinkStatusChanged = "changed"
	LinkStatusBroken  = "broken"
)

// LinkSourceKommands is the only Source in use today.
const LinkSourceKommands = "kommands"

// CommandButtonSet is what GetCommandButtons returns.
//
// Seeded exists because "no file has ever been written, so seed the defaults"
// and "the user deleted every button" are different states that the previous
// string-returning binding could not tell apart: both came back as "". The
// frontend only preserved the second by accident, because an empty array
// marshals to "[]", which is truthy. Making the distinction explicit means the
// seed path can never resurrect buttons somebody deliberately removed.
type CommandButtonSet struct {
	Seeded bool            `json:"seeded"`
	Items  []CommandButton `json:"items"`
}
