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
	// A refresh token keeps a grant alive for thirty days from its last use
	// and ninety from its consent, whichever ends first (§ S9.6). A grant
	// with no refresh token ends with its access token.
	remoteGrantUnused   = 30 * 24 * time.Hour
	remoteGrantLifetime = 90 * 24 * time.Hour
	remoteMaxGrants     = 16
	remoteClientNameMax = 60
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
	ID     string `json:"id"`
	Client string `json:"client"`
	// ClientID is the OAuth client the grant was consented to (#514): a
	// Client ID Metadata Document URL or a registered id. A refresh is
	// accepted from that client and no other.
	ClientID string `json:"clientId,omitempty"`
	// Redirect is the host the sign-in went back to, for Settings.
	Redirect   string   `json:"redirect,omitempty"`
	Scopes     []string `json:"scopes"`
	Resource   string   `json:"resource"`
	AccessHash string   `json:"accessHash"`
	// AccessExpires is Unix seconds.
	AccessExpires int64 `json:"accessExpires"`
	// RefreshHash is the current refresh token; PrevRefreshHash the one it
	// replaced, kept so a replay of it is recognised and ends the grant
	// (§ S9.6). Empty for a grant that was issued with no refresh token.
	RefreshHash     string `json:"refreshHash,omitempty"`
	PrevRefreshHash string `json:"prevRefreshHash,omitempty"`
	Created         int64  `json:"created"`
	LastUsed        int64  `json:"lastUsed,omitempty"`
}

