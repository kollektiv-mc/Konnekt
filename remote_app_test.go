package main

import (
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"konnekt/backend/services"
)

// The desktop's own bound methods over Remote Access (#47), against the real
// App the way remote_methods_test.go builds its dispatcher.

func newRemoteTestApp(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	app.remoteAuth.SetDataDir(t.TempDir())
	t.Cleanup(func() {
		if err := app.remoteService.Stop(); err != nil {
			t.Errorf("stop: %v", err)
		}
	})
	return app
}

// § S8.8: off unless switched on, and it cannot be switched on before there
// is a password to sign in with.
func TestRemoteAccessStartsOnlyWithAPassword(t *testing.T) {
	app := newRemoteTestApp(t)
	state, err := app.GetRemoteAccessState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Running || state.PasswordSet || state.Addr != "" {
		t.Fatalf("a fresh app reports %+v, want everything off", state)
	}
	if err := app.StartRemoteAccess(); err == nil {
		t.Fatal("started with no password set")
	}
	if app.remoteService.Running() {
		t.Fatal("the listener is running after a refused start")
	}
	if err := app.SetRemotePassword("too short"); !errors.Is(err, services.ErrRemotePasswordLength) {
		t.Errorf("a 9-character password: got %v", err)
	}

	if err := app.SetRemotePassword("correct horse battery"); err != nil {
		t.Fatal(err)
	}
	if err := app.StartRemoteAccess(); err != nil {
		t.Fatal(err)
	}
	state, err = app.GetRemoteAccessState()
	if err != nil {
		t.Fatal(err)
	}
	// Loopback and nothing else (§ S8.3).
	if !state.Running || !state.PasswordSet || !strings.HasPrefix(state.Addr, "127.0.0.1:") {
		t.Errorf("after start: %+v", state)
	}
	if err := app.StopRemoteAccess(); err != nil {
		t.Fatal(err)
	}
	state, err = app.GetRemoteAccessState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Running || state.Addr != "" {
		t.Errorf("after stop: %+v", state)
	}
}

// The frontend maps over these three lists without a null check, so an empty
// one has to arrive as [] and not as null.
func TestRemoteAccessStateListsAreNeverNull(t *testing.T) {
	app := newRemoteTestApp(t)
	state, err := app.GetRemoteAccessState()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"devices":[]`, `"pendingDevices":[]`, `"approvals":[]`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("state is %s, want it to contain %s", raw, want)
		}
	}
}

// remote:changed is the desktop's cue to read the state back, and it is the
// one event about remote access.
func TestRemoteAccessAnnouncesItsChanges(t *testing.T) {
	app := newRemoteTestApp(t)
	var changes atomic.Int32
	app.bus.Tap(func(event string, _ any) {
		if event == services.EventRemoteChanged {
			changes.Add(1)
		}
	})
	step := func(what string, fn func() error) {
		t.Helper()
		before := changes.Load()
		if err := fn(); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		if changes.Load() == before {
			t.Errorf("%s was not announced", what)
		}
	}
	step("setting the password", func() error { return app.SetRemotePassword("correct horse battery") })
	step("starting", app.StartRemoteAccess)
	step("stopping", app.StopRemoteAccess)

	before := changes.Load()
	if err := app.AnswerRemoteApproval("nope", true); !errors.Is(err, services.ErrRemoteApprovalGone) {
		t.Errorf("answering a call that is not waiting: got %v", err)
	}
	if err := app.ApproveRemoteDevice("nope", "Phone"); !errors.Is(err, services.ErrRemoteRequestGone) {
		t.Errorf("approving a request that is not waiting: got %v", err)
	}
	if err := app.RemoveRemoteDevice("nope"); !errors.Is(err, services.ErrRemoteDeviceUnknown) {
		t.Errorf("removing a device that does not exist: got %v", err)
	}
	if changes.Load() != before {
		t.Error("a refused action was announced as a change")
	}
}

// § S8.8: the tunnel is off unless switched on, and it has nothing to carry
// until the listener runs.
func TestRemoteTunnelNeedsTheListener(t *testing.T) {
	app := newRemoteTestApp(t)
	state, err := app.GetRemoteAccessState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Tunnel.Status != "off" || state.Tunnel.URL != "" || state.Tunnel.Version == "" {
		t.Errorf("a fresh app's tunnel is %+v, want off and naming its pinned version", state.Tunnel)
	}
	if err := app.StartRemoteTunnel(); err == nil {
		t.Fatal("the tunnel started with the listener off")
	}
	if got := app.tunnelService.State().Status; got != "off" {
		t.Errorf("the tunnel is %q after a refused start", got)
	}
	if err := app.StopRemoteTunnel(); err != nil {
		t.Errorf("stopping a tunnel that is off: %v", err)
	}
}
