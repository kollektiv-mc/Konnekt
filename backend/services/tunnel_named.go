package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"konnekt/backend/models"
)

// A named tunnel (#512) is a remotely-managed Cloudflare tunnel on the user's
// own account: they create it in their dashboard, route a hostname they own to
// http://127.0.0.1:<port>, and paste the tunnel token and the hostname into
// Settings. It keeps one hostname across runs, which is what a saved Claude
// connector and a phone's bookmark need; a quick tunnel's hostname is new
// every time. Cloudflare still terminates TLS.
//
// The token is a credential (agent_docs/SECURITY_CHECKLIST.md § S9.8): it
// lives in an owner-only file, reaches cloudflared through --token-file and
// never through argv (any local user can read argv from the process list),
// and appears in no AppSettings field and no log line. The hostname and the
// port are not secret and sit in tunnel.json beside it.

const (
	// tunnelConfigFile holds the hostname and the port. tunnelTokenFile holds
	// the token and nothing else, written 0600.
	tunnelConfigFile = "tunnel.json"
	tunnelTokenFile  = "tunnel-token"
	// tunnelTokenMax bounds a pasted token. A real one is a few hundred
	// characters of base64; this is room for a longer format, not a payload.
	tunnelTokenMax = 4096
	// tunnelPortMin keeps the fixed listener port out of the privileged range.
	tunnelPortMin   = 1024
	tunnelHostMax   = 253
	tunnelLabelMax  = 63
	tunnelNamedMode = "named"
	tunnelQuickMode = "quick"
)

var (
	ErrTunnelBadHostname  = errors.New("the hostname is not a DNS name")
	ErrTunnelBadToken     = errors.New("the tunnel token is not usable")
	ErrTunnelBadPort      = errors.New("the port is out of range")
	ErrTunnelPortMismatch = errors.New("remote access is not listening on the named tunnel's port")
)

// tunnelRegisteredPattern is the line cloudflared logs once a connection to
// the edge is registered, in the words of connection/observer.go at the
// pinned release ("Registered tunnel connection") and of older builds
// ("Connection established"). A named tunnel prints no URL, so this is what
// says it is up.
var tunnelRegisteredPattern = regexp.MustCompile(`Registered tunnel connection|Connection established`)

type tunnelConfig struct {
	Hostname string `json:"hostname"`
	Port     int    `json:"port"`
}

// Named reports the named tunnel's configuration: the hostname and port saved,
// and whether a token is stored. All zero when none is.
func (t *TunnelService) Named() models.NamedTunnel {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.named
}

// namedConfigured says whether Start runs the named tunnel: it needs both the
// hostname and a stored token. Called with t.mu held.
func (t *TunnelService) namedConfigured() bool {
	return t.named.Hostname != "" && t.named.TokenSet
}

// loadNamed reads the saved configuration, if any. A missing or unreadable
// file is no configuration, logged and not fatal: the tunnel is off until
// switched on either way.
func (t *TunnelService) loadNamed(dir string) models.NamedTunnel {
	var cfg tunnelConfig
	data, err := os.ReadFile(filepath.Join(dir, tunnelConfigFile))
	switch {
	case errors.Is(err, os.ErrNotExist):
		return models.NamedTunnel{}
	case err != nil:
		slog.Warn("tunnel: read config", "error", err)
		return models.NamedTunnel{}
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		slog.Warn("tunnel: parse config", "error", err)
		return models.NamedTunnel{}
	}
	host, err := ValidTunnelHostname(cfg.Hostname)
	if err != nil || cfg.Port < tunnelPortMin || cfg.Port > 65535 {
		slog.Warn("tunnel: saved config is not usable, ignoring it")
		return models.NamedTunnel{}
	}
	_, statErr := os.Stat(filepath.Join(dir, tunnelTokenFile))
	return models.NamedTunnel{Hostname: host, Port: cfg.Port, TokenSet: statErr == nil}
}

// ValidTunnelHostname accepts a DNS name of at least two labels, lowercased:
// letters, digits and hyphens, no wildcard, no scheme, no port, no path. It
// returns the lowercase form.
func ValidTunnelHostname(raw string) (string, error) {
	host := strings.ToLower(strings.TrimSpace(raw))
	if host == "" || len(host) > tunnelHostMax || strings.ContainsAny(host, "*/:@ ") {
		return "", fmt.Errorf("%w: %q", ErrTunnelBadHostname, raw)
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 {
		return "", fmt.Errorf("%w: %q has no domain", ErrTunnelBadHostname, raw)
	}
	for _, l := range labels {
		if l == "" || len(l) > tunnelLabelMax || l[0] == '-' || l[len(l)-1] == '-' {
			return "", fmt.Errorf("%w: %q", ErrTunnelBadHostname, raw)
		}
		for _, r := range l {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
				return "", fmt.Errorf("%w: %q", ErrTunnelBadHostname, raw)
			}
		}
	}
	return host, nil
}

func validTunnelToken(token string) error {
	if token == "" || len(token) > tunnelTokenMax {
		return fmt.Errorf("%w: it is empty or too long", ErrTunnelBadToken)
	}
	for _, r := range token {
		if unicode.IsSpace(r) || unicode.IsControl(r) || r > unicode.MaxASCII {
			return fmt.Errorf("%w: it carries whitespace or a character no token has", ErrTunnelBadToken)
		}
	}
	return nil
}

