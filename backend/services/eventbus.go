package services

import (
	"context"
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventBus is the single emit path for all Wails events.
// Emit forwards to the local WebView, to every Tap (the remote-access
// WebSocket mirror, remote_ws.go) and to any in-process subscribers registered
// via Subscribe (the scheduler trigger subsystem).
type EventBus struct {
	ctx  context.Context
	mu   sync.RWMutex
	subs map[string][]func(data any)
	taps []func(event string, data any)
}

func NewEventBus() *EventBus {
	return &EventBus{subs: make(map[string][]func(data any))}
}

func (b *EventBus) SetContext(ctx context.Context) {
	b.ctx = ctx
}

// Subscribe registers an in-process handler for an event. Handlers are called
// in their own goroutines so a slow handler never stalls the emitter. A handler
// that panics is contained, never the emitter's or another handler's problem,
// but not silently: the goroutine recovers and logs the panic with the event
// name, because the subscribers today are the scheduler's triggers and a
// trigger that stops firing with no line in konnekt.log is undiagnosable.
func (b *EventBus) Subscribe(event string, handler func(data any)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs[event] = append(b.subs[event], handler)
}

// Tap registers a handler for every event, called synchronously on the
// emitter's goroutine in emit order. It exists for the remote-access fan-out
// (remote_ws.go), whose replay buffer is only useful if it holds events in the
// order they happened: Subscribe's per-call goroutines give no such guarantee,
// and two console lines emitted a microsecond apart would reach a reconnecting
// phone swapped. A tap must therefore be quick and never block, since it runs
// inside every Emit; a panic in one is contained and logged the same way a
// subscriber's is, so a broken tap cannot take the server process down.
func (b *EventBus) Tap(handler func(event string, data any)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.taps = append(b.taps, handler)
}

func (b *EventBus) Emit(event string, data any) {
	if b == nil {
		return
	}
	if b.ctx != nil {
		runtime.EventsEmit(b.ctx, event, data)
	}
	b.mu.RLock()
	taps := b.taps
	handlers := b.subs[event]
	b.mu.RUnlock()
	for _, tap := range taps {
		b.runTap(tap, event, data)
	}
	// Fan out to in-process subscribers (scheduler triggers).
	for _, h := range handlers {
		h := h
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("eventbus: handler panicked", "event", event, "panic", r)
				}
			}()
			h(data)
		}()
	}
}

func (b *EventBus) runTap(tap func(event string, data any), event string, data any) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("eventbus: tap panicked", "event", event, "panic", r)
		}
	}()
	tap(event, data)
}
