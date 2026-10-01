package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"sync"
)

// RemoteTier says what a stolen or misused remote session could do with a
// method, which is the only question the tiers answer. A remote client is the
// user on a phone, so the tiers are not about trust in the caller; they are
// about the blast radius when the caller is not who the session says.
//
//   - read: observes state. A leaked session leaks what the dashboard shows.
//   - operate: acts on a server or on the dashboard's own state in the ways
//     the tiles do all day. A leaked session can disrupt a server.
//   - admin: amounts to running code on the host, or writes what does (a JVM
//     argument, a jar path, a mod jar the server will load, an app setting, a
//     scheduler graph with HTTP and command blocks). Never dispatched without
//     the desktop's approval of that call; with no approver set, refused
//     (agent_docs/SECURITY_CHECKLIST.md § S8.2).
//
// A method with no tier is not remote-callable at all. The native-host methods
// (file dialogs, "open folder") are that, and so is SetActiveServerID, which
// would let a phone change what the desktop is looking at (§ S8.11).
type RemoteTier string

const (
	RemoteTierRead    RemoteTier = "read"
	RemoteTierOperate RemoteTier = "operate"
	RemoteTierAdmin   RemoteTier = "admin"
)

// RemoteMethod is one allowlist entry: the tier, and why the method sits there.
// The reason is required so the list reads as decisions rather than as a
// transcript of app.go.
type RemoteMethod struct {
	Tier   RemoteTier
	Reason string
}

var (
	ErrRemoteMethodUnknown    = errors.New("method is not remote-callable")
	ErrRemoteApprovalRequired = errors.New("method needs desktop approval")
	ErrRemoteBadArgs          = errors.New("bad arguments")
)

// RemoteDispatcher invokes allowlisted bound methods by name.
//
// It reflects over the one method the allowlist names for a call, never over
// the target as a whole: the constructor resolves each listed name once, and
// Invoke looks up that table. A method app.go binds but the list omits does
// not exist as far as a remote client can tell. remote_methods_test.go at the
// repo root is what keeps the list and app.go in step (§ S8.1): every bound
// method is classified there, one way or the other, or the test fails.
type RemoteDispatcher struct {
	methods map[string]remoteBoundMethod

	mu sync.RWMutex
	// approve gates admin calls. nil refuses every one of them.
	approve RemoteApprover
}

// RemoteApprovalRequest is one admin call as the desktop is asked about it:
// who is asking, for what, why that method is gated, and the arguments as
// sent. They have already been decoded once, so what the prompt shows is a
// call that would run.
type RemoteApprovalRequest struct {
	Device string
	Method string
	Reason string
	Args   []json.RawMessage
}

// RemoteApprover decides one admin call. nil allows it; an error refuses it
// and is what the caller is told. RemoteApprovals.Ask is the implementation.
type RemoteApprover func(ctx context.Context, req RemoteApprovalRequest) error

type remoteBoundMethod struct {
	fn      reflect.Value
	in      []reflect.Type
	tier    RemoteTier
	reason  string
	hasBody bool // returns (T, error) rather than just error
}

// NewRemoteDispatcher resolves every allowlisted name against target and
// refuses a list that names a method target lacks or a shape the bridge
// cannot carry, so a typo in the list fails at construction (and in the test
// that constructs it) rather than at the first call from a phone.
func NewRemoteDispatcher(target any, allow map[string]RemoteMethod) (*RemoteDispatcher, error) {
	tv := reflect.ValueOf(target)
	methods := make(map[string]remoteBoundMethod, len(allow))
	for name, entry := range allow {
		bound, err := resolveRemoteMethod(tv, name, entry)
		if err != nil {
			return nil, fmt.Errorf("remote allowlist: %s: %w", name, err)
		}
		methods[name] = bound
	}
	return &RemoteDispatcher{methods: methods}, nil
}

