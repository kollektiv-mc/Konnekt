package services

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"konnekt/backend/models"
)

const (
	maxNodesPerRun = 500
	maxRunDuration = 30 * time.Minute
	nodeTimeout    = 60 * time.Second
)

var reTemplate = regexp.MustCompile(`\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}`)

// @{ … } inline expression and @a.b.c bare attribute reference.
var reAttrExpr = regexp.MustCompile(`@\{([^}]*)\}`)
var reAttrRef = regexp.MustCompile(`@([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)`)

// runGraph executes a graph from the given trigger node, seeding data outputs
// with the provided seed values. It runs synchronously (caller may goroutine it)
// and returns the final RunRecord when complete.
//
// seed maps nodeID → portID → value; "trigger" is an alias for entryNodeID.
func (s *SchedulerService) runGraph(
	g models.Graph,
	entryNodeID string,
	triggerLabel string,
	seed map[string]map[string]interface{},
) models.RunRecord {
	// Concurrency guard: one active run per graph.
	s.runningMu.Lock()
	if s.running[g.ID] {
		s.runningMu.Unlock()
		return models.RunRecord{
			ID: newID(), GraphID: g.ID, GraphName: g.Name,
			Trigger: triggerLabel, StartedAt: time.Now().UnixMilli(),
			FinishedAt: time.Now().UnixMilli(), Status: "skipped",
		}
	}
	s.running[g.ID] = true
	s.runningMu.Unlock()
	defer func() {
		s.runningMu.Lock()
		delete(s.running, g.ID)
		s.runningMu.Unlock()
	}()

	// Authoritative type check: the editor's isValidConnection already blocks
	// authoring an incompatible data wire, but hand-edited or
	// ImportScheduleGraphJSON graphs bypass that. Fail loudly here rather than
	// silently coercing to a default value at the executor (e.g. GetFloat).
	if issues := validateGraphDataTypes(g, s.registry); len(issues) > 0 {
		now := time.Now().UnixMilli()
		return models.RunRecord{
			ID: newID(), GraphID: g.ID, GraphName: g.Name,
			Trigger: triggerLabel, StartedAt: now, FinishedAt: now,
			Status: "failed",
			Error:  "data type validation failed: " + strings.Join(issues, "; "),
		}
	}

	runID := newID()
	now := time.Now()
	rec := models.RunRecord{
		ID:        runID,
		GraphID:   g.ID,
		GraphName: g.Name,
		Trigger:   triggerLabel,
		StartedAt: now.UnixMilli(),
		Status:    "running",
	}

	// serverID rides every run and node event (#237): a graph belongs to one
	// server (#236), and the id is what lets a listener filter on the server
	// rather than having to know which graphs are that server's.
	s.bus.Emit(EventScheduleRunStarted, map[string]interface{}{
		"runId": runID, "graphId": g.ID, "graphName": g.Name, "serverID": g.ServerID,
	})

	// Build lookup structures from the graph snapshot.
	nodeByID := make(map[string]models.Node, len(g.Nodes))
	for _, n := range g.Nodes {
		nodeByID[n.ID] = n
	}

	// outputs accumulates data port values as nodes complete; seeded from trigger.
	outputs := make(map[string]map[string]interface{})
	for nid, ports := range seed {
		cp := make(map[string]interface{}, len(ports))
		for k, v := range ports {
			cp[k] = v
		}
		outputs[nid] = cp
	}
	// "trigger" is an alias for the entry node id so authors write {{trigger.player}}.
	if entryNodeID != "" {
		if _, ok := outputs["trigger"]; !ok {
			outputs["trigger"] = outputs[entryNodeID]
		}
	}

	// Run context with a wall-clock limit.
	runCtx, cancel := context.WithTimeout(context.Background(), maxRunDuration)
	defer cancel()

	// Run-scoped custom attributes: defined by Write Attribute nodes as raw
	// expressions, evaluated lazily on each reference. Fresh per run.
	scope := newAttrScope(s.deps, s.runServerID(g), map[string]string{})

	// BFS/queue of (nodeID, firedPort-that-led-here).
	type work struct {
		nodeID    string
		arrivedOn string // the targetPort on this node's control input
	}
	queue := []work{{nodeID: entryNodeID, arrivedOn: "in"}}
	execCount := 0
	failed := false
	var firstErr string

	for len(queue) > 0 && execCount < maxNodesPerRun {
		item := queue[0]
		queue = queue[1:]

		node, ok := nodeByID[item.nodeID]
		if !ok {
			continue
		}

		execCount++
		nodeStart := time.Now()
		s.bus.Emit(EventScheduleNodeStarted, map[string]interface{}{
			"runId": runID, "graphId": g.ID, "nodeId": node.ID, "type": node.Type, "serverID": g.ServerID,
		})

		result := s.executeNode(runCtx, node, g.Edges, nodeByID, outputs, scope)

		firedPort := result.Port
		status := "success"
		errStr := ""
		if result.Err != nil {
			status = "failed"
			errStr = result.Err.Error()
			if firedPort == "" {
				firedPort = "onFailed"
			}
			if !failed {
				failed = true
				firstErr = errStr
			}
		} else if firedPort == "" {
			firedPort = "onComplete"
		}

		nrec := models.NodeRunRecord{
			NodeID:     node.ID,
			Type:       node.Type,
			Status:     status,
			FiredPort:  firedPort,
			StartedAt:  nodeStart.UnixMilli(),
			FinishedAt: time.Now().UnixMilli(),
			Error:      errStr,
		}
		rec.Nodes = append(rec.Nodes, nrec)

		s.bus.Emit(EventScheduleNodeFinished, map[string]interface{}{
			"runId": runID, "graphId": g.ID, "nodeId": node.ID,
			"status": status, "firedPort": firedPort, "serverID": g.ServerID,
		})

		// Follow control edges from this node on the fired port.
		for _, edge := range g.Edges {
			if edge.Kind != "control" || edge.Source != node.ID || edge.SourcePort != firedPort {
				continue
			}
			queue = append(queue, work{nodeID: edge.Target, arrivedOn: edge.TargetPort})
		}

		select {
		case <-runCtx.Done():
			failed = true
			firstErr = "run exceeded maximum duration"
			goto done
		default:
		}
	}

	if execCount >= maxNodesPerRun {
		failed = true
		firstErr = fmt.Sprintf("aborted: exceeded %d node executions (possible cycle)", maxNodesPerRun)
	}

done:
	rec.FinishedAt = time.Now().UnixMilli()
	if failed {
		rec.Status = "failed"
		rec.Error = firstErr
	} else {
		rec.Status = "success"
	}

	s.bus.Emit(EventScheduleRunFinished, map[string]interface{}{
		"runId": runID, "graphId": g.ID, "status": rec.Status, "serverID": g.ServerID,
	})

	s.addHistory(rec)
	return rec
}