// remoteTokens is what /token hands a client: the one copy of each.
type remoteTokens struct {
	Access    string
	Refresh   string
	ExpiresIn int
	Scopes    []string
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

// IssueGrant creates a grant for client with scopes, good for resource, with
// an access token only, and returns its id and the one copy of that token.
// Without a refresh token the grant ends with the hour. The consent flow
// (remote_oauth.go) issues through issueGrantLocked with both tokens; this is
// the plain form, for tests and for a token minted at the desktop.
func (a *RemoteAuth) IssueGrant(client string, scopes []string, resource string) (id, token string, err error) {
	defer a.flush()
	a.mu.Lock()
	defer a.mu.Unlock()
	id, tokens, err := a.issueGrantLocked(client, "", "", scopes, resource, false)
	if err != nil {
		return "", "", err
	}
	return id, tokens.Access, nil
}

// cleanRemoteClient clamps a client's name, which is third-party text, to
// what a prompt can show.
func cleanRemoteClient(client string) string {
	client = cleanRemoteAgent(client)
	if client == "" {
		client = "unnamed client"
	}
	if len(client) > remoteClientNameMax {
		client = client[:remoteClientNameMax]
	}
	return client
}

// issueGrantLocked records a grant and mints its tokens. clientID binds a
// later refresh to the client the user consented to, redirect is the host
// the sign-in went back to, and refresh says whether to mint one. Caller
// holds a.mu and defers flush.
func (a *RemoteAuth) issueGrantLocked(client, clientID, redirect string, scopes []string, resource string, refresh bool) (string, remoteTokens, error) {
	client = cleanRemoteClient(client)
	scopes = normalizeRemoteScopes(scopes)
	if len(scopes) == 0 {
		return "", remoteTokens{}, ErrRemoteScope
	}
	if !strings.HasPrefix(resource, "https://") && !strings.HasPrefix(resource, "http://") || !strings.HasSuffix(resource, RemoteMCPPath) {
		return "", remoteTokens{}, ErrRemoteResource
	}
	id, err := newRemoteID()
	if err != nil {
		return "", remoteTokens{}, err
	}
	now := a.now()
	a.pruneGrantsLocked(now)
	if len(a.state.Grants) >= remoteMaxGrants {
		return "", remoteTokens{}, ErrRemoteGrantsFull
	}
	rec := remoteGrantRecord{ID: id, Client: client, ClientID: clientID, Redirect: redirect, Scopes: scopes,
		Resource: strings.ToLower(resource), Created: now.Unix()}
	tokens, err := a.mintLocked(&rec, refresh)
	if err != nil {
		return "", remoteTokens{}, err
	}
	a.state.Grants = append(a.state.Grants, rec)
	if err := a.saveLocked(); err != nil {
		a.state.Grants = a.state.Grants[:len(a.state.Grants)-1]
		return "", remoteTokens{}, err
	}
	a.dirty = true
	slog.Info("remote: grant issued", "client", client, "scopes", strings.Join(scopes, " "))
	return id, tokens, nil
}

// mintLocked gives rec a fresh access token and, if asked, a fresh refresh
// token, keeping the one it replaces so a replay is recognised.
func (a *RemoteAuth) mintLocked(rec *remoteGrantRecord, refresh bool) (remoteTokens, error) {
	access, err := newRemoteToken()
	if err != nil {
		return remoteTokens{}, err
	}
	now := a.now()
	rec.AccessHash = remoteTokenHash(access)
	rec.AccessExpires = now.Add(remoteAccessTokenTTL).Unix()
	tokens := remoteTokens{Access: access, ExpiresIn: int(remoteAccessTokenTTL / time.Second), Scopes: slices.Clone(rec.Scopes)}
	if refresh {
		token, err := newRemoteToken()
		if err != nil {
			return remoteTokens{}, err
		}
		rec.PrevRefreshHash = rec.RefreshHash
		rec.RefreshHash = remoteTokenHash(token)
		tokens.Refresh = token
	}
	return tokens, nil
}

// RefreshGrant trades a refresh token for new tokens (§ S9.6): the old one
// stops working at once, and a replay of it ends the grant, since someone
// other than the client holds it. clientID has to be the grant's. Every
// failure is ErrRemoteBearer, which /token reports as invalid_grant.
func (a *RemoteAuth) RefreshGrant(refresh, clientID string) (remoteTokens, error) {
	defer a.flush()
	if refresh == "" {
		return remoteTokens{}, ErrRemoteBearer
	}
	hash := remoteTokenHash(refresh)
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.pruneGrantsLocked(now)
	for i := range a.state.Grants {
		g := &a.state.Grants[i]
		switch hash {
		case g.RefreshHash:
			if g.ClientID != clientID {
				return remoteTokens{}, ErrRemoteBearer
			}
			tokens, err := a.mintLocked(g, true)
			if err != nil {
				return remoteTokens{}, err
			}
			g.LastUsed = now.Unix()
			if err := a.saveLocked(); err != nil {
				return remoteTokens{}, err
			}
			a.dirty = true
			return tokens, nil
		case g.PrevRefreshHash:
			client := g.Client
			a.state.Grants = slices.Delete(a.state.Grants, i, i+1)
			if err := a.saveLocked(); err != nil {
				slog.Error("remote: save after refresh replay", "error", err)
			}
			a.dirty = true
			slog.Warn("remote: refresh token replayed, grant ended", "client", client)
			return remoteTokens{}, ErrRemoteBearer
		}
	}
	return remoteTokens{}, ErrRemoteBearer
}

// normalizeRemoteScopes sorts and deduplicates scopes, adds read to operate
// (operating a server includes seeing it, and the endpoint's challenge asks
// for read of every grant), and answers nil for a scope it does not know.
func normalizeRemoteScopes(scopes []string) []string {
	var out []string
	for _, s := range scopes {
		if (s == RemoteScopeRead || s == RemoteScopeOperate) && !slices.Contains(out, s) {
			out = append(out, s)
		} else if s != RemoteScopeRead && s != RemoteScopeOperate {
			return nil
		}
	}
	if slices.Contains(out, RemoteScopeOperate) && !slices.Contains(out, RemoteScopeRead) {
		out = append(out, RemoteScopeRead)
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
			ID: g.ID, Client: g.Client, Redirect: g.Redirect, Scopes: slices.Clone(g.Scopes),
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

// RevokeGrants ends every grant (#515).
func (a *RemoteAuth) RevokeGrants() error {
	defer a.flush()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.state.Grants) == 0 {
		return nil
	}
	previous := a.state.Grants
	a.state.Grants = nil
	if err := a.saveLocked(); err != nil {
		a.state.Grants = previous
		return err
	}
	a.dirty = true
	slog.Info("remote: every grant revoked", "count", len(previous))
	return nil
}

// pruneGrantsLocked drops the grants that have ended: ninety days after the
// consent, thirty days after the last use, or, with no refresh token to come
// back on, when the access token expired.
func (a *RemoteAuth) pruneGrantsLocked(now time.Time) {
	kept := a.state.Grants[:0]
	for _, g := range a.state.Grants {
		last := max(g.LastUsed, g.Created)
		alive := now.Unix() < g.Created+int64(remoteGrantLifetime/time.Second) &&
			now.Unix() < last+int64(remoteGrantUnused/time.Second) &&
			(g.RefreshHash != "" || now.Unix() < g.AccessExpires)
		if alive {
			kept = append(kept, g)
		}
	}
	if len(kept) != len(a.state.Grants) {
		a.state.Grants = kept
		a.dirty = true
	}
}
