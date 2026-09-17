package services

import (
	"strings"
	"testing"

	"konnekt/backend/models"
)

// ─── The attribute field teaches one spelling (#162) ───────────────────────
//
// The field's canonical form is the bare name: that is what the defaults hold
// and what the engine looks up. Labels used to carry a leading @, so the list
// displayed "@tps" and inserted "tps", which is most of why nobody could tell
// which one the field wanted.

// attributeField reads the real registry rather than a copy of it, so these
// tests cannot drift from the descriptors the app ships.
//
// Deliberately local to this file, with a name no other test file would pick:
// the command-block tests (#161) need the same lookup and land separately, and
// two files in one package cannot both declare a shared helper.
func attributeField(t *testing.T, blockID string) models.ConfigField {
	t.Helper()
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	for _, def := range reg.Defs() {
		if def.ID != blockID {
			continue
		}
		for _, f := range def.ConfigSchema {
			if f.Key == "attribute" {
				return f
			}
		}
		t.Fatalf("block %q has no attribute field", blockID)
	}
	t.Fatalf("block %q is not registered", blockID)
	return models.ConfigField{}
}

func TestAttributePresetLabelsMatchTheValuesTheyInsert(t *testing.T) {
	for _, id := range []string{"data.serverAttribute", "data.writeAttribute"} {
		field := attributeField(t, id)

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
	for _, id := range []string{"data.serverAttribute", "data.writeAttribute"} {
		field := attributeField(t, id)

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
// accepting it: anything saved while the placeholder was teaching that form has
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
