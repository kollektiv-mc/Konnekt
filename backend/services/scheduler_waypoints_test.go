package services

import (
	"encoding/json"
	"strings"
	"testing"

	"konnekt/backend/models"
)

func TestEdgeWaypointsSurviveSaveAndLoad(t *testing.T) {
	s := newScopedScheduler(t, "a", "a")
	g := models.Graph{
		Name: "routed",
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "x", SourcePort: "onComplete", Target: "y", TargetPort: "trigger",
				Waypoints: []models.Position{{X: 10, Y: 20}, {X: 30.5, Y: -4}}},
			{ID: "e2", Kind: "control", Source: "y", SourcePort: "onComplete", Target: "z", TargetPort: "trigger"},
		},
	}
	if _, err := s.SaveGraph("a", g); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetGraphs("a")
	if err != nil || len(got) != 1 {
		t.Fatalf("GetGraphs = %v, %v, want one graph", got, err)
	}
	wp := got[0].Edges[0].Waypoints
	if len(wp) != 2 || wp[0] != (models.Position{X: 10, Y: 20}) || wp[1] != (models.Position{X: 30.5, Y: -4}) {
		t.Errorf("waypoints after reload = %v", wp)
	}
	if got[0].Edges[1].Waypoints != nil {
		t.Errorf("an edge saved without waypoints came back with %v", got[0].Edges[1].Waypoints)
	}
}

func TestEdgeWithoutWaypointsWritesNoKey(t *testing.T) {
	raw, err := json.Marshal(models.Edge{ID: "e1"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "waypoints") {
		t.Errorf("a plain edge serialized a waypoints key: %s", raw)
	}
}
