package services

import (
	"bufio"
	"io"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// The tests here are #309: the save-off/save-all flush/save-on trio around a
// backup used to discard every error, so a dropped RCON connection produced a
// backup of an unflushed world reported as a success, and a failed save-on left
// autosave off with nothing said anywhere.

// rconServerLoop is fakeRconServer's multi-connection twin. Execute opens one
// connection per command and PrepareForBackup sends two or three, so a
// single-shot listener leaves the later dials parked on the 5s read deadline
// rather than failing. handler gets the 1-based connection number so a test can
// fail one particular command.
func rconServerLoop(t *testing.T, handler func(n int, conn net.Conn)) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for n := 1; ; n++ {
			conn, err := ln.Accept()
			if err != nil {
				return // listener closed by cleanup
			}
			go func(n int, c net.Conn) {
				defer c.Close()
				handler(n, c)
			}(n, conn)
		}
	}()
	return ln.Addr().String()
}

// rconRecorder serves the RCON protocol far enough to accept auth and read one
// command, recording it, and answers every command it does not refuse. Refused
// connection numbers hang up after auth, which is the mid-command drop #309
// describes.
type rconRecorder struct {
	mu     sync.Mutex
	got    []string
	refuse map[int]bool
}

func newRconRecorder(refuse ...int) *rconRecorder {
	r := &rconRecorder{refuse: map[int]bool{}}
	for _, n := range refuse {
		r.refuse[n] = true
	}
	return r
}

func (r *rconRecorder) serve(n int, conn net.Conn) {
	authID, _, _, err := readPacket(conn)
	if err != nil {
		return
	}
	if err := writePacket(conn, authID, rconPacketCommand, ""); err != nil {
		return
	}

	r.mu.Lock()
	refuse := r.refuse[n]
	r.mu.Unlock()
	if refuse {
		return // hang up before reading the command
	}

	cmdID, _, command, err := readPacket(conn)
	if err != nil {
		return
	}
	r.mu.Lock()
	r.got = append(r.got, command)
	r.mu.Unlock()
	_ = writePacket(conn, cmdID, 0, "")
}

// commands returns what actually reached RCON, waiting up to two seconds for n
// of them: each connection is served on its own goroutine, so a command can
// still be in flight when Execute has already returned.
func (r *rconRecorder) commands(t *testing.T, n int) []string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		r.mu.Lock()
		got := append([]string(nil), r.got...)
		r.mu.Unlock()
		if len(got) >= n || time.Now().After(deadline) {
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// runningInstance marks the fixture's instance running with a stdin a test can
// read back. fakeRunningServer drains stdin into io.Discard, which is right for
// the power-action tests and useless here: the whole question in #309 is which
// channel carried each command. No process and no waitForExit either — nothing
// below spawns or stops one.
//
// stdinLines reports what got through, so a test that calls breakStdin first
// sees an empty slice — which is how "neither channel worked" is staged.
func runningInstance(t *testing.T, s *ServerService) (stdinLines func() []string) {
	t.Helper()
	pr, pw := io.Pipe()

	var mu sync.Mutex
	var got []string
	done := make(chan struct{})
	go func() {
		defer close(done)
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			mu.Lock()
			got = append(got, sc.Text())
			mu.Unlock()
		}
	}()

	in := s.instanceFor(fixtureServerID)
	s.setCurrent(in)
	in.mu.Lock()
	in.stdin = pw
	in.running = true
	in.exited = make(chan struct{})
	in.state = stateRunning // direct write, not the setter: a fixture mirrors a ready boot without emitting
	in.mu.Unlock()

	t.Cleanup(func() {
		_ = pw.Close()
		<-done
	})

	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), got...)
	}
}

// breakStdin closes the write half so every later SendCommand fails, standing
// in for a server whose pipe has gone while the instance still believes it is
// running. Nothing in production closes stdin and leaves running set, but the
// window exists between the process dying and waitForExit noticing.
func breakStdin(t *testing.T, s *ServerService) {
	t.Helper()
	in := s.instanceFor(fixtureServerID)
	in.mu.Lock()
	stdin := in.stdin
	in.mu.Unlock()
	if wc, ok := stdin.(io.Closer); ok {
		_ = wc.Close()
	}
}

// enableRcon points the fixture's instance at addr. rconEnabled is normally
// read out of server.properties at start; there is no start here.
func enableRcon(s *ServerService, addr string) {
	s.SetRcon(NewRconService())
	in := s.instanceFor(fixtureServerID)
	in.mu.Lock()
	in.rconEnabled = true
	in.rconAddr = addr
	in.rconPassword = "secret"
	in.mu.Unlock()
}

