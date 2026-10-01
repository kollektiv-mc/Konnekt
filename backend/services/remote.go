package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// RemoteService is the embedded HTTP server behind Remote Access (#43): the
// same frontend bundle the WebView shows, served to a browser, with the bound
// methods reachable over POST /api/rpc and the EventBus mirrored over GET /ws.
// The frontend's remote runtime (Phase 2, #44) is what turns those two
// endpoints back into window.go and window.runtime, so no tile changes.
//
// What it is not: reachable. Nothing starts it until the settings UI exists
// (#47), its authorizer (remote_auth.go, #45) refuses every sign-in until that
// UI has set a password, and it only ever binds the loopback address: the tunnel (#46) is what carries it
// further, and TLS terminates at that tunnel's edge. The acceptance criteria
// are agent_docs/SECURITY_CHECKLIST.md § S8; each rule below names its item.
type RemoteService struct {
	bus        *EventBus
	dispatcher *RemoteDispatcher
	hub        *remoteHub

	mu     sync.Mutex
	assets fs.FS
	auth   RemoteAuthorizer
	idle   time.Duration
	// hosts is the Host allowlist (§ S8.3): the bound address in both of its
	// spellings, plus whatever AllowHost added (the tunnel's hostname). Origin
	// is checked against the same set, since a page served from one of these
	// hosts is the only legitimate caller.
	hosts map[string]struct{}
	srv   *http.Server
	ln    net.Listener
	// running gates the bus tap: while the server is down, no event is
	// buffered, so a client of the next run can never be replayed the last.
	running    atomic.Bool
	lastActive atomic.Int64 // unix nanoseconds of the last request or socket message
	stopIdle   chan struct{}
	// cancel ends every request's context when the listener stops, so a call
	// waiting on the desktop's approval is withdrawn rather than holding the
	// shutdown open for its whole wait.
	cancel context.CancelFunc
	// onChange is told when the listener starts or stops, by hand or by the
	// idle stop, and when a socket opens or closes.
	onChange func()
}

// RemoteAuthorizer identifies the session behind a request. An error refuses
// the request with 401 and is never shown to the client beyond that status,
// so it may say why. RemoteAuth (remote_auth.go, #45) is the implementation; a
// RemoteService with none refuses every API request.
type RemoteAuthorizer interface {
	Authorize(r *http.Request) (RemoteSession, error)
}

// RemoteSession is what the authorizer knows about a caller. Device is the
// name the desktop gave the device when it approved it (§ S8.6), and is the
// one thing about a caller the log names (§ S8.9). ID names the session, so
// CloseSessions can find its sockets; it is not the token and unlocks nothing.
type RemoteSession struct {
	ID     string
	Device string
}

// remoteLoginServer is the sign-in half of an authorizer. RemoteAuth is the
// one implementation; an authorizer without it (the tests' stub) leaves the
// two routes answering 404, which the login gate reads as "no sign-ins yet".
// Each method reports whether it issued a session, which is the only
// unauthenticated request that counts as activity.
type remoteLoginServer interface {
	ServeLogin(w http.ResponseWriter, r *http.Request) bool
	ServeLoginWait(w http.ResponseWriter, r *http.Request) bool
}

// remoteSessionKeeper is the other optional half: whether a session is still
// good. writePump asks at every ping, so a socket does not outlive the session
// it was opened with.
type remoteSessionKeeper interface {
	SessionAlive(id string) bool
}

const (
	// remoteDefaultIdle stops a listener nobody has used (§ S8.8). Thirty
	// minutes: long enough to survive a phone locking, short enough that a
	// forgotten session on a laptop at work is not an open door all evening.
	remoteDefaultIdle = 30 * time.Minute
	// remoteMaxBody bounds an RPC body. The largest legitimate argument is a
	// config file's content (WriteConfigFile), and server configs are kilobytes.
	remoteMaxBody = 1 << 20
	// remoteShutdownGrace is how long Stop waits for in-flight requests.
	remoteShutdownGrace = 5 * time.Second
	// remoteLoginReadTimeout bounds reading a sign-in body: the one body read
	// before anyone is authenticated, which a caller could otherwise hold open
	// a byte at a time. It is set per request rather than as the server's
	// ReadTimeout, which would also run out under a bound method that takes
	// longer than this to answer.
	remoteLoginReadTimeout = 10 * time.Second
)

// remoteCSP is frontend/index.html's policy with frame-ancestors added: a
// <meta> policy cannot set it, and a page that can be framed from another
// origin can be clickjacked (§ S8.7). TestRemoteCSPMatchesIndexHTML holds the
// two in step, so a change to the meta tag reaches here or fails.
const remoteCSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https: data:; frame-src 'none'; object-src 'none'; base-uri 'self'; " +
	"form-action 'none'; frame-ancestors 'none'"

