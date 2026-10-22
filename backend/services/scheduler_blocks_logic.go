package services

import (
	"math"
	"strings"

	"konnekt/backend/models"
)

// gateOps are Condition's logic operators: the option value, its label and the
// truth function over the two operands. One table feeds the operator list, the
// "is true" fields' visibility and the executor, so the three cannot drift.
var gateOps = []struct {
	value, label string
	eval         func(a, b bool) bool
}{
	{"and", "AND", func(a, b bool) bool { return a && b }},
	{"or", "OR", func(a, b bool) bool { return a || b }},
	{"xor", "XOR", func(a, b bool) bool { return a != b }},
	{"nand", "NAND", func(a, b bool) bool { return !(a && b) }},
	{"nor", "NOR", func(a, b bool) bool { return !(a || b) }},
}

// conditionOptions is Condition's operator list: the comparisons, then the gates.
func conditionOptions() []models.FieldOption {
	opts := []models.FieldOption{
		{Label: "==", Value: "eq"}, {Label: "!=", Value: "ne"},
		{Label: ">", Value: "gt"}, {Label: "<", Value: "lt"},
		{Label: "contains", Value: "contains"},
	}
	for _, g := range gateOps {
		opts = append(opts, models.FieldOption{Label: g.label, Value: g.value})
	}
	return opts
}

// gateOpValues lists the gate operators' option values, for the "is true"
// fields' ShowWhen.
func gateOpValues() []string {
	vals := make([]string, 0, len(gateOps))
	for _, g := range gateOps {
		vals = append(vals, g.value)
	}
	return vals
}

// conditionConfigSchema is Condition's config. The two operands sit side by side
// (Row "values") with the "is true" checkboxes under them (Row "truth"), shown
// only for a gate operator. Port id == config key (resolveDataInputs), so a wired
// value outranks the field of the same key; the checkboxes have no port.
func conditionConfigSchema() []models.ConfigField {
	gate := &models.FieldWhen{Key: "op", Values: gateOpValues()}
	return []models.ConfigField{
		{Key: "op", Label: "Operator", Type: "select", Default: "eq", Options: conditionOptions()},
		{Key: "left", Label: "A", Type: "string", Required: true, Row: "values"},
		{Key: "right", Label: "B", Type: "string", Required: true, Row: "values"},
		{Key: "leftTrue", Label: "is true", Type: "bool", Default: true, ShowWhen: gate, Row: "truth"},
		{Key: "rightTrue", Label: "is true", Type: "bool", Default: true, ShowWhen: gate, Row: "truth"},
	}
}

// gateEval returns the truth function for op, or nil when op is not a gate.
func gateEval(op string) func(a, b bool) bool {
	for _, g := range gateOps {
		if g.value == op {
			return g.eval
		}
	}
	return nil
}

// operandIsTrue reads one gate operand. A checked "is true" box (the default,
// so a missing value counts as checked) takes the operand as it is and an
// unchecked one flips it, which is what NOT was.
func operandIsTrue(e *ExecContext, valueKey, flagKey string) bool {
	want := true
	if v, ok := e.Config[flagKey]; ok && v != nil {
		want = truthy(v)
	}
	return truthy(e.Config[valueKey]) == want
}

// boolOperand reads a value as a boolean when it plausibly is one: a bool, a
// number or the text "true" or "false". Anything else (names, MOTDs) is not.
func boolOperand(v interface{}) (value, ok bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "true":
			return true, true
		case "false":
			return false, true
		}
	case nil:
		return false, false
	}
	f, err := toFloat(v)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return false, false
	}
	return f != 0, true
}

// isBoolText reports whether v is the text "true" or "false".
func isBoolText(v interface{}) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	t := strings.ToLower(strings.TrimSpace(s))
	return t == "true" || t == "false"
}

// boolEquality answers eq and ne by truthiness when one operand is the text
// "true" or "false" and the other can be read as a boolean, so a wired true
// (float64 1) equals a literal "true". decided is false when the rule does not
// apply and the comparison stays numeric or textual.
func boolEquality(e *ExecContext) (equal, decided bool) {
	l, r := e.Config["left"], e.Config["right"]
	if !isBoolText(l) && !isBoolText(r) {
		return false, false
	}
	lb, lok := boolOperand(l)
	rb, rok := boolOperand(r)
	if !lok || !rok {
		return false, false
	}
	return lb == rb, true
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
