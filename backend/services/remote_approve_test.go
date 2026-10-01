package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The desktop's approval of admin-tier calls (#462) against
// agent_docs/SECURITY_CHECKLIST.md § S8.2 and § S8.9.

func approvalRequest(device string) RemoteApprovalRequest {
	return RemoteApprovalRequest{
		Device: device, Method: "SaveServerConfig", Reason: "JVM arguments become a process",
		Args: []json.RawMessage{json.RawMessage(`{"jvmArgs":"-Xmx4G secret-flag"}`)},
	}
}

// waitForPending returns the one call waiting on the desktop.
func waitForPending(t *testing.T, a *RemoteApprovals) string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if pending := a.Pending(); len(pending) == 1 {
			return pending[0].ID
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("no call reached the desktop")
	return ""
}

// ask runs Ask on its own goroutine, the way the RPC handler's would.
func ask(a *RemoteApprovals, ctx context.Context, device string) <-chan error {
	done := make(chan error, 1)
	go func() { done <- a.Ask(ctx, approvalRequest(device)) }()
	return done
}

func result(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("Ask never returned")
		return nil
	}
}

// § S8.2: the call waits, the desktop sees who asked for what with the
// arguments as sent, and the answer decides.
func TestRemoteApprovalWaitsForTheDesktopsAnswer(t *testing.T) {
	a := NewRemoteApprovals()
	done := ask(a, context.Background(), "Phone")
	id := waitForPending(t, a)
	p := a.Pending()[0]
	if p.Device != "Phone" || p.Method != "SaveServerConfig" || p.Reason != "JVM arguments become a process" {
		t.Errorf("the prompt shows %+v", p)
	}
	if len(p.Args) != 1 || p.Args[0] != `{"jvmArgs":"-Xmx4G secret-flag"}` {
		t.Errorf("the prompt's arguments are %q, want them as sent", p.Args)
	}
	if p.ExpiresAt-p.RequestedAt != remoteApprovalTimeout.Milliseconds() {
		t.Errorf("the prompt expires %d ms after it was asked", p.ExpiresAt-p.RequestedAt)
	}
	if err := a.Answer(id, true); err != nil {
		t.Fatal(err)
	}
	if err := result(t, done); err != nil {
		t.Errorf("allowed: got %v", err)
	}
	if len(a.Pending()) != 0 {
		t.Error("an answered call is still listed")
	}

	done = ask(a, context.Background(), "Phone")
	if err := a.Answer(waitForPending(t, a), false); err != nil {
		t.Fatal(err)
	}
	if err := result(t, done); !errors.Is(err, ErrRemoteApprovalDenied) {
		t.Errorf("declined: got %v", err)
	}
}

// § S8.2: no answer is a no, and a phone that hangs up withdraws its prompt.
func TestRemoteApprovalTimesOutToRefusal(t *testing.T) {
	a := NewRemoteApprovals()
	a.timeout = 20 * time.Millisecond
	if err := result(t, ask(a, context.Background(), "Phone")); !errors.Is(err, ErrRemoteApprovalTimeout) {
		t.Errorf("nobody at the desktop: got %v", err)
	}
	if len(a.Pending()) != 0 {
		t.Error("a timed-out call is still listed")
	}

	a.timeout = time.Minute
	ctx, cancel := context.WithCancel(context.Background())
	done := ask(a, ctx, "Phone")
	id := waitForPending(t, a)
	cancel()
	if err := result(t, done); !errors.Is(err, ErrRemoteApprovalCanceled) {
		t.Errorf("the phone hung up: got %v", err)
	}
	if err := a.Answer(id, true); !errors.Is(err, ErrRemoteApprovalGone) {
		t.Errorf("answering a withdrawn call: got %v", err)
	}
}

// One call, one answer: a second click on the same prompt is told it is gone,
// and so is an id that never existed.
func TestRemoteApprovalIsAnsweredOnce(t *testing.T) {
	a := NewRemoteApprovals()
	done := ask(a, context.Background(), "Phone")
	id := waitForPending(t, a)
	if err := a.Answer(id, true); err != nil {
		t.Fatal(err)
	}
	if err := a.Answer(id, false); !errors.Is(err, ErrRemoteApprovalGone) {
		t.Errorf("second answer: got %v", err)
	}
	if err := result(t, done); err != nil {
		t.Errorf("the first answer should stand: got %v", err)
	}
	if err := a.Answer("nope", true); !errors.Is(err, ErrRemoteApprovalGone) {
		t.Errorf("unknown id: got %v", err)
	}
}