// The first half of #309: RCON drops after auth, so save-off never lands. The
// quiesce must carry the same command over stdin instead of returning a
// success it did not earn.
func TestPrepareForBackupFallsBackToStdinWhenRconDrops(t *testing.T) {
	s, _ := newServerFixture()
	stdinLines := runningInstance(t, s)
	rec := newRconRecorder(1, 2) // both save commands hang up after auth
	enableRcon(s, rconServerLoop(t, rec.serve))
	curInst(s).quiesceWait = time.Millisecond

	paused, err := s.PrepareForBackup(fixtureServerID)
	if err != nil {
		t.Fatalf("PrepareForBackup with a working stdin = %v, want no error", err)
	}
	if !paused {
		t.Fatal("PrepareForBackup = false, want true: stdin carried the quiesce")
	}

	want := []string{"save-off", "save-all flush"}
	got := stdinLines()
	if len(got) != len(want) {
		t.Fatalf("stdin saw %v, want %v", got, want)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("stdin line %d = %q, want %q", i, got[i], w)
		}
	}

	// And it says why it is waiting, since a configured RCON that failed is a
	// different situation from one that was never set up.
	if lines := strings.Join(consoleLines(s), "\n"); !strings.Contains(lines, "RCON did not answer") {
		t.Errorf("console = %q, want it to say RCON did not answer", lines)
	}
}

// The second half: with neither channel working there is no quiesce, so the
// copy would come off a live world. That is refused rather than reported as a
// success.
func TestPrepareForBackupRefusesWhenNeitherChannelWorks(t *testing.T) {
	s, _ := newServerFixture()
	runningInstance(t, s)
	rec := newRconRecorder(1, 2)
	enableRcon(s, rconServerLoop(t, rec.serve))
	breakStdin(t, s)

	paused, err := s.PrepareForBackup(fixtureServerID)
	if err == nil {
		t.Fatal("PrepareForBackup with both channels dead = nil error, want a refusal")
	}
	if paused {
		t.Error("PrepareForBackup = true after refusing, want false")
	}
	if !strings.Contains(err.Error(), "save-off") {
		t.Errorf("error = %q, want it to name the command that failed", err)
	}
	if !strings.Contains(err.Error(), "rcon") || !strings.Contains(err.Error(), "stdin") {
		t.Errorf("error = %q, want it to name both channels it tried", err)
	}
	if lines := strings.Join(consoleLines(s), "\n"); !strings.Contains(lines, "Could not pause world saves") {
		t.Errorf("console = %q, want the refusal said out loud", lines)
	}
}

// The half of a refusal that is easy to miss: save-off can land and the flush
// after it fail, and returning at that point would leave autosave off with the
// backup refused, which is the original bug wearing a different hat.
func TestPrepareForBackupPutsSavingBackWhenTheFlushFails(t *testing.T) {
	s, _ := newServerFixture()
	runningInstance(t, s)
	rec := newRconRecorder(2) // save-off lands, save-all flush hangs up
	enableRcon(s, rconServerLoop(t, rec.serve))
	breakStdin(t, s)

	if _, err := s.PrepareForBackup(fixtureServerID); err == nil {
		t.Fatal("PrepareForBackup with a failed flush = nil error, want a refusal")
	}

	got := rec.commands(t, 2)
	want := []string{"save-off", "save-on"}
	if len(got) != len(want) {
		t.Fatalf("rcon saw %v, want %v", got, want)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("rcon command %d = %q, want %q", i, got[i], w)
		}
	}
}

// A failed save-on is the failure that outlives the backup: autosave is off
// and stays off until the server restarts, and nothing the user does next says
// so. It gets its own event because the archive itself may be perfectly good.
func TestResumeSavesAnnouncesAStuckAutosave(t *testing.T) {
	s, bus := newServerFixture()
	runningInstance(t, s)
	breakStdin(t, s)

	stuck := make(chan map[string]interface{}, 1)
	bus.Subscribe(EventAutosaveStuck, func(data any) {
		payload, _ := data.(map[string]interface{})
		stuck <- payload
	})

	if err := s.ResumeSaves(fixtureServerID); err == nil {
		t.Fatal("ResumeSaves with a dead stdin = nil error, want an error")
	}

	select {
	case p := <-stuck:
		if p["serverID"] != fixtureServerID {
			t.Errorf("event serverID = %v, want %q", p["serverID"], fixtureServerID)
		}
		if msg, _ := p["error"].(string); msg == "" {
			t.Error("event carries no error text")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("no %s event", EventAutosaveStuck)
	}

	if lines := strings.Join(consoleLines(s), "\n"); !strings.Contains(lines, "autosave is still off") {
		t.Errorf("console = %q, want it to say autosave is still off", lines)
	}
}

// A backup that cannot quiesce fails, and fails the way every other backup
// failure does: the reserved archive is removed rather than left as a
// zero-byte file the tile would list.
func TestCreateBackupRefusesWhenTheQuiesceFails(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	failed := subscribeFailed(t, svc, EventBackupFailed)
	svc.server.SetBus(svc.bus)
	runningInstance(t, svc.server)
	breakStdin(t, svc.server)

	if _, err := svc.CreateBackup(testServerID); err == nil {
		t.Fatal("CreateBackup with a failed quiesce = nil error, want a refusal")
	}

	payload := awaitFailed(t, failed, EventBackupFailed)
	if msg, _ := payload["error"].(string); !strings.Contains(msg, "pause world saves") {
		t.Errorf("backup:failed error = %q, want it to name the quiesce", msg)
	}

	backups, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatalf("ListBackups error: %v", err)
	}
	if len(backups) != 0 {
		t.Errorf("ListBackups = %v, want the reserved archive removed", backups)
	}
}
