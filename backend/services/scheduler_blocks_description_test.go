package services

import (
	"strings"
	"testing"
)

// The description is the hover text in the block browser and quick-add list,
// and the first thing in the node panel, so it says what the block does in one
// sentence and stops. How it does it belongs in the docs (#713).
const maxDescriptionLen = 100

func TestBlockDescriptionsAreOneSentence(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	for _, def := range reg.Defs() {
		d := def.Description
		switch {
		case d == "":
			t.Errorf("%s: no description", def.ID)
		case len(d) > maxDescriptionLen:
			t.Errorf("%s: description is %d characters, over %d: %q", def.ID, len(d), maxDescriptionLen, d)
		case !strings.HasSuffix(d, "."):
			t.Errorf("%s: description does not end in a full stop: %q", def.ID, d)
		case strings.Contains(strings.TrimSuffix(d, "."), ". "):
			t.Errorf("%s: description is more than one sentence: %q", def.ID, d)
		}
	}
}
