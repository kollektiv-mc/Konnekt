package services

import (
	"fmt"
	"strings"

	"konnekt/backend/models"
)

type resolvedDataType string

const (
	dataTypeString     resolvedDataType = "string"
	dataTypeNumber     resolvedDataType = "number"
	dataTypeBool       resolvedDataType = "bool"
	dataTypeUnresolved resolvedDataType = "unresolved"
)

// Two config.type vocabularies exist across blocks (Read-Attribute uses
// lowercase data-port names, Constant uses capitalized display names) — both
// normalize here. Mirrors frontend/src/tiles/scheduler/editor/portTypes.ts.
var dataTypeAliases = map[string]resolvedDataType{
	"string":  dataTypeString,
	"String":  dataTypeString,
	"number":  dataTypeNumber,
	"Float":   dataTypeNumber,
	"Integer": dataTypeNumber,
	"bool":    dataTypeBool,
	"Boolean": dataTypeBool,
}

func normalizeDataType(raw string) resolvedDataType {
	if t, ok := dataTypeAliases[raw]; ok {
		return t
	}
	return dataTypeUnresolved
}

// resolveDataPortType resolves a block's declared data-port type to a
// concrete type, following the port's "auto" indirection (Read-Attribute,
// Constant) through the node's own config["type"] field.
func resolveDataPortType(def models.BlockDef, portID string, isOutput bool, config map[string]interface{}) resolvedDataType {
	ports := def.DataInputs
	if isOutput {
		ports = def.DataOutputs
	}
	for _, p := range ports {
		if p.ID != portID {
			continue
		}
		if p.Type == "auto" {
			cfgType, _ := config["type"].(string)
			return normalizeDataType(cfgType)
		}
		return normalizeDataType(p.Type)
	}
	return dataTypeUnresolved
}

// dataTypesCompatible mirrors portTypesCompatible on the frontend. Unresolved
// on either side can't be proven incompatible, so it's allowed — this only
// blocks connections positively known to coerce/fail at run time.
func dataTypesCompatible(src, tgt resolvedDataType) bool {
	if src == dataTypeUnresolved || tgt == dataTypeUnresolved {
		return true
	}
	if src == tgt {
		return true
	}
	if tgt == dataTypeString {
		return true
	}
	if src == dataTypeBool && tgt == dataTypeNumber {
		return true
	}
	return false
}

// validateGraphDataTypes checks every data edge in g for a type-incompatible
// wiring (e.g. a "string" output feeding a "number" input), which would
// otherwise silently coerce to the input's zero value at run time
// (ExecContext.GetFloat and friends). Returns one descriptive issue per bad
// edge; nil means the graph is clean. Pure and side-effect free — the
// frontend's isValidConnection already prevents authoring these, but this is
// the authoritative check for hand-edited or imported graphs
// (ImportScheduleGraphJSON).
func validateGraphDataTypes(g models.Graph, reg *BlockRegistry) []string {
	nodeByID := make(map[string]models.Node, len(g.Nodes))
	for _, n := range g.Nodes {
		nodeByID[n.ID] = n
	}

	var issues []string
	for _, e := range g.Edges {
		if e.Kind != "data" {
			continue
		}
		srcNode, ok := nodeByID[e.Source]
		if !ok {
			continue
		}
		tgtNode, ok := nodeByID[e.Target]
		if !ok {
			continue
		}
		srcEntry, ok := reg.Get(srcNode.Type)
		if !ok {
			continue
		}
		tgtEntry, ok := reg.Get(tgtNode.Type)
		if !ok {
			continue
		}

		srcType := resolveDataPortType(srcEntry.def, e.SourcePort, true, srcNode.Config)
		tgtType := resolveDataPortType(tgtEntry.def, e.TargetPort, false, tgtNode.Config)
		if !dataTypesCompatible(srcType, tgtType) {
			issues = append(issues, fmt.Sprintf(
				"data edge %s: %s output -> %s input (node %s.%s -> %s.%s)",
				e.ID, srcType, tgtType, srcNode.ID, e.SourcePort, tgtNode.ID, e.TargetPort,
			))
		}
	}
	return issues
}

// rconUnconfirmedWarning is the advice for a node that stops the server. Worded
// as "not confirmed" because ServerService.RconConfig reports ok only once the
// server has started with RCON enabled, so a server that has never been started
// reads the same as one with RCON off.
const rconUnconfirmedWarning = "Stops the server with no warning to players: RCON is not confirmed. " +
	"It is confirmed once the server has started with enable-rcon on."

// dhSnapshotConsoleWarning is the other half of that advice. The snapshot block
// stops the server too, but it warns the players first, so for it "cannot warn"
// would be untrue: without RCON the warning goes through the server's console.
const dhSnapshotConsoleWarning = "DH Snapshot warns players through the console, as RCON is not confirmed. " +
	"It is confirmed once the server has started with enable-rcon on."

