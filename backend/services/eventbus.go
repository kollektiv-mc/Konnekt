package services

import (
	"context"
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventBus is the single emit path for all Wails events.
// Emit forwards to both the local WebView and any in-process subscribers
// registered via Subscribe (used by the scheduler trigger subsystem and
// reserved for the remote-access WebSocket fan-out in Phase 1).
type EventBus struct {
	ctx  context.Context
	mu   sync.RWMutex
	subs map[string][]func(data any)
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

func (b *EventBus) Emit(event string, data any) {
	if b == nil {
		return
	}
	if b.ctx != nil {
		runtime.EventsEmit(b.ctx, event, data)
	}
	// Fan out to in-process subscribers (scheduler triggers, future remote WS).
	b.mu.RLock()
	handlers := b.subs[event]
	b.mu.RUnlock()
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
