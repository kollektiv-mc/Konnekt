package services

import (
	"log/slog"

	"konnekt/backend/models"
)

// ─── Assigning a server to graphs written before graphs had one (#236) ──────
//
// Graphs used to belong to no server: every run resolved its target from
// active_server.json at fire time, so switching the sidebar re-pointed every
// schedule. models.Graph carries a ServerID now, and the graphs already on disk
// have to be given one exactly once.
//
// The rule is to freeze the behaviour the user already has rather than to guess
// at a better one. Ambient resolution means their schedules are pointed at the
// active server this instant, so the active server is the honest answer. Where
// it cannot be resolved the graph is left unassigned, which keeps running it
// against the active server the way it always has; it is never assigned to a
// server the user does not have, because a graph owned by a server that does not
// exist is a schedule that silently stops running and never says so.

// resolveMigrationServerID picks the server an unassigned graph belongs to, or
// "" when there is no answer worth writing down.
//
// The active id is only trusted once it resolves against a real config.
// active_server.json is a bare string written without a referential check, so it
// can name a server that has since been deleted, and assigning graphs to it
// would hide them behind a server nobody can select.
func resolveMigrationServerID(activeID string, configs []models.ServerConfig) string {
	for _, c := range configs {
		if c.ID == activeID {
			return activeID
		}
	}
	// One configured server is not a guess: it is the only server those graphs
	// can ever have run against, whatever active_server.json says.
	if len(configs) == 1 {
		return configs[0].ID
	}
	return ""
}

// assignMissingServerIDs fills in every empty ServerID and reports whether it
// changed anything, so an already-migrated file is not rewritten on every
// launch. A serverID of "" assigns nothing.
func assignMissingServerIDs(graphs []models.Graph, serverID string) ([]models.Graph, bool) {
	if serverID == "" {
		return graphs, false
	}
	changed := false
	out := make([]models.Graph, len(graphs))
	copy(out, graphs)
	for i := range out {
		if out[i].ServerID == "" {
			out[i].ServerID = serverID
			changed = true
		}
	}
	if !changed {
		return graphs, false
	}
	return out, true
}

// migrateGraphServerIDs assigns a server to the graphs loaded from disk and
// persists the result. Called from SetDataDir, before SetContext starts the
// triggers, so nothing fires against an unmigrated graph.
//
// A failed write is logged and not fatal: the in-memory graphs are correct for
// this session and the migration runs again on the next launch. Returning the
// unmigrated slice instead would leave the session behaving as though the
// change had not shipped.
func (s *SchedulerService) migrateGraphServerIDs(graphs []models.Graph) []models.Graph {
	if s.deps.config == nil {
		return graphs
	}
	configs, err := s.deps.config.GetServerConfigs()
	if err != nil {
		slog.Error("scheduler: reading server configs to assign graph owners", "error", err)
		return graphs
	}
	target := resolveMigrationServerID(s.activeServerID(), configs)
	migrated, changed := assignMissingServerIDs(graphs, target)
	if !changed {
		return graphs
	}
	if err := s.writeGraphs(migrated); err != nil {
		slog.Error("scheduler: persisting assigned graph owners", "error", err)
	}
	return migrated
}

// ─── Folding the command preset into the command field (#161) ───────────────
//
// action.command and action.rcon used to carry a "preset" select beside their
// "command" field, and the executor read the preset first. So on a saved graph
// the preset, where it is set, is the value that has been running: a command
// typed into the field below it never ran, and neither did one arriving over
// the data edge.
//
// The two fields are one field now, which leaves the graphs on disk holding a
// key no block declares any more. Folding is what keeps them running, and the
// rule is the same one the migration above follows: freeze the behaviour the
// user already has rather than guess at a better one. A set preset is therefore
// promoted onto "command", displacing whatever sat there, because promoting the
// displaced text instead would start running a command that never has.
//
// One behaviour does change, unavoidably and by the issue's intent: a node with
// both a preset and a wired command edge used to run the preset, and now runs
// the wired value, because config is what an edge overlays.

// presetBearingBlocks are the block types that ever declared a preset field.
// Scoped by type so a manifest block of a user's own that happens to use the
// key "preset" is left alone.
var presetBearingBlocks = map[string]bool{
	"action.command": true,
	"action.rcon":    true,
}

// foldCommandPresets promotes each node's preset onto its command and drops the
// preset key, reporting whether it changed anything so an already-migrated file
// is not rewritten on every launch.
//
// Dropping the key is what makes this idempotent: once no node carries a
// preset, the function is a no-op forever after.
func foldCommandPresets(graphs []models.Graph) ([]models.Graph, bool) {
	changed := false
	out := make([]models.Graph, len(graphs))
	copy(out, graphs)

	for gi := range out {
		// nil until this graph turns out to need one. Copying the slice and the
		// config map rather than writing through them keeps the caller's graphs
		// untouched, so a migration that cannot persist leaves nothing
		// half-applied in memory: copy() above is shallow and the node array is
		// shared until this replaces it.
		var nodes []models.Node

		for ni := range out[gi].Nodes {
			n := out[gi].Nodes[ni]
			if !presetBearingBlocks[n.Type] || n.Config == nil {
				continue
			}
			raw, ok := n.Config["preset"]
			if !ok {
				continue
			}
			preset, _ := raw.(string)

			cfg := make(map[string]interface{}, len(n.Config))
			for k, v := range n.Config {
				cfg[k] = v
			}
			delete(cfg, "preset")

			if preset != "" {
				if existing, _ := cfg["command"].(string); existing != "" && existing != preset {
					slog.Info("scheduler: folding command preset over a command that was never running",
						"graph", out[gi].ID, "node", n.ID, "preset", preset, "discarded", existing)
				}
				cfg["command"] = preset
			}

			if nodes == nil {
				nodes = make([]models.Node, len(out[gi].Nodes))
				copy(nodes, out[gi].Nodes)
			}
			nodes[ni].Config = cfg
			changed = true
		}

		if nodes != nil {
			out[gi].Nodes = nodes
		}
	}

	if !changed {
		return graphs, false
	}
	return out, true
}

// migrateCommandPresets folds the presets on the graphs loaded from disk and
// persists the result. Called from SetDataDir, before SetContext starts the
// triggers, so nothing fires against an unmigrated graph.
//
// A failed write is logged and not fatal, for the reason migrateGraphServerIDs
// gives: the in-memory graphs are correct for this session and the migration
// runs again on the next launch.
func (s *SchedulerService) migrateCommandPresets(graphs []models.Graph) []models.Graph {
	migrated, changed := foldCommandPresets(graphs)
	if !changed {
		return graphs
	}
	if err := s.writeGraphs(migrated); err != nil {
		slog.Error("scheduler: persisting folded command presets", "error", err)
	}
	return migrated
}
