package services

import (
	"konnekt/backend/models"
)

// EffectStopsServer is a block's declaration that running it takes the server
// down. It is the only effect value, and is mirrored by NODE_EFFECT_STOPS_SERVER
// in frontend/src/tiles/scheduler/editor/blockMeta.ts.
const EffectStopsServer = "stopsServer"

// The command block and its data port. Port id == config key by convention
// (see resolveDataInputs), so a data edge into the "command" port supplies the
// value the config field would have.
const (
	commandBlockID    = "action.command"
	commandPortID     = "command"
	commandStopOpt    = "__stop__"
	commandRestartOpt = "__restart__"
)

// nodeEffects returns the effects of one node: what its block declares, plus
// what its config adds.
//
// action.command cannot declare stopsServer statically, because only two of its
// options stop anything: the Stop and Restart sentinels. So the effect is read
// from the node's configured command. A command wired in on the data port is
// not known until run time (the wired value outranks the config field, see
// executeNode), so a node with that port connected gets no badge. That is
// inferred rather than guaranteed: the wired value could be a stop sentinel
// from a Constant block, and nothing here evaluates it.
//
// Mirrors nodeEffects in frontend/src/tiles/scheduler/editor/blockMeta.ts, and
// testdata/block_effects_cases.json holds the cases both sides must agree on.
func nodeEffects(def models.BlockDef, node models.Node, edges []models.Edge) []string {
	var out []string
	add := func(effect string) {
		for _, have := range out {
			if have == effect {
				return
			}
		}
		out = append(out, effect)
	}

	for _, effect := range def.Effects {
		add(effect)
	}

	if node.Type == commandBlockID && !commandWired(node.ID, edges) {
		if cmd, _ := node.Config["command"].(string); cmd == commandStopOpt || cmd == commandRestartOpt {
			add(EffectStopsServer)
		}
	}
	return out
}

// commandWired reports whether a data edge feeds the node's command port.
func commandWired(nodeID string, edges []models.Edge) bool {
	for _, e := range edges {
		if e.Kind == "data" && e.Target == nodeID && e.TargetPort == commandPortID {
			return true
		}
	}
	return false
}

func hasEffect(effects []string, want string) bool {
	for _, e := range effects {
		if e == want {
			return true
		}
	}
	return false
}

// graphStopsServer reports whether any node of g stops the server. A node whose
// block is not registered contributes nothing; the engine fails it at run time.
func graphStopsServer(g models.Graph, reg *BlockRegistry) bool {
	return graphStopsServerExcept(g, reg, "")
}

// graphStopsServerExcept is graphStopsServer ignoring nodes of one block type,
// for advice that treats that block's stop separately.
func graphStopsServerExcept(g models.Graph, reg *BlockRegistry, except string) bool {
	for _, n := range g.Nodes {
		entry, ok := reg.Get(n.Type)
		if !ok || (except != "" && n.Type == except) {
			continue
		}
		if hasEffect(nodeEffects(entry.def, n, g.Edges), EffectStopsServer) {
			return true
		}
	}
	return false
}