func NewRemoteService(bus *EventBus, dispatcher *RemoteDispatcher) *RemoteService {
	s := &RemoteService{
		bus:        bus,
		dispatcher: dispatcher,
		hub:        newRemoteHub(remoteReplayCap),
		idle:       remoteDefaultIdle,
		hosts:      map[string]struct{}{},
	}
	if bus != nil {
		bus.Tap(func(event string, data any) {
			// "remote:" is the listener's own namespace on the wire (the hello),
			// and on the bus it is what the desktop is told about remote access:
			// a device waiting, a call wanting approval. Neither is a phone's
			// business, and a bus event named remote:hello would otherwise pass
			// for the real one.
			if s.running.Load() && !strings.HasPrefix(event, remoteEventPrefix) {
				s.hub.publish(event, data)
			}
		})
	}
	return s
}

// SetAssets gives the service the built frontend to serve: main.go's embed,
// rooted at frontend/dist. Without it every page request is a 404 and the API
// still works, which is what the tests use.
func (s *RemoteService) SetAssets(assets fs.FS) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.assets = assets
}

func (s *RemoteService) SetAuthorizer(auth RemoteAuthorizer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auth = auth
}

// OnChange registers what to tell when what the desktop shows about the
// listener has changed: running or not, and how many sockets are open. It is
// told that something did, not what. Called with s.mu released.
func (s *RemoteService) OnChange(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChange = fn
}

// RemoteChangeNotifier is the one emitter of remote:changed: what the
// listener, the authorizer and the approvals are each given as their OnChange.
func RemoteChangeNotifier(bus *EventBus) func() {
	return func() { bus.Emit(EventRemoteChanged, nil) }
}

func (s *RemoteService) changed() {
	s.mu.Lock()
	fn := s.onChange
	s.mu.Unlock()
	if fn != nil {
		fn()
	}
}

// SetIdleTimeout replaces the idle stop's period. Zero or less disables it,
// which nothing in the app does; it exists for the tests.
func (s *RemoteService) SetIdleTimeout(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.idle = d
}

// AllowHost adds a hostname the listener answers to, in the form a browser
// puts in Host: "name" or "name:port". The tunnel (#46) adds its public
// hostname here; the loopback spellings are added by Start.
func (s *RemoteService) AllowHost(host string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hosts[strings.ToLower(host)] = struct{}{}
}

// Start listens on 127.0.0.1 at port (0 picks a free one) and returns the
// bound address. It binds loopback and nothing else (§ S8.3): a LAN or public
// reach is the tunnel's job, and a user who wants the dashboard on the LAN
// wants it authenticated and over TLS, which the tunnel gives and a bare
// listener does not.
func (s *RemoteService) Start(port int) (string, error) {
	// Deferred first, so it runs after s.mu is released.
	defer s.changed()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.srv != nil {
		return "", errors.New("remote access is already running")
	}
	if s.dispatcher == nil {
		return "", errors.New("remote access has no dispatcher")
	}
	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return "", fmt.Errorf("remote: listen: %w", err)
	}
	addr := ln.Addr().String()
	_, boundPort, err := net.SplitHostPort(addr)
	if err != nil {
		_ = ln.Close() //nolint:errcheck // the listen already failed to yield a usable address; nothing to report about closing it
		return "", fmt.Errorf("remote: bound address %q: %w", addr, err)
	}
	if err := s.hub.newRun(); err != nil {
		_ = ln.Close() //nolint:errcheck // already failing; nothing to report about closing it
		return "", err
	}
	s.hosts[addr] = struct{}{}
	s.hosts["localhost:"+boundPort] = struct{}{}

	base, cancel := context.WithCancel(context.Background())
	s.srv = &http.Server{
		Handler:           s.handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
		BaseContext:       func(net.Listener) context.Context { return base },
	}
	s.cancel = cancel
	s.ln = ln
	s.touch()
	s.running.Store(true)
	s.stopIdle = make(chan struct{})
	if s.idle > 0 {
		go s.idleWatch(s.idle, s.stopIdle)
	}
	go func(srv *http.Server, ln net.Listener) {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("remote: serve", "error", err)
		}
	}(s.srv, ln)
	slog.Info("remote: listening", "addr", addr)
	return addr, nil
}

