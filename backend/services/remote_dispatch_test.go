package services

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
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

	got, err := d.Invoke("Echo", raw(`"hi"`))
	if err != nil || got != "echo:hi" {
		t.Errorf("Echo = %v, %v; want echo:hi", got, err)
	}
	got, err = d.Invoke("Add", raw(`2`, `3`))
	if err != nil || got != 5 {
		t.Errorf("Add = %v, %v; want 5", got, err)
	}
	got, err = d.Invoke("Struct", raw(`{"name":"x","n":7}`))
	if err != nil || got != (remoteArgs{Name: "x", N: 7}) {
		t.Errorf("Struct = %v, %v", got, err)
	}
	// A method that returns only an error yields no result.
	got, err = d.Invoke("Fail", nil)
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
	if _, err := d.Invoke("Hidden", nil); !errors.Is(err, ErrRemoteMethodUnknown) {
		t.Errorf("Hidden: got %v, want ErrRemoteMethodUnknown", err)
	}
	if _, err := d.Invoke("NoSuch", nil); !errors.Is(err, ErrRemoteMethodUnknown) {
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
// refused before the method runs; with one, its answer decides.
func TestRemoteDispatcherGatesAdminOnDesktopApproval(t *testing.T) {
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Invoke("Danger", nil); !errors.Is(err, ErrRemoteApprovalRequired) {
		t.Errorf("no approver: got %v, want ErrRemoteApprovalRequired", err)
	}
	d.approve = func(string) error { return errors.New("the desktop said no") }
	if _, err := d.Invoke("Danger", nil); !errors.Is(err, ErrRemoteApprovalRequired) || !strings.Contains(err.Error(), "said no") {
		t.Errorf("refusing approver: got %v", err)
	}
	if len(target.calls) != 0 {
		t.Fatalf("an unapproved admin call reached the target: %v", target.calls)
	}
	d.approve = func(string) error { return nil }
	if _, err := d.Invoke("Danger", nil); err != nil {
		t.Errorf("approved: got %v", err)
	}
	if len(target.calls) != 1 || target.calls[0] != "Danger" {
		t.Errorf("approved call did not reach the target once: %v", target.calls)
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
		if _, err := d.Invoke("Add", args); !errors.Is(err, ErrRemoteBadArgs) {
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