// executeNode resolves the node's config + data inputs, runs its executor
// under a per-node timeout, and returns the result with data outputs stored.
func (s *SchedulerService) executeNode(
	runCtx context.Context,
	node models.Node,
	edges []models.Edge,
	nodeByID map[string]models.Node,
	outputs map[string]map[string]interface{},
	scope *AttrScope,
) ExecResult {
	entry, ok := s.registry.Get(node.Type)
	if !ok {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("unknown block type %q", node.Type)}
	}

	// Trigger nodes are entry points only; their executor is a no-op at run time.
	if entry.def.IsTrigger {
		return ExecResult{Port: "onComplete"}
	}

	// Pull-evaluate any pure-data nodes that feed data inputs to this node
	// before we resolve inputs — ensures their outputs are available.
	s.pullDataDependencies(runCtx, node.ID, edges, nodeByID, outputs, scope, make(map[string]bool))

	nodeCtx, cancel := context.WithTimeout(runCtx, nodeTimeout)
	defer cancel()

	resolvedConfig := resolveConfigTemplates(node.Config, outputs, scope)
	dataIn := resolveDataInputs(node.ID, edges, outputs)

	// Overlay model: wired data values take precedence over literal config.
	// Port id == config key by convention, so executors call e.GetString("command")
	// and transparently receive the wired value without knowing the source.
	for k, v := range dataIn {
		resolvedConfig[k] = v
	}

	dataOut := make(map[string]interface{})
	ec := &ExecContext{
		Ctx:       nodeCtx,
		ServerID:  scope.ServerID(),
		Config:    resolvedConfig,
		RawConfig: node.Config,
		DataIn:    dataIn,
		Attrs:     scope,
		svc:       s.deps,
		dataOut:   dataOut,
	}

	result := entry.exec(ec)

	// Store data outputs so downstream nodes can reference them.
	if len(dataOut) > 0 {
		if outputs[node.ID] == nil {
			outputs[node.ID] = make(map[string]interface{})
		}
		for k, v := range dataOut {
			outputs[node.ID][k] = v
		}
	}
	return result
}

