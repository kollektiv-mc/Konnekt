package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"

	"konnekt/backend/models"
)

// Grants are what the MCP endpoint on the remote listener authorizes (#513,
// agent_docs/SECURITY_CHECKLIST.md § S9.5). A grant is one client's standing
// permission: who it is, which scopes it was given, the one resource its
// tokens are good for, and the hash of its current access token. OAuth (#514)
// is what creates grants from a consent and refreshes their tokens; this file
// is the store and the check, and knows nothing about how a grant was earned.
//
// Tokens are 256 bits from crypto/rand, handed out once and kept as SHA-256
// in remote.json (0600). An access token lasts an hour and is bound to the
// resource it was issued for, compared as a string against the resource the
// request arrived at: a token for one hostname is refused on another, and a
// token is never good for the dashboard's /api/rpc, which does not read
// bearer tokens at all. Nothing here is a session: each request stands on its
// token alone, as the MCP security best practices require.

const (
	// RemoteScopeRead and RemoteScopeOperate are the two scopes a grant can
	// carry: the tiers of the allowlist a tool may reach (§ S9.1). Operate
	// includes read, since nothing that acts on a server is kept from seeing
	// it.
	RemoteScopeRead    = "konnekt:read"
	RemoteScopeOperate = "konnekt:operate"

	remoteAccessTokenTTL = time.Hour
	remoteMaxGrants      = 16
	remoteClientNameMax  = 60
)

var (
	ErrRemoteGrantsFull   = fmt.Errorf("at most %d connectors can be signed in; revoke one first", remoteMaxGrants)
	ErrRemoteGrantUnknown = errors.New("no such grant")
	ErrRemoteScope        = errors.New("a grant carries konnekt:read, konnekt:operate or both")
	ErrRemoteResource     = errors.New("a grant's resource is the connector URL, https://<host>/mcp")
	// ErrRemoteBearer is every refusal of a bearer token. It unwraps to the
	// SDK's ErrInvalidToken so its middleware answers 401, and says no more
	// than that to the client.
	ErrRemoteBearer = fmt.Errorf("%w: unknown, expired or for another resource", auth.ErrInvalidToken)
)

// remoteGrantRecord is a grant as remote.json holds it.
type remoteGrantRecord struct {
	ID         string   `json:"id"`
	Client     string   `json:"client"`
	Scopes     []string `json:"scopes"`
	Resource   string   `json:"resource"`
	AccessHash string   `json:"accessHash"`
	// AccessExpires is Unix seconds. A grant whose access token has expired
	// and that has no way to refresh it (#514) is dead and is pruned.
	AccessExpires int64 `json:"accessExpires"`
	Created       int64 `json:"created"`
	LastUsed      int64 `json:"lastUsed,omitempty"`
}

// RemoteGrant is what the endpoint learns about an accepted token: the name
// the desktop will see and the scopes that bound the call.
type RemoteGrant struct {
	ID     string
	Client string
	Scopes []string
}

// RemoteMCPPath is where the endpoint lives on the listener, and the path of
// every grant's resource.
const RemoteMCPPath = "/mcp"

// RemoteResource is the resource a request at host names: the connector URL
// as a client was given it. The tunnel terminates TLS and the listener
// itself speaks plain HTTP on loopback, so the scheme follows the host rather
// than the connection: the listener's own loopback spellings are http, every
// other hostname arrived through the tunnel and is https.
func RemoteResource(host string) string {
	host = strings.ToLower(host)
	scheme := "https"
	if h, _, err := splitHostPortLoose(host); err == nil && (h == "127.0.0.1" || h == "localhost" || h == "::1") {
		scheme = "http"
	}
	return scheme + "://" + host + RemoteMCPPath
}

func splitHostPortLoose(host string) (string, string, error) {
	if i := strings.LastIndex(host, ":"); i >= 0 && !strings.Contains(host[i+1:], "]") {
		return strings.Trim(host[:i], "[]"), host[i+1:], nil
	}
	return host, "", nil
}

// ConnectorsEnabled is the "Allow Claude connectors" switch (§ S9.10).
func (a *RemoteAuth) ConnectorsEnabled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.state.Connectors
}

// SetConnectorsEnabled moves the switch and saves it.
func (a *RemoteAuth) SetConnectorsEnabled(on bool) error {
	defer a.flush()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.state.Connectors == on {
		return nil
	}
	previous := a.state.Connectors
	a.state.Connectors = on
	if err := a.saveLocked(); err != nil {
		a.state.Connectors = previous
		return err
	}
	a.dirty = true
	return nil
}

