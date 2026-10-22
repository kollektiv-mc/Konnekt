package services

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"konnekt/backend/models"
)

// effectCase is one row of testdata/block_effects_cases.json, the table the
// TypeScript derivation in editor/blockMeta.ts is held to as well
// (blockEffects.test.ts), so the two cannot drift apart.
type effectCase struct {
	Name         string                 `json:"name"`
	Type         string                 `json:"type"`
	DefEffects   []string               `json:"defEffects"`
	Config       map[string]interface{} `json:"config"`
	CommandWired bool                   `json:"commandWired"`
	Want         []string               `json:"want"`
}

func loadEffectCases(t *testing.T) []effectCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "block_effects_cases.json"))
	if err != nil {
		t.Fatalf("read cases: %v", err)
	}
	var cases []effectCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parse cases: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	return cases
}

func TestNodeEffectsSharedCases(t *testing.T) {
	for _, c := range loadEffectCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			def := models.BlockDef{ID: c.Type, Effects: c.DefEffects}
			node := models.Node{ID: "n1", Type: c.Type, Config: c.Config}
			var edges []models.Edge
			if c.CommandWired {
				edges = append(edges, models.Edge{
					ID: "e1", Kind: "data", Source: "src", SourcePort: "value",
					Target: "n1", TargetPort: "command",
				})
			}
			got := nodeEffects(def, node, edges)
			if len(got) == 0 && len(c.Want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, c.Want) {
				t.Errorf("nodeEffects = %v, want %v", got, c.Want)
			}
		})
	}
}

func TestNodeEffectsIgnoresOtherEdges(t *testing.T) {
	def := models.BlockDef{ID: commandBlockID}
	node := models.Node{ID: "n1", Type: commandBlockID, Config: map[string]interface{}{"command": "__stop__"}}
	edges := []models.Edge{
		// A control edge into the node, a data edge into a different node and a
		// data edge into a different port: none of them wires this command.
		{ID: "c", Kind: "control", Source: "t", SourcePort: "onComplete", Target: "n1", TargetPort: "trigger"},
		{ID: "d1", Kind: "data", Source: "s", SourcePort: "value", Target: "other", TargetPort: "command"},
		{ID: "d2", Kind: "data", Source: "s", SourcePort: "value", Target: "n1", TargetPort: "other"},
	}
	if got := nodeEffects(def, node, edges); !hasEffect(got, EffectStopsServer) {
		t.Errorf("nodeEffects = %v, want stopsServer", got)
	}
}

// The real registry's command block is the one the derivation exists for, so
// the Stop and Restart options it offers must be the ones that give the effect.
func TestCommandBlockStopOptionsMatchTheDerivation(t *testing.T) {
	def := commandBlock(t, commandBlockID)
	field := commandFieldOf(t, def)
	if len(def.Effects) != 0 {
		t.Fatalf("action.command declares %v statically, but only some options stop the server", def.Effects)
	}
	stopping := map[string]bool{}
	for _, opt := range field.Options {
		node := models.Node{ID: "n", Type: def.ID, Config: map[string]interface{}{"command": opt.Value}}
		if hasEffect(nodeEffects(def, node, nil), EffectStopsServer) {
			stopping[opt.Value] = true
		}
	}
	want := map[string]bool{"__stop__": true, "__restart__": true}
	if !reflect.DeepEqual(stopping, want) {
		t.Errorf("options that stop the server = %v, want %v", stopping, want)
	}
}

func stopGraph(t *testing.T, command string, wired bool) models.Graph {
	t.Helper()
	g := models.Graph{
		ID: "g1", Name: "g",
		Nodes: []models.Node{
			{ID: "t", Type: "trigger.interval", Config: map[string]interface{}{}},
			{ID: "a", Type: commandBlockID, Config: map[string]interface{}{"command": command}},
		},
		Edges: []models.Edge{
			{ID: "e", Kind: "control", Source: "t", SourcePort: "onComplete", Target: "a", TargetPort: "trigger"},
		},
	}
	if wired {
		g.Edges = append(g.Edges, models.Edge{
			ID: "d", Kind: "data", Source: "t", SourcePort: "value", Target: "a", TargetPort: "command",
		})
	}
	return g
}

func TestGraphWarnings(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	registerDataBuiltins(reg)

	tests := []struct {
		name  string
		graph models.Graph
		rcon  bool
		warn  bool
	}{
		{"stop with RCON", stopGraph(t, "__stop__", false), true, false},
		{"stop without RCON", stopGraph(t, "__stop__", false), false, true},
		{"restart without RCON", stopGraph(t, "__restart__", false), false, true},
		{"no stop without RCON", stopGraph(t, "save-all", false), false, false},
		{"no stop with RCON", stopGraph(t, "save-all", false), true, false},
		{"a wired command is not known to stop", stopGraph(t, "__stop__", true), false, false},
		{"an empty graph", models.Graph{ID: "g"}, false, false},
		{"an unregistered block is ignored", models.Graph{
			ID: "g", Nodes: []models.Node{{ID: "x", Type: "no.such.block"}},
		}, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := graphWarnings(tt.graph, reg, tt.rcon)
			if tt.warn && len(got) != 1 {
				t.Fatalf("graphWarnings = %v, want one warning", got)
			}
			if !tt.warn && len(got) != 0 {
				t.Fatalf("graphWarnings = %v, want none", got)
			}
		})
	}
}

