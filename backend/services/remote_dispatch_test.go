package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// remoteTarget stands in for App: a few methods in the shapes the bridge
// carries, and a few it must refuse at construction.
type remoteTarget struct {
	calls []string
}

func (r *remoteTarget) Echo(s string) (string, error) {
	r.calls = append(r.calls, "Echo")
	return "echo:" + s, nil
}

func (r *remoteTarget) Add(a, b int) (int, error) { return a + b, nil }

func (r *remoteTarget) Fail() error { return errors.New("it failed") }

func (r *remoteTarget) Danger() error {
	r.calls = append(r.calls, "Danger")
	return nil
}

func (r *remoteTarget) DangerWith(what string) error {
	r.calls = append(r.calls, "DangerWith:"+what)
	return nil
}

func (r *remoteTarget) Hidden() error {
	r.calls = append(r.calls, "Hidden")
	return nil
}

func (r *remoteTarget) NoError() string { return "" }

func (r *remoteTarget) Callback(fn func()) error { return nil }

type remoteArgs struct {
	Name string `json:"name"`
	N    int    `json:"n"`
}

func (r *remoteTarget) Struct(a remoteArgs) (remoteArgs, error) { return a, nil }

var remoteTargetAllow = map[string]RemoteMethod{
	"Echo":   {Tier: RemoteTierRead, Reason: "test"},
	"Add":    {Tier: RemoteTierRead, Reason: "test"},
	"Fail":   {Tier: RemoteTierOperate, Reason: "test"},
	"Danger": {Tier: RemoteTierAdmin, Reason: "test"},
	"DangerWith": {Tier: RemoteTierAdmin,
		Reason: "runs what it is given"},
	"Struct": {Tier: RemoteTierRead, Reason: "test"},
}

func raw(vals ...string) []json.RawMessage {
	out := make([]json.RawMessage, len(vals))
	for i, v := range vals {
		out[i] = json.RawMessage(v)
	}
	return out
}

func TestRemoteDispatcherInvokesAllowlistedMethodsWithDecodedArguments(t *testing.T) {
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}

	got, err := d.Invoke(context.Background(), "phone", "Echo", raw(`"hi"`))
	if err != nil || got != "echo:hi" {
		t.Errorf("Echo = %v, %v; want echo:hi", got, err)
	}
	got, err = d.Invoke(context.Background(), "phone", "Add", raw(`2`, `3`))
	if err != nil || got != 5 {
		t.Errorf("Add = %v, %v; want 5", got, err)
	}
	got, err = d.Invoke(context.Background(), "phone", "Struct", raw(`{"name":"x","n":7}`))
	if err != nil || got != (remoteArgs{Name: "x", N: 7}) {
		t.Errorf("Struct = %v, %v", got, err)
	}
	// A method that returns only an error yields no result.
	got, err = d.Invoke(context.Background(), "phone", "Fail", nil)
	if got != nil || err == nil || err.Error() != "it failed" {
		t.Errorf("Fail = %v, %v; want nil, the method's own error", got, err)
	}
}

func TestRemoteDispatcherRefusesWhatTheAllowlistOmits(t *testing.T) {
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	// Hidden is a real, exported method on the target and is not reachable:
	// the allowlist is the surface, not the type.
	if _, err := d.Invoke(context.Background(), "phone", "Hidden", nil); !errors.Is(err, ErrRemoteMethodUnknown) {
		t.Errorf("Hidden: got %v, want ErrRemoteMethodUnknown", err)
	}
	if _, err := d.Invoke(context.Background(), "phone", "NoSuch", nil); !errors.Is(err, ErrRemoteMethodUnknown) {
		t.Errorf("NoSuch: got %v, want ErrRemoteMethodUnknown", err)
	}
	if _, ok := d.Tier("Hidden"); ok {
		t.Error("Tier reports Hidden as reachable")
	}
	if len(target.calls) != 0 {
		t.Errorf("a refused call reached the target: %v", target.calls)
	}
}

