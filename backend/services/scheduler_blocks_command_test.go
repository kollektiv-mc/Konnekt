package services

import (
	"strings"
	"testing"

	"konnekt/backend/models"
)

// ─── The command blocks carry one field, not two (#161) ────────────────────
//
// A separate preset select outranked the command field at runtime, so a typed
// command could be ignored with nothing in the node saying so. The presets are
// options on the command field now, and the second field is gone for good: if
// it came back, execCommand would have something to prefer again.

// commandBlock reads the real registry rather than a copy of it, so these tests
// cannot drift from the descriptors the app ships.
//
// Deliberately local to this file, with a name no other test file would pick:
// the attribute tests (#162) need a similar lookup and land separately, and two
// files in one package cannot both declare a shared helper.
func commandBlock(t *testing.T, blockID string) models.BlockDef {
	t.Helper()
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	for _, def := range reg.Defs() {
		if def.ID == blockID {
			return def
		}
	}
	t.Fatalf("block %q is not registered", blockID)
	return models.BlockDef{}
}

func commandFieldOf(t *testing.T, def models.BlockDef) models.ConfigField {
	t.Helper()
	for _, f := range def.ConfigSchema {
		if f.Key == "command" {
			return f
		}
	}
	t.Fatalf("block %q has no command field", def.ID)
	return models.ConfigField{}
}

func TestCommandBlocksHaveNoSeparatePresetField(t *testing.T) {
	for _, id := range []string{"action.command", "action.rcon"} {
		for _, f := range commandBlock(t, id).ConfigSchema {
			if f.Key == "preset" {
				t.Errorf("%s: the preset field is back, so a command can be silently overridden again", id)
			}
		}
	}
}

func TestCommandFieldsCarryTheirPresets(t *testing.T) {
	for _, id := range []string{"action.command", "action.rcon"} {
		field := commandFieldOf(t, commandBlock(t, id))

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
	field := commandFieldOf(t, commandBlock(t, "action.command"))

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
