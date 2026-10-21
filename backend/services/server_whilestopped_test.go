package services

import (
	"errors"
	"testing"
	"time"

	"konnekt/backend/models"
)

// The defect WhileStopped fixes: a DH snapshot stopped the server, and a graph
// triggered on the server:stopped event (an "Auto Start") booted it again while
// the snapshot was still copying. The snapshot's own start then failed with
// "server already running". The stand-in for that graph here is a bus
// subscriber that starts the server, and the work done while stopped waits for
// its attempt so the race is decided, not timed.
func TestWhileStoppedRefusesAStartTriggeredByTheStop(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	release, stopSeen := fakeRunningServer(t, s)
	go func() { <-stopSeen; release() }()
	t.Cleanup(func() {
		if err := s.ForceStop(fixtureServerID); err != nil {
			t.Errorf("force stop: %v", err)
		}
	})
	dir := t.TempDir()

	attempted := make(chan error, 1)
	bus.Subscribe(EventServerStopped, func(data any) {
		if ev, ok := data.(models.ServerStoppedEvent); ok && ev.ServerID == fixtureServerID {
			attempted <- s.Start(fixtureServerID, "", nil, dir)
		}
	})

	var ranStopped bool
	stopErr, startErr := s.WhileStopped(fixtureServerID, "", nil, dir, time.Second, func() {
		select {
		case err := <-attempted:
			if !errors.Is(err, ErrPowerActionInProgress) {
				t.Errorf("a Start during the stopped window = %v, want ErrPowerActionInProgress", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("the stop's event never reached its subscriber")
		}
		ranStopped = !s.IsRunning(fixtureServerID)
	})
	if stopErr != nil || startErr != nil {
		t.Fatalf("WhileStopped = (%v, %v), want (nil, nil)", stopErr, startErr)
	}
	if !ranStopped {
		t.Error("fn ran while the server was up: something started it under the copy")
	}
	if !s.IsRunning(fixtureServerID) {
		t.Error("the server was not started again")
	}
}

func TestWhileStoppedOnAStoppedServerDoesNothing(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	called := false
	stopErr, startErr := s.WhileStopped(fixtureServerID, "", nil, t.TempDir(), time.Second, func() { called = true })
	if !errors.Is(stopErr, errServerNotRunning) || startErr != nil {
		t.Fatalf("WhileStopped = (%v, %v), want (errServerNotRunning, nil)", stopErr, startErr)
	}
	if called {
		t.Error("fn ran although nothing was stopped")
	}
	if s.IsRunning(fixtureServerID) {
		t.Error("a server that was not running was started")
	}
}

// WhileDown is the same hold for a server that was never running: a Start
// inside it is refused, and the server is left stopped after.
func TestWhileDownRefusesAStartAndLeavesTheServerStopped(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	var inner error
	if err := s.WhileDown(fixtureServerID, func() { inner = s.Start(fixtureServerID, "", nil, t.TempDir()) }); err != nil {
		t.Fatalf("WhileDown = %v", err)
	}
	if !errors.Is(inner, ErrPowerActionInProgress) {
		t.Errorf("a Start inside WhileDown = %v, want ErrPowerActionInProgress", inner)
	}
	if s.IsRunning(fixtureServerID) {
		t.Error("WhileDown left the server running")
	}
}

func TestWhileDownRefusesARunningServer(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	t.Cleanup(release)

	called := false
	if err := s.WhileDown(fixtureServerID, func() { called = true }); !errors.Is(err, errServerRunning) {
		t.Fatalf("WhileDown = %v, want errServerRunning", err)
	}
	if called {
		t.Error("fn ran with the server up")
	}
	if !s.IsRunning(fixtureServerID) {
		t.Error("WhileDown touched a running server")
	}
}

func TestWhileStoppedRefusesWhileAnotherPowerActionHoldsTheGate(t *testing.T) {
	s, _ := newServerFixture()
	s.powerMu.Lock()
	defer s.powerMu.Unlock()

	called := false
	stopErr, startErr := s.WhileStopped(fixtureServerID, "", nil, t.TempDir(), time.Second, func() { called = true })
	if !errors.Is(stopErr, ErrPowerActionInProgress) || startErr != nil {
		t.Fatalf("WhileStopped = (%v, %v), want (ErrPowerActionInProgress, nil)", stopErr, startErr)
	}
	if called {
		t.Error("fn ran without the gate")
	}
	if err := s.WhileDown(fixtureServerID, func() { called = true }); !errors.Is(err, ErrPowerActionInProgress) || called {
		t.Errorf("WhileDown = %v (fn called %v), want ErrPowerActionInProgress and no call", err, called)
	}
}
