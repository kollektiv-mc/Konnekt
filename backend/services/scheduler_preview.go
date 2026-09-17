package services

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"konnekt/backend/models"
)

// PreviewNode computes a side-effect-free dry-run of a single node against the
// current live server state. Pure-data nodes (Constant, Math, Random, Read Attribute)
// are actually executed to produce real values. Action nodes are never executed —
// only validated and described. Custom attributes are gathered from every Write
// Attribute node in the whole graph so a standalone node can still see them.
func (s *SchedulerService) PreviewNode(g models.Graph, nodeID string) (models.NodePreview, error) {
	nodeByID := make(map[string]models.Node, len(g.Nodes))
	for _, n := range g.Nodes {
		nodeByID[n.ID] = n
	}
	node, ok := nodeByID[nodeID]
	if !ok {
		return models.NodePreview{}, fmt.Errorf("node %q not found", nodeID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	outputs := make(map[string]map[string]interface{})
	scope := newAttrScope(s.deps, s.runServerID(g), map[string]string{})

	// Gather custom-attribute definitions from all Write Attribute nodes in the graph.
	// Pull their data dependencies first so wired values (e.g. Math result) are available.
	for _, n := range g.Nodes {
		if n.Type != "data.writeAttribute" {
			continue
		}
		target := strings.TrimPrefix(asString(n.Config["attribute"]), "@")
		if target == "" {
			continue
		}
		if _, builtin := builtinAttrs[target]; builtin {
			continue
		}
		s.pullDataDependencies(ctx, n.ID, g.Edges, nodeByID, outputs, scope, make(map[string]bool))
		dataIn := resolveDataInputs(n.ID, g.Edges, outputs)
		if wireVal, ok2 := dataIn["value"]; ok2 && wireVal != nil {
			// Wired value: store the computed result as a literal so Resolve returns it directly.
			scope.Define(target, toStr(wireVal))
		} else {
			scope.Define(target, asString(n.Config["value"]))
		}
	}

	// Pull data dependencies for the selected node, then resolve its config + inputs.
	s.pullDataDependencies(ctx, nodeID, g.Edges, nodeByID, outputs, scope, make(map[string]bool))
	resolvedCfg := resolveConfigTemplates(node.Config, outputs, scope)
	dataIn := resolveDataInputs(nodeID, g.Edges, outputs)
	for k, v := range dataIn {
		resolvedCfg[k] = v
	}

	preview := models.NodePreview{NodeID: nodeID, OK: true}

	// Collect attribute names referenced anywhere in the raw config strings.
	refNames := map[string]bool{}
	for _, v := range node.Config {
		sv, ok := v.(string)
		if !ok {
			continue
		}
		for _, m := range reAttrRef.FindAllStringSubmatch(sv, -1) {
			refNames[m[1]] = true
		}
	}

	// The Write Attribute target is the attribute the node defines/writes; show its value.
	if node.Type == "data.writeAttribute" {
		target := strings.TrimPrefix(asString(resolvedCfg["attribute"]), "@")
		if target != "" {
			delete(refNames, target)
			meta, builtin := builtinAttrs[target]
			var row models.AttrValue
			switch {
			case builtin && !meta.Writable:
				row = models.AttrValue{Name: target, Type: meta.Type, Error: "read-only"}
				preview.OK = false
			case builtin:
				row = models.AttrValue{
					Name: target, Type: meta.Type, Writable: true,
					Value: toStr(resolvedCfg["value"]),
				}
			default:
				row = attrRow(target, scope)
			}
			preview.Attributes = append(preview.Attributes, row)
		}
	}

	for _, name := range sortedKeys(refNames) {
		preview.Attributes = append(preview.Attributes, attrRow(name, scope))
	}

	lines, ok2 := s.simulateNode(ctx, node, resolvedCfg, dataIn, scope)
	preview.Console = lines
	if !ok2 {
		preview.OK = false
	}
	return preview, nil
}

// attrRow resolves a single attribute against the scope for the spreadsheet.
func attrRow(name string, scope *AttrScope) models.AttrValue {
	row := models.AttrValue{Name: name}
	if meta, ok := builtinAttrs[name]; ok {
		row.Type, row.Writable = meta.Type, meta.Writable
	} else if scope.IsCustom(name) {
		row.Type = "custom"
	} else {
		row.Type = "unknown"
	}
	val, err := scope.Resolve(name)
	if err != nil {
		row.Error = err.Error()
		return row
	}
	row.Value = toStr(val)
	return row
}

// simulateNode describes what a node would do, using real resolved values.
// Pure-data nodes (Constant, Math, Random) are executed side-effect-free to produce
// actual output values. Action nodes are never executed — only validated and described.
// Returns the console lines and whether the node would succeed.
func (s *SchedulerService) simulateNode(
	ctx context.Context,
	node models.Node,
	resolvedCfg map[string]interface{},
	dataIn map[string]interface{},
	scope *AttrScope,
) ([]string, bool) {
	switch node.Type {
	case "data.writeAttribute":
		target := strings.TrimPrefix(asString(resolvedCfg["attribute"]), "@")
		if target == "" {
			return []string{"would fail: no attribute name"}, false
		}
		meta, builtin := builtinAttrs[target]
		if builtin && !meta.Writable {
			return []string{fmt.Sprintf("ERROR: @%s is read-only", target)}, false
		}
		val := toStr(resolvedCfg["value"])
		if builtin {
			return []string{fmt.Sprintf("would write @%s = %s", target, val)}, true
		}
		if val == "" {
			return []string{fmt.Sprintf("would define @%s = (value is null)", target)}, false
		}
		return []string{fmt.Sprintf("would define @%s = %s", target, val)}, true

	case "action.notify":
		return []string{"would notify: " + toStr(resolvedCfg["message"])}, true

	case "action.command":
		cmd := asString(resolvedCfg["preset"])
		if cmd == "" {
			cmd = toStr(resolvedCfg["command"])
		}
		if cmd == "" {
			return []string{"would fail: command is empty"}, false
		}
		return []string{"would run: " + cmd}, true

	case "action.rcon":
		cmd := asString(resolvedCfg["preset"])
		if cmd == "" {
			cmd = toStr(resolvedCfg["command"])
		}
		if cmd == "" {
			return []string{"would fail: command is empty"}, false
		}
		return []string{"would rcon: " + cmd}, true

	case "action.httpRequest":
		method := asString(resolvedCfg["method"])
		if method == "" {
			method = "POST"
		}
		url := toStr(resolvedCfg["url"])
		if url == "" {
			return []string{"would fail: url is empty"}, false
		}
		return []string{fmt.Sprintf("would %s %s", method, url)}, true

	case "data.serverAttribute":
		name := strings.TrimPrefix(asString(resolvedCfg["attribute"]), "@")
		if name == "" {
			return []string{"would fail: no attribute name"}, false
		}
		val, err := scope.Resolve(name)
		if err != nil {
			return []string{fmt.Sprintf("ERROR: @%s is undefined", name)}, false
		}
		if typeErr := checkAttrType(val, asString(resolvedCfg["type"])); typeErr != nil {
			return []string{fmt.Sprintf("ERROR: @%s — %s", name, typeErr)}, false
		}
		return []string{fmt.Sprintf("reads @%s = %s", name, toStr(val))}, true
	}

	// Generic side-effect-free execution for pure-data nodes (Constant, Math, Random, …).
	entry, ok := s.registry.Get(node.Type)
	if ok && isPureData(entry.def) {
		dataOut := make(map[string]interface{})
		nodeCtx, cancel := context.WithTimeout(ctx, nodeTimeout)
		defer cancel()
		ec := &ExecContext{
			Ctx:       nodeCtx,
			ServerID:  scope.ServerID(),
			Config:    resolvedCfg,
			RawConfig: node.Config,
			DataIn:    dataIn,
			Attrs:     scope,
			svc:       s.deps,
			dataOut:   dataOut,
		}
		result := entry.exec(ec)
		if result.Err != nil {
			return []string{fmt.Sprintf("would fail: %s", result.Err)}, false
		}
		portLabel := make(map[string]string, len(entry.def.DataOutputs))
		for _, p := range entry.def.DataOutputs {
			portLabel[p.ID] = p.Label
		}
		ports := make([]string, 0, len(dataOut))
		for k := range dataOut {
			ports = append(ports, k)
		}
		sort.Strings(ports)
		lines := make([]string, 0, len(ports))
		for _, p := range ports {
			label := portLabel[p]
			if label == "" {
				label = p
			}
			lines = append(lines, fmt.Sprintf("%s = %s", label, toStr(dataOut[p])))
		}
		if len(lines) == 0 {
			return []string{"(no output)"}, true
		}
		return lines, true
	}

	if ok {
		return []string{"would execute " + entry.def.Label}, true
	}
	return []string{"would execute " + node.Type}, true
}

func asString(v interface{}) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
