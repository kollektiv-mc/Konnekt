package main

import (
	"errors"
	"testing"

	"konnekt/backend/services"
)

// Kick, ban and pardon refuse a selector before anything reaches the server
// (#510). With no server running the next failure would be "not running", so
// ErrPlayerName coming back is the check firing first.
func TestModerationRefusesASelector(t *testing.T) {
	app := newRemoteTestApp(t)
	for _, name := range []string{"@a", "@e[type=player]", "Ste ve", ""} {
		if err := app.KickPlayer("srv", name, "bye"); !errors.Is(err, services.ErrPlayerName) {
			t.Errorf("kick %q: got %v", name, err)
		}
		if err := app.BanPlayer("srv", name, "bye"); !errors.Is(err, services.ErrPlayerName) {
			t.Errorf("ban %q: got %v", name, err)
		}
		if err := app.PardonPlayer("srv", name); !errors.Is(err, services.ErrPlayerName) {
			t.Errorf("pardon %q: got %v", name, err)
		}
	}
	if err := app.KickPlayer("srv", "Steve", "bye"); errors.Is(err, services.ErrPlayerName) {
		t.Errorf("a plain name was refused: %v", err)
	}
}
