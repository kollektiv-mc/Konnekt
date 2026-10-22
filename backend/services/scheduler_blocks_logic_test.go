package services

import (
	"reflect"
	"strings"
	"testing"

	"konnekt/backend/models"
)

// runCondition executes Condition against cfg and returns the branch it took
// and the value of its "result" output.
func runCondition(t *testing.T, cfg map[string]interface{}) (port string, result interface{}) {
	t.Helper()
	ec := &ExecContext{Config: cfg, dataOut: map[string]interface{}{}}
	res := execCondition(ec)
	if res.Err != nil {
		t.Fatalf("unexpected error: %v", res.Err)
	}
	return res.Port, ec.dataOut["result"]
}

func conditionDef(t *testing.T) models.BlockDef {
	t.Helper()
	entry, ok := newTestScheduler(t).registry.Get("control.condition")
	if !ok {
		t.Fatal("control.condition is not registered")
	}
	return entry.def
}

func portFor(want bool) string {
	if want {
		return "onTrue"
	}
	return "onFalse"
}

func TestConditionGateTruthTables(t *testing.T) {
	// Rows are (A, B) = (0,0), (0,1), (1,0), (1,1).
	tables := []struct {
		op   string
		want [4]bool
	}{
		{"and", [4]bool{false, false, false, true}},
		{"or", [4]bool{false, true, true, true}},
		{"xor", [4]bool{false, true, true, false}},
		{"nand", [4]bool{true, true, true, false}},
		{"nor", [4]bool{true, false, false, false}},
	}
	for _, tb := range tables {
		for i, want := range tb.want {
			a, b := i/2 == 1, i%2 == 1
			t.Run(tb.op, func(t *testing.T) {
				port, result := runCondition(t, map[string]interface{}{"op": tb.op, "left": a, "right": b})
				wantResult := float64(0)
				if want {
					wantResult = 1
				}
				if port != portFor(want) || result != wantResult {
					t.Errorf("a=%v b=%v: port %q result %v, want %q %v", a, b, port, result, portFor(want), wantResult)
				}
			})
		}
	}
}

// An unchecked "is true" flips its operand, which is what NOT used to do, and a
// missing box counts as checked.
func TestConditionIsTrueBoxesFlipOperands(t *testing.T) {
	cases := []struct {
		name string
		cfg  map[string]interface{}
		want bool
	}{
		{"boxes unset read A and B as they are", map[string]interface{}{"op": "and", "left": true, "right": true}, true},
		{"both checked behaves as before", map[string]interface{}{"op": "and", "left": true, "right": true, "leftTrue": true, "rightTrue": true}, true},
		{"unchecked A flips A", map[string]interface{}{"op": "and", "left": false, "right": true, "leftTrue": false}, true},
		{"unchecked A flips a true A", map[string]interface{}{"op": "and", "left": true, "right": true, "leftTrue": false}, false},
		{"unchecked B flips B", map[string]interface{}{"op": "and", "left": true, "right": false, "rightTrue": false}, true},
		{"both unchecked is NOR of the values", map[string]interface{}{"op": "and", "left": false, "right": false, "leftTrue": false, "rightTrue": false}, true},
		{"unchecked A makes OR a NOT-A or B", map[string]interface{}{"op": "or", "left": true, "right": false, "leftTrue": false}, false},
		{"unchecked A, wired one", map[string]interface{}{"op": "or", "left": float64(1), "right": false, "leftTrue": false}, false},
		{"unchecked A, wired zero", map[string]interface{}{"op": "or", "left": float64(0), "right": false, "leftTrue": false}, true},
		{"XOR with one flipped operand", map[string]interface{}{"op": "xor", "left": true, "right": true, "rightTrue": false}, true},
		{"NAND with both flipped", map[string]interface{}{"op": "nand", "left": false, "right": false, "leftTrue": false, "rightTrue": false}, false},
		{"NOR with A flipped", map[string]interface{}{"op": "nor", "left": true, "right": false, "leftTrue": false}, true},
		{"checkbox spelled as text false", map[string]interface{}{"op": "or", "left": true, "right": false, "leftTrue": "false"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			port, _ := runCondition(t, c.cfg)
			if port != portFor(c.want) {
				t.Errorf("port = %q, want %q", port, portFor(c.want))
			}
		})
	}
}

// A wired value arrives as float64 0/1 and a literal as text, so a gate has to
// read every spelling the engine can hand it the same way.
func TestConditionGateReadsEveryInputSpelling(t *testing.T) {
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
			// OR with a false B reads A alone.
			port, _ := runCondition(t, map[string]interface{}{"op": "or", "left": c.v, "right": false})
			if port != portFor(c.want) {
				t.Errorf("OR(%#v, false) took %q, want %q", c.v, port, portFor(c.want))
			}
		})
	}
}

