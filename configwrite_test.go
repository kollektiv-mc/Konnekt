package main

import (
	"path/filepath"
	"testing"
	"time"

	"konnekt/backend/models"
	"konnekt/backend/services"
)

// #412: saving server.properties from the Config tile shows the new
// max-players at once, rather than on the next 10s stats tick. Built through
// NewApp so the SetConfig wiring is the one under test.
func TestWritingServerPropertiesPushesTheNewStatus(t *testing.T) {
	a := NewApp()
	a.configService.SetDataDir(filepath.Join(t.TempDir(), "konnekt"))
	if err := a.configService.SaveServerConfig(models.ServerConfig{ID: "srv", Name: "Survival", WorkingDir: t.TempDir()}); err != nil {
		t.Fatalf("SaveServerConfig: %v", err)
	}
	// The bus hands each event to its subscribers on their own goroutines.
	pushed := make(chan models.ServerStatusEvent, 4)
	a.bus.Subscribe(services.EventServerStatus, func(d any) {
		if ev, ok := d.(models.ServerStatusEvent); ok {
			pushed <- ev
		}
	})

	// A file with no max-players in it pushes nothing, so the first status to
	// arrive has to be the server.properties write's.
	if err := a.WriteConfigFile("srv", "ops.json", "[]"); err != nil {
		t.Fatalf("WriteConfigFile(ops.json): %v", err)
	}
	if err := a.WriteConfigFile("srv", "server.properties", "max-players=7\n"); err != nil {
		t.Fatalf("WriteConfigFile(server.properties): %v", err)
	}

	select {
	case ev := <-pushed:
		if ev.ServerID != "srv" || ev.MaxPlayers != 7 {
			t.Errorf("pushed %q with MaxPlayers %d, want srv with 7", ev.ServerID, ev.MaxPlayers)
		}
	case <-time.After(time.Second):
		t.Fatal("no server:status pushed after writing server.properties")
	}
	select {
	case ev := <-pushed:
		t.Errorf("a second status was pushed: %+v", ev)
	case <-time.After(200 * time.Millisecond):
	}
}