// IssueGrant creates a grant for client with scopes, good for resource, and
// returns its id and the one copy of its access token. The caller is the
// desktop's consent flow (#514): nothing a connector sends reaches here
// unchecked. client is clamped to something a prompt can show.
func (a *RemoteAuth) IssueGrant(client string, scopes []string, resource string) (id, token string, err error) {
	defer a.flush()
	client = cleanRemoteAgent(client)
	if client == "" {
		client = "unnamed client"
	}
	if len(client) > remoteClientNameMax {
		client = client[:remoteClientNameMax]
	}
	scopes = normalizeRemoteScopes(scopes)
	if len(scopes) == 0 {
		return "", "", ErrRemoteScope
	}
	if !strings.HasPrefix(resource, "https://") && !strings.HasPrefix(resource, "http://") || !strings.HasSuffix(resource, RemoteMCPPath) {
		return "", "", ErrRemoteResource
	}
	id, err = newRemoteID()
	if err != nil {
		return "", "", err
	}
	token, err = newRemoteToken()
	if err != nil {
		return "", "", err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.pruneGrantsLocked(now)
	if len(a.state.Grants) >= remoteMaxGrants {
		return "", "", ErrRemoteGrantsFull
	}
	a.state.Grants = append(a.state.Grants, remoteGrantRecord{
		ID: id, Client: client, Scopes: scopes, Resource: strings.ToLower(resource),
		AccessHash: remoteTokenHash(token), AccessExpires: now.Add(remoteAccessTokenTTL).Unix(),
		Created: now.Unix(),
	})
	if err := a.saveLocked(); err != nil {
		a.state.Grants = a.state.Grants[:len(a.state.Grants)-1]
		return "", "", err
	}
	a.dirty = true
	slog.Info("remote: grant issued", "client", client, "scopes", strings.Join(scopes, " "))
	return id, token, nil
}

func normalizeRemoteScopes(scopes []string) []string {
	var out []string
	for _, s := range scopes {
		if (s == RemoteScopeRead || s == RemoteScopeOperate) && !slices.Contains(out, s) {
			out = append(out, s)
		} else if s != RemoteScopeRead && s != RemoteScopeOperate {
			return nil
		}
	}
	slices.Sort(out)
	return out
}

// AuthorizeBearer answers the grant behind token when it is current and was
// issued for resource, and counts the use. Anything else is ErrRemoteBearer:
// the reasons differ, the answer does not (§ S8.4).
func (a *RemoteAuth) AuthorizeBearer(token, resource string) (RemoteGrant, error) {
	if token == "" {
		return RemoteGrant{}, ErrRemoteBearer
	}
	hash := remoteTokenHash(token)
	resource = strings.ToLower(resource)
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for i := range a.state.Grants {
		g := &a.state.Grants[i]
		if g.AccessHash != hash {
			continue
		}
		if g.Resource != resource || now.Unix() >= g.AccessExpires {
			return RemoteGrant{}, ErrRemoteBearer
		}
		// Use is recorded in memory and reaches the file with the next
		// save; a crash loses a timestamp and nothing else.
		g.LastUsed = now.Unix()
		return RemoteGrant{ID: g.ID, Client: g.Client, Scopes: slices.Clone(g.Scopes)}, nil
	}
	return RemoteGrant{}, ErrRemoteBearer
}

// VerifyBearer is AuthorizeBearer in the shape the SDK's middleware takes,
// with the resource read from the request's Host.
func (a *RemoteAuth) VerifyBearer(_ context.Context, token string, r *http.Request) (*auth.TokenInfo, error) {
	g, err := a.AuthorizeBearer(token, RemoteResource(r.Host))
	if err != nil {
		return nil, err
	}
	// The middleware insists on an expiration and compares it with the wall
	// clock. The check above already decided, on the service's own clock, so
	// what goes here only has to keep the middleware's out of the way.
	return &auth.TokenInfo{UserID: g.Client, Scopes: g.Scopes, Expiration: time.Now().Add(remoteAccessTokenTTL),
		Extra: map[string]any{"grant": g.ID}}, nil
}

// Grants lists the live grants, oldest first, for Settings.
func (a *RemoteAuth) Grants() []models.RemoteGrant {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneGrantsLocked(a.now())
	out := make([]models.RemoteGrant, 0, len(a.state.Grants))
	for _, g := range a.state.Grants {
		out = append(out, models.RemoteGrant{
			ID: g.ID, Client: g.Client, Scopes: slices.Clone(g.Scopes),
			CreatedAt: g.Created * 1000, LastUsed: g.LastUsed * 1000, ExpiresAt: g.AccessExpires * 1000,
		})
	}
	return out
}

// RevokeGrant ends one grant: its next call is refused.
func (a *RemoteAuth) RevokeGrant(id string) error {
	defer a.flush()
	a.mu.Lock()
	defer a.mu.Unlock()
	i := slices.IndexFunc(a.state.Grants, func(g remoteGrantRecord) bool { return g.ID == id })
	if i < 0 {
		return ErrRemoteGrantUnknown
	}
	client := a.state.Grants[i].Client
	kept := slices.Delete(slices.Clone(a.state.Grants), i, i+1)
	previous := a.state.Grants
	a.state.Grants = kept
	if err := a.saveLocked(); err != nil {
		a.state.Grants = previous
		return err
	}
	a.dirty = true
	slog.Info("remote: grant revoked", "client", client)
	return nil
}

// pruneGrantsLocked drops grants whose access token has expired. Until #514
// adds refresh tokens an expired grant has no way back, so it is not kept.
func (a *RemoteAuth) pruneGrantsLocked(now time.Time) {
	kept := a.state.Grants[:0]
	for _, g := range a.state.Grants {
		if now.Unix() < g.AccessExpires {
			kept = append(kept, g)
		}
	}
	if len(kept) != len(a.state.Grants) {
		a.state.Grants = kept
		a.dirty = true
	}
}
