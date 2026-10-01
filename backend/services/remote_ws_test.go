package services

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// The WebSocket mirror: numbered, ordered, replayable.

func startRemote(t *testing.T) (*RemoteService, *EventBus, string) {
	t.Helper()
	bus := NewEventBus()
	d, err := NewRemoteDispatcher(&remoteTarget{}, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	s := NewRemoteService(bus, d)
	s.SetAuthorizer(stubAuthorizer{device: "phone"})
	addr, err := s.Start(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	return s, bus, addr
}

// newTestHub is a hub on a run of its own, as Start leaves the service's.
func newTestHub(t *testing.T, capacity int) *remoteHub {
	t.Helper()
	hub := newRemoteHub(capacity)
	if err := hub.newRun(); err != nil {
		t.Fatal(err)
	}
	return hub
}

func runOf(s *RemoteService) string {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	return s.hub.run
}

// dialWS opens the socket the way the client does: since and the run it was
// numbered in travel together, and since 0 sends neither.
func dialWS(t *testing.T, addr string, since uint64, run, origin string) *websocket.Conn {
	t.Helper()
	url := "ws://" + addr + "/ws"
	if since > 0 {
		url += "?since=" + strconv.FormatUint(since, 10)
		if run != "" {
			url += "&run=" + run
		}
	}
	conn, resp, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": {origin}})
	if err != nil {
		code := 0
		if resp != nil {
			code = resp.StatusCode
		}
		t.Fatalf("dial %s: %v (status %d)", url, err, code)
	}
	t.Cleanup(func() {
		if err := conn.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			t.Log(err)
		}
	})
	return conn
}

func readFrame(t *testing.T, conn *websocket.Conn) remoteFrame {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var f remoteFrame
	if err := conn.ReadJSON(&f); err != nil {
		t.Fatalf("read frame: %v", err)
	}
	return f
}

func waitForClients(t *testing.T, s *RemoteService, n int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for s.ClientCount() != n && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if s.ClientCount() != n {
		t.Fatalf("ClientCount = %d, want %d", s.ClientCount(), n)
	}
}

func TestRemoteSocketMirrorsTheBusInOrder(t *testing.T) {
	s, bus, addr := startRemote(t)
	conn := dialWS(t, addr, 0, "", "http://"+addr)

	hello := readFrame(t, conn)
	if hello.Event != remoteHelloEvent || hello.Seq != 0 {
		t.Fatalf("first frame %+v, want a hello at seq 0", hello)
	}
	waitForClients(t, s, 1)

	for i := range 50 {
		bus.Emit(EventLogLine, map[string]any{"serverID": "s1", "line": "l" + strconv.Itoa(i)})
	}
	for i := range 50 {
		f := readFrame(t, conn)
		if f.Seq != uint64(i+1) || f.Event != EventLogLine {
			t.Fatalf("frame %d: seq %d event %s", i, f.Seq, f.Event)
		}
		var payload map[string]string
		if err := json.Unmarshal(f.Data, &payload); err != nil || payload["line"] != "l"+strconv.Itoa(i) {
			t.Fatalf("frame %d carries %s (%v)", i, f.Data, err)
		}
	}
}

func TestRemoteSocketReplaysWhatAReconnectMissed(t *testing.T) {
	s, bus, addr := startRemote(t)
	for i := 1; i <= 10; i++ {
		bus.Emit(EventServerStatus, map[string]any{"serverID": "s1", "n": i})
	}
	// A client that saw 7 gets 8, 9 and 10, then the live stream.
	conn := dialWS(t, addr, 7, runOf(s), "http://"+addr)
	hello := readFrame(t, conn)
	var h remoteHello
	if err := json.Unmarshal(hello.Data, &h); err != nil {
		t.Fatal(err)
	}
	if hello.Seq != 10 || h.Replayed != 3 || h.Gap {
		t.Fatalf("hello %+v %+v; want seq 10, 3 replayed, no gap", hello, h)
	}
	for want := uint64(8); want <= 10; want++ {
		if f := readFrame(t, conn); f.Seq != want {
			t.Fatalf("replayed seq %d, want %d", f.Seq, want)
		}
	}
	bus.Emit(EventServerStatus, map[string]any{"serverID": "s1", "n": 11})
	if f := readFrame(t, conn); f.Seq != 11 {
		t.Fatalf("live seq %d after replay, want 11", f.Seq)
	}

	// A client that saw nothing yet asks for nothing: a fresh page primes
	// itself from the getters.
	fresh := dialWS(t, addr, 0, "", "http://"+addr)
	f := readFrame(t, fresh)
	if f.Seq != 11 || f.Event != remoteHelloEvent {
		t.Fatalf("fresh hello %+v", f)
	}
	var fh remoteHello
	if err := json.Unmarshal(f.Data, &fh); err != nil || fh.Replayed != 0 {
		t.Fatalf("fresh client was replayed %d frames", fh.Replayed)
	}
}

func TestRemoteReplayReportsAGapPastTheBuffer(t *testing.T) {
	hub := newTestHub(t, 5)
	for i := range 8 {
		hub.publish("e", i)
	}
	// Buffer holds 4..8. A client that saw 2 cannot be made whole.
	frames, latest, gap, _ := hub.replay(2, hub.run)
	if latest != 8 || !gap || len(frames) != 5 || frames[0].Seq != 4 {
		t.Errorf("replay(2) = %d frames from %d, latest %d, gap %v", len(frames), frames[0].Seq, latest, gap)
	}
	// A client that saw 3 missed exactly what the buffer holds: no gap.
	if frames, _, gap, _ := hub.replay(3, hub.run); gap || len(frames) != 5 {
		t.Errorf("replay(3) = %d frames, gap %v; want 5 and no gap", len(frames), gap)
	}
	if frames, _, gap, _ := hub.replay(8, hub.run); gap || len(frames) != 0 {
		t.Errorf("replay(8) = %d frames, gap %v; want nothing", len(frames), gap)
	}
	if frames, latest, gap, _ := hub.replay(0, hub.run); gap || len(frames) != 0 || latest != 8 {
		t.Errorf("replay(0) = %d frames, latest %d, gap %v; want only the latest", len(frames), latest, gap)
	}
}

// A since the hub cannot answer for is a gap, never a silent nothing: the
// numbering restarts at 0 per process, so a client from the previous run holds
// a number from another sequence, and Stop empties the buffer without
// resetting it.
func TestRemoteReplayReportsAGapItCannotAnswerFor(t *testing.T) {
	hub := newTestHub(t, 5)
	for i := range 3 {
		hub.publish("e", i)
	}
	// A client from a previous run saw 40; this run is at 3.
	if frames, latest, gap, _ := hub.replay(40, hub.run); !gap || len(frames) != 0 || latest != 3 {
		t.Errorf("replay(40) = %d frames, latest %d, gap %v; want none, 3 and a gap", len(frames), latest, gap)
	}
	// A client that is current has missed nothing.
	if frames, _, gap, _ := hub.replay(3, hub.run); gap || len(frames) != 0 {
		t.Errorf("replay(3) = %d frames, gap %v; want nothing and no gap", len(frames), gap)
	}
	// A client of another run holds a number that means nothing here.
	if frames, _, gap, _ := hub.replay(2, "otherrun"); !gap || len(frames) != 0 {
		t.Errorf("replay(2, other run) = %d frames, gap %v; want none and a gap", len(frames), gap)
	}
	// closeAll empties the ring but not the numbering: what a client at 1 missed
	// is gone.
	hub.closeAll()
	if frames, latest, gap, _ := hub.replay(1, hub.run); !gap || len(frames) != 0 || latest != 3 {
		t.Errorf("replay(1) after closeAll = %d frames, latest %d, gap %v; want none, 3 and a gap", len(frames), latest, gap)
	}
}

// A replay that cannot be queued ahead of writePump must be answered with a
// gap, not a closed socket: the client would reconnect with the same since and
// fail the same way forever.
func TestRemoteSocketAnswersAnOversizedReplayWithAGap(t *testing.T) {
	s, bus, addr := startRemote(t)
	total := remoteSendBuffer + 44
	for i := range total {
		bus.Emit(EventLogLine, map[string]any{"serverID": "s1", "line": "l" + strconv.Itoa(i)})
	}
	conn := dialWS(t, addr, 1, runOf(s), "http://"+addr)
	hello := readFrame(t, conn)
	var h remoteHello
	if err := json.Unmarshal(hello.Data, &h); err != nil {
		t.Fatal(err)
	}
	if hello.Event != remoteHelloEvent || hello.Seq != uint64(total) || h.Replayed != 0 || !h.Gap {
		t.Fatalf("hello %+v %+v; want seq %d, nothing replayed and a gap", hello, h, total)
	}
	// The socket stayed open and went live.
	bus.Emit(EventLogLine, map[string]any{"serverID": "s1", "line": "live"})
	if f := readFrame(t, conn); f.Seq != uint64(total+1) {
		t.Fatalf("live seq %d after the gap hello, want %d", f.Seq, total+1)
	}

	// The largest replay that fits is still replayed.
	fits := dialWS(t, addr, uint64(total+1-(remoteSendBuffer-1)), runOf(s), "http://"+addr)
	var fh remoteHello
	if err := json.Unmarshal(readFrame(t, fits).Data, &fh); err != nil {
		t.Fatal(err)
	}
	if fh.Replayed != remoteSendBuffer-1 || fh.Gap {
		t.Fatalf("a replay of %d frames: hello %+v; want it replayed whole", remoteSendBuffer-1, fh)
	}
}

// § S8.3 over the wire: gorilla's upgrader sees the same allowlist the guard
// does, so a foreign Origin never reaches the socket.
func TestRemoteSocketRefusesAForeignOriginOverTheWire(t *testing.T) {
	_, _, addr := startRemote(t)
	_, resp, err := websocket.DefaultDialer.Dial("ws://"+addr+"/ws", http.Header{"Origin": {"http://evil.example"}})
	if err == nil {
		t.Fatal("dial with a foreign Origin succeeded")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status %v, want 403", resp)
	}
}

// Stop closes every socket and empties the buffer, so a client of the next
// run is never replayed the last one's events.
func TestRemoteStopClosesSocketsAndForgetsTheBuffer(t *testing.T) {
	bus := NewEventBus()
	d, err := NewRemoteDispatcher(&remoteTarget{}, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	s := NewRemoteService(bus, d)
	s.SetAuthorizer(stubAuthorizer{device: "phone"})
	addr, err := s.Start(0)
	if err != nil {
		t.Fatal(err)
	}
	conn := dialWS(t, addr, 0, "", "http://"+addr)
	readFrame(t, conn)
	waitForClients(t, s, 1)
	oldRun := runOf(s)
	bus.Emit(EventLogLine, map[string]any{"serverID": "s1", "line": "before stop"})
	readFrame(t, conn)

	if err := s.Stop(); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("socket still open after Stop")
	}
	// Emitted while stopped: not buffered.
	bus.Emit(EventLogLine, map[string]any{"serverID": "s1", "line": "while stopped"})

	addr, err = s.Start(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	// The client was fully caught up (since 1 is the latest number, and the
	// line emitted while stopped was never numbered), which is exactly the case
	// a bare sequence number cannot catch. The run id does.
	again := dialWS(t, addr, 1, oldRun, "http://"+addr)
	hello := readFrame(t, again)
	var h remoteHello
	if err := json.Unmarshal(hello.Data, &h); err != nil {
		t.Fatal(err)
	}
	if hello.Seq != 1 {
		t.Fatalf("hello seq %d, want 1: the sequence stays monotonic across Stop and Start", hello.Seq)
	}
	if h.Replayed != 0 || !h.Gap || h.Run == "" || h.Run == oldRun {
		t.Errorf("hello %+v after a restart; want a gap, nothing replayed and a new run (old %s)", h, oldRun)
	}
}

// Whether a since belongs to this run is the server's call: a run that is
// missing or wrong is a gap even when the number is in range, and the right
// run replays.
func TestRemoteSocketDecidesWhetherASinceBelongsToThisRun(t *testing.T) {
	s, bus, addr := startRemote(t)
	for i := 1; i <= 10; i++ {
		bus.Emit(EventServerStatus, map[string]any{"serverID": "s1", "n": i})
	}
	hello := func(since uint64, run string) remoteHello {
		t.Helper()
		var h remoteHello
		if err := json.Unmarshal(readFrame(t, dialWS(t, addr, since, run, "http://"+addr)).Data, &h); err != nil {
			t.Fatal(err)
		}
		return h
	}
	run := runOf(s)
	if h := hello(7, run); h.Replayed != 3 || h.Gap || h.Run != run {
		t.Errorf("the right run: %+v; want 3 replayed, no gap, run %s", h, run)
	}
	for name, wrong := range map[string]string{"missing": "", "wrong": "0123456789abcdef"} {
		if h := hello(7, wrong); h.Replayed != 0 || !h.Gap || h.Run != run {
			t.Errorf("a %s run: %+v; want a gap and no frames, and the real run %s", name, h, run)
		}
	}
	// since 0 is a fresh page: no run needed, no gap, and it learns the run.
	if h := hello(0, ""); h.Replayed != 0 || h.Gap || h.Run != run {
		t.Errorf("a fresh page: %+v; want no gap and run %s", h, run)
	}
}

func TestRemoteRunIDsAreFreshPerStartAndHex(t *testing.T) {
	s, _, _ := startRemote(t)
	first := runOf(s)
	if len(first) != 16 {
		t.Fatalf("run %q, want 16 hex characters (8 bytes)", first)
	}
	if err := s.Stop(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(0); err != nil {
		t.Fatal(err)
	}
	if second := runOf(s); second == first || len(second) != 16 {
		t.Errorf("run after a restart %q, first was %q; want a different 16 character id", second, first)
	}
}
