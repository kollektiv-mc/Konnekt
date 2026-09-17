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

// ─── The command blocks carry one field, not two (#161) ────────────────────
//
// A separate preset select outranked the command field at runtime, so a typed
// command could be ignored with nothing in the node saying so. The presets are
// options on the command field now, and the second field is gone for good: if
// it came back, execCommand would have something to prefer again.

func TestCommandBlocksHaveNoSeparatePresetField(t *testing.T) {
	defs := nativeDefs(t)

	for _, id := range []string{"action.command", "action.rcon"} {
		def, ok := defs[id]
		if !ok {
			t.Fatalf("block %q is not registered", id)
		}
		for _, f := range def.ConfigSchema {
			if f.Key == "preset" {
				t.Errorf("%s: the preset field is back, so a command can be silently overridden again", id)
			}
		}
	}
}

func TestCommandFieldsCarryTheirPresets(t *testing.T) {
	defs := nativeDefs(t)

	for _, id := range []string{"action.command", "action.rcon"} {
		field := fieldByKey(t, defs[id], "command")
		if len(field.Options) == 0 {
			t.Errorf("%s: command field offers no presets", id)
		}
		// "— none —" was only meaningful when the preset was a second field
		// that had to be opted out of. An empty option here would write an
		// empty command.
		for _, opt := range field.Options {
			if opt.Value == "" {
				t.Errorf("%s: command presets still offer an empty option (%q)", id, opt.Label)
			}
		}
	}
}

// The lifecycle entries are not commands; execCommand switches on them. They
// are safe to share the command field only because no Minecraft command starts
// with "__", so free text cannot collide with them.
func TestLifecycleSentinelsKeepTheirReservedPrefix(t *testing.T) {
	field := fieldByKey(t, nativeDefs(t)["action.command"], "command")

	found := map[string]bool{}
	for _, opt := range field.Options {
		if strings.HasPrefix(opt.Value, "__") {
			found[opt.Value] = true
		}
	}
	for _, want := range []string{"__start__", "__stop__", "__restart__"} {
		if !found[want] {
			t.Errorf("lifecycle sentinel %q is missing from the command presets", want)
		}
	}
}

func TestExecCommandIgnoresALeftoverPresetKey(t *testing.T) {
	// A graph that somehow still carries `preset` (a hand-edited file, an
	// import written against the old shape) must run what the command field
	// says, which is the whole point of the change.
	e := &ExecContext{Config: map[string]interface{}{
		"preset":  "time set day",
		"command": "",
	}}

	res := execCommand(e)
	if res.Port != "onFailed" {
		t.Fatalf("port = %q, want onFailed on an empty command", res.Port)
	}
	if res.Err == nil || !strings.Contains(res.Err.Error(), "command is empty") {
		t.Errorf("err = %v, want an empty-command failure", res.Err)
	}
}
