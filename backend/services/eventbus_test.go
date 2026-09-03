package services

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// captureLog points slog's default at a buffer for the test's duration and
// returns a reader for it. Every service logs through the package default
// (logging.go), so this is the only seam there is.
func captureLog(t *testing.T) func() string {
	t.Helper()
	var mu sync.Mutex
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&lockedWriter{mu: &mu, w: &buf}, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return func() string {
		mu.Lock()
		defer mu.Unlock()
		return buf.String()
	}
}

type lockedWriter struct {
	mu *sync.Mutex
	w  *bytes.Buffer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

// Handlers run in their own goroutines, so nothing below can be asserted
// synchronously; waitFor (loader_test.go) polls with a deadline.

// A panicking handler used to be recovered and discarded, so a scheduler
// trigger that crashed on an event simply stopped firing with nothing in
// konnekt.log. The panic still has to be contained: the emitter must not see
// it, and the other subscribers to the same event must still run.
func TestEmitLogsAHandlerPanicAndKeepsTheOthersRunning(t *testing.T) {
	logged := captureLog(t)
	bus := NewEventBus() // no ctx: Emit skips the Wails runtime and only fans out in-process

	var mu sync.Mutex
	var ran []string
	bus.Subscribe("thing:happened", func(data any) {
		panic("handler blew up on " + data.(string))
	})
	bus.Subscribe("thing:happened", func(data any) {
		mu.Lock()
		ran = append(ran, data.(string))
		mu.Unlock()
	})

	bus.Emit("thing:happened", "payload") // must not panic the caller

	// The well-behaved sibling still runs, and the panic reaches the log.
	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(ran) == 1
	})
	waitFor(t, func() bool { return strings.Contains(logged(), "handler panicked") })
	line := logged()
	for _, want := range []string{"event=thing:happened", "handler blew up on payload"} {
		if !strings.Contains(line, want) {
			t.Errorf("log line %q does not carry %q", line, want)
		}
	}
}

func TestEmitLogsNothingWhenNoHandlerPanics(t *testing.T) {
	logged := captureLog(t)
	bus := NewEventBus()

	done := make(chan struct{})
	bus.Subscribe("quiet", func(any) { close(done) })
	bus.Emit("quiet", nil)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never ran")
	}
	if got := logged(); got != "" {
		t.Errorf("a clean handler produced a log line: %q", got)
	}
}

func TestEmitOnANilBusIsANoOp(t *testing.T) {
	var bus *EventBus
	bus.Emit("anything", nil) // fixtures wire no bus; this must not panic
}
