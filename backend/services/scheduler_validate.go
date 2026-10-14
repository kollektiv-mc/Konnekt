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

// rconUnconfirmedWarning is the one warning graphWarnings produces. Worded as
// "not confirmed" because ServerService.RconConfig reports ok only once the
// server has started with RCON enabled, so a server that has never been started
// reads the same as one with RCON off.
const rconUnconfirmedWarning = "Stops the server with no warning to players: RCON is not confirmed. " +
	"It is confirmed once the server has started with enable-rcon on."

// dhSnapshotConsoleWarning is the other half of that advice. The snapshot block
// stops the server too, but it warns the players first, so for it "cannot warn"
// would be untrue: without RCON the warning goes through the server's console.
const dhSnapshotConsoleWarning = "DH Snapshot warns players through the console, as RCON is not confirmed. " +
	"It is confirmed once the server has started with enable-rcon on."

// graphWarnings returns advice about g that is not an error: a graph that
// stops the server while RCON is not confirmed cannot warn players before it
// does, except through the console for the snapshot block, which says so in a
// line of its own. Pure and side-effect free. Unlike validateGraphDataTypes it
// never refuses anything: SaveGraph stays permissive and the editor only shows
// the text beside Save, so a save or a run is never blocked by it.
func graphWarnings(g models.Graph, reg *BlockRegistry, rconAvailable bool) []string {
	if rconAvailable {
		return nil
	}
	var warnings []string
	if graphStopsServerExcept(g, reg, dhSnapshotBlockID) {
		warnings = append(warnings, rconUnconfirmedWarning)
	}
	for _, n := range g.Nodes {
		if n.Type == dhSnapshotBlockID {
			warnings = append(warnings, dhSnapshotConsoleWarning)
			break
		}
	}
	return warnings
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
// uploads gets the same check. Returns one sentence per bad node; nil means the
// graph is clean. Pure apart from reading the destination list.
func validateGraphDestinations(g models.Graph, reg *BlockRegistry, dests *DestinationService) []string {
	var issues []string
	for _, n := range g.Nodes {
		entry, ok := reg.Get(n.Type)
		if !ok {
			continue
		}
		for _, f := range entry.def.ConfigSchema {
			if f.Type != destinationFieldType {
				continue
			}
			who := fmt.Sprintf("%s (%s)", entry.def.Label, n.ID)
			name := ""
			if v, ok := n.Config[f.Key].(string); ok {
				name = strings.TrimSpace(v)
			}
			if name == "" {
				// An optional destination (the snapshot block's, where none means
				// the staging folder's own index) may be left empty.
				if f.Required {
					issues = append(issues, who+": no destination chosen.")
				}
				continue
			}
			if dests == nil {
				issues = append(issues, who+": destinations are not available.")
				continue
			}
			_, found, err := dests.Lookup(name)
			switch {
			case err != nil:
				issues = append(issues, fmt.Sprintf("%s: the saved destinations could not be read.", who))
			case !found:
				issues = append(issues, fmt.Sprintf("%s: the destination %q does not exist. It was deleted or renamed in Settings, or this graph came from another install.", who, name))
			}
		}
	}
	return issues
}

// validateGraphRetention checks the keep value of every Publish DH Snapshot node:
// empty or absent is the default, anything else must be a whole number of at
// least 1. A value that is not a number yet (a {{wire}} or an @attribute) cannot
// be judged before the run resolves it, and the block checks it again then.
// Returns one sentence per bad node; nil means the graph is clean.
func validateGraphRetention(g models.Graph) []string {
	var issues []string
	for _, n := range g.Nodes {
		if n.Type != dhPublishBlockID {
			continue
		}
		if s, ok := n.Config["keep"].(string); ok && (strings.Contains(s, "{{") || strings.Contains(s, "@")) {
			continue
		}
		if _, err := parseDHKeep(n.Config["keep"]); err != nil {
			issues = append(issues, fmt.Sprintf("Publish DH Snapshot (%s): %s.", n.ID, err))
		}
	}
	return issues
}