// isPureData returns true for blocks that are pull-evaluated value nodes:
// no control inputs and no control outputs.
func isPureData(def models.BlockDef) bool {
	return len(def.ControlInputs) == 0 && len(def.ControlOutputs) == 0
}

// pullDataDependencies recursively ensures pure-data source nodes for nodeID
// have been evaluated and their outputs stored before the caller resolves its
// own data inputs. visiting prevents infinite recursion on data cycles.
func (s *SchedulerService) pullDataDependencies(
	runCtx context.Context,
	nodeID string,
	edges []models.Edge,
	nodeByID map[string]models.Node,
	outputs map[string]map[string]interface{},
	scope *AttrScope,
	visiting map[string]bool,
) {
	for _, e := range edges {
		if e.Kind != "data" || e.Target != nodeID {
			continue
		}
		s.ensureDataOutputs(runCtx, e.Source, edges, nodeByID, outputs, scope, visiting)
	}
}

// ensureDataOutputs evaluates a pure-data node if its outputs are not yet
// populated. Callers guard with visiting to detect cycles.
func (s *SchedulerService) ensureDataOutputs(
	runCtx context.Context,
	nodeID string,
	edges []models.Edge,
	nodeByID map[string]models.Node,
	outputs map[string]map[string]interface{},
	scope *AttrScope,
	visiting map[string]bool,
) {
	if _, done := outputs[nodeID]; done {
		return
	}
	if visiting[nodeID] {
		return // data cycle — leave output absent
	}
	node, ok := nodeByID[nodeID]
	if !ok {
		return
	}
	entry, ok := s.registry.Get(node.Type)
	if !ok || !isPureData(entry.def) {
		return
	}

	visiting[nodeID] = true
	defer delete(visiting, nodeID)

	// Recursively pull upstream data dependencies first.
	s.pullDataDependencies(runCtx, nodeID, edges, nodeByID, outputs, scope, visiting)

	resolvedConfig := resolveConfigTemplates(node.Config, outputs, scope)
	dataIn := resolveDataInputs(nodeID, edges, outputs)
	for k, v := range dataIn {
		resolvedConfig[k] = v
	}

	dataOut := make(map[string]interface{})
	nodeCtx, cancel := context.WithTimeout(runCtx, nodeTimeout)
	defer cancel()
	ec := &ExecContext{
		Ctx:       nodeCtx,
		ServerID:  scope.ServerID(),
		Config:    resolvedConfig,
		RawConfig: node.Config,
		DataIn:    dataIn,
		Attrs:     scope,
		svc:       s.deps,
		dataOut:   dataOut,
	}
	_ = entry.exec(ec) //nolint:errcheck // ignore ExecResult — pure data nodes have no control branches

	if len(dataOut) > 0 {
		outputs[nodeID] = dataOut
	}
}

