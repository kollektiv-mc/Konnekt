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