func TestConditionComparisonsIgnoreIsTrueBoxes(t *testing.T) {
	cases := []struct {
		name string
		cfg  map[string]interface{}
		want bool
	}{
		{"gt with boxes unchecked", map[string]interface{}{"op": "gt", "left": "10", "right": "9", "leftTrue": false, "rightTrue": false}, true},
		{"lt with boxes unchecked", map[string]interface{}{"op": "lt", "left": "10", "right": "9", "leftTrue": false, "rightTrue": false}, false},
		{"eq with boxes unchecked", map[string]interface{}{"op": "eq", "left": "a", "right": "a", "leftTrue": false}, true},
		{"ne with boxes unchecked", map[string]interface{}{"op": "ne", "left": "a", "right": "a", "rightTrue": false}, false},
		{"contains with boxes unchecked", map[string]interface{}{"op": "contains", "left": "hello", "right": "ell", "leftTrue": false}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if port, _ := runCondition(t, c.cfg); port != portFor(c.want) {
				t.Errorf("port = %q, want %q", port, portFor(c.want))
			}
		})
	}
}

// A wired true is float64 1, which the literal text "true" never matched.
func TestConditionEqReadsBooleansAsTruthiness(t *testing.T) {
	cases := []struct {
		name        string
		left, right interface{}
		op          string
		want        bool
	}{
		{"wired one == true", float64(1), "true", "eq", true},
		{"wired zero == true", float64(0), "true", "eq", false},
		{"wired zero == false", float64(0), "false", "eq", true},
		{"wired one == false", float64(1), "false", "eq", false},
		{"wired one != true", float64(1), "true", "ne", false},
		{"wired zero != true", float64(0), "true", "ne", true},
		{"wired one != false", float64(1), "false", "ne", true},
		{"true on the left", "true", float64(1), "eq", true},
		{"false on the left", "false", float64(1), "eq", false},
		{"bool == text true", true, "true", "eq", true},
		{"bool false == text true", false, "true", "eq", false},
		{"text case and padding", float64(1), " True ", "eq", true},
		{"any non-zero number is true", float64(7), "true", "eq", true},
		{"text number is true", "1", "true", "eq", true},
		{"text true == text true", "true", "true", "eq", true},
		{"text true != text false", "true", "false", "ne", true},
		{"other side not boolean falls back to text", "yes", "true", "eq", false},
		{"text false vs unrecognised text is not equal", "false", "yes", "eq", false},
		{"text false vs empty is not equal", "false", "", "eq", false},
		{"bool vs numeric spelling stays unequal", true, "1", "eq", false},
		{"gt keeps comparing as text", float64(1), "true", "gt", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := map[string]interface{}{"left": c.left, "right": c.right, "op": c.op}
			if port, _ := runCondition(t, cfg); port != portFor(c.want) {
				t.Errorf("port = %q, want %q", port, portFor(c.want))
			}
		})
	}
}

func TestConditionResultOutputMatchesBranch(t *testing.T) {
	cases := []struct {
		name string
		cfg  map[string]interface{}
		want float64
	}{
		{"eq true", map[string]interface{}{"op": "eq", "left": "5", "right": "5"}, 1},
		{"eq false", map[string]interface{}{"op": "eq", "left": "5", "right": "6"}, 0},
		{"ne true", map[string]interface{}{"op": "ne", "left": "5", "right": "6"}, 1},
		{"gt numeric across digit counts", map[string]interface{}{"op": "gt", "left": "10", "right": "9"}, 1},
		{"gt numeric, smaller left", map[string]interface{}{"op": "gt", "left": "9", "right": "10"}, 0},
		{"lt on wired float", map[string]interface{}{"op": "lt", "left": float64(8.5), "right": "15"}, 1},
		{"lt on wired float, above", map[string]interface{}{"op": "lt", "left": float64(19.9), "right": "15"}, 0},
		{"text gt is lexicographic", map[string]interface{}{"op": "gt", "left": "banana", "right": "apple"}, 1},
		{"contains true", map[string]interface{}{"op": "contains", "left": "hello world", "right": "world"}, 1},
		{"contains false", map[string]interface{}{"op": "contains", "left": "hello world", "right": "xyz"}, 0},
		{"contains never goes numeric", map[string]interface{}{"op": "contains", "left": "1234", "right": "23"}, 1},
		{"unknown op falls back to eq", map[string]interface{}{"op": "whatever", "left": "1.0", "right": "1"}, 1},
		{"and true", map[string]interface{}{"op": "and", "left": true, "right": true}, 1},
		{"and false", map[string]interface{}{"op": "and", "left": true, "right": false}, 0},
		{"nor flipped", map[string]interface{}{"op": "nor", "left": true, "right": false, "leftTrue": false}, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			port, result := runCondition(t, c.cfg)
			if result != c.want {
				t.Errorf("result = %v, want %v", result, c.want)
			}
			if port != portFor(c.want == 1) {
				t.Errorf("port = %q disagrees with result %v", port, c.want)
			}
		})
	}
}

