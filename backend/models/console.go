package models

// ConsoleLine is one line of the console stream. Source says who wrote it:
// empty for server process output, "manager" for a line Konnekt itself
// narrated (#113). Empty is the zero value on purpose, so a line from any
// path that predates or misses the marker reads as server output.
//
// Outcome is the second half of that marker: source says Konnekt spoke,
// outcome says what it said — "progress" for work under way, "ok" for work
// that finished, "failed" for work that did not. The UI paints a status dot
// per value, which is what replaced the "[Konnekt] " text prefix the line
// used to carry. Empty on server output, and on a manager line from any path
// that predates this, which reads as "progress".
type ConsoleLine struct {
	Timestamp string `json:"timestamp"`
	Line      string `json:"line"`
	Source    string `json:"source"`
	Outcome   string `json:"outcome"`
}
