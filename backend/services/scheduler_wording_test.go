package services

import "testing"

// The block palette is 192px wide at an 11px monospace face, which fits twenty
// characters before a label wraps onto a second line, as "Distant Horizons
// Snapshot" did. A longer name belongs in the description, which the config
// panel shows in full.
const maxBlockLabelLen = 20

func TestBlockLabelsFitThePalette(t *testing.T) {
	defs, err := NewSchedulerService(nil, nil, nil, nil).GetBlockDefs()
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) == 0 {
		t.Fatal("the registry returned no blocks")
	}
	for _, def := range defs {
		if n := len(def.Label); n > maxBlockLabelLen {
			t.Errorf("%s: label %q is %d characters, the palette fits %d", def.ID, def.Label, n, maxBlockLabelLen)
		}
	}
}

// The editor shows graph advice on one line of its toolbar, cut at the edge
// with the whole text in a tooltip, so the first clause carries the point and
// the whole reads in a tooltip at a glance. Two sentences is the room there is.
const maxGraphWarningLen = 140

func TestGraphWarningsStayShort(t *testing.T) {
	for _, w := range []string{rconUnconfirmedWarning, dhSnapshotConsoleWarning} {
		if n := len(w); n > maxGraphWarningLen {
			t.Errorf("%d characters, the toolbar line holds %d: %q", n, maxGraphWarningLen, w)
		}
	}
}
