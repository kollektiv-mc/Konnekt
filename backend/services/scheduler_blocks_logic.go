package services

import (
	"math"
	"strings"

	"konnekt/backend/models"
)

// logicGate is one boolean gate: its block id and label, the sentence the config
// panel shows, how many inputs it reads, and the truth function over them.
// Registering from a table keeps the six blocks from drifting apart, which six
// near-identical literals would.
type logicGate struct {
	id, label, description string
	unary                  bool
	eval                   func(a, b bool) bool
}

var logicGates = []logicGate{
	{"control.and", "AND", "Outputs true when both A and B are true.", false,
		func(a, b bool) bool { return a && b }},
	{"control.or", "OR", "Outputs true when A or B, or both, are true.", false,
		func(a, b bool) bool { return a || b }},
	{"control.xor", "XOR", "Outputs true when exactly one of A and B is true.", false,
		func(a, b bool) bool { return a != b }},
	{"control.not", "NOT", "Outputs the opposite of A.", true,
		func(a, _ bool) bool { return !a }},
	{"control.nand", "NAND", "Outputs false only when both A and B are true.", false,
		func(a, b bool) bool { return !(a && b) }},
	{"control.nor", "NOR", "Outputs true only when neither A nor B is true.", false,
		func(a, b bool) bool { return !(a || b) }},
}

// registerLogicBlocks registers the gate blocks. They live beside
// registerBuiltins rather than in it, which is already the largest function in
// the tree.
//
// A gate has no control ports, so isPureData treats it as a pull-evaluated value
// node: it runs when something downstream reads it, and the data panel's preview
// runs it the same way. The category is "control" so the gates list beside
// Condition, which is where their output is usually wired.
func registerLogicBlocks(r *BlockRegistry) {
	for _, g := range logicGates {
		// Port id == config key (resolveDataInputs), so a wired value outranks
		// the checkbox of the same key, which only supplies an unwired input.
		inputs := []models.DataPort{{ID: "a", Label: "A", Type: "bool"}}
		fields := []models.ConfigField{{Key: "a", Label: "A", Type: "bool", Default: false}}
		if !g.unary {
			inputs = append(inputs, models.DataPort{ID: "b", Label: "B", Type: "bool"})
			fields = append(fields, models.ConfigField{Key: "b", Label: "B", Type: "bool", Default: false})
		}
		must(r.RegisterBlock(models.BlockDef{
			ID: g.id, Category: "control", Label: g.label, Description: g.description,
			DataInputs:   inputs,
			DataOutputs:  []models.DataPort{{ID: "value", Label: "Value", Type: "bool"}},
			ConfigSchema: fields,
			Source:       "native",
		}, execGate(g.eval)))
	}

	// Compare is what turns a number or text comparison into a bool, so a
	// threshold such as TPS below 15 can feed a gate. Its ports and fields are
	// Condition's (port id == config key), and it shares Condition's comparison.
	must(r.RegisterBlock(models.BlockDef{
		ID: "control.compare", Category: "control", Label: "Compare",
		Description: "Outputs true when the comparison of A and B holds; two numbers compare numerically, anything else as text.",
		DataInputs: []models.DataPort{
			{ID: "left", Label: "A", Type: "string"},
			{ID: "right", Label: "B", Type: "string"},
		},
		DataOutputs: []models.DataPort{{ID: "value", Label: "Value", Type: "bool"}},
		ConfigSchema: []models.ConfigField{
			{Key: "left", Label: "Left value", Type: "string", Required: true},
			{Key: "op", Label: "Operator", Type: "select", Default: "eq", Options: comparisonOptions()},
			{Key: "right", Label: "Right value", Type: "string", Required: true},
		},
		Source: "native",
	}, execCompare))
}

// execCompare outputs compareValues as float64 1 or 0, like the gates.
func execCompare(e *ExecContext) ExecResult {
	if compareValues(e, e.GetString("op")) {
		e.SetOutput("value", float64(1))
	} else {
		e.SetOutput("value", float64(0))
	}
	return ExecResult{Port: "onComplete"}
}

// execGate builds the executor for one truth function. The output is float64
// 0/1, the engine's convention for a bool (see execConstant), so it wires into
// Condition, another gate or a Write Attribute without a conversion.
func execGate(eval func(a, b bool) bool) ExecFunc {
	return func(e *ExecContext) ExecResult {
		if eval(truthy(e.Config["a"]), truthy(e.Config["b"])) {
			e.SetOutput("value", float64(1))
		} else {
			e.SetOutput("value", float64(0))
		}
		return ExecResult{Port: "onComplete"}
	}
}

// truthy reads a resolved config or wired value as a boolean. A bool is itself
// and a number is true when it is non-zero, which is how a 0/1 from Read
// Attribute or Constant arrives. Text is read the way Constant's Boolean type
// reads it, "true" and "false", plus any number spelled as a string, since a
// literal typed into a field arrives as text while the same value wired in
// arrives as float64. Anything else, including a missing value, is false: an
// unwired input that was never set must not switch a branch on.
func truthy(v interface{}) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		if s == "true" {
			return true
		}
		if f, err := toFloat(s); err == nil {
			return f != 0 && !math.IsNaN(f)
		}
		return false
	case nil:
		return false
	}
	f, err := toFloat(v)
	return err == nil && f != 0 && !math.IsNaN(f)
}
