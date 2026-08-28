package models

// ConsoleLine is one line of the console stream. Source says who wrote it:
// empty for server process output, "manager" for a line Konnekt itself
// narrated (#113). Empty is the zero value on purpose, so a line from any
// path that predates or misses the marker reads as server output.
type ConsoleLine struct {
	Timestamp string `json:"timestamp"`
	Line      string `json:"line"`
	Source    string `json:"source"`
}
