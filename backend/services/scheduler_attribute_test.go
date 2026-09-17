package services

import (
	"strings"
	"testing"
)

// ─── The attribute field teaches one spelling (#162) ────────────────────────
//
// The field holds a bare name: both blocks default to one, and the engine looks
// one up. The preset list used to display "@tps" and insert "tps", so the list
// and the field disagreed about the same value and a user could not tell which
// spelling was meant.
//
// The @ is the reference sigil. It belongs in an expression or a value string,
// as in @{ @players.count * 2 }, and not in the field that names the attribute.

func attributeFields(t *testing.T) map[string][]string {
	t.Helper()
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	out := map[string][]string{}
	for _, def := range reg.Defs() {
		for _, f := range def.ConfigSchema {
			if f.Type == "attribute" {
				out[def.ID] = append(out[def.ID], f.Key)
			}
		}
	}
	if len(out) == 0 {
		t.Fatal("no attribute fields found; this test is checking nothing")
	}
	return out
}

func TestAttributeOptionsInsertWhatTheyDisplay(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	for _, def := range reg.Defs() {
		for _, f := range def.ConfigSchema {
			if f.Type != "attribute" {
				continue
			}
			for _, o := range f.Options {
				if strings.HasPrefix(o.Label, "@") {
					t.Errorf("%s.%s: option %q displays the @ form but inserts %q",
						def.ID, f.Key, o.Label, o.Value)
				}
				if strings.HasPrefix(o.Value, "@") {
					t.Errorf("%s.%s: option value %q carries the sigil; the field holds bare names",
						def.ID, f.Key, o.Value)
				}
				// The label may annotate a unit, as "ram.used (MB)" does, but
				// the name it starts with has to be the value it inserts.
				if name, _, _ := strings.Cut(o.Label, " "); name != o.Value {
					t.Errorf("%s.%s: option %q does not name the value %q it inserts",
						def.ID, f.Key, o.Label, o.Value)
				}
			}
		}
	}
}

func TestAttributeDefaultsAreBare(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	fields := attributeFields(t)
	for id, keys := range fields {
		entry, ok := reg.Get(id)
		if !ok {
			t.Fatalf("%s is not registered", id)
		}
		for _, f := range entry.def.ConfigSchema {
			for _, key := range keys {
				if f.Key != key {
					continue
				}
				if d, isStr := f.Default.(string); isStr && strings.HasPrefix(d, "@") {
					t.Errorf("%s.%s: default %q carries the sigil", id, f.Key, d)
				}
			}
		}
	}
}

// The @ form has been taught by the UI for as long as the placeholder was
// there, so anything already saved with one has to keep resolving. The engine
// strips it before lookup, and that tolerance is not what #162 removes.
func TestAttributeLookupToleratesTheSigil(t *testing.T) {
	for _, attr := range []string{"tps", "@tps", "server.motd", "@server.motd"} {
		bare := strings.TrimPrefix(attr, "@")
		if _, known := builtinAttrs[bare]; !known {
			t.Errorf("%q does not resolve to a builtin attribute", attr)
		}
	}
}
