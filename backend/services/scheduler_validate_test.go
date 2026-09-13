package services

import (
	"testing"

	"konnekt/backend/models"
)

func testDataTypeRegistry(t *testing.T) *BlockRegistry {
	t.Helper()
	reg := NewBlockRegistry()
	noop := func(e *ExecContext) ExecResult { return ExecResult{} }

	must := func(err error) {
		if err != nil {
			t.Fatalf("register: %v", err)
		}
	}

	must(reg.RegisterBlock(models.BlockDef{
		ID:          "test.stringOut",
		DataOutputs: []models.DataPort{{ID: "value", Type: "string"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:         "test.numberIn",
		DataInputs: []models.DataPort{{ID: "value", Type: "number"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:          "test.boolOut",
		DataOutputs: []models.DataPort{{ID: "value", Type: "bool"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:         "test.stringIn",
		DataInputs: []models.DataPort{{ID: "value", Type: "string"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:          "test.readAttr",
		DataOutputs: []models.DataPort{{ID: "value", Type: "auto"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:          "test.constant",
		DataOutputs: []models.DataPort{{ID: "value", Type: "auto"}},
	}, noop))
	// A bool input is the one target that both string and number are refused
	// on, which makes it the port that tells a resolved type from an
	// unresolved one (unresolved is always allowed).
	must(reg.RegisterBlock(models.BlockDef{
		ID:         "test.boolIn",
		DataInputs: []models.DataPort{{ID: "value", Type: "bool"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:         "test.autoIn",
		DataInputs: []models.DataPort{{ID: "value", Type: "auto"}},
	}, noop))
	must(reg.RegisterBlock(models.BlockDef{
		ID:          "test.numberOut",
		DataOutputs: []models.DataPort{{ID: "value", Type: "number"}},
	}, noop))
	// Two ports, so the search has to pass over the first to find the wired
	// one: a port lookup that stopped at the first mismatch would resolve
	// nothing but a block's first port.
	must(reg.RegisterBlock(models.BlockDef{
		ID: "test.twoOut",
		DataOutputs: []models.DataPort{
			{ID: "first", Type: "string"},
			{ID: "value", Type: "number"},
		},
	}, noop))

	return reg
}

func dataEdgeGraph(srcType, tgtType string, srcConfig, tgtConfig map[string]interface{}) models.Graph {
	return models.Graph{
		Nodes: []models.Node{
			{ID: "src", Type: srcType, Config: srcConfig},
			{ID: "tgt", Type: tgtType, Config: tgtConfig},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "data", Source: "src", SourcePort: "value", Target: "tgt", TargetPort: "value"},
		},
	}
}

func TestValidateGraphDataTypes(t *testing.T) {
	reg := testDataTypeRegistry(t)

	tests := []struct {
		name      string
		g         models.Graph
		wantIssue bool
	}{
		{"string->string ok", dataEdgeGraph("test.stringOut", "test.stringIn", nil, nil), false},
		{"string->number blocked", dataEdgeGraph("test.stringOut", "test.numberIn", nil, nil), true},
		{"bool->number ok (0/1)", dataEdgeGraph("test.boolOut", "test.numberIn", nil, nil), false},
		{"bool->string ok", dataEdgeGraph("test.boolOut", "test.stringIn", nil, nil), false},
		{
			"auto(number)->number ok",
			dataEdgeGraph("test.readAttr", "test.numberIn", map[string]interface{}{"type": "number"}, nil),
			false,
		},
		{
			"auto(string)->number blocked",
			dataEdgeGraph("test.readAttr", "test.numberIn", map[string]interface{}{"type": "string"}, nil),
			true,
		},
		{
			"auto unresolved (config missing type)->number allowed",
			dataEdgeGraph("test.readAttr", "test.numberIn", nil, nil),
			false,
		},
		{
			"constant(Integer)->number ok",
			dataEdgeGraph("test.constant", "test.numberIn", map[string]interface{}{"type": "Integer"}, nil),
			false,
		},
		{
			"constant(String)->number blocked",
			dataEdgeGraph("test.constant", "test.numberIn", map[string]interface{}{"type": "String"}, nil),
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := validateGraphDataTypes(tt.g, reg)
			if tt.wantIssue && len(issues) == 0 {
				t.Errorf("expected a validation issue, got none")
			}
			if !tt.wantIssue && len(issues) != 0 {
				t.Errorf("expected no validation issue, got %v", issues)
			}
		})
	}
}

func TestValidateGraphDataTypesIgnoresControlEdges(t *testing.T) {
	reg := testDataTypeRegistry(t)
	// The ports carry the data ports' names on purpose: a control edge is
	// skipped for being a control edge, not for naming ports that do not
	// resolve, and this wiring would be refused if it were type-checked.
	g := models.Graph{
		Nodes: []models.Node{
			{ID: "src", Type: "test.stringOut"},
			{ID: "tgt", Type: "test.numberIn"},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "src", SourcePort: "value", Target: "tgt", TargetPort: "value"},
		},
	}
	if issues := validateGraphDataTypes(g, reg); len(issues) != 0 {
		t.Errorf("control edges must not be type-checked, got %v", issues)
	}
}

// Every alias in dataTypeAliases, each in a wiring that is only refused when
// the alias resolves. A mutation run found the Float, Integer, bool and
// Boolean entries could be deleted with no test noticing (#312): the cases
// above that use them all pass on "unresolved" too.
func TestValidateGraphDataTypesAliases(t *testing.T) {
	reg := testDataTypeRegistry(t)
	cfg := func(typ string) map[string]interface{} { return map[string]interface{}{"type": typ} }

	tests := []struct {
		name      string
		g         models.Graph
		wantIssue bool
	}{
		{"Float resolves to number: refused into bool", dataEdgeGraph("test.constant", "test.boolIn", cfg("Float"), nil), true},
		{"Integer resolves to number: refused into bool", dataEdgeGraph("test.constant", "test.boolIn", cfg("Integer"), nil), true},
		{"number resolves: refused into bool", dataEdgeGraph("test.readAttr", "test.boolIn", cfg("number"), nil), true},
		{"String resolves to string: refused into bool", dataEdgeGraph("test.constant", "test.boolIn", cfg("String"), nil), true},
		{"string resolves: refused into bool", dataEdgeGraph("test.readAttr", "test.boolIn", cfg("string"), nil), true},
		{"bool resolves on the input side: string refused into it", dataEdgeGraph("test.stringOut", "test.boolIn", nil, nil), true},
		{"Boolean resolves on the input side: string refused into it", dataEdgeGraph("test.stringOut", "test.autoIn", nil, cfg("Boolean")), true},
		{"bool resolves on the input side: number refused into it", dataEdgeGraph("test.numberOut", "test.autoIn", nil, cfg("bool")), true},
		{"bool source is accepted everywhere", dataEdgeGraph("test.readAttr", "test.boolIn", cfg("Boolean"), nil), false},
		{"an unknown alias is unresolved and allowed", dataEdgeGraph("test.constant", "test.boolIn", cfg("Decimal"), nil), false},
		{"the second of two ports resolves: refused into bool", dataEdgeGraph("test.twoOut", "test.boolIn", nil, nil), true},
		{"a port the block does not declare is unresolved", models.Graph{
			Nodes: []models.Node{{ID: "src", Type: "test.stringOut"}, {ID: "tgt", Type: "test.boolIn"}},
			Edges: []models.Edge{{ID: "e1", Kind: "data", Source: "src", SourcePort: "nope", Target: "tgt", TargetPort: "value"}},
		}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := validateGraphDataTypes(tt.g, reg)
			if tt.wantIssue && len(issues) == 0 {
				t.Errorf("expected a validation issue, got none")
			}
			if !tt.wantIssue && len(issues) != 0 {
				t.Errorf("expected no validation issue, got %v", issues)
			}
		})
	}
}

func TestDataTypesCompatible(t *testing.T) {
	cases := []struct {
		src, tgt resolvedDataType
		want     bool
	}{
		{dataTypeUnresolved, dataTypeBool, true},
		{dataTypeString, dataTypeUnresolved, true},
		{dataTypeString, dataTypeString, true},
		{dataTypeNumber, dataTypeNumber, true},
		{dataTypeBool, dataTypeBool, true},
		{dataTypeNumber, dataTypeString, true},
		{dataTypeBool, dataTypeString, true},
		{dataTypeBool, dataTypeNumber, true},
		{dataTypeString, dataTypeNumber, false},
		{dataTypeString, dataTypeBool, false},
		{dataTypeNumber, dataTypeBool, false},
	}
	for _, c := range cases {
		if got := dataTypesCompatible(c.src, c.tgt); got != c.want {
			t.Errorf("dataTypesCompatible(%s, %s) = %v, want %v", c.src, c.tgt, got, c.want)
		}
	}
}

// The walk skips what it cannot resolve rather than stopping: an edge to a
// node or block the graph does not have is not an issue, and one bad edge
// does not hide the next. Six loop mutants survived without these (#312).
func TestValidateGraphDataTypesWalksEveryEdge(t *testing.T) {
	reg := testDataTypeRegistry(t)
	g := models.Graph{
		Nodes: []models.Node{
			{ID: "s", Type: "test.stringOut"},
			{ID: "n", Type: "test.numberIn"},
			{ID: "b", Type: "test.boolIn"},
			{ID: "x", Type: "test.unregistered"},
		},
		Edges: []models.Edge{
			// A control edge first: skipping it must not end the walk.
			{ID: "control", Kind: "control", Source: "s", SourcePort: "onComplete", Target: "n", TargetPort: "trigger"},
			{ID: "missing-src", Kind: "data", Source: "ghost", SourcePort: "value", Target: "n", TargetPort: "value"},
			{ID: "missing-tgt", Kind: "data", Source: "s", SourcePort: "value", Target: "ghost", TargetPort: "value"},
			{ID: "unregistered-src", Kind: "data", Source: "x", SourcePort: "value", Target: "n", TargetPort: "value"},
			{ID: "unregistered-tgt", Kind: "data", Source: "s", SourcePort: "value", Target: "x", TargetPort: "value"},
			{ID: "bad-1", Kind: "data", Source: "s", SourcePort: "value", Target: "n", TargetPort: "value"},
			{ID: "bad-2", Kind: "data", Source: "s", SourcePort: "value", Target: "b", TargetPort: "value"},
		},
	}
	issues := validateGraphDataTypes(g, reg)
	if len(issues) != 2 {
		t.Fatalf("got %d issue(s), want 2: %v", len(issues), issues)
	}
	for i, want := range []string{"data edge bad-1: string output -> number input (node s.value -> n.value)", "data edge bad-2: string output -> bool input (node s.value -> b.value)"} {
		if issues[i] != want {
			t.Errorf("issue %d = %q, want %q", i, issues[i], want)
		}
	}
	if got := validateGraphDataTypes(models.Graph{}, reg); got != nil {
		t.Errorf("empty graph = %v, want nil", got)
	}
}