// SaveNamed stores the named tunnel's hostname, port and token. An empty token
// keeps the one already stored, so the hostname or port can change without
// pasting the token again. Refused while a tunnel runs: the listener's host
// allowlist follows the configuration, and changing it under a live run would
// leave the two apart.
func (t *TunnelService) SaveNamed(hostname string, port int, token string) error {
	host, err := ValidTunnelHostname(hostname)
	if err != nil {
		return err
	}
	if port < tunnelPortMin || port > 65535 {
		return fmt.Errorf("%w: %d is not between %d and 65535", ErrTunnelBadPort, port, tunnelPortMin)
	}
	if token != "" {
		if err := validTunnelToken(token); err != nil {
			return err
		}
	}

	t.mu.Lock()
	if t.dataDir == "" {
		t.mu.Unlock()
		return ErrTunnelNoDataDir
	}
	if t.active() {
		t.mu.Unlock()
		return ErrTunnelRunning
	}
	if token == "" && !t.named.TokenSet {
		t.mu.Unlock()
		return fmt.Errorf("%w: none is stored yet", ErrTunnelBadToken)
	}
	if token != "" {
		if err := WritePrivateDataFile(t.dataDir, tunnelTokenFile, []byte(token)); err != nil {
			t.mu.Unlock()
			return err
		}
	}
	data, err := json.Marshal(tunnelConfig{Hostname: host, Port: port})
	if err != nil {
		t.mu.Unlock()
		return fmt.Errorf("encode tunnel config: %w", err)
	}
	if err := WriteDataFile(t.dataDir, tunnelConfigFile, data); err != nil {
		t.mu.Unlock()
		return err
	}
	old := t.named.Hostname
	t.named = models.NamedTunnel{Hostname: host, Port: port, TokenSet: true}
	cb, hostCb := t.onChange, t.onHost
	t.mu.Unlock()

	slog.Info("tunnel: named tunnel saved", "host", host, "port", port)
	// A hostname that was replaced will not come back under this
	// configuration, so the devices approved on it go with it.
	if old != "" && old != host && hostCb != nil {
		hostCb(old, false, true)
	}
	if cb != nil {
		cb()
	}
	return nil
}

// ForgetNamed deletes the token and the configuration, and with them the
// devices approved on the hostname: the "forget token" control. Refused while
// a tunnel runs.
func (t *TunnelService) ForgetNamed() error {
	t.mu.Lock()
	if t.active() {
		t.mu.Unlock()
		return ErrTunnelRunning
	}
	if t.dataDir == "" {
		t.mu.Unlock()
		return ErrTunnelNoDataDir
	}
	for _, name := range []string{tunnelTokenFile, tunnelConfigFile} {
		if err := os.Remove(filepath.Join(t.dataDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			t.mu.Unlock()
			return fmt.Errorf("forget the named tunnel: %w", err)
		}
	}
	old := t.named.Hostname
	t.named = models.NamedTunnel{}
	cb, hostCb := t.onChange, t.onHost
	t.mu.Unlock()

	slog.Info("tunnel: named tunnel forgotten")
	if old != "" && hostCb != nil {
		hostCb(old, false, true)
	}
	if cb != nil {
		cb()
	}
	return nil
}

// active says whether a run is in flight. Called with t.mu held.
func (t *TunnelService) active() bool {
	switch t.state.Status {
	case "downloading", "starting", "running":
		return true
	}
	return false
}

// tunnelRun is one run's plan: the arguments, and how to tell it is up.
type tunnelRun struct {
	mode string
	args []string
	// host is the named hostname, "" for a quick tunnel, whose hostname is
	// read from the URL it prints.
	host string
}

// planRun decides between the named tunnel and a quick one for localAddr.
// Called with t.mu held.
func (t *TunnelService) planRun(localAddr string) (tunnelRun, error) {
	if !t.namedConfigured() {
		return tunnelRun{mode: tunnelQuickMode, args: []string{"tunnel", "--no-autoupdate", "--url", "http://" + localAddr}}, nil
	}
	// The dashboard's ingress rule names one port, and the listener has to be
	// on it or the tunnel answers nothing. StartRemoteAccess reads the port
	// from here; a listener started before the tunnel was configured is the
	// case this catches.
	if _, port, err := splitPort(localAddr); err != nil || port != t.named.Port {
		return tunnelRun{}, fmt.Errorf("%w: it listens on %s and the tunnel expects port %d; switch remote access off and on",
			ErrTunnelPortMismatch, localAddr, t.named.Port)
	}
	tokenPath := filepath.Join(t.dataDir, tunnelTokenFile)
	return tunnelRun{
		mode: tunnelNamedMode,
		args: []string{"tunnel", "--no-autoupdate", "run", "--token-file", tokenPath},
		host: t.named.Hostname,
	}, nil
}

func splitPort(addr string) (string, int, error) {
	i := strings.LastIndexByte(addr, ':')
	if i < 0 {
		return "", 0, fmt.Errorf("%q has no port", addr)
	}
	port, err := strconv.Atoi(addr[i+1:])
	if err != nil {
		return "", 0, err
	}
	return addr[:i], port, nil
}

// tunnelUp reports whether line says the run is reachable, and the URL and
// hostname it is reachable at.
func (r tunnelRun) tunnelUp(line string) (rawURL, host string) {
	if r.mode == tunnelNamedMode {
		if tunnelRegisteredPattern.MatchString(line) {
			return "https://" + r.host, r.host
		}
		return "", ""
	}
	if u := findTunnelURL(line); u != "" {
		return u, strings.TrimPrefix(u, "https://")
	}
	return "", ""
}