// § S8.2: admin waits for the desktop. With no approver every admin call is
// refused before the method runs; with one, its answer decides. Run against a
// stub and against RemoteApprovals, the implementation the app wires (#462).
func TestRemoteDispatcherGatesAdminOnDesktopApproval(t *testing.T) {
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := d.Invoke(ctx, "phone", "Danger", nil); !errors.Is(err, ErrRemoteApprovalRequired) {
		t.Errorf("no approver: got %v, want ErrRemoteApprovalRequired", err)
	}

	t.Run("stub", func(t *testing.T) {
		d.SetApprover(func(context.Context, RemoteApprovalRequest) error { return errors.New("the desktop said no") })
		if _, err := d.Invoke(ctx, "phone", "Danger", nil); !errors.Is(err, ErrRemoteApprovalRequired) || !strings.Contains(err.Error(), "said no") {
			t.Errorf("refusing approver: got %v", err)
		}
		if len(target.calls) != 0 {
			t.Fatalf("an unapproved admin call reached the target: %v", target.calls)
		}
		var asked RemoteApprovalRequest
		d.SetApprover(func(_ context.Context, req RemoteApprovalRequest) error {
			asked = req
			return nil
		})
		if _, err := d.Invoke(ctx, "phone", "DangerWith", raw(`"rm"`)); err != nil {
			t.Errorf("approved: got %v", err)
		}
		if len(target.calls) != 1 || target.calls[0] != "DangerWith:rm" {
			t.Errorf("approved call did not reach the target once: %v", target.calls)
		}
		// The prompt needs all four to be a decision about this call.
		if asked.Device != "phone" || asked.Method != "DangerWith" || asked.Reason != "runs what it is given" ||
			len(asked.Args) != 1 || string(asked.Args[0]) != `"rm"` {
			t.Errorf("approver was asked %+v", asked)
		}
	})

	t.Run("RemoteApprovals", func(t *testing.T) {
		target.calls = nil
		approvals := NewRemoteApprovals()
		d.SetApprover(approvals.Ask)
		answer := func(allow bool) {
			t.Helper()
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				if pending := approvals.Pending(); len(pending) == 1 {
					if err := approvals.Answer(pending[0].ID, allow); err != nil {
						t.Error(err)
					}
					return
				}
				time.Sleep(time.Millisecond)
			}
			t.Error("the call never reached the desktop")
		}
		go answer(false)
		if _, err := d.Invoke(ctx, "phone", "Danger", nil); !errors.Is(err, ErrRemoteApprovalRequired) || !errors.Is(err, ErrRemoteApprovalDenied) {
			t.Errorf("declined on the desktop: got %v", err)
		}
		if len(target.calls) != 0 {
			t.Fatalf("a declined admin call reached the target: %v", target.calls)
		}
		go answer(true)
		if _, err := d.Invoke(ctx, "phone", "Danger", nil); err != nil {
			t.Errorf("allowed on the desktop: got %v", err)
		}
		if len(target.calls) != 1 || target.calls[0] != "Danger" {
			t.Errorf("allowed call did not reach the target once: %v", target.calls)
		}
	})
}

// A call that could not run never asks: the arguments are decoded before the
// desktop is, so a malformed admin call is a 400 and not a prompt (#462).
func TestRemoteDispatcherDecodesBeforeItAsks(t *testing.T) {
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	asked := 0
	d.SetApprover(func(context.Context, RemoteApprovalRequest) error {
		asked++
		return nil
	})
	for _, args := range [][]json.RawMessage{nil, raw(`1`, `2`), raw(`{"not":"a string"}`)} {
		if _, err := d.Invoke(context.Background(), "phone", "DangerWith", args); !errors.Is(err, ErrRemoteBadArgs) {
			t.Errorf("args %s: got %v, want ErrRemoteBadArgs", args, err)
		}
	}
	if asked != 0 {
		t.Errorf("the desktop was asked %d times about calls that could not run", asked)
	}
	if len(target.calls) != 0 {
		t.Errorf("target saw %v", target.calls)
	}
}

func TestRemoteDispatcherRefusesBadArguments(t *testing.T) {
	d, err := NewRemoteDispatcher(&remoteTarget{}, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]json.RawMessage{
		"too few":    raw(`1`),
		"too many":   raw(`1`, `2`, `3`),
		"wrong type": raw(`"a"`, `"b"`),
		"malformed":  raw(`{`, `2`),
	}
	for name, args := range cases {
		if _, err := d.Invoke(context.Background(), "phone", "Add", args); !errors.Is(err, ErrRemoteBadArgs) {
			t.Errorf("%s: got %v, want ErrRemoteBadArgs", name, err)
		}
	}
}

func TestNewRemoteDispatcherRefusesAListItCannotHonour(t *testing.T) {
	cases := map[string]map[string]RemoteMethod{
		"unbound method":      {"NoSuch": {Tier: RemoteTierRead, Reason: "typo"}},
		"unknown tier":        {"Echo": {Tier: "root", Reason: "x"}},
		"no reason":           {"Echo": {Tier: RemoteTierRead}},
		"no error return":     {"NoError": {Tier: RemoteTierRead, Reason: "x"}},
		"undecodable param":   {"Callback": {Tier: RemoteTierRead, Reason: "x"}},
		"unexported receiver": {"calls": {Tier: RemoteTierRead, Reason: "x"}},
	}
	for name, allow := range cases {
		if _, err := NewRemoteDispatcher(&remoteTarget{}, allow); err == nil {
			t.Errorf("%s: constructed; want an error", name)
		}
	}
}
