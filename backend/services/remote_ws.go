package services

import (
	"encoding/json"
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
)

// remoteFrame is one event on the wire. Data is the payload already encoded,
// once, at publish time; every client gets the same bytes.
type remoteFrame struct {
	Seq   uint64          `json:"seq"`
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

type remoteHello struct {
	Replayed int  `json:"replayed"`
	Gap      bool `json:"gap"`
}

type remoteHub struct {
	mu      sync.Mutex
	cap     int
	ring    []remoteFrame
	seq     uint64
	clients map[*remoteClient]struct{}
}

type remoteClient struct {
	conn *websocket.Conn
	send chan []byte
	once sync.Once
	done chan struct{}
}

func newRemoteHub(capacity int) *remoteHub {
	return &remoteHub{cap: capacity, clients: map[*remoteClient]struct{}{}}
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

// replay returns the frames after since, the latest sequence number, and
// whether the buffer no longer reaches back to since. since 0 asks for
// nothing but the live stream, which is what a fresh page wants.
func (h *remoteHub) replay(since uint64) ([]remoteFrame, uint64, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if since == 0 || since >= h.seq {
		return nil, h.seq, false
	}
	gap := len(h.ring) > 0 && h.ring[0].Seq > since+1
	var out []remoteFrame
	for _, f := range h.ring {
		if f.Seq > since {
			out = append(out, f)
		}
	}
	return out, h.seq, gap
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
	c := &remoteClient{conn: conn, send: make(chan []byte, remoteSendBuffer), done: make(chan struct{})}
	slog.Info("remote: socket opened", "device", session.Device, "since", since)

	// Hello and replay are queued before the client joins the hub, so nothing
	// live can slip in ahead of them and arrive out of order.
	frames, latest, gap := s.hub.replay(since)
	if !c.queue(remoteFrame{Seq: latest, Event: remoteHelloEvent}, remoteHello{Replayed: len(frames), Gap: gap}) {
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
		// The replay alone overflowed the client's buffer; a reconnect with the
		// same "since" will hit the same wall, so tell it to start fresh.
		slog.Warn("remote: replay exceeds client buffer, disconnecting")
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
			if err := c.conn.SetWriteDeadline(time.Now().Add(remoteWriteWait)); err != nil {
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
