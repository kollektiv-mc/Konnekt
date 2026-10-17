package services

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"konnekt/backend/models"
)

// The local bridge's endpoint (#511, agent_docs/SECURITY_CHECKLIST.md
// § S9.4). Claude Code and Claude Desktop on the machine that runs Konnekt
// start `konnekt mcp`, a stdio process from the same binary, and that process
// forwards each call here. This listener is not the Remote Access one: allowing
// Claude locally does not open the dashboard, and the other way round. It runs
// only while "Allow Claude on this computer" is on, which is off by default.
//
// It binds loopback and is keyed by a 256-bit secret from crypto/rand,
// regenerated at every start and written 0600 beside its port in
// mcp-local.json. The bridge reads that file; so can any process running as
// the user, which is the trust boundary remote.json already has. On Windows
// 0600 is not an ACL: the data dir sits under the user's profile, which is
// per-user by default, and that is the whole of the protection there.
// Requests pass a Host and Origin guard in the shape of RemoteService's; a
// browser request carries an Origin, so it is refused, which closes DNS
// rebinding.

const (
	// localMCPFile holds the switch, and the port and secret while listening.
	localMCPFile = "mcp-local.json"
	// localMCPSessionIdle ends an MCP session the bridge stopped using, such
	// as one whose bridge process was killed.
	localMCPSessionIdle = 30 * time.Minute
	localMCPGrace       = 3 * time.Second
	// LocalMCPCaller is the device name the dispatcher and the log see for a
	// call through the bridge.
	LocalMCPCaller = "local-mcp"
)

var (
	ErrLocalMCPNoServer  = errors.New("the MCP catalog did not build")
	ErrLocalMCPNoDataDir = errors.New("the data directory is not set")
	ErrLocalMCPOff       = errors.New("Konnekt is not running, or \"Allow Claude on this computer\" is off in its Settings")
)

// localMCPRecord is mcp-local.json. Port and Secret are set only while the
// endpoint listens; Enabled survives a restart.
type localMCPRecord struct {
	Enabled bool   `json:"enabled"`
	Port    int    `json:"port"`
	Secret  string `json:"secret"`
}

// LocalMCPService runs the loopback MCP endpoint for the bridge.
type LocalMCPService struct {
	mu       sync.Mutex
	dataDir  string
	server   *mcp.Server
	enabled  bool
	secret   string
	hosts    map[string]struct{}
	srv      *http.Server
	ln       net.Listener
	onChange func()
	handler  http.Handler
}

// NewLocalMCPService wraps the catalog's server. A nil server (the catalog
// failed to build) makes every Start refuse.
func NewLocalMCPService(server *mcp.Server) *LocalMCPService {
	s := &LocalMCPService{server: server, hosts: map[string]struct{}{}}
	if server != nil {
		s.handler = mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server },
			&mcp.StreamableHTTPOptions{SessionTimeout: localMCPSessionIdle})
	}
	return s
}

// SetDataDir reads the switch's saved position. It does not start anything:
// the app does that once it is up, so a failing listener is logged in a
// running app rather than in a constructor.
func (s *LocalMCPService) SetDataDir(dir string) {
	rec := readLocalMCPRecord(dir)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dataDir = dir
	s.enabled = rec.Enabled
}

func readLocalMCPRecord(dir string) localMCPRecord {
	var rec localMCPRecord
	data, err := os.ReadFile(filepath.Join(dir, localMCPFile))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("mcp: read local record", "error", err)
		}
		return rec
	}
	if err := json.Unmarshal(data, &rec); err != nil {
		slog.Warn("mcp: parse local record", "error", err)
		return localMCPRecord{}
	}
	return rec
}

// OnChange registers what to tell when the switch or the listener changes.
// Called with the lock released.
func (s *LocalMCPService) OnChange(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChange = fn
}

func (s *LocalMCPService) changed() {
	s.mu.Lock()
	fn := s.onChange
	s.mu.Unlock()
	if fn != nil {
		fn()
	}
}

// Enabled is the switch's position; Running says whether the endpoint
// listens. They differ while the app starts, and after a failed Start.
func (s *LocalMCPService) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enabled
}

func (s *LocalMCPService) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.srv != nil
}

// Addr is the bound address while running, else "".
func (s *LocalMCPService) Addr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln == nil {
		return ""
	}
	return s.ln.Addr().String()
}

// State is what the desktop shows. command is the setup command's executable.
func (s *LocalMCPService) State(executable string) models.LocalMCPState {
	return models.LocalMCPState{Enabled: s.Enabled(), Running: s.Running(), Addr: s.Addr(),
		Command: fmt.Sprintf("%q mcp", executable), Executable: executable}
}