func TestConditionDefinition(t *testing.T) {
	def := conditionDef(t)

	if def.Label != "Condition" || def.Category != "control" {
		t.Errorf("label %q category %q", def.Label, def.Category)
	}
	if !reflect.DeepEqual(def.ControlInputs, []string{"trigger"}) ||
		!reflect.DeepEqual(def.ControlOutputs, []string{"onTrue", "onFalse"}) {
		t.Errorf("control ports in %v out %v", def.ControlInputs, def.ControlOutputs)
	}

	var ins []models.DataPort
	ins = append(ins, def.DataInputs...)
	wantIns := []models.DataPort{{ID: "left", Label: "A", Type: "string"}, {ID: "right", Label: "B", Type: "string"}}
	if !reflect.DeepEqual(ins, wantIns) {
		t.Errorf("data inputs = %+v, want %+v", ins, wantIns)
	}
	wantOut := []models.DataPort{{ID: "result", Label: "Result", Type: "bool"}}
	if !reflect.DeepEqual(def.DataOutputs, wantOut) {
		t.Errorf("data outputs = %+v, want %+v", def.DataOutputs, wantOut)
	}

	fields := map[string]models.ConfigField{}
	var keys []string
	for _, f := range def.ConfigSchema {
		fields[f.Key] = f
		keys = append(keys, f.Key)
	}
	if !reflect.DeepEqual(keys, []string{"op", "left", "right", "leftTrue", "rightTrue"}) {
		t.Errorf("config keys = %v", keys)
	}

	var ops []string
	for _, o := range fields["op"].Options {
		ops = append(ops, o.Value)
	}
	if !reflect.DeepEqual(ops, []string{"eq", "ne", "gt", "lt", "contains", "and", "or", "xor", "nand", "nor"}) {
		t.Errorf("operators = %v", ops)
	}
	var labels []string
	for _, o := range fields["op"].Options {
		labels = append(labels, o.Label)
	}
	if !reflect.DeepEqual(labels, []string{"==", "!=", ">", "<", "contains", "AND", "OR", "XOR", "NAND", "NOR"}) {
		t.Errorf("operator labels = %v", labels)
	}
	if fields["op"].Default != "eq" {
		t.Errorf("operator default = %v, want eq", fields["op"].Default)
	}
}

// The layout is data: A and B on one row, the checkboxes on the next, and the
// checkboxes shown only for a gate.
func TestConditionFieldsDeclareLayoutAndVisibility(t *testing.T) {
	fields := map[string]models.ConfigField{}
	for _, f := range conditionDef(t).ConfigSchema {
		fields[f.Key] = f
	}

	for _, k := range []string{"left", "right"} {
		f := fields[k]
		if f.Row != "values" || f.ShowWhen != nil {
			t.Errorf("%s: row %q showWhen %+v, want row values and always shown", k, f.Row, f.ShowWhen)
		}
	}
	if fields["left"].Label != "A" || fields["right"].Label != "B" {
		t.Errorf("labels %q and %q, want A and B", fields["left"].Label, fields["right"].Label)
	}
	if fields["op"].Row != "" || fields["op"].ShowWhen != nil {
		t.Errorf("operator should sit on its own line, always shown")
	}

	wantWhen := &models.FieldWhen{Key: "op", Values: []string{"and", "or", "xor", "nand", "nor"}}
	for _, k := range []string{"leftTrue", "rightTrue"} {
		f := fields[k]
		if f.Type != "bool" || f.Label != "is true" || f.Default != true {
			t.Errorf("%s: type %q label %q default %v", k, f.Type, f.Label, f.Default)
		}
		if f.Row != "truth" {
			t.Errorf("%s: row %q, want truth", k, f.Row)
		}
		if !reflect.DeepEqual(f.ShowWhen, wantWhen) {
			t.Errorf("%s: showWhen = %+v, want %+v", k, f.ShowWhen, wantWhen)
		}
	}
	// One hint for the line, so it is drawn once under both boxes.
	if fields["leftTrue"].Hint == "" || fields["rightTrue"].Hint != "" {
		t.Errorf("hints %q and %q, want one on leftTrue only",
			fields["leftTrue"].Hint, fields["rightTrue"].Hint)
	}
	if strings.ContainsAny(fields["leftTrue"].Hint, "\u2014\u2013") {
		t.Errorf("hint %q has a dash", fields["leftTrue"].Hint)
	}
}