func resolveRemoteMethod(tv reflect.Value, name string, entry RemoteMethod) (remoteBoundMethod, error) {
	switch entry.Tier {
	case RemoteTierRead, RemoteTierOperate, RemoteTierAdmin:
	default:
		return remoteBoundMethod{}, fmt.Errorf("unknown tier %q", entry.Tier)
	}
	if entry.Reason == "" {
		return remoteBoundMethod{}, errors.New("no reason given")
	}
	fn := tv.MethodByName(name)
	if !fn.IsValid() {
		return remoteBoundMethod{}, errors.New("no such bound method")
	}
	ft := fn.Type()
	if ft.NumOut() == 0 || ft.NumOut() > 2 || ft.Out(ft.NumOut()-1) != errorType {
		return remoteBoundMethod{}, errors.New("must return error or (T, error)")
	}
	in := make([]reflect.Type, ft.NumIn())
	for i := range in {
		in[i] = ft.In(i)
		switch in[i].Kind() {
		case reflect.Func, reflect.Chan, reflect.UnsafePointer:
			return remoteBoundMethod{}, fmt.Errorf("parameter %d cannot be decoded from JSON", i)
		}
	}
	return remoteBoundMethod{fn: fn, in: in, tier: entry.Tier, reason: entry.Reason, hasBody: ft.NumOut() == 2}, nil
}

var errorType = reflect.TypeOf((*error)(nil)).Elem()

// Tier reports the allowlisted tier of a method, or false if it has none.
func (d *RemoteDispatcher) Tier(method string) (RemoteTier, bool) {
	m, ok := d.methods[method]
	return m.tier, ok
}

// MethodsInTier lists the allowlisted methods of one tier, sorted. The
// listener tells a signed-in browser which of its calls will wait on the
// desktop, so it can say so instead of looking hung.
func (d *RemoteDispatcher) MethodsInTier(tier RemoteTier) []string {
	var names []string
	for name, m := range d.methods {
		if m.tier == tier {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// SetApprover installs what admin calls wait on. Without one they are refused.
func (d *RemoteDispatcher) SetApprover(approve RemoteApprover) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.approve = approve
}

// Invoke calls one allowlisted method with JSON-encoded positional arguments,
// the shape the generated bindings send, and returns what it returned. An
// error from the method itself is returned as is; the sentinel errors above
// mark refusals that never reached it.
//
// device names the caller for an approval prompt, and ctx ends the wait for
// one. The arguments are decoded before the desktop is asked, so a call that
// could not run never puts a prompt on screen.
func (d *RemoteDispatcher) Invoke(ctx context.Context, device, method string, args []json.RawMessage) (any, error) {
	m, ok := d.methods[method]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrRemoteMethodUnknown, method)
	}
	if len(args) != len(m.in) {
		return nil, fmt.Errorf("%w: %s takes %d arguments, got %d", ErrRemoteBadArgs, method, len(m.in), len(args))
	}
	in := make([]reflect.Value, len(m.in))
	for i, t := range m.in {
		v := reflect.New(t)
		if err := json.Unmarshal(args[i], v.Interface()); err != nil {
			return nil, fmt.Errorf("%w: %s argument %d: %w", ErrRemoteBadArgs, method, i, err)
		}
		in[i] = v.Elem()
	}
	if m.tier == RemoteTierAdmin {
		d.mu.RLock()
		approve := d.approve
		d.mu.RUnlock()
		if approve == nil {
			return nil, fmt.Errorf("%w: %s", ErrRemoteApprovalRequired, method)
		}
		if err := approve(ctx, RemoteApprovalRequest{Device: device, Method: method, Reason: m.reason, Args: args}); err != nil {
			return nil, fmt.Errorf("%w: %s: %w", ErrRemoteApprovalRequired, method, err)
		}
	}
	out := m.fn.Call(in)
	var result any
	if m.hasBody {
		result = out[0].Interface()
	}
	if err, ok := out[len(out)-1].Interface().(error); ok && err != nil {
		return result, err
	}
	return result, nil
}
