package services

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// The EventBus mirrored to a browser. Every event the WebView would see is
// numbered and buffered, so a phone that dropped its socket on a lift ride
// reconnects with the last number it saw and gets what it missed, in order,
// rather than a console with a hole in it.

const (
	// remoteReplayCap is the replay buffer's depth, the console's own cap:
	// the console is the chattiest event source by far, and a reconnect that
	// outlives the console's memory outlives the buffer's too. The client then
	// re-primes from GetConsoleHistory the way a fresh page does.
	remoteReplayCap = consoleCap
	// remoteSendBuffer is per-client backpressure. A client that falls this
	// far behind is disconnected rather than allowed to stall the emitter or
	// grow without bound; it reconnects with "since" and catches up from the
	// replay buffer, which is the path a dropped socket takes anyway.
	remoteSendBuffer = 256

	remoteWriteWait = 10 * time.Second
	remotePongWait  = 60 * time.Second
	remotePingEvery = (remotePongWait * 9) / 10

	// remoteHelloEvent is the first frame on every socket: the latest
	// sequence number, and whether the replay could cover the client's gap.
	remoteHelloEvent = "remote:hello"
	// remoteEventPrefix is the namespace no bus event crosses the wire under
	// (see NewRemoteService's tap).
	remoteEventPrefix = "remote:"
)