// Stop closes the listener, every WebSocket and the replay buffer. Safe to
// call when not running.
func (s *RemoteService) Stop() error {
	s.mu.Lock()
	srv := s.srv
	stopIdle := s.stopIdle
	cancel := s.cancel
	s.srv, s.ln, s.stopIdle, s.cancel = nil, nil, nil, nil
	s.running.Store(false)
	s.mu.Unlock()
	if srv == nil {
		return nil
	}
	defer s.changed()
	close(stopIdle)
	cancel()
	ctx, cancel := context.WithTimeout(context.Background(), remoteShutdownGrace)
	defer cancel()
	err := srv.Shutdown(ctx)
	// Shutdown leaves hijacked connections alone, and every WebSocket is one.
	s.hub.closeAll()
	slog.Info("remote: stopped")
	if err != nil {
		return fmt.Errorf("remote: shutdown: %w", err)
	}
	return nil
}

func (s *RemoteService) Running() bool { return s.running.Load() }

// Addr is the bound address while running, else "".
func (s *RemoteService) Addr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln == nil {
		return ""
	}
	return s.ln.Addr().String()
}

// ClientCount is how many WebSocket clients are connected.
func (s *RemoteService) ClientCount() int { return s.hub.count() }

// Handler is the full request pipeline, for httptest. Start uses the same
// one; the tests add their own Host with AllowHost first.
func (s *RemoteService) Handler() http.Handler { return s.handler() }

func (s *RemoteService) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/rpc", s.handleRPC)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/login/wait", s.handleLoginWait)
	mux.HandleFunc("GET /ws", s.handleWS)
	mux.HandleFunc("GET /", s.handleStatic)
	return s.guard(mux)
}