func TestConditionDescriptionFollowsCopyRules(t *testing.T) {
	d := conditionDef(t).Description
	switch {
	case len(d) > 100:
		t.Errorf("description is %d characters, want at most 100", len(d))
	case !strings.HasSuffix(d, "."):
		t.Errorf("description %q does not end with a period", d)
	case strings.Contains(d, ". "):
		t.Errorf("description %q is more than one sentence", d)
	case strings.ContainsAny(d, "\u2014\u2013"):
		t.Errorf("description %q has a dash", d)
	}
}

func TestBuiltinRegistryHasNoSeparateGateBlocks(t *testing.T) {
	reg := newTestScheduler(t).registry
	for _, id := range []string{
		"control.and", "control.or", "control.xor", "control.not",
		"control.nand", "control.nor", "control.compare",
	} {
		if _, ok := reg.Get(id); ok {
			t.Errorf("%s is registered; Condition replaces it", id)
		}
	}
}

// The Result output lets one Condition feed another: a threshold on the first
// is wired into an AND on the second.
func TestRunGraphConditionResultFeedsCondition(t *testing.T) {
	cases := []struct {
		name         string
		tps, players string
		want         string
	}{
		{"low tps with players takes onTrue", "8", "3", "yes"},
		{"low tps with nobody takes onFalse", "8", "0", "no"},
		{"healthy tps takes onFalse", "19.9", "3", "no"},
	}
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
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newTestScheduler(t)
			var visited []string
			registerTestMarker(s.registry, &visited)
			g := models.Graph{
				ID: "chain",
				Nodes: []models.Node{
					{ID: "t1", Type: "trigger.player", Config: cfg("type", "Joined")},
					{ID: "tps", Type: "data.constant", Config: cfg("type", "Float", "value", c.tps)},
					{ID: "ppl", Type: "data.constant", Config: cfg("type", "Integer", "value", c.players)},
					{ID: "low", Type: "control.condition", Config: cfg("op", "lt", "right", "15")},
					{ID: "any", Type: "control.condition", Config: cfg("op", "gt", "right", "0")},
					{ID: "both", Type: "control.condition", Config: cfg("op", "and")},
					{ID: "yes", Type: "test.marker", Config: cfg("markerId", "yes")},
					{ID: "no", Type: "test.marker", Config: cfg("markerId", "no")},
				},
				Edges: []models.Edge{
					ctrl("c1", "t1", "onComplete", "low"),
					ctrl("c2", "low", "onTrue", "any"),
					ctrl("c3", "low", "onFalse", "both"),
					ctrl("c4", "any", "onTrue", "both"),
					ctrl("c5", "any", "onFalse", "both"),
					ctrl("c6", "both", "onTrue", "yes"),
					ctrl("c7", "both", "onFalse", "no"),
					data("d1", "tps", "value", "low", "left"),
					data("d2", "ppl", "value", "any", "left"),
					data("d3", "low", "result", "both", "left"),
					data("d4", "any", "result", "both", "right"),
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

// A wired boolean compared with == true, end to end through the engine.
func TestRunGraphWiredBooleanEqualsTrue(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  string
	}{
		{"true takes onTrue", "true", "yes"},
		{"false takes onFalse", "false", "no"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newTestScheduler(t)
			var visited []string
			registerTestMarker(s.registry, &visited)
			g := models.Graph{
				ID: "eqtrue",
				Nodes: []models.Node{
					{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
					{ID: "flag", Type: "data.constant", Config: map[string]interface{}{"type": "Boolean", "value": c.value}},
					{ID: "cond", Type: "control.condition", Config: map[string]interface{}{"op": "eq", "right": "true"}},
					{ID: "yes", Type: "test.marker", Config: map[string]interface{}{"markerId": "yes"}},
					{ID: "no", Type: "test.marker", Config: map[string]interface{}{"markerId": "no"}},
				},
				Edges: []models.Edge{
					{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "cond", TargetPort: "trigger"},
					{ID: "e2", Kind: "control", Source: "cond", SourcePort: "onTrue", Target: "yes", TargetPort: "trigger"},
					{ID: "e3", Kind: "control", Source: "cond", SourcePort: "onFalse", Target: "no", TargetPort: "trigger"},
					{ID: "d1", Kind: "data", Source: "flag", SourcePort: "value", Target: "cond", TargetPort: "left"},
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
