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
	// The gates plus Compare, which is tested on its own below.
	if n := len(reg.Defs()); n != len(wantLabels)+1 {
		t.Fatalf("registered %d blocks, want %d", n, len(wantLabels)+1)
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

func TestExecCompare(t *testing.T) {
	cases := []struct {
		name        string
		left, right interface{}
		op          string
		want        float64
	}{
		{"eq true", "5", "5", "eq", 1},
		{"eq false", "5", "6", "eq", 0},
		{"ne true", "5", "6", "ne", 1},
		{"gt numeric across digit counts", "10", "9", "gt", 1},
		{"gt numeric, smaller left", "9", "10", "gt", 0},
		{"lt on wired float", float64(8.5), "15", "lt", 1},
		{"lt on wired float, above", float64(19.9), "15", "lt", 0},
		{"gt wired against wired", float64(2), float64(0), "gt", 1},
		{"text gt is lexicographic", "banana", "apple", "gt", 1},
		{"text eq", "green", "green", "eq", 1},
		{"contains true", "hello world", "world", "contains", 1},
		{"contains false", "hello world", "xyz", "contains", 0},
		{"contains never goes numeric", "1234", "23", "contains", 1},
		{"unknown op falls back to eq", "1.0", "1", "whatever", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ec := &ExecContext{
				Config:  map[string]interface{}{"left": c.left, "right": c.right, "op": c.op},
				dataOut: map[string]interface{}{},
			}
			if res := execCompare(ec); res.Err != nil {
				t.Fatalf("unexpected error: %v", res.Err)
			}
			if got := ec.dataOut["value"]; got != c.want {
				t.Errorf("value = %v, want %v", got, c.want)
			}
		})
	}
}

func TestCompareDefinition(t *testing.T) {
	reg := NewBlockRegistry()
	registerLogicBlocks(reg)
	entry, ok := reg.Get("control.compare")
	if !ok {
		t.Fatal("control.compare is not registered")
	}
	def := entry.def
	if def.Label != "Compare" || def.Category != "control" || !isPureData(def) {
		t.Errorf("label %q category %q pure %v", def.Label, def.Category, isPureData(def))
	}
	if len(def.DataOutputs) != 1 || def.DataOutputs[0].ID != "value" || def.DataOutputs[0].Type != "bool" {
		t.Errorf("outputs = %+v, want one bool value", def.DataOutputs)
	}
	var ins, keys, ops []string
	for _, p := range def.DataInputs {
		ins = append(ins, p.ID)
	}
	for _, f := range def.ConfigSchema {
		keys = append(keys, f.Key)
		if f.Key == "op" {
			for _, o := range f.Options {
				ops = append(ops, o.Value)
			}
		}
	}
	if !reflect.DeepEqual(ins, []string{"left", "right"}) || !reflect.DeepEqual(keys, []string{"left", "op", "right"}) {
		t.Errorf("inputs %v, config %v", ins, keys)
	}
	// The unary operators belong to Condition alone: Compare has no use for them.
	if !reflect.DeepEqual(ops, []string{"eq", "ne", "gt", "lt", "contains"}) {
		t.Errorf("operators = %v", ops)
	}

	cond, _ := newTestScheduler(t).registry.Get("control.condition")
	var condOps []string
	for _, f := range cond.def.ConfigSchema {
		if f.Key == "op" {
			for _, o := range f.Options {
				condOps = append(condOps, o.Value)
			}
		}
	}
	if !reflect.DeepEqual(condOps, []string{"eq", "ne", "gt", "lt", "contains", "true", "false"}) {
		t.Errorf("condition operators = %v", condOps)
	}
}

// The issue's acceptance case: two thresholds combined to drive one branch.
// Constants stand in for Read Attribute, which delivers the same float64.
func TestRunGraphCompareAndGateDriveBranch(t *testing.T) {
	cases := []struct {
		name         string
		tps, players string
		want         string
	}{
		{"low tps with players takes onTrue", "8", "3", "yes"},
		{"low tps with nobody takes onFalse", "8", "0", "no"},
		{"healthy tps takes onFalse", "19.9", "3", "no"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newTestScheduler(t)
			var visited []string
			registerTestMarker(s.registry, &visited)
			cfg := func(kv ...interface{}) map[string]interface{} {
				m := map[string]interface{}{}
				for i := 0; i < len(kv); i += 2 {
					m[kv[i].(string)] = kv[i+1]
				}
				return m
			}
			data := func(id, src, sp, tgt, tp string) models.Edge {
				return models.Edge{ID: id, Kind: "data", Source: src, SourcePort: sp, Target: tgt, TargetPort: tp}
			}
			ctrl := func(id, src, sp, tgt string) models.Edge {
				return models.Edge{ID: id, Kind: "control", Source: src, SourcePort: sp, Target: tgt, TargetPort: "trigger"}
			}
			g := models.Graph{
				ID: "cmp",
				Nodes: []models.Node{
					{ID: "t1", Type: "trigger.player", Config: cfg("type", "Joined")},
					{ID: "tps", Type: "data.constant", Config: cfg("type", "Float", "value", c.tps)},
					{ID: "ppl", Type: "data.constant", Config: cfg("type", "Integer", "value", c.players)},
					{ID: "low", Type: "control.compare", Config: cfg("op", "lt", "right", "15")},
					{ID: "any", Type: "control.compare", Config: cfg("op", "gt", "right", "0")},
					{ID: "and", Type: "control.and"},
					{ID: "cond", Type: "control.condition", Config: cfg("op", "true")},
					{ID: "yes", Type: "test.marker", Config: cfg("markerId", "yes")},
					{ID: "no", Type: "test.marker", Config: cfg("markerId", "no")},
				},
				Edges: []models.Edge{
					ctrl("c1", "t1", "onComplete", "cond"),
					ctrl("c2", "cond", "onTrue", "yes"),
					ctrl("c3", "cond", "onFalse", "no"),
					data("d1", "tps", "value", "low", "left"),
					data("d2", "ppl", "value", "any", "left"),
					data("d3", "low", "value", "and", "a"),
					data("d4", "any", "value", "and", "b"),
					data("d5", "and", "value", "cond", "left"),
				},
			}
			rec := s.runGraph(g, "t1", "manual", seed("t1"))
			if rec.Status != "success" {
				t.Fatalf("status = %q (error: %s)", rec.Status, rec.Error)
			}
			if len(visited) != 1 || visited[0] != c.want {
				t.Errorf("visited = %v, want [%s]", visited, c.want)
			}
		})
	}
}