// guard is the one place a request's provenance is judged (§ S8.3). Host must
// be allowlisted, which is what defeats DNS rebinding: a page on evil.example
// resolving to 127.0.0.1 arrives with Host: evil.example. Origin, when the
// browser sends one, must be allowlisted too, and a WebSocket upgrade or a
// state-changing method must carry one, which is what defeats a cross-site
// page opening the socket or posting to the RPC endpoint. Nothing here reads
// the source address: every tunnelled request arrives from loopback, so it
// says nothing.
func (s *RemoteService) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", remoteCSP)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		if !s.hostAllowed(r.Host) {
			http.Error(w, "unexpected host", http.StatusForbidden)
			return
		}
		origin := r.Header.Get("Origin")
		mustHaveOrigin := r.URL.Path == "/ws" || (r.Method != http.MethodGet && r.Method != http.MethodHead)
		if origin == "" && mustHaveOrigin {
			http.Error(w, "missing origin", http.StatusForbidden)
			return
		}
		if origin != "" && !s.originAllowed(origin) {
			http.Error(w, "unexpected origin", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *RemoteService) hostAllowed(host string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.hosts[strings.ToLower(host)]
	return ok
}

func (s *RemoteService) originAllowed(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return s.hostAllowed(u.Host)
}

// handleStatic serves the built frontend. Files only: a directory under
// assets/ is a 404 rather than a listing, and "/" is index.html. Unknown paths
// are 404s too, since the dashboard has no client-side routes to fall back
// for.
func (s *RemoteService) handleStatic(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	assets := s.assets
	s.mu.Unlock()
	if assets == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	info, err := fs.Stat(assets, name)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if name == "index.html" {
		// The shell is what a login gate and a new bundle both have to reach.
		w.Header().Set("Cache-Control", "no-cache")
	}
	// name is path.Clean'd and rooted in an fs.FS, which refuses a name that
	// escapes it, and fs.Stat above has already refused a directory or an
	// invalid name.
	http.ServeFileFS(w, r, assets, name) // #nosec G703 -- see above
}

// remoteRPCRequest is the wire shape of one call: the bound method's name
// and its arguments in order, exactly as the generated bindings pass them.
type remoteRPCRequest struct {
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

type remoteRPCResponse struct {
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (s *RemoteService) handleRPC(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		// A cross-site HTML form cannot send this type, which is the second
		// line behind the Origin check for a browser that omits the header.
		http.Error(w, "expected application/json", http.StatusUnsupportedMediaType)
		return
	}
	var req remoteRPCRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, remoteMaxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}
	tier, known := s.dispatcher.Tier(req.Method)
	result, err := s.dispatcher.Invoke(r.Context(), session.Device, req.Method, req.Args)
	// One line per call, naming the method and the device and never an
	// argument or a result: a config file's content or a console command are
	// both arguments, and neither belongs in konnekt.log (§ S8.9). A name the
	// allowlist does not know is the caller's own text, up to a megabyte of
	// it, so it is not written either.
	logged := req.Method
	if !known {
		logged = "(not remote-callable)"
	}
	slog.Info("remote: call", "method", logged, "tier", string(tier), "device", session.Device, "ok", err == nil)
	if !known {
		// Same answer for "not bound" and "bound but not remote-callable": the
		// difference is not the client's business.
		writeRemoteJSON(w, http.StatusNotFound, remoteRPCResponse{Error: ErrRemoteMethodUnknown.Error()})
		return
	}
	switch {
	case errors.Is(err, ErrRemoteApprovalRequired):
		writeRemoteJSON(w, http.StatusForbidden, remoteRPCResponse{Error: err.Error()})
	case errors.Is(err, ErrRemoteBadArgs):
		writeRemoteJSON(w, http.StatusBadRequest, remoteRPCResponse{Error: err.Error()})
	case err != nil:
		// The method ran and said no. That is the (T, error) the binding
		// would have rejected with, so it travels as a 200 with the message.
		writeRemoteJSON(w, http.StatusOK, remoteRPCResponse{Error: err.Error()})
	default:
		writeRemoteJSON(w, http.StatusOK, remoteRPCResponse{Result: result})
	}
}

// authorize answers the session behind r, or writes the 401 and returns false.
// No authorizer is the same as an authorizer that refuses everyone.
func (s *RemoteService) authorize(w http.ResponseWriter, r *http.Request) (RemoteSession, bool) {
	s.mu.Lock()
	auth := s.auth
	s.mu.Unlock()
	if auth == nil {
		http.Error(w, "remote access is not configured", http.StatusUnauthorized)
		return RemoteSession{}, false
	}
	session, err := auth.Authorize(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return RemoteSession{}, false
	}
	// Only here, and on a sign-in that earned a session: activity is what a
	// session does.
	// Counting every guarded request would let anyone who can reach the
	// tunnel's URL hold the listener open by reloading the gate (§ S8.8).
	s.touch()
	return session, true
}

func (s *RemoteService) loginServer() remoteLoginServer {
	s.mu.Lock()
	defer s.mu.Unlock()
	login, ok := s.auth.(remoteLoginServer)
	if !ok {
		return nil
	}
	return login
}

func (s *RemoteService) handleLogin(w http.ResponseWriter, r *http.Request) {
	login := s.loginServer()
	if login == nil {
		http.NotFound(w, r)
		return
	}
	// httptest's recorder has no connection to set a deadline on, which is the
	// one error expected here.
	deadline := time.Now().Add(remoteLoginReadTimeout)
	if err := http.NewResponseController(w).SetReadDeadline(deadline); err != nil && !errors.Is(err, http.ErrNotSupported) {
		slog.Warn("remote: sign-in read deadline", "error", err)
	}
	if login.ServeLogin(w, r) {
		s.touch()
	}
}

func (s *RemoteService) handleLoginWait(w http.ResponseWriter, r *http.Request) {
	login := s.loginServer()
	if login == nil {
		http.NotFound(w, r)
		return
	}
	if login.ServeLoginWait(w, r) {
		s.touch()
	}
}

// sessionAlive is whether a socket's session still stands. An authorizer that
// cannot say (the tests' stub) is taken to mean yes.
func (s *RemoteService) sessionAlive(id string) bool {
	s.mu.Lock()
	keeper, ok := s.auth.(remoteSessionKeeper)
	s.mu.Unlock()
	return !ok || keeper.SessionAlive(id)
}

// CloseSessions disconnects every socket opened under one of the named
// sessions. RemoteAuth calls it when sessions are revoked (§ S8.5): without it
// a revoked session's next request is refused, but its open socket would keep
// receiving events until the next ping.
func (s *RemoteService) CloseSessions(ids []string) {
	s.hub.closeSessions(ids)
}

func writeRemoteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("remote: write response", "error", err)
	}
}

func (s *RemoteService) touch() { s.lastActive.Store(time.Now().UnixNano()) }

// idleWatch stops the listener once nothing has touched it for idle (§ S8.8).
// An authorized request, a sign-in that earned a session, a WebSocket message
// and a pong all count, so a phone with the dashboard open keeps it alive and a closed
// tab lets it lapse. A request nobody authorized does not.
func (s *RemoteService) idleWatch(idle time.Duration, stop <-chan struct{}) {
	tick := time.NewTicker(idle / 4)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case <-tick.C:
			if time.Since(time.Unix(0, s.lastActive.Load())) < idle {
				continue
			}
			slog.Info("remote: idle, stopping", "idle", idle.String())
			if err := s.Stop(); err != nil {
				slog.Warn("remote: idle stop", "error", err)
			}
			return
		}
	}
}
