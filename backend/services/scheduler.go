package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"time"

	"konnekt/backend/models"
)

const historyCapacity = 200

type SchedulerService struct {
	mu       sync.RWMutex
	ctx      context.Context
	dataDir  string
	deps     serviceDeps
	bus      *EventBus
	registry *BlockRegistry

	graphs  []models.Graph
	history []models.RunRecord

	// runningMu guards the running map (one concurrent run per graph).
	runningMu sync.Mutex
	running   map[string]bool

	// cooldownMu guards lastFired (shared with trigger subsystem).
	cooldownMu sync.Mutex
	lastFired  map[string]time.Time

	// stopTime signals the time-trigger ticker to shut down.
	stopTime chan struct{}
}

func NewSchedulerService(server *ServerService, backup *BackupService, rcon *RconService, config *ConfigService) *SchedulerService {
	s := &SchedulerService{
		running:   make(map[string]bool),
		lastFired: make(map[string]time.Time),
		stopTime:  make(chan struct{}),
	}
	s.deps = serviceDeps{
		server: server, backup: backup, rcon: rcon, config: config,
	}
	s.registry = NewBlockRegistry()
	registerBuiltins(s.registry)
	registerDataBuiltins(s.registry)
	return s
}

func (s *SchedulerService) SetBus(b *EventBus) {
	s.bus = b
	s.deps.bus = b
}

// SetDataDir loads graphs from disk and manifest blocks from the blocks/ subfolder.
// Must be called before SetContext so triggers see graphs on first evaluation.
func (s *SchedulerService) SetDataDir(dir string) {
	s.dataDir = dir
	if graphs, err := s.loadGraphs(); err == nil {
		s.mu.Lock()
		s.graphs = graphs
		s.mu.Unlock()
	}
	if history, err := s.loadHistory(); err == nil {
		s.mu.Lock()
		s.history = history
		s.mu.Unlock()
	}
	primitives := s.primitiveMap()
	s.registry.LoadManifests(filepath.Join(dir, "blocks"), primitives)
}

// SetContext starts the time-trigger ticker and event-bus subscriptions.
// Must be called after SetDataDir.
func (s *SchedulerService) SetContext(ctx context.Context) {
	s.ctx = ctx
	s.startTriggers()
}

// StopScheduler signals the time ticker to shut down (called on app close).
func (s *SchedulerService) StopScheduler() {
	select {
	case <-s.stopTime:
	default:
		close(s.stopTime)
	}
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

func (s *SchedulerService) GetGraphs() ([]models.Graph, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]models.Graph, len(s.graphs))
	copy(out, s.graphs)
	return out, nil
}

// SaveGraph upserts a graph by ID (inserts when ID is empty or not found).
func (s *SchedulerService) SaveGraph(g models.Graph) (models.Graph, error) {
	now := time.Now().UnixMilli()
	if g.ID == "" {
		g.ID = newID()
		g.CreatedAt = now
	}
	g.UpdatedAt = now

	s.mu.Lock()
	found := false
	for i, existing := range s.graphs {
		if existing.ID == g.ID {
			s.graphs[i] = g
			found = true
			break
		}
	}
	if !found {
		if g.CreatedAt == 0 {
			g.CreatedAt = now
		}
		s.graphs = append(s.graphs, g)
	}
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.Unlock()

	err := s.writeGraphs(graphs)
	// Emit regardless of the write result: in-memory state already changed, so
	// the new map is what the UI should show. Must run outside s.mu — see
	// emitNextRuns.
	s.emitNextRuns()
	return g, err
}

func (s *SchedulerService) DeleteGraph(id string) error {
	s.mu.Lock()
	filtered := make([]models.Graph, 0, len(s.graphs))
	for _, g := range s.graphs {
		if g.ID != id {
			filtered = append(filtered, g)
		}
	}
	s.graphs = filtered
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.Unlock()

	err := s.writeGraphs(graphs)
	s.emitNextRuns()
	return err
}

func (s *SchedulerService) SetGraphEnabled(id string, enabled bool) error {
	s.mu.Lock()
	for i, g := range s.graphs {
		if g.ID == id {
			s.graphs[i].Enabled = enabled
			s.graphs[i].UpdatedAt = time.Now().UnixMilli()
			break
		}
	}
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.Unlock()

	err := s.writeGraphs(graphs)
	s.emitNextRuns()
	return err
}

// ─── Block registry ───────────────────────────────────────────────────────────

func (s *SchedulerService) GetBlockDefs() ([]models.BlockDef, error) {
	return s.registry.Defs(), nil
}

// ─── Execution ────────────────────────────────────────────────────────────────

// RunGraphNow manually triggers a graph by ID, blocks until the run completes,
// and returns the final RunRecord. Useful for testing without live triggers.
func (s *SchedulerService) RunGraphNow(id string) (models.RunRecord, error) {
	s.mu.RLock()
	var target *models.Graph
	for i := range s.graphs {
		if s.graphs[i].ID == id {
			g := s.graphs[i]
			target = &g
			break
		}
	}
	s.mu.RUnlock()

	if target == nil {
		return models.RunRecord{}, fmt.Errorf("graph %q not found", id)
	}

	entryNodeID, err := findTriggerNode(*target)
	if err != nil {
		return models.RunRecord{}, err
	}

	return s.runGraph(*target, entryNodeID, "manual", map[string]map[string]interface{}{
		entryNodeID: {}, "trigger": {},
	}), nil
}

