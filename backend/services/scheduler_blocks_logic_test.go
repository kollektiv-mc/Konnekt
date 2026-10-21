package services

import (
	"reflect"
	"testing"

	"konnekt/backend/models"
)

// runGate executes one gate block against the given config and returns its
// "value" output, going through the registry so the id and the executor are
// tested as registered rather than as wired up by the test.
func runGate(t *testing.T, id string, cfg map[string]interface{}) interface{} {
	t.Helper()
	reg := NewBlockRegistry()
	registerLogicBlocks(reg)
	entry, ok := reg.Get(id)
	if !ok {
		t.Fatalf("%s is not registered", id)
	}
	ec := &ExecContext{Config: cfg, dataOut: map[string]interface{}{}}
	if res := entry.exec(ec); res.Err != nil {
		t.Fatalf("%s: %v", id, res.Err)
	}
	return ec.dataOut["value"]
}

func TestLogicGatesTruthTables(t *testing.T) {
	// Rows are (a, b) = (0,0), (0,1), (1,0), (1,1).
	tables := []struct {
		id   string
		want [4]float64
	}{
		{"control.and", [4]float64{0, 0, 0, 1}},
		{"control.or", [4]float64{0, 1, 1, 1}},
		{"control.xor", [4]float64{0, 1, 1, 0}},
		{"control.nand", [4]float64{1, 1, 1, 0}},
		{"control.nor", [4]float64{1, 0, 0, 0}},
	}
	for _, tb := range tables {
		for i, want := range tb.want {
			a, b := i/2 == 1, i%2 == 1
			t.Run(tb.id, func(t *testing.T) {
				got := runGate(t, tb.id, map[string]interface{}{"a": a, "b": b})
				if got != want {
					t.Errorf("a=%v b=%v: value = %v, want %v", a, b, got, want)
				}
			})
		}
	}
}

func TestLogicNotInvertsAndIgnoresB(t *testing.T) {
	cases := []struct {
		name string
		cfg  map[string]interface{}
		want float64
	}{
		{"false becomes 1", map[string]interface{}{"a": false}, 1},
		{"true becomes 0", map[string]interface{}{"a": true}, 0},
		{"b is ignored when a is false", map[string]interface{}{"a": false, "b": false}, 1},
		{"b is ignored when a is true", map[string]interface{}{"a": true, "b": false}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := runGate(t, "control.not", c.cfg); got != c.want {
				t.Errorf("value = %v, want %v", got, c.want)
			}
		})
	}
}

// A wired value arrives as float64 0/1 and a literal as text, so a gate has to
// read every spelling the engine can hand it the same way.
func TestLogicGatesReadEveryInputSpelling(t *testing.T) {
	cases := []struct {
		name string
		v    interface{}
		want bool
	}{
		{"wired one", float64(1), true},
		{"wired zero", float64(0), false},
		{"any non-zero number", float64(-2.5), true},
		{"int", 3, true},
		{"bool true", true, true},
		{"bool false", false, false},
		{"text true", "true", true},
		{"text false", "false", false},
		{"text true, any case and padding", " TRUE ", true},
		{"text one", "1", true},
		{"text zero", "0", false},
		{"text number", "0.5", true},
		{"unrecognised text", "yes", false},
		{"empty text", "", false},
		{"missing", nil, false},
		{"NaN is not true", "NaN", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			want := float64(0)
			if c.want {
				want = 1
			}
			// OR with a false B reads A alone.
			got := runGate(t, "control.or", map[string]interface{}{"a": c.v, "b": false})
			if got != want {
				t.Errorf("OR(%#v, false) = %v, want %v", c.v, got, want)
			}
		})
	}

	t.Run("an input left unset is false", func(t *testing.T) {
		if got := runGate(t, "control.nor", map[string]interface{}{}); got != float64(1) {
			t.Errorf("NOR with nothing set = %v, want 1", got)
		}
	})
}

func TestLogicGateDefinitions(t *testing.T) {
	reg := NewBlockRegistry()
	registerLogicBlocks(reg)

	wantLabels := map[string]string{
		"control.and": "AND", "control.or": "OR", "control.xor": "XOR",
		"control.not": "NOT", "control.nand": "NAND", "control.nor": "NOR",
	}
	if n := len(reg.Defs()); n != len(wantLabels) {
		t.Fatalf("registered %d blocks, want %d", n, len(wantLabels))
	}
	for id, label := range wantLabels {
		entry, ok := reg.Get(id)
		if !ok {
			t.Errorf("%s is not registered", id)
			continue
		}
		def := entry.def
		if def.Label != label || def.Category != "control" {
			t.Errorf("%s: label %q category %q, want %q control", id, def.Label, def.Category, label)
		}
		if len(def.ControlInputs) != 0 || len(def.ControlOutputs) != 0 || !isPureData(def) {
			t.Errorf("%s must be pure data (no control ports)", id)
		}
		wantIns := []string{"a", "b"}
		if id == "control.not" {
			wantIns = []string{"a"}
		}
		var ins, cfgKeys []string
		for _, p := range def.DataInputs {
			ins = append(ins, p.ID)
			if p.Type != "bool" {
				t.Errorf("%s input %s has type %q, want bool", id, p.ID, p.Type)
			}
		}
		for _, f := range def.ConfigSchema {
			cfgKeys = append(cfgKeys, f.Key)
		}
		// Port id == config key, so each input has a field for when it is unwired.
		if !reflect.DeepEqual(ins, wantIns) || !reflect.DeepEqual(cfgKeys, wantIns) {
			t.Errorf("%s: inputs %v, config %v, want both %v", id, ins, cfgKeys, wantIns)
		}
		if len(def.DataOutputs) != 1 || def.DataOutputs[0].ID != "value" || def.DataOutputs[0].Type != "bool" {
			t.Errorf("%s outputs = %+v, want one bool value", id, def.DataOutputs)
		}
	}
}

