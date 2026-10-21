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
}