// remoteFrame is one event on the wire. Data is the payload already encoded,
// once, at publish time; every client gets the same bytes.
type remoteFrame struct {
	Seq   uint64          `json:"seq"`
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// remoteHello also names the run, so a client can send it back with "since"
// and the server, not the client, decides whether that number belongs to this
// run. Sequence numbers are only comparable inside one run.
type remoteHello struct {
	Replayed int    `json:"replayed"`
	Gap      bool   `json:"gap"`
	Run      string `json:"run"`
}

type remoteHub struct {
	mu  sync.Mutex
	cap int
	// run identifies one listening session. A "since" is only meaningful
	// against the run that numbered it, which is what lets replay refuse a
	// client from before a restart even when its number happens to be in range.
	run     string
	ring    []remoteFrame
	seq     uint64
	clients map[*remoteClient]struct{}
}

type remoteClient struct {
	conn *websocket.Conn
	// session is the RemoteSession.ID the socket was opened under.
	session string
	send    chan []byte
	once    sync.Once
	done    chan struct{}
}

func newRemoteHub(capacity int) *remoteHub {
	return &remoteHub{cap: capacity, clients: map[*remoteClient]struct{}{}}
}

// newRun starts a new run: a fresh identity and an empty buffer. Start calls it,
// so a Stop and Start inside one process is a new run too, and a client that was
// fully caught up at Stop is told it missed whatever was emitted while the
// listener was down, which was never numbered. seq is not reset: it stays
// monotonic for the process.
func (h *remoteHub) newRun() error {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Errorf("remote: run id: %w", err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.run = hex.EncodeToString(b[:])
	h.ring = nil
	return nil
}

// publish numbers and buffers an event and hands it to every client. It runs
// on the emitter's goroutine (EventBus.Tap), so it does no I/O: a client's
// send is a non-blocking channel write, and a full channel drops the client.
func (h *remoteHub) publish(event string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		slog.Warn("remote: encode event", "event", event, "error", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	frame := remoteFrame{Seq: h.seq, Event: event, Data: raw}
	if len(h.ring) >= h.cap {
		h.ring = h.ring[1:]
	}
	h.ring = append(h.ring, frame)
	encoded, err := json.Marshal(frame)
	if err != nil {
		slog.Warn("remote: encode frame", "event", event, "error", err)
		return
	}
	for c := range h.clients {
		select {
		case c.send <- encoded:
		default:
			delete(h.clients, c)
			c.close()
			slog.Warn("remote: client too slow, disconnected")
		}
	}
}

// replay returns the frames after since, the latest sequence number, whether
// the buffer no longer reaches back to since, and the current run. since 0 asks
// for nothing but the live stream, which is what a fresh page wants.
//
// A since with a missing or different run belongs to another run, or to none
// the client can name, and is a gap with no frames: the numbering is unrelated
// to this run's, so even an in-range number would replay the wrong events.
//
// Within a run, two more cases cannot be made whole and report a gap with no
// frames. A since ahead of the latest number is not one this run issued, and a
// since behind it with nothing buffered means closeAll forgot the buffer.
func (h *remoteHub) replay(since uint64, run string) ([]remoteFrame, uint64, bool, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if since == 0 {
		return nil, h.seq, false, h.run
	}
	if run == "" || run != h.run || since > h.seq || (since < h.seq && len(h.ring) == 0) {
		return nil, h.seq, true, h.run
	}
	if since == h.seq {
		return nil, h.seq, false, h.run
	}
	gap := h.ring[0].Seq > since+1
	var out []remoteFrame
	for _, f := range h.ring {
		if f.Seq > since {
			out = append(out, f)
		}
	}
	return out, h.seq, gap, h.run
}

func (h *remoteHub) add(c *remoteClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *remoteHub) remove(c *remoteClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

func (h *remoteHub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// closeAll disconnects every client and forgets the buffer, so a client of
// the next run is never replayed this one's events.
func (h *remoteHub) closeAll() {
	h.mu.Lock()
	clients := h.clients
	h.clients = map[*remoteClient]struct{}{}
	h.ring = nil
	h.mu.Unlock()
	for c := range clients {
		c.close()
	}
}

// closeSessions disconnects the clients of the named sessions and leaves the
// rest, and the buffer, alone.
func (h *remoteHub) closeSessions(ids []string) {
	if len(ids) == 0 {
		return
	}
	gone := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		gone[id] = struct{}{}
	}
	var closing []*remoteClient
	h.mu.Lock()
	for c := range h.clients {
		if _, ok := gone[c.session]; ok {
			delete(h.clients, c)
			closing = append(closing, c)
		}
	}
	h.mu.Unlock()
	for _, c := range closing {
		c.close()
	}
}

func (c *remoteClient) close() {
	c.once.Do(func() {
		close(c.done)
		if err := c.conn.Close(); err != nil {
			slog.Debug("remote: close socket", "error", err)
		}
	})
}

// handleWS upgrades an authorized, guarded request and streams events to it.
// The Origin decision was already made by guard, so the upgrader's own check
// only restates it; gorilla's default would otherwise compare Origin to Host,
// which is the same rule and would be a second place to get it wrong.
func (s *RemoteService) handleWS(w http.ResponseWriter, r *http.Request) {
	session, ok := s.authorize(w, r)
	if !ok {
		return
	}
	since, err := strconv.ParseUint(r.URL.Query().Get("since"), 10, 64)
	if err != nil {
		since = 0
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		return s.originAllowed(r.Header.Get("Origin"))
	}}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote the response.
		slog.Warn("remote: websocket upgrade", "device", session.Device, "error", err)
		return
	}
	c := &remoteClient{conn: conn, session: session.ID, send: make(chan []byte, remoteSendBuffer), done: make(chan struct{})}
	slog.Info("remote: socket opened", "device", session.Device, "since", since)

	// Hello and replay are queued before the client joins the hub, so nothing
	// live can slip in ahead of them and arrive out of order. They are queued
	// before writePump starts, so they must fit the send buffer: a replay that
	// would not is not attempted, and the hello says gap so the client
	// re-primes like a fresh page. Disconnecting instead would loop, since the
	// client's reconnect carries the same "since" and meets the same wall.
	frames, latest, gap, run := s.hub.replay(since, r.URL.Query().Get("run"))
	if len(frames)+1 > remoteSendBuffer {
		frames, gap = nil, true
	}
	if !c.queue(remoteFrame{Seq: latest, Event: remoteHelloEvent}, remoteHello{Replayed: len(frames), Gap: gap, Run: run}) {
		c.close()
		return
	}
	for _, f := range frames {
		if !c.queueEncoded(f) {
			c.close()
			return
		}
	}
	s.hub.add(c)
	go s.writePump(c)
	s.readPump(c, session)
}

func (c *remoteClient) queue(f remoteFrame, data any) bool {
	raw, err := json.Marshal(data)
	if err != nil {
		slog.Warn("remote: encode hello", "error", err)
		return false
	}
	f.Data = raw
	return c.queueEncoded(f)
}

func (c *remoteClient) queueEncoded(f remoteFrame) bool {
	encoded, err := json.Marshal(f)
	if err != nil {
		slog.Warn("remote: encode frame", "event", f.Event, "error", err)
		return false
	}
	select {
	case c.send <- encoded:
		return true
	default:
		// handleWS checks that the replay fits before queueing it, so this is
		// not reached by a replay; it guards the invariant, not a path.
		slog.Warn("remote: client send buffer full, disconnecting")
		return false
	}
}

// readPump drains the socket. The client sends nothing the server acts on;
// what matters is noticing it went away, and its pongs, which count as
// activity for the idle stop.
func (s *RemoteService) readPump(c *remoteClient, session RemoteSession) {
	defer func() {
		s.hub.remove(c)
		c.close()
		slog.Info("remote: socket closed", "device", session.Device)
		s.changed()
	}()
	c.conn.SetReadLimit(1024)
	if err := c.conn.SetReadDeadline(time.Now().Add(remotePongWait)); err != nil {
		return
	}
	c.conn.SetPongHandler(func(string) error {
		s.touch()
		return c.conn.SetReadDeadline(time.Now().Add(remotePongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
		s.touch()
	}
}

func (s *RemoteService) writePump(c *remoteClient) {
	ping := time.NewTicker(remotePingEvery)
	defer func() {
		ping.Stop()
		c.close()
	}()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(remoteWriteWait)); err != nil {
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			// The session is checked on the socket's own clock, since nothing
			// else would: a socket makes no requests for Authorize to refuse.
			if !s.sessionAlive(c.session) {
				return
			}
			if err := c.conn.SetWriteDeadline(time.Now().Add(remoteWriteWait)); err != nil {
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
