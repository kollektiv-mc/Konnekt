package services

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// recordingHandler is a slog.Handler that keeps every record it is handed and
// signals on each one, so a test can wait for a line written from another
// goroutine instead of sleeping and hoping.
type recordingHandler struct {
	mu    sync.Mutex
	lines []string
	seen  chan struct{}
}

func newRecordingHandler() *recordingHandler {
	return &recordingHandler{seen: make(chan struct{}, 16)}
}

func (h *recordingHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *recordingHandler) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	b.WriteString(r.Message)
	r.Attrs(func(a slog.Attr) bool {
		b.WriteString(" ")
		b.WriteString(a.String())
		return true
	})
	h.mu.Lock()
	h.lines = append(h.lines, b.String())
	h.mu.Unlock()
	h.seen <- struct{}{}
	return nil
}

func (h *recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *recordingHandler) WithGroup(string) slog.Handler      { return h }

func (h *recordingHandler) all() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.lines...)
}

// captureLog points slog's package default at a recording handler for the
// test's lifetime. Every service logs through the default (logging.go), so
// this is the seam a log assertion has.
func captureLog(t *testing.T) *recordingHandler {
	t.Helper()
	h := newRecordingHandler()
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return h
}

// The bug behind #261: a subscriber that panicked was recovered and then
// forgotten, so a scheduler trigger that crashed on an event simply stopped
// firing with nothing in konnekt.log. The recover has to stay (the emitter
// and the other handlers must not go down with it) and now has to leave a
// line naming the event.
func TestEmitLogsAHandlerPanicAndKeepsTheOtherHandlersRunning(t *testing.T) {
	logs := captureLog(t)
	bus := NewEventBus() // no ctx: Emit skips the Wails runtime and only fans out in-process

	survivor := make(chan any, 1)
	bus.Subscribe("test:event", func(any) { panic("trigger exploded") })
	bus.Subscribe("test:event", func(data any) { survivor <- data })

	// Must not propagate: a panic escaping a handler's goroutine would take the
	// whole process down, which is the one thing the recover exists to stop.
	bus.Emit("test:event", "payload")

	select {
	case got := <-survivor:
		if got != "payload" {
			t.Errorf("surviving handler received %v, want %q", got, "payload")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the handler after the panicking one never ran")
	}

	select {
	case <-logs.seen:
	case <-time.After(2 * time.Second):
		t.Fatalf("no log line for the panic; got %v", logs.all())
	}
	lines := logs.all()
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want exactly one: %v", len(lines), lines)
	}
	for _, want := range []string{"handler panicked", "event=test:event", "trigger exploded"} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("log line %q does not mention %q", lines[0], want)
		}
	}
}

// A handler that does not panic writes nothing: the log is for failures, and
// a line per event would bury them.
func TestEmitIsSilentForAHealthyHandler(t *testing.T) {
	logs := captureLog(t)
	bus := NewEventBus()

	done := make(chan struct{})
	bus.Subscribe("test:quiet", func(any) { close(done) })
	bus.Emit("test:quiet", nil)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never ran")
	}
	if lines := logs.all(); len(lines) != 0 {
		t.Errorf("healthy handler produced log lines: %v", lines)
	}
}

// Emit on a nil bus is a no-op, which the BackupService test fixture relies on
// by leaving its bus nil.
func TestEmitOnANilBusIsANoOp(t *testing.T) {
	var bus *EventBus
	bus.Emit("test:nil", nil)
}
