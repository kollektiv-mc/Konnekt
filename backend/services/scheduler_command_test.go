package services

import (
	"context"
	"testing"

	"konnekt/backend/models"
)

// ─── One command field, and it is the one that runs (#161) ─────────────────
//
// action.command and action.rcon used to read a "preset" config field ahead of
// their "command" field, in the executor and again in the preview. A user who
// picked a preset and then typed a command got the preset, unannounced, on
// every unattended run; so did a graph that computed its command and wired it
// in, because an edge's value arrives as config.
//
// These pin the absence of that rule. A leftover "preset" key is the shape a
// graph has if it somehow reaches execution unmigrated, and it must carry no
// weight at all.

func execCtx(cfg map[string]interface{}) *ExecContext {
	return &ExecContext{
		Ctx:     context.Background(),
		Config:  cfg,
		dataOut: map[string]interface{}{},
	}
}

func TestExecCommandIgnoresALeftoverPreset(t *testing.T) {
	// No server is wired into this context, so a command that did reach
	// SendCommand would panic rather than pass: reaching the empty-command
	// guard is itself the assertion that "preset" supplied nothing.
	res := execCommand(execCtx(map[string]interface{}{"preset": "time set day"}))

	if res.Port != "onFailed" {
		t.Fatalf("port = %q, want onFailed", res.Port)
	}
	if res.Err == nil || res.Err.Error() != "command is empty" {
		t.Errorf("err = %v, want \"command is empty\"", res.Err)
	}
}

// The preview and the run must name the same command. They read separate code
// paths, which is exactly how they drifted into two copies of the precedence
// rule, so the preview is pinned on the same inputs.
func TestSimulateCommandNodeReadsOnlyTheCommandField(t *testing.T) {
	s := newTestScheduler(t)

	cases := []struct {
		name string
		typ  string
		cfg  map[string]interface{}
		want string
		ok   bool
	}{
		{
			name: "the command field is what would run",
			typ:  "action.command",
			cfg:  map[string]interface{}{"command": "say hello"},
			want: "would run: say hello",
			ok:   true,
		},
		{
			name: "a leftover preset does not override it",
			typ:  "action.command",
			cfg:  map[string]interface{}{"preset": "time set day", "command": "say hello"},
			want: "would run: say hello",
			ok:   true,
		},
		{
			name: "a leftover preset does not supply one either",
			typ:  "action.command",
			cfg:  map[string]interface{}{"preset": "time set day"},
			want: "would fail: command is empty",
			ok:   false,
		},
		{
			name: "a lifecycle sentinel previews as itself",
			typ:  "action.command",
			cfg:  map[string]interface{}{"command": lifecycleRestart},
			want: "would run: " + lifecycleRestart,
			ok:   true,
		},
		{
			name: "rcon reads the same single field",
			typ:  "action.rcon",
			cfg:  map[string]interface{}{"preset": "save-all", "command": "list"},
			want: "would rcon: list",
			ok:   true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			node := models.Node{ID: "n", Type: tc.typ, Config: tc.cfg}
			lines, ok := s.simulateNode(context.Background(), node, tc.cfg, nil, nil)

			if ok != tc.ok {
				t.Errorf("ok = %v, want %v", ok, tc.ok)
			}
			if len(lines) != 1 || lines[0] != tc.want {
				t.Errorf("lines = %v, want [%q]", lines, tc.want)
			}
		})
	}
}

// Every option the merged field offers has to be something the block can act
// on: a sentinel execCommand switches on, or text it sends verbatim. A typo in
// a sentinel would be sent to the server as a command instead of starting it.
func TestCommandPresetOptionsAreActionable(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)

	sentinels := map[string]bool{
		lifecycleStart: true, lifecycleStop: true, lifecycleRestart: true,
	}

	for _, id := range []string{"action.command", "action.rcon"} {
		entry, ok := reg.Get(id)
		if !ok {
			t.Fatalf("%s is not registered", id)
		}
		def := entry.def

		var fields []string
		for _, f := range def.ConfigSchema {
			fields = append(fields, f.Key)
			if f.Key != "command" {
				continue
			}
			if len(f.Options) == 0 {
				t.Errorf("%s: the command field offers no presets", id)
			}
			for _, o := range f.Options {
				if o.Value == "" {
					t.Errorf("%s: an empty option value is a command that cannot run", id)
				}
				if o.Label == "" {
					t.Errorf("%s: option %q has no label to render", id, o.Value)
				}
				if id == "action.rcon" && sentinels[o.Value] {
					t.Errorf("action.rcon offers %q, which execRcon cannot act on", o.Value)
				}
			}
		}

		for _, k := range fields {
			if k == "preset" {
				t.Errorf("%s still declares a preset field; it was merged into command", id)
			}
		}
	}
}
