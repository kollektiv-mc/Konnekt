package services

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"sync"
	"time"

	"konnekt/backend/models"
)

// RemoteApprovals is the desktop's say over an admin-tier remote call (#462,
// agent_docs/SECURITY_CHECKLIST.md § S8.2). The dispatcher asks it before an
// admin method runs; it holds the call, the desktop is shown what was asked
// and by which device, and the call proceeds only on a yes. No answer is a no.
//
// Three rules it keeps:
//
//   - One call, one answer. There is no "allow this device from now on": that
//     would turn the admin tier back into operate.
//   - A device has at most one call waiting, and a second is refused at once.
//     A stolen session can ask as fast as it likes, and a desktop buried in
//     prompts is one where somebody eventually clicks yes.
//   - Ask blocks the caller, which is the RPC handler's own goroutine. It is
//     never called from an EventBus tap, which would stall every emitter.
type RemoteApprovals struct {
	mu       sync.Mutex
	now      func() time.Time
	timeout  time.Duration
	pending  map[string]*remoteApproval
	onChange func()
}

type remoteApproval struct {
	id        string
	device    string
	method    string
	reason    string
	args      []json.RawMessage
	requested time.Time
	// answer is buffered, so Answer never waits on a caller that has already
	// given up.
	answer chan bool
}

const (
	// remoteApprovalTimeout is how long a call waits for the desktop. Long
	// enough to read what is being asked, shorter than the proxies in front of
	// the listener are willing to hold a request open.
	remoteApprovalTimeout = 60 * time.Second
	// remoteMaxApprovals bounds the prompts on screen across all devices.
	remoteMaxApprovals = 4
)

var (
	ErrRemoteApprovalDenied   = errors.New("declined on the desktop")
	ErrRemoteApprovalTimeout  = errors.New("nobody answered on the desktop")
	ErrRemoteApprovalBusy     = errors.New("another request from this device is already waiting on the desktop")
	ErrRemoteApprovalFull     = errors.New("too many requests are waiting on the desktop")
	ErrRemoteApprovalGone     = errors.New("that request is no longer waiting")
	ErrRemoteApprovalCanceled = errors.New("the request was withdrawn")
)

func NewRemoteApprovals() *RemoteApprovals {
	return &RemoteApprovals{
		now:     time.Now,
		timeout: remoteApprovalTimeout,
		pending: map[string]*remoteApproval{},
	}
}

// OnChange registers what to tell when the set of waiting calls changes: the
// desktop, so it can show or drop a prompt. Called with a.mu released.
func (a *RemoteApprovals) OnChange(fn func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.onChange = fn
}

func (a *RemoteApprovals) changed() {
	a.mu.Lock()
	fn := a.onChange
	a.mu.Unlock()
	if fn != nil {
		fn()
	}
}

// Ask is the dispatcher's RemoteApprover. It returns nil when the desktop
// allowed the call, and otherwise why not. The request's context ends the
// wait when the phone hangs up, so its prompt does not outlive it.
func (a *RemoteApprovals) Ask(ctx context.Context, req RemoteApprovalRequest) error {
	id, err := newRemoteID()
	if err != nil {
		return err
	}
	entry := &remoteApproval{
		id: id, device: req.Device, method: req.Method, reason: req.Reason, args: req.Args,
		answer: make(chan bool, 1),
	}
	a.mu.Lock()
	for _, p := range a.pending {
		if p.device == req.Device {
			a.mu.Unlock()
			return ErrRemoteApprovalBusy
		}
	}
	if len(a.pending) >= remoteMaxApprovals {
		a.mu.Unlock()
		return ErrRemoteApprovalFull
	}
	entry.requested = a.now()
	a.pending[id] = entry
	timeout := a.timeout
	a.mu.Unlock()
	// The method and the device, never an argument (§ S8.9): what is being
	// asked stays on the desktop's screen.
	slog.Info("remote: approval asked", "method", req.Method, "device", req.Device)
	a.changed()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	var outcome error
	select {
	case allowed := <-entry.answer:
		if !allowed {
			outcome = ErrRemoteApprovalDenied
		}
	case <-timer.C:
		outcome = ErrRemoteApprovalTimeout
	case <-ctx.Done():
		outcome = ErrRemoteApprovalCanceled
	}
	a.mu.Lock()
	delete(a.pending, id)
	a.mu.Unlock()
	slog.Info("remote: approval answered", "method", req.Method, "device", req.Device, "allowed", outcome == nil)
	a.changed()
	return outcome
}

// Answer is the desktop's reply to one waiting call.
func (a *RemoteApprovals) Answer(id string, allow bool) error {
	a.mu.Lock()
	entry, ok := a.pending[id]
	if ok {
		// Removed here rather than left to Ask, so a second click on the same
		// prompt is told the request is gone instead of filling the channel.
		delete(a.pending, id)
	}
	a.mu.Unlock()
	if !ok {
		return ErrRemoteApprovalGone
	}
	entry.answer <- allow
	return nil
}

// Pending lists the calls waiting on the desktop, oldest first, with their
// arguments as the device sent them. The arguments are for the prompt and go
// nowhere else.
func (a *RemoteApprovals) Pending() []models.RemoteApproval {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]models.RemoteApproval, 0, len(a.pending))
	for _, p := range a.pending {
		args := make([]string, len(p.args))
		for i, arg := range p.args {
			args[i] = string(arg)
		}
		out = append(out, models.RemoteApproval{
			ID: p.id, Device: p.device, Method: p.method, Reason: p.reason, Args: args,
			RequestedAt: p.requested.UnixMilli(), ExpiresAt: p.requested.Add(a.timeout).UnixMilli(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt < out[j].RequestedAt })
	return out
}