// A stolen session cannot bury the desktop in prompts: one waiting per device,
// refused at once rather than queued, and a ceiling across devices.
func TestRemoteApprovalPromptsAreBounded(t *testing.T) {
	a := NewRemoteApprovals()
	first := ask(a, context.Background(), "Phone")
	id := waitForPending(t, a)
	if err := a.Ask(context.Background(), approvalRequest("Phone")); !errors.Is(err, ErrRemoteApprovalBusy) {
		t.Errorf("a second call from the same device: got %v", err)
	}

	waiting := []<-chan error{first}
	for _, device := range []string{"Tablet", "Laptop", "Other"} {
		waiting = append(waiting, ask(a, context.Background(), device))
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(a.Pending()) < remoteMaxApprovals && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if err := a.Ask(context.Background(), approvalRequest("Fifth")); !errors.Is(err, ErrRemoteApprovalFull) {
		t.Errorf("a call past the ceiling: got %v", err)
	}

	if err := a.Answer(id, false); err != nil {
		t.Fatal(err)
	}
	for _, p := range a.Pending() {
		if err := a.Answer(p.ID, false); err != nil {
			t.Error(err)
		}
	}
	for _, done := range waiting {
		if err := result(t, done); !errors.Is(err, ErrRemoteApprovalDenied) {
			t.Errorf("got %v", err)
		}
	}
	// The device is free to ask again once its call is answered.
	again := ask(a, context.Background(), "Phone")
	if err := a.Answer(waitForPending(t, a), true); err != nil {
		t.Fatal(err)
	}
	if err := result(t, again); err != nil {
		t.Errorf("asking again after an answer: got %v", err)
	}
}

// The desktop is told when a prompt appears and when it goes.
func TestRemoteApprovalTellsTheDesktopOfChanges(t *testing.T) {
	a := NewRemoteApprovals()
	var changes atomic.Int32
	a.OnChange(func() { changes.Add(1) })
	done := ask(a, context.Background(), "Phone")
	id := waitForPending(t, a)
	if changes.Load() != 1 {
		t.Errorf("%d changes after a call arrived, want 1", changes.Load())
	}
	if err := a.Answer(id, true); err != nil {
		t.Fatal(err)
	}
	if err := result(t, done); err != nil {
		t.Fatal(err)
	}
	if changes.Load() != 2 {
		t.Errorf("%d changes after the answer, want 2", changes.Load())
	}
}

// § S8.9: the log names the method and the device, and never an argument.
func TestRemoteApprovalLogsNoArgument(t *testing.T) {
	logs := captureLog(t)
	a := NewRemoteApprovals()
	done := ask(a, context.Background(), "Phone")
	if err := a.Answer(waitForPending(t, a), true); err != nil {
		t.Fatal(err)
	}
	if err := result(t, done); err != nil {
		t.Fatal(err)
	}
	all := strings.Join(logs.all(), "\n")
	if !strings.Contains(all, "remote: approval asked method=SaveServerConfig device=Phone") {
		t.Errorf("no line names the method and the device:\n%s", all)
	}
	if !strings.Contains(all, "allowed=true") {
		t.Errorf("the answer is not logged:\n%s", all)
	}
	if strings.Contains(all, "secret-flag") || strings.Contains(all, "jvmArgs") {
		t.Errorf("an argument reached the log:\n%s", all)
	}
}

// #462's done-when: a phone that asks for an admin method gets a 403 within
// the timeout when nobody is at the desktop, and the method never ran.
func TestRemoteAdminCallIsRefusedWhenNobodyAnswers(t *testing.T) {
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	approvals := NewRemoteApprovals()
	approvals.timeout = 30 * time.Millisecond
	d.SetApprover(approvals.Ask)
	s := NewRemoteService(NewEventBus(), d)
	s.AllowHost(testHost)
	s.SetAuthorizer(stubAuthorizer{device: "phone"})

	started := time.Now()
	w := do(s.Handler(), rpcRequest("DangerWith", `{"method":"DangerWith","args":["rm"]}`))
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403 (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}
	if waited := time.Since(started); waited > 2*time.Second {
		t.Errorf("the refusal took %s", waited)
	}
	if !strings.Contains(w.Body.String(), ErrRemoteApprovalTimeout.Error()) {
		t.Errorf("the phone is not told why: %s", w.Body.String())
	}
	if len(target.calls) != 0 {
		t.Errorf("the method ran: %v", target.calls)
	}
}