// GetRunHistory returns in-memory run history in reverse-chronological order.
func (s *SchedulerService) GetRunHistory() ([]models.RunRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]models.RunRecord, len(s.history))
	for i, r := range s.history {
		out[len(s.history)-1-i] = r
	}
	return out, nil
}

// ImportGraphJSON parses a graph from raw JSON and saves it.
func (s *SchedulerService) ImportGraphJSON(raw string) (models.Graph, error) {
	var g models.Graph
	if err := json.Unmarshal([]byte(raw), &g); err != nil {
		return models.Graph{}, fmt.Errorf("parse graph JSON: %w", err)
	}
	return s.SaveGraph(g)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

func (s *SchedulerService) addHistory(rec models.RunRecord) {
	s.mu.Lock()
	s.history = append(s.history, rec)
	if len(s.history) > historyCapacity {
		s.history = s.history[len(s.history)-historyCapacity:]
	}
	snapshot := make([]models.RunRecord, len(s.history))
	copy(snapshot, s.history)
	s.mu.Unlock()

	// Persist outside the lock; history is small and writes are infrequent.
	if err := s.writeHistory(snapshot); err != nil {
		slog.Error("scheduler: write history", "error", err)
	}
}

func (s *SchedulerService) loadHistory() ([]models.RunRecord, error) {
	data, err := os.ReadFile(filepath.Join(s.dataDir, "scheduler-history.json"))
	if os.IsNotExist(err) {
		return []models.RunRecord{}, nil
	}
	if err != nil {
		return nil, err
	}
	var history []models.RunRecord
	if err := json.Unmarshal(data, &history); err != nil {
		return nil, err
	}
	if len(history) > historyCapacity {
		history = history[len(history)-historyCapacity:]
	}
	return history, nil
}

func (s *SchedulerService) writeHistory(history []models.RunRecord) error {
	if s.dataDir == "" {
		return nil
	}
	data, err := json.Marshal(history)
	if err != nil {
		return err
	}
	return WriteDataFile(s.dataDir, "scheduler-history.json", data)
}

func (s *SchedulerService) activeServerID() string {
	if s.deps.config == nil {
		return ""
	}
	if id, err := s.deps.config.GetActiveServerID(); err == nil {
		return id
	}
	return ""
}

func (s *SchedulerService) loadGraphs() ([]models.Graph, error) {
	data, err := os.ReadFile(filepath.Join(s.dataDir, "scheduler.json"))
	if os.IsNotExist(err) {
		return []models.Graph{}, nil
	}
	if err != nil {
		return nil, err
	}
	var graphs []models.Graph
	if err := json.Unmarshal(data, &graphs); err != nil {
		return nil, err
	}
	return graphs, nil
}

func (s *SchedulerService) writeGraphs(graphs []models.Graph) error {
	data, err := json.Marshal(graphs)
	if err != nil {
		return err
	}
	return WriteDataFile(s.dataDir, "scheduler.json", data)
}

// primitiveMap returns the fixed set of safe primitive executors available to
// declarative manifest blocks. New primitives require a native code change.
func (s *SchedulerService) primitiveMap() map[string]ExecFunc {
	return map[string]ExecFunc{
		"rcon":       execRcon,
		"command":    execCommand,
		"http":       execHTTP,
		"backup":     execBackup,
		"write-attr": execWriteAttribute,
		"delay":      execDelay,
		"condition":  execCondition,
		"notify":     execNotify,
	}
}

// findTriggerNode returns the ID of the single trigger node in a graph.
func findTriggerNode(g models.Graph) (string, error) {
	var triggers []string
	for _, n := range g.Nodes {
		if len(n.Type) >= 8 && n.Type[:8] == "trigger." {
			triggers = append(triggers, n.ID)
		}
	}
	switch len(triggers) {
	case 0:
		return "", fmt.Errorf("graph %q has no trigger node", g.ID)
	case 1:
		return triggers[0], nil
	default:
		return "", fmt.Errorf("graph %q has multiple trigger nodes; add a single trigger only", g.ID)
	}
}

func newID() string {
	return fmt.Sprintf("%x", rand.Int63())
}

// listJSONFiles returns paths of *.json files in dir. Missing dir → nil, nil.
func listJSONFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var paths []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			paths = append(paths, filepath.Join(dir, e.Name()))
		}
	}
	return paths, nil
}

// readManifestFile reads a manifest that may be a single BlockDef or []BlockDef.
func readManifestFile(path string) ([]models.BlockDef, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var defs []models.BlockDef
	if err := json.Unmarshal(data, &defs); err == nil {
		return defs, nil
	}
	var def models.BlockDef
	if err := json.Unmarshal(data, &def); err != nil {
		return nil, fmt.Errorf("not a BlockDef or []BlockDef: %w", err)
	}
	return []models.BlockDef{def}, nil
}