func TestBuiltinRegistryHasTheGates(t *testing.T) {
	reg := newTestScheduler(t).registry
	for _, id := range []string{
		"control.and", "control.or", "control.xor", "control.not", "control.nand", "control.nor",
	} {
		if _, ok := reg.Get(id); !ok {
			t.Errorf("%s missing from the built-in registry", id)
		}
	}
}

func TestExecConditionIsTrueAndIsFalse(t *testing.T) {
	cases := []struct {
		name     string
		left     interface{}
		right    interface{}
		op       string
		wantPort string
	}{
		{"is true on wired one", float64(1), nil, "true", "onTrue"},
		{"is true on wired zero", float64(0), nil, "true", "onFalse"},
		{"is false on wired zero", float64(0), nil, "false", "onTrue"},
		{"is false on wired one", float64(1), nil, "false", "onFalse"},
		{"is true on bool", true, nil, "true", "onTrue"},
		{"is true on text true", "true", nil, "true", "onTrue"},
		{"is false on text false", "false", nil, "false", "onTrue"},
		{"is true on empty left", "", nil, "true", "onFalse"},
		{"is false on empty left", "", nil, "false", "onTrue"},
		{"right operand is ignored by is true", float64(1), "0", "true", "onTrue"},
		{"right operand is ignored by is false", float64(0), "1", "false", "onTrue"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := map[string]interface{}{"left": c.left, "op": c.op}
			if c.right != nil {
				cfg["right"] = c.right
			}
			if got := execCondition(&ExecContext{Config: cfg}).Port; got != c.wantPort {
				t.Errorf("port = %q, want %q", got, c.wantPort)
			}
		})
	}
}

// Gates feeding a Condition through the engine: the gate is pulled when the
// Condition reads its wired left operand, and "is true" branches on the result.
func TestRunGraphGateDrivesCondition(t *testing.T) {
	cases := []struct {
		name        string
		a, b        string
		wantVisited string
	}{
		{"both true takes onTrue", "true", "true", "yes"},
		{"one false takes onFalse", "true", "false", "no"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newTestScheduler(t)
			var visited []string
			registerTestMarker(s.registry, &visited)

			g := models.Graph{
				ID: "gate",
				Nodes: []models.Node{
					{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
					{ID: "ca", Type: "data.constant", Config: map[string]interface{}{"type": "Boolean", "value": c.a}},
					{ID: "cb", Type: "data.constant", Config: map[string]interface{}{"type": "Boolean", "value": c.b}},
					{ID: "and", Type: "control.and"},
					{ID: "cond", Type: "control.condition", Config: map[string]interface{}{"op": "true"}},
					{ID: "yes", Type: "test.marker", Config: map[string]interface{}{"markerId": "yes"}},
					{ID: "no", Type: "test.marker", Config: map[string]interface{}{"markerId": "no"}},
				},
				Edges: []models.Edge{
					{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "cond", TargetPort: "trigger"},
					{ID: "e2", Kind: "control", Source: "cond", SourcePort: "onTrue", Target: "yes", TargetPort: "trigger"},
					{ID: "e3", Kind: "control", Source: "cond", SourcePort: "onFalse", Target: "no", TargetPort: "trigger"},
					{ID: "d1", Kind: "data", Source: "ca", SourcePort: "value", Target: "and", TargetPort: "a"},
					{ID: "d2", Kind: "data", Source: "cb", SourcePort: "value", Target: "and", TargetPort: "b"},
					{ID: "d3", Kind: "data", Source: "and", SourcePort: "value", Target: "cond", TargetPort: "left"},
				},
			}

			rec := s.runGraph(g, "t1", "manual", seed("t1"))
			if rec.Status != "success" {
				t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
			}
			if len(visited) != 1 || visited[0] != c.wantVisited {
				t.Errorf("visited = %v, want [%s]", visited, c.wantVisited)
			}
		})
	}
}

// The data panel previews a gate by running it, like Constant and Math.
func TestPreviewNodeShowsGateOutput(t *testing.T) {
	s := newTestScheduler(t)
	g := models.Graph{
		ID: "g1",
		Nodes: []models.Node{
			{ID: "x", Type: "control.xor", Config: map[string]interface{}{"a": true, "b": false}},
		},
	}
	p, err := s.PreviewNode(g, "x")
	if err != nil {
		t.Fatalf("PreviewNode: %v", err)
	}
	if !p.OK || !reflect.DeepEqual(p.Console, []string{"Value = 1"}) {
		t.Errorf("preview = ok %v, console %q, want ok with %q", p.OK, p.Console, "Value = 1")
	}
}
