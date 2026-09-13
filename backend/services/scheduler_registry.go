package services

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"konnekt/backend/models"
)

// ─── Execution surface ────────────────────────────────────────────────────────

// ExecResult is returned by every block executor: which control output to
// follow and an optional error (non-nil forces onFailed if Port is empty).
type ExecResult struct {
	Port string // e.g. "onComplete", "onFailed", "onTrue", "onFalse"
	Err  error
}

// serviceDeps bundles service references injected into every ExecContext.
type serviceDeps struct {
	server *ServerService
	backup *BackupService
	rcon   *RconService
	config *ConfigService
	bus    *EventBus
}

// ExecContext is the per-node execution surface handed to a block executor.
type ExecContext struct {
	Ctx       context.Context        // per-run context (carries timeout + cancellation)
	ServerID  string                 // active server id for this run
	Config    map[string]interface{} // node config with {{...}} and @attr templates resolved
	RawConfig map[string]interface{} // unresolved node config (raw expressions preserved)
	DataIn    map[string]interface{} // resolved data inputs from connected edges
	Attrs     *AttrScope             // run-scoped attribute resolver (built-in + custom)

	svc     serviceDeps
	dataOut map[string]interface{} // written by SetOutput, read by engine after exec
}

func (e *ExecContext) SetOutput(port string, v interface{}) {
	e.dataOut[port] = v
}

// RawString returns an unresolved config value as a string (used to preserve a
// custom attribute's value as a lazy expression rather than its resolved value).
func (e *ExecContext) RawString(key string) string {
	if e.RawConfig == nil {
		return ""
	}
	v, ok := e.RawConfig[key]
	if !ok || v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func (e *ExecContext) GetString(key string) string {
	v := e.Config[key]
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func (e *ExecContext) GetFloat(key string, def float64) float64 {
	v, ok := e.Config[key]
	if !ok || v == nil {
		return def
	}
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return def
}

func (e *ExecContext) Server() *ServerService  { return e.svc.server }
func (e *ExecContext) Backup() *BackupService  { return e.svc.backup }
func (e *ExecContext) Rcon() *RconService      { return e.svc.rcon }
func (e *ExecContext) Config_() *ConfigService { return e.svc.config }
func (e *ExecContext) Emit(event string, data any) {
	e.svc.bus.Emit(event, data)
}

// ExecFunc is the signature every block executor must implement.
type ExecFunc func(e *ExecContext) ExecResult

// ─── Registry ─────────────────────────────────────────────────────────────────

type blockEntry struct {
	def  models.BlockDef
	exec ExecFunc
}

type BlockRegistry struct {
	mu      sync.RWMutex
	entries map[string]blockEntry
}

func NewBlockRegistry() *BlockRegistry {
	return &BlockRegistry{entries: make(map[string]blockEntry)}
}

// RegisterBlock registers a native block descriptor and its executor.
// Returns an error on ID collision (first registration wins).
func (r *BlockRegistry) RegisterBlock(def models.BlockDef, exec ExecFunc) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entries[def.ID]; exists {
		return fmt.Errorf("block %q already registered", def.ID)
	}
	r.entries[def.ID] = blockEntry{def: def, exec: exec}
	return nil
}

func (r *BlockRegistry) Get(id string) (blockEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.entries[id]
	return e, ok
}

// Defs returns all descriptors sorted by category then id, for GetBlockDefs IPC.
func (r *BlockRegistry) Defs() []models.BlockDef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]models.BlockDef, 0, len(r.entries))
	for _, e := range r.entries {
		out = append(out, e.def)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Category != out[j].Category {
			return out[i].Category < out[j].Category
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// ─── Manifest loader ──────────────────────────────────────────────────────────

// LoadManifests reads *.json files from dir, each a BlockDef or []BlockDef with
// Source:"manifest". Each def is bound to primitives[def.Primitive]; unknown
// primitives or native-ID collisions are skipped with a warning (native wins).
// Missing dir is a no-op.
func (r *BlockRegistry) LoadManifests(dir string, primitives map[string]ExecFunc) []string {
	entries, err := listJSONFiles(dir)
	if err != nil {
		return nil // missing dir is fine
	}

	var warnings []string
	for _, path := range entries {
		defs, err := readManifestFile(path)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("manifest %s: %v", path, err))
			continue
		}
		for _, def := range defs {
			def.Source = "manifest"
			exec, ok := primitives[def.Primitive]
			if !ok {
				warnings = append(warnings, fmt.Sprintf("manifest %s block %q: unknown primitive %q", path, def.ID, def.Primitive))
				continue
			}
			if err := r.RegisterBlock(def, exec); err != nil {
				warnings = append(warnings, fmt.Sprintf("manifest %s block %q: %v (native wins)", path, def.ID, err))
			}
		}
	}
	return warnings
}