// Each warning names the node it is about, and graph order decides the list.
func TestGraphWarningsAttachEachToItsNode(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	g := stopGraph(t, "__stop__", false)
	g.Nodes = append(g.Nodes,
		models.Node{ID: "b", Type: commandBlockID, Config: map[string]interface{}{"command": "__restart__"}},
		models.Node{ID: "c", Type: commandBlockID, Config: map[string]interface{}{"command": "save-all"}},
		models.Node{ID: "d", Type: dhSnapshotBlockID, Config: map[string]interface{}{}},
	)
	got := graphWarnings(g, reg, false)
	want := []models.GraphWarning{
		{NodeID: "a", Text: rconUnconfirmedWarning},
		{NodeID: "b", Text: rconUnconfirmedWarning},
		{NodeID: "d", Text: dhSnapshotConsoleWarning},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("warnings = %v, want %v", got, want)
	}
}

func TestIssueSentencesLeadWithTheBlockLabel(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	g := stopGraph(t, "save-all", false)
	got := issueSentences(g, reg, []models.GraphWarning{
		{NodeID: "a", Text: "boom."},
		{NodeID: "", Text: "graph wide."},
		{NodeID: "ghost", Text: "gone."},
	})
	want := []string{"Command (a): boom.", "graph wide.", "Node ghost: gone."}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("sentences = %q, want %q", got, want)
	}
}

func TestGraphWarningsSaysRconIsNotConfirmed(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	got := graphWarnings(stopGraph(t, "__stop__", false), reg, false)
	if len(got) != 1 || !containsAll(got[0].Text, "RCON is not confirmed", "warning to players") {
		t.Errorf("warning = %v", got)
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !strings.Contains(s, p) {
			return false
		}
	}
	return true
}

// A graph with no stopping node must answer without asking the server service
// at all, which is also what lets the scheduler tests run with none.
func TestGraphWarningsMethodSkipsServerForNonStoppingGraph(t *testing.T) {
	s := newTestScheduler(t)
	got, err := s.GraphWarnings("srv", stopGraph(t, "save-all", false))
	if err != nil {
		t.Fatalf("GraphWarnings: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("GraphWarnings = %#v, want an empty non-nil slice", got)
	}
}

// The method asks the server service for the graph's server only, and a server
// whose RCON is up clears the warning.
func TestGraphWarningsMethodReadsRconFromTheServer(t *testing.T) {
	s := newTestScheduler(t)
	srv, _ := newServerFixture()
	s.deps.server = srv
	g := stopGraph(t, "__stop__", false)

	got, err := s.GraphWarnings(fixtureServerID, g)
	if err != nil || len(got) != 1 {
		t.Fatalf("without RCON: warnings = %v, err = %v, want one warning", got, err)
	}

	enableRcon(srv, "127.0.0.1:25575")
	got, err = s.GraphWarnings(fixtureServerID, g)
	if err != nil || len(got) != 0 {
		t.Fatalf("with RCON: warnings = %v, err = %v, want none", got, err)
	}

	// RCON on another server does not count for this one.
	got, err = s.GraphWarnings("other", g)
	if err != nil || len(got) != 1 {
		t.Fatalf("other server: warnings = %v, err = %v, want one warning", got, err)
	}
}

// The editor keeps a failed node's reason beside its marker, so the event that
// finishes a node carries the error, and only for a node that failed.
func TestNodeFinishedEventCarriesTheErrorOfAFailedNode(t *testing.T) {
	s := newTestScheduler(t)
	var finished []map[string]interface{}
	s.bus.Tap(func(event string, data any) {
		if m, ok := data.(map[string]interface{}); ok && event == EventScheduleNodeFinished {
			finished = append(finished, m)
		}
	})
	must(s.registry.RegisterBlock(models.BlockDef{
		ID: "test.maybefail", Category: "action",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
	}, func(e *ExecContext) ExecResult {
		if e.GetString("fail") != "" {
			return ExecResult{Port: "onFailed", Err: errors.New("bucket unreachable")}
		}
		return ExecResult{Port: "onComplete"}
	}))

	for _, tt := range []struct{ fail, want string }{{"", ""}, {"yes", "bucket unreachable"}} {
		finished = nil
		g := slowGraph("test.maybefail")
		g.Nodes[1].Config = map[string]interface{}{"fail": tt.fail}
		s.runGraph(g, "t1", "manual", seed("t1"))
		awaitIdle(t, s)
		var got interface{}
		for _, m := range finished {
			if m["nodeId"] == "a1" {
				got = m["error"]
			}
		}
		if tt.want == "" && got != nil || tt.want != "" && got != tt.want {
			t.Errorf("fail=%q: event error = %v, want %q", tt.fail, got, tt.want)
		}
	}
}