// resolveConfigTemplates walks config values substituting {{nodeId.port}} tokens
// and @attribute references.
func resolveConfigTemplates(config map[string]interface{}, outputs map[string]map[string]interface{}, scope *AttrScope) map[string]interface{} {
	out := make(map[string]interface{}, len(config))
	for k, v := range config {
		out[k] = resolveValue(v, outputs, scope)
	}
	return out
}

func resolveValue(v interface{}, outputs map[string]map[string]interface{}, scope *AttrScope) interface{} {
	s, ok := v.(string)
	if !ok {
		return v
	}
	// Single whole-string token: {{node.port}} — preserve original type.
	if matches := reTemplate.FindStringSubmatch(s); matches != nil && matches[0] == strings.TrimSpace(s) {
		return lookupOutput(matches[1], matches[2], outputs)
	}
	// Mixed string with embedded {{…}} tokens: substitute as strings.
	s = reTemplate.ReplaceAllStringFunc(s, func(m string) string {
		parts := reTemplate.FindStringSubmatch(m)
		if parts == nil {
			return m
		}
		val := lookupOutput(parts[1], parts[2], outputs)
		if val == nil {
			return ""
		}
		return fmt.Sprintf("%v", val)
	})
	return resolveAttrTokens(s, scope)
}

// resolveAttrTokens substitutes @{ expr } and @a.b.c references in a string.
// A whole-string token preserves its native (number/string) type; embedded
// tokens stringify. Resolution failures substitute empty (mirrors {{…}}).
func resolveAttrTokens(s string, scope *AttrScope) interface{} {
	if scope == nil || !strings.Contains(s, "@") {
		return s
	}
	trimmed := strings.TrimSpace(s)

	// Whole-string @{ expr } — preserve type.
	if m := reAttrExpr.FindStringSubmatch(trimmed); m != nil && m[0] == trimmed {
		if val, err := evalExpr(m[1], scope); err == nil {
			return val
		}
		return ""
	}
	// Whole-string @ref — preserve type.
	if m := reAttrRef.FindStringSubmatch(trimmed); m != nil && m[0] == trimmed {
		if val, err := scope.Resolve(m[1]); err == nil {
			return val
		}
		return ""
	}

	// Embedded: @{…} first, then bare @refs — stringify each.
	out := reAttrExpr.ReplaceAllStringFunc(s, func(tok string) string {
		m := reAttrExpr.FindStringSubmatch(tok)
		val, err := evalExpr(m[1], scope)
		if err != nil {
			return ""
		}
		return toStr(val)
	})
	out = reAttrRef.ReplaceAllStringFunc(out, func(tok string) string {
		m := reAttrRef.FindStringSubmatch(tok)
		val, err := scope.Resolve(m[1])
		if err != nil {
			return ""
		}
		return toStr(val)
	})
	return out
}

func lookupOutput(nodeID, port string, outputs map[string]map[string]interface{}) interface{} {
	ports, ok := outputs[nodeID]
	if !ok {
		return nil
	}
	return ports[port]
}

// resolveDataInputs builds the DataIn map for a node by walking data edges
// targeting it. For each matching edge, it looks up the source node's output
// value from the outputs accumulator (honoring the "trigger" alias).
// Port id == config key by convention; the caller overlays these onto resolvedConfig.
func resolveDataInputs(
	nodeID string,
	edges []models.Edge,
	outputs map[string]map[string]interface{},
) map[string]interface{} {
	dataIn := make(map[string]interface{})
	for _, e := range edges {
		if e.Kind != "data" || e.Target != nodeID {
			continue
		}
		v := lookupOutput(e.Source, e.SourcePort, outputs)
		if v != nil {
			dataIn[e.TargetPort] = v
		}
	}
	return dataIn
}