// graphWarnings returns advice about g that is not an error: every node that
// stops the server while RCON is not confirmed cannot warn players before it
// does, except through the console for the snapshot block, which says so in a
// line of its own. Each piece of advice names the node it is about. Pure and
// side-effect free. Unlike validateGraphDataTypes it never refuses anything:
// SaveGraph stays permissive and the editor only shows the text beside Save, so
// a save or a run is never blocked by it.
func graphWarnings(g models.Graph, reg *BlockRegistry, rconAvailable bool) []models.GraphWarning {
	if rconAvailable {
		return nil
	}
	stoppers := make(map[string]bool)
	for _, n := range nodesThatStopServer(g, reg, dhSnapshotBlockID) {
		stoppers[n.ID] = true
	}
	var warnings []models.GraphWarning
	for _, n := range g.Nodes {
		switch {
		case n.Type == dhSnapshotBlockID:
			warnings = append(warnings, models.GraphWarning{NodeID: n.ID, Text: dhSnapshotConsoleWarning})
		case stoppers[n.ID]:
			warnings = append(warnings, models.GraphWarning{NodeID: n.ID, Text: rconUnconfirmedWarning})
		}
	}
	return warnings
}

// issueSentences renders warnings the way a run's error text carries them: one
// sentence each, led by the block's label and the node's id so a reader of the
// history, who has no editor beside them, can tell which node is meant.
func issueSentences(g models.Graph, reg *BlockRegistry, issues []models.GraphWarning) []string {
	typeOf := make(map[string]string, len(g.Nodes))
	for _, n := range g.Nodes {
		typeOf[n.ID] = n.Type
	}
	out := make([]string, 0, len(issues))
	for _, w := range issues {
		if w.NodeID == "" {
			out = append(out, w.Text)
			continue
		}
		if entry, ok := reg.Get(typeOf[w.NodeID]); ok {
			out = append(out, fmt.Sprintf("%s (%s): %s", entry.def.Label, w.NodeID, w.Text))
			continue
		}
		out = append(out, fmt.Sprintf("Node %s: %s", w.NodeID, w.Text))
	}
	return out
}

// validateGraphDestinations checks every node whose block has a destination
// field: a required one must name a saved destination that still exists, and an
// optional one (the snapshot block's) may be empty but may not name a missing
// one. A graph names its bucket and nothing more (the credential stays in
// Settings), so a destination deleted or renamed afterwards leaves the node
// pointing at nothing, and a graph imported from another install may name one
// this install never had.
//
// It reads the field by its type rather than by block id, so the next block that
// uploads gets the same check. Returns one issue per bad node, naming it; nil
// means the graph is clean. Pure apart from reading the destination list.
func validateGraphDestinations(g models.Graph, reg *BlockRegistry, dests *DestinationService) []models.GraphWarning {
	var issues []models.GraphWarning
	for _, n := range g.Nodes {
		entry, ok := reg.Get(n.Type)
		if !ok {
			continue
		}
		for _, f := range entry.def.ConfigSchema {
			if f.Type != destinationFieldType {
				continue
			}
			bad := func(text string) {
				issues = append(issues, models.GraphWarning{NodeID: n.ID, Text: text})
			}
			name := ""
			if v, ok := n.Config[f.Key].(string); ok {
				name = strings.TrimSpace(v)
			}
			if name == "" {
				// An optional destination (the snapshot block's, where none means
				// the staging folder's own index) may be left empty.
				if f.Required {
					bad("no destination chosen.")
				}
				continue
			}
			if dests == nil {
				bad("destinations are not available.")
				continue
			}
			_, found, err := dests.Lookup(name)
			switch {
			case err != nil:
				bad("the saved destinations could not be read.")
			case !found:
				bad(fmt.Sprintf("the destination %q does not exist. It was deleted or renamed in Settings, or this graph came from another install.", name))
			}
		}
	}
	return issues
}

// validateGraphRetention checks the keep value of every Publish DH Snapshot node:
// empty or absent is the default, anything else must be a whole number of at
// least 1. A value that is not a number yet (a {{wire}} or an @attribute) cannot
// be judged before the run resolves it, and the block checks it again then.
// Returns one issue per bad node, naming it; nil means the graph is clean.
func validateGraphRetention(g models.Graph) []models.GraphWarning {
	var issues []models.GraphWarning
	for _, n := range g.Nodes {
		if n.Type != dhPublishBlockID {
			continue
		}
		if s, ok := n.Config["keep"].(string); ok && (strings.Contains(s, "{{") || strings.Contains(s, "@")) {
			continue
		}
		if _, err := parseDHKeep(n.Config["keep"]); err != nil {
			issues = append(issues, models.GraphWarning{NodeID: n.ID, Text: err.Error() + "."})
		}
	}
	return issues
}