// SetEnabled moves the switch, persists it, and starts or stops the endpoint
// to match. A Start that fails leaves the switch on and the endpoint off,
// which State shows, and returns the error.
func (s *LocalMCPService) SetEnabled(on bool) error {
	s.mu.Lock()
	if s.dataDir == "" {
		s.mu.Unlock()
		return ErrLocalMCPNoDataDir
	}
	s.enabled = on
	s.mu.Unlock()
	if on {
		return s.Start()
	}
	return s.Stop()
}

// Start listens on a free loopback port with a fresh secret and writes both to
// mcp-local.json. A no-op while already listening.
func (s *LocalMCPService) Start() error {
	defer s.changed()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.srv != nil {
		return nil
	}
	if s.server == nil {
		return ErrLocalMCPNoServer
	}
	if s.dataDir == "" {
		return ErrLocalMCPNoDataDir
	}
	secret, err := newRemoteToken()
	if err != nil {
		return err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("mcp: listen: %w", err)
	}
	addr := ln.Addr().String()
	port := ln.Addr().(*net.TCPAddr).Port
	rec := localMCPRecord{Enabled: s.enabled, Port: port, Secret: secret}
	if err := s.writeRecord(rec); err != nil {
		_ = ln.Close() //nolint:errcheck // the start already failed; nothing to report about closing the socket
		return err
	}
	s.secret = secret
	s.hosts = map[string]struct{}{addr: {}, fmt.Sprintf("localhost:%d", port): {}}
	s.ln = ln
	s.srv = &http.Server{
		Handler:           s.guard(s.handler),
		ReadHeaderTimeout: 10 * time.Second,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}
	go func(srv *http.Server, ln net.Listener) {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("mcp: serve", "error", err)
		}
	}(s.srv, ln)
	slog.Info("mcp: local endpoint listening", "addr", addr)
	return nil
}

// Stop closes the endpoint and clears the port and secret from the file, so
// a bridge started afterwards learns at once that nothing is there.
func (s *LocalMCPService) Stop() error {
	s.mu.Lock()
	srv := s.srv
	s.srv, s.ln, s.secret = nil, nil, ""
	s.hosts = map[string]struct{}{}
	rec := localMCPRecord{Enabled: s.enabled}
	dir := s.dataDir
	s.mu.Unlock()
	if srv == nil {
		if dir != "" {
			return s.writeRecord(rec)
		}
		return nil
	}
	defer s.changed()
	ctx, cancel := context.WithTimeout(context.Background(), localMCPGrace)
	defer cancel()
	err := srv.Shutdown(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		// Shutdown has closed the listener but waits for every request in
		// flight; a client holding one past the grace does not get to keep
		// the endpoint alive, so Close ends the connections it waited for.
		slog.Warn("mcp: local endpoint closed with a request still open")
		err = srv.Close()
	}
	slog.Info("mcp: local endpoint stopped")
	if werr := s.writeRecord(rec); werr != nil && err == nil {
		err = werr
	}
	return err
}

// writeRecord is the one writer of mcp-local.json: 0600, because the secret
// is in it (§ S2.2). Called with or without the lock; it reads no state.
func (s *LocalMCPService) writeRecord(rec localMCPRecord) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("mcp: encode local record: %w", err)
	}
	dir := s.dataDir
	if dir == "" {
		return ErrLocalMCPNoDataDir
	}
	return WritePrivateDataFile(dir, localMCPFile, data)
}

// Handler is the guarded pipeline, for httptest.
func (s *LocalMCPService) Handler() http.Handler { return s.guard(s.handler) }

// guard refuses a request before the MCP handler sees it: an unlisted Host
// (DNS rebinding), any Origin at all (a browser sent it, and no browser is a
// legitimate caller here), and a missing or wrong bearer secret, compared in
// constant time. The source address is not consulted: the listener binds
// loopback, so it would say nothing.
func (s *LocalMCPService) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		s.mu.Lock()
		_, hostOK := s.hosts[strings.ToLower(r.Host)]
		secret := s.secret
		s.mu.Unlock()
		if !hostOK {
			http.Error(w, "unexpected host", http.StatusForbidden)
			return
		}
		if r.Header.Get("Origin") != "" {
			http.Error(w, "a browser cannot call this endpoint", http.StatusForbidden)
			return
		}
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || secret == "" || subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if next == nil {
			http.Error(w, ErrLocalMCPNoServer.Error(), http.StatusServiceUnavailable)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// LocalMCPEndpoint is what the bridge reads: the endpoint's URL and secret
// from mcp-local.json, or ErrLocalMCPOff when the app is not listening. The
// file is the app's and is rewritten at every start and stop, so what it says
// is current to within the app's own lifetime.
func LocalMCPEndpoint(dataDir string) (endpoint, secret string, err error) {
	rec := readLocalMCPRecord(dataDir)
	if rec.Port == 0 || rec.Secret == "" {
		return "", "", ErrLocalMCPOff
	}
	return fmt.Sprintf("http://127.0.0.1:%d/", rec.Port), rec.Secret, nil
}
