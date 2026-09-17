package services

import (
	"strings"
	"testing"

	"konnekt/backend/models"
)

// nativeDefs builds the registry the app ships with, so these tests read the
// real block descriptors rather than a copy that can drift from them.
func nativeDefs(t *testing.T) map[string]models.BlockDef {
	t.Helper()
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	byID := make(map[string]models.BlockDef)
	for _, d := range reg.Defs() {
		byID[d.ID] = d
	}
	return byID
}

func fieldByKey(t *testing.T, def models.BlockDef, key string) models.ConfigField {
	t.Helper()
	for _, f := range def.ConfigSchema {
		if f.Key == key {
			return f
		}
	}
	t.Fatalf("block %q has no %q field", def.ID, key)
	return models.ConfigField{}
}

// ─── The attribute field teaches one spelling (#162) ───────────────────────
//
// The field's canonical form is the bare name: that is what the defaults hold
// and what the engine looks up. Labels used to carry a leading @, so the list
// displayed "@tps" and inserted "tps", which is most of why nobody could tell
// which one the field wanted.

func TestAttributePresetLabelsMatchTheValuesTheyInsert(t *testing.T) {
	defs := nativeDefs(t)

	for _, id := range []string{"data.serverAttribute", "data.writeAttribute"} {
		def, ok := defs[id]
		if !ok {
			t.Fatalf("block %q is not registered", id)
		}
		field := fieldByKey(t, def, "attribute")

		if len(field.Options) == 0 {
			t.Fatalf("%s: attribute field has no presets to check", id)
		}
		for _, opt := range field.Options {
			if strings.HasPrefix(opt.Label, "@") {
				t.Errorf("%s: preset label %q carries the @ sigil but inserts %q", id, opt.Label, opt.Value)
			}
			// A label may add a unit ("ram.used (MB)"), but it has to start
			// with the value it puts in the field.
			if !strings.HasPrefix(opt.Label, opt.Value) {
				t.Errorf("%s: preset label %q does not name its value %q", id, opt.Label, opt.Value)
			}
		}
	}
}

func TestAttributeDefaultsAreBareNames(t *testing.T) {
	defs := nativeDefs(t)

	for _, id := range []string{"data.serverAttribute", "data.writeAttribute"} {
		field := fieldByKey(t, defs[id], "attribute")
		def, isString := field.Default.(string)
		if !isString {
			t.Errorf("%s: attribute default %v is not a string", id, field.Default)
			continue
		}
		if strings.HasPrefix(def, "@") {
			t.Errorf("%s: default %q carries the @ sigil", id, def)
		}
	}
}

// The @ is the reference sigil, not part of the name, so the engine keeps
// accepting it: anything saved while the placeholder was taught that form has
// to keep resolving. execWriteAttribute reaches its read-only check before it
// touches any service, so both spellings can be driven straight through.
func TestAttributeLookupStillToleratesTheSigil(t *testing.T) {
	for _, attr := range []string{"tps", "@tps"} {
		e := &ExecContext{Config: map[string]interface{}{
			"attribute": attr,
			"value":     "20",
		}}

		res := execWriteAttribute(e)

		// tps is read-only, so resolving the name at all is what produces this.
		// A lookup that kept the @ would miss builtinAttrs and fall through.
		if res.Port != "onFailed" {
			t.Errorf("%q: port = %q, want onFailed", attr, res.Port)
		}
		if res.Err == nil || !strings.Contains(res.Err.Error(), "read-only") {
			t.Errorf("%q: err = %v, want a read-only refusal", attr, res.Err)
		}
	}
}
