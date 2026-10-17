package services

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Konnekt is its own OAuth 2.1 authorization server for the MCP endpoint
// (#514, agent_docs/SECURITY_CHECKLIST.md § S9.6), with no identity provider
// behind it: the Remote Access password and the desktop's approval are what a
// consent costs, as they are for a new device (§ S8.6). The shape is the one
// the MCP authorization specification profiles and Claude's clients walk:
//
//   - RFC 9728 resource metadata at /.well-known/oauth-protected-resource
//     names this listener as the one authorization server, and RFC 8414
//     server metadata at /.well-known/oauth-authorization-server names the
//     endpoints below and what they accept.
//   - A client identifies itself with a Client ID Metadata Document URL
//     (remote_cimd.go) or registers at /register (RFC 7591); public clients
//     only, since a client secret inside Claude Code is not one.
//   - /authorize serves Konnekt's own consent page; the user types the
//     password, picks the scopes, and the desktop approves. The browser polls
//     /authorize/wait for the outcome and is sent back to the client with a
//     single-use code.
//   - /token trades the code, with its PKCE verifier, for an access token
//     and a refresh token, and later a refresh token for new ones.
//
// Every redirect goes to one of Claude's callback URLs and nowhere else
// (validRedirectURI), and a client_id URL is fetched from claude.ai and
// nowhere else (remoteCIMDHost), which is what keeps the connector to
// Claude's clients until a user-editable allowlist is a decision someone
// has made. validRedirectURI is named for CodeQL, which takes a function
// of that shape (isValidRedirect, isLocalURL) as the project's own check
// and stops reporting the redirect it guards as open.

const (
	RemotePRMPath           = "/.well-known/oauth-protected-resource"
	RemoteASMPath           = "/.well-known/oauth-authorization-server"
	RemoteRegisterPath      = "/register"
	RemoteAuthorizePath     = "/authorize"
	RemoteAuthorizeWaitPath = "/authorize/wait"
	RemoteTokenPath         = "/token"

	// RemoteClaudeRedirect is where claude.ai, Claude Desktop, mobile and
	// Cowork take a code. Claude Code uses a loopback URL on a port of its
	// choosing (validRedirectURI).
	// aislop-ignore-next-line ai-slop/hardcoded-url -- Claude's callback URL is the redirect allowlist (S9.6), not a deployment setting
	RemoteClaudeRedirect = "https://claude.ai/api/mcp/auth_callback"

	// remoteCIMDHost is the one host a Client ID Metadata Document is fetched
	// from: Claude Code's lives there, and a document anywhere else would be
	// an outbound request to an address a stranger chose.
	remoteCIMDHost = "claude.ai"

	// A consent page lives five minutes, like a pending device; a code two,
	// since the client exchanges it at once. A registered client that no
	// sign-in has used for thirty days is forgotten.
	remoteConsentTTL   = 5 * time.Minute
	remoteCodeTTL      = 2 * time.Minute
	remoteMaxConsents  = 8
	remoteMaxClients   = 32
	remoteClientUnused = 30 * 24 * time.Hour
	remoteOAuthMaxBody = 16 << 10

	// remoteConsentKey is the sign-in backoff bucket every consent shares
	// (§ S8.4): the page is reached by anyone with the URL, so it is judged
	// as an unapproved device is.
	remoteConsentKey = "oauth"
	// remoteConsentMethod is what the desktop prompt names a consent as.
	remoteConsentMethod = "ConnectorSignIn"
)

// RemoteOAuthGETPaths and RemoteOAuthPOSTPaths are the routes the listener
// gives ServeOAuth, by method.
var (
	RemoteOAuthGETPaths  = []string{RemotePRMPath, RemotePRMPath + RemoteMCPPath, RemoteASMPath, RemoteAuthorizePath, RemoteAuthorizeWaitPath}
	RemoteOAuthPOSTPaths = []string{RemoteRegisterPath, RemoteAuthorizePath, RemoteTokenPath}
)

// remoteClientRecord is a registered client (RFC 7591) as remote.json holds
// it. It is an identity, not a credential: public clients only.
type remoteClientRecord struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	RedirectURIs []string `json:"redirectUris"`
	Created      int64    `json:"created"`
	LastUsed     int64    `json:"lastUsed,omitempty"`
}

// remoteOAuthClient is a client as a consent knows it, whichever way it
// identified itself. Host is who vouches for the name: the metadata
// document's host, or empty for a client that only registered.
type remoteOAuthClient struct {
	ID        string
	Name      string
	Host      string
	Redirects []string
}

// remoteConsent is one sign-in from the consent page to the redirect back.
type remoteConsent struct {
	id, csrf    string
	client      remoteOAuthClient
	redirectURI string
	state       string
	challenge   string
	scopes      []string // asked for
	resource    string
	created     time.Time
	// Past the password the consent waits on the desktop; decided, it holds
	// the code to hand back or the error to redirect with.
	waiting bool
	decided bool
	granted []string
	code    string
	deny    string
}

// remoteCode is an authorization code waiting to be exchanged, keyed by its
// hash in RemoteAuth.codes.
type remoteCode struct {
	client      remoteOAuthClient
	redirectURI string
	challenge   string
	scopes      []string
	resource    string
	expires     time.Time
}

// remoteOAuthState is what the authorization server keeps in memory on a
// RemoteAuth: nothing here survives a restart, and nothing here needs to.
type remoteOAuthState struct {
	consents map[string]*remoteConsent // by request id
	codes    map[string]*remoteCode    // by code hash
	cimd     *cimdFetcher
	// approve is the desktop's say on a consent. nil refuses every one.
	approve RemoteApprover
}

func newRemoteOAuthState() remoteOAuthState {
	return remoteOAuthState{consents: map[string]*remoteConsent{}, codes: map[string]*remoteCode{}}
}

// SetConsentApprover installs what a consent waits on after the password:
// RemoteApprovals.Ask, with the client's name as the device. Without one
// every consent is declined.
func (a *RemoteAuth) SetConsentApprover(approve RemoteApprover) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.oauth.approve = approve
}

// remoteIssuer is the authorization server's identity for the host a
// request arrived at: the origin, with no path.
func remoteIssuer(host string) string {
	return strings.TrimSuffix(RemoteResource(host), RemoteMCPPath)
}

// validRedirectURI is the allowlist of callback URLs (§ S9.6): Claude's
// hosted callback exactly, and for Claude Code a loopback callback on any
// port. A query, a fragment or user info is refused with the rest.
func validRedirectURI(raw string) bool {
	if raw == RemoteClaudeRedirect {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/callback" {
		return false
	}
	return remoteLoopbackHost(u.Hostname())
}

func remoteLoopbackHost(h string) bool {
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// remoteRedirectRegistered says whether requested is one of a client's
// registered URIs: an exact match, or the same loopback host and path with
// the port left free, since Claude Code picks its port when it starts.
func remoteRedirectRegistered(registered []string, requested string) bool {
	if slices.Contains(registered, requested) {
		return true
	}
	want, err := url.Parse(requested)
	if err != nil || !remoteLoopbackHost(want.Hostname()) {
		return false
	}
	for _, r := range registered {
		have, err := url.Parse(r)
		if err == nil && have.Scheme == want.Scheme && have.Path == want.Path &&
			remoteLoopbackHost(have.Hostname()) && have.Hostname() == want.Hostname() {
			return true
		}
	}
	return false
}

// ServeOAuth answers every OAuth route. It reports whether it issued tokens,
// which is the one unauthenticated request that counts as activity.
func (a *RemoteAuth) ServeOAuth(w http.ResponseWriter, r *http.Request) bool {
	defer a.flush()
	w.Header().Set("Cache-Control", "no-store")
	switch r.URL.Path {
	case RemotePRMPath, RemotePRMPath + RemoteMCPPath:
		a.serveResourceMetadata(w, r)
	case RemoteASMPath:
		a.serveServerMetadata(w, r)
	case RemoteRegisterPath:
		a.serveRegister(w, r)
	case RemoteAuthorizePath:
		if r.Method == http.MethodGet {
			a.serveAuthorize(w, r)
		} else {
			a.serveConsent(w, r)
		}
	case RemoteAuthorizeWaitPath:
		a.serveAuthorizeWait(w, r)
	case RemoteTokenPath:
		return a.serveToken(w, r)
	default:
		http.NotFound(w, r)
	}
	return false
}

// ── Discovery ───────────────────────────────────────────────────────────

// serveResourceMetadata is RFC 9728: the resource is the connector URL
// exactly as a client was given it, and this listener is the only
// authorization server, since Claude reads only the first.
func (a *RemoteAuth) serveResourceMetadata(w http.ResponseWriter, r *http.Request) {
	writeRemoteJSON(w, http.StatusOK, map[string]any{
		"resource":                 RemoteResource(r.Host),
		"authorization_servers":    []string{remoteIssuer(r.Host)},
		"scopes_supported":         []string{RemoteScopeRead, RemoteScopeOperate},
		"bearer_methods_supported": []string{"header"},
		"resource_name":            "Konnekt",
	})
}

// serveServerMetadata is RFC 8414. Claude chooses a Client ID Metadata
// Document over registration only when the document flag is set and "none"
// is among the token endpoint methods, so both are here; PKCE S256 is the
// one challenge method, and the issuer parameter on the redirect (RFC 9207)
// is advertised so a client checks it.
func (a *RemoteAuth) serveServerMetadata(w http.ResponseWriter, r *http.Request) {
	issuer := remoteIssuer(r.Host)
	writeRemoteJSON(w, http.StatusOK, map[string]any{
		"issuer":                           issuer,
		"authorization_endpoint":           issuer + RemoteAuthorizePath,
		"token_endpoint":                   issuer + RemoteTokenPath,
		"registration_endpoint":            issuer + RemoteRegisterPath,
		"scopes_supported":                 []string{RemoteScopeRead, RemoteScopeOperate},
		"response_types_supported":         []string{"code"},
		"response_modes_supported":         []string{"query"},
		"grant_types_supported":            []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported": []string{"S256"},
		// aislop-ignore-next-line ai-slop/hardcoded-id -- an RFC 8414 or RFC 7591 field name, not an identifier
		"token_endpoint_auth_methods_supported": []string{"none"},
		// aislop-ignore-next-line ai-slop/hardcoded-id -- an RFC 8414 or RFC 7591 field name, not an identifier
		"client_id_metadata_document_supported":          true,
		"authorization_response_iss_parameter_supported": true,
	})
}

// ── Clients ─────────────────────────────────────────────────────────────

// remoteOAuthError is an RFC 6749 § 5.2 error body.
func remoteOAuthError(w http.ResponseWriter, status int, code, description string) {
	writeRemoteJSON(w, status, map[string]string{"error": code, "error_description": description})
}

type remoteRegistration struct {
	RedirectURIs []string `json:"redirect_uris"`
	ClientName   string   `json:"client_name"`
	// aislop-ignore-next-line ai-slop/hardcoded-id -- an RFC 8414 or RFC 7591 field name, not an identifier
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
}

// serveRegister is RFC 7591 for public clients whose callbacks are Claude's
// (§ S9.7): capped in number, forgotten after thirty days unused, and never
// given a secret.
func (a *RemoteAuth) serveRegister(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		remoteOAuthError(w, http.StatusBadRequest, "invalid_request", "expected application/json")
		return
	}
	var req remoteRegistration
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, remoteOAuthMaxBody)).Decode(&req); err != nil {
		remoteOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "malformed registration")
		return
	}
	if len(req.RedirectURIs) == 0 {
		remoteOAuthError(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uris is required")
		return
	}
	for _, u := range req.RedirectURIs {
		if !validRedirectURI(u) {
			remoteOAuthError(w, http.StatusBadRequest, "invalid_redirect_uri",
				"Konnekt sends sign-ins to Claude's callback URLs only")
			return
		}
	}
	if m := req.TokenEndpointAuthMethod; m != "" && m != "none" {
		remoteOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "public clients only: token_endpoint_auth_method must be none")
		return
	}
	for _, g := range req.GrantTypes {
		if g != "authorization_code" && g != "refresh_token" {
			remoteOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "grant_types may hold authorization_code and refresh_token only")
			return
		}
	}
	for _, t := range req.ResponseTypes {
		if t != "code" {
			remoteOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "response_types may hold code only")
			return
		}
	}
	id, err := newRemoteID()
	if err != nil {
		remoteOAuthError(w, http.StatusInternalServerError, "server_error", "could not register")
		return
	}
	rec := remoteClientRecord{ID: id, Name: cleanRemoteClient(req.ClientName), RedirectURIs: req.RedirectURIs}

	a.mu.Lock()
	now := a.now()
	a.pruneClientsLocked(now)
	if len(a.state.Clients) >= remoteMaxClients {
		a.mu.Unlock()
		remoteOAuthError(w, http.StatusBadRequest, "invalid_client_metadata",
			fmt.Sprintf("at most %d clients can be registered; one unused for thirty days is forgotten", remoteMaxClients))
		return
	}
	rec.Created = now.Unix()
	a.state.Clients = append(a.state.Clients, rec)
	if err := a.saveLocked(); err != nil {
		a.state.Clients = a.state.Clients[:len(a.state.Clients)-1]
		a.mu.Unlock()
		remoteOAuthError(w, http.StatusInternalServerError, "server_error", "could not save the registration")
		return
	}
	a.mu.Unlock()
	slog.Info("remote: client registered", "client", rec.Name)
	writeRemoteJSON(w, http.StatusCreated, map[string]any{
		"client_id": rec.ID,
		// aislop-ignore-next-line ai-slop/hardcoded-id -- an RFC 8414 or RFC 7591 field name, not an identifier
		"client_id_issued_at": rec.Created,
		"client_name":         rec.Name,
		"redirect_uris":       rec.RedirectURIs,
		// aislop-ignore-next-line ai-slop/hardcoded-id -- an RFC 8414 or RFC 7591 field name, not an identifier
		"token_endpoint_auth_method": "none",
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
	})
}

// pruneClientsLocked forgets the registrations nothing has used in thirty
// days. Caller holds a.mu.
func (a *RemoteAuth) pruneClientsLocked(now time.Time) {
	kept := a.state.Clients[:0]
	for _, c := range a.state.Clients {
		if now.Unix() < max(c.LastUsed, c.Created)+int64(remoteClientUnused/time.Second) {
			kept = append(kept, c)
		}
	}
	if len(kept) != len(a.state.Clients) {
		a.state.Clients = kept
		if err := a.saveLocked(); err != nil {
			slog.Error("remote: save after forgetting clients", "error", err)
		}
	}
}

var errRemoteClientUnknown = errors.New("the client is not registered with Konnekt; sign in again from Claude")

// resolveClient answers who clientID is: a metadata document fetched from
// its URL, or a registration. The fetch is a network request and is made
// with a.mu released.
func (a *RemoteAuth) resolveClient(ctx context.Context, clientID string) (remoteOAuthClient, error) {
	if strings.HasPrefix(clientID, "https://") {
		a.mu.Lock()
		if a.oauth.cimd == nil {
			a.oauth.cimd = newCIMDFetcher()
		}
		fetcher := a.oauth.cimd
		a.mu.Unlock()
		doc, err := fetcher.Fetch(ctx, clientID)
		if err != nil {
			return remoteOAuthClient{}, err
		}
		if m := doc.TokenEndpointAuthMethod; m != "" && m != "none" {
			return remoteOAuthClient{}, fmt.Errorf("%w: public clients only", ErrCIMDDoc)
		}
		u, err := url.Parse(clientID)
		if err != nil {
			return remoteOAuthClient{}, ErrCIMDURL
		}
		name := doc.ClientName
		if strings.TrimSpace(name) == "" {
			name = u.Hostname()
		}
		return remoteOAuthClient{ID: clientID, Name: cleanRemoteClient(name), Host: u.Hostname(), Redirects: doc.RedirectURIs}, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.pruneClientsLocked(now)
	for i := range a.state.Clients {
		c := &a.state.Clients[i]
		if c.ID == clientID {
			// Use is recorded in memory and reaches the file with the next
			// save, as a grant's is.
			c.LastUsed = now.Unix()
			return remoteOAuthClient{ID: c.ID, Name: c.Name, Redirects: slices.Clone(c.RedirectURIs)}, nil
		}
	}
	return remoteOAuthClient{}, errRemoteClientUnknown
}

// ── Consent ─────────────────────────────────────────────────────────────

// remoteConsentCSP is the consent page's own policy: no scripts, no
// resources, inline style only, forms to this origin only, never framed.
const remoteConsentCSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"

type remoteScopeView struct {
	Scope   string
	Text    string
	Checked bool
}

type remoteConsentView struct {
	Title        string
	Client       string
	ClientHost   string
	RedirectHost string
	Loopback     bool
	Message      string
	ID, CSRF     string
	Scopes       []remoteScopeView
	// WaitURL is set on the waiting page, which refreshes itself to it.
	WaitURL string
	// Plain is set on an error page, which has no form.
	Plain bool
}

var remoteScopeText = map[string]string{
	RemoteScopeRead:    "See your servers, players, console and schedules",
	RemoteScopeOperate: "Start, stop and restart servers, run commands and manage players",
}

var remoteConsentTemplate = template.Must(template.New("consent").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
{{if .WaitURL}}<meta http-equiv="refresh" content="2;url={{.WaitURL}}">{{end}}
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e6e6e6;font:16px/1.5 system-ui,sans-serif}
main{width:min(92vw,28rem);padding:1.75rem;border:1px solid #2a2f3a;border-radius:12px;background:#161a22}
h1{font-size:1.25rem;margin:0 0 .75rem}
p{margin:.5rem 0}
.who,.hint{color:#9aa3b2;font-size:.9rem}
.warn{color:#f5c26b}
.error{color:#ff7b72}
fieldset{border:1px solid #2a2f3a;border-radius:8px;margin:1rem 0;padding:.5rem 1rem}
legend{color:#9aa3b2;font-size:.9rem;padding:0 .25rem}
label{display:block;margin:.5rem 0}
input[type=password]{display:block;width:100%;box-sizing:border-box;margin-top:.25rem;padding:.6rem;border:1px solid #2a2f3a;border-radius:8px;background:#0f1115;color:inherit;font:inherit}
button{font:inherit;padding:.6rem 1.1rem;border-radius:8px;border:1px solid #2a2f3a;background:#1f2633;color:inherit;cursor:pointer;margin:.75rem .5rem 0 0}
button[value=allow]{background:#2f6feb;border-color:#2f6feb;color:#fff}
</style></head><body><main>
<h1>{{.Title}}</h1>
{{if .Plain}}<p>{{.Message}}</p>{{else if .WaitURL}}
<p>Konnekt on the desktop is asking whether to let <strong>{{.Client}}</strong> connect. Allow it there.</p>
<p class="hint">This page checks again every two seconds. <a href="{{.WaitURL}}">Check now</a>.</p>
{{else}}
{{if .ClientHost}}<p class="who">Identified by {{.ClientHost}}</p>{{end}}
<p>After you allow it, Claude is sent back to <strong>{{.RedirectHost}}</strong>.</p>
{{if .Loopback}}<p class="warn">That is a program on the computer this browser runs on. Allow it only if you started this sign-in yourself.</p>{{end}}
{{if .Message}}<p class="error" role="alert">{{.Message}}</p>{{end}}
<form method="post" action="/authorize">
<input type="hidden" name="request" value="{{.ID}}"><input type="hidden" name="csrf" value="{{.CSRF}}">
<fieldset><legend>Allow it to</legend>
{{range .Scopes}}<label><input type="checkbox" name="scope" value="{{.Scope}}"{{if .Checked}} checked{{end}}> {{.Text}}</label>{{end}}
</fieldset>
<label>Remote Access password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<p class="hint">Konnekt on the desktop asks once more before anything is connected.</p>
<button name="action" value="allow">Allow</button><button name="action" value="deny" formnovalidate>Cancel</button>
</form>
{{end}}
</main></body></html>
`))

func writeRemoteConsentPage(w http.ResponseWriter, status int, view remoteConsentView) {
	w.Header().Set("Content-Security-Policy", remoteConsentCSP)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := remoteConsentTemplate.Execute(w, view); err != nil {
		slog.Debug("remote: write consent page", "error", err)
	}
}

// remoteConsentError is a sign-in that ends on this page rather than back at
// the client: nothing is known yet about where the client may be sent.
func remoteConsentError(w http.ResponseWriter, status int, message string) {
	writeRemoteConsentPage(w, status, remoteConsentView{Title: "Konnekt could not start this sign-in", Message: message, Plain: true})
}

// consentView builds the page for c. Caller holds a.mu.
func consentView(c *remoteConsent, message string) remoteConsentView {
	u, err := url.Parse(c.redirectURI)
	host := c.redirectURI
	loopback := false
	if err == nil {
		host = u.Host
		loopback = remoteLoopbackHost(u.Hostname())
	}
	view := remoteConsentView{Title: "Connect " + c.client.Name + " to Konnekt", Client: c.client.Name, ClientHost: c.client.Host,
		RedirectHost: host, Loopback: loopback, Message: message, ID: c.id, CSRF: c.csrf}
	for _, s := range c.scopes {
		view.Scopes = append(view.Scopes, remoteScopeView{Scope: s, Text: remoteScopeText[s], Checked: s == RemoteScopeRead})
	}
	return view
}

// remoteRedirectTo sends the browser to base with params added, which is
// how both a code and an error reach the client (RFC 6749 § 4.1.2).
func remoteRedirectTo(w http.ResponseWriter, r *http.Request, base string, params map[string]string) {
	u, err := url.Parse(base)
	if err != nil {
		remoteConsentError(w, http.StatusBadRequest, "The redirect URL could not be parsed.")
		return
	}
	q := u.Query()
	for k, v := range params {
		if v != "" {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusSeeOther)
}

func (a *RemoteAuth) redirectError(w http.ResponseWriter, r *http.Request, redirect, state, code, description string) {
	remoteRedirectTo(w, r, redirect, map[string]string{
		"error": code, "error_description": description, "state": state, "iss": remoteIssuer(r.Host)})
}

// validPKCEChallenge is a base64url SHA-256: 43 characters of its alphabet.
func validPKCEChallenge(c string) bool {
	if len(c) != 43 {
		return false
	}
	for _, r := range c {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

// pkceMatches is RFC 7636 S256: BASE64URL(SHA256(verifier)) == challenge,
// compared in constant time.
func pkceMatches(verifier, challenge string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	got := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(got), []byte(challenge)) == 1
}

// serveAuthorize is GET /authorize: the request is checked and the consent
// page shown. Until the redirect URI is known to be the client's and one of
// Claude's, an error stays on this page; after that it goes back to the
// client, as the specification has it.
func (a *RemoteAuth) serveAuthorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	clientID := q.Get("client_id")
	if clientID == "" {
		remoteConsentError(w, http.StatusBadRequest, "The sign-in request names no client.")
		return
	}
	client, err := a.resolveClient(r.Context(), clientID)
	if err != nil {
		slog.Warn("remote: consent refused, client", "error", err)
		remoteConsentError(w, http.StatusBadRequest, "Konnekt could not verify the client: "+err.Error()+".")
		return
	}
	redirect := q.Get("redirect_uri")
	if redirect == "" && len(client.Redirects) == 1 {
		redirect = client.Redirects[0]
	}
	if !validRedirectURI(redirect) || !remoteRedirectRegistered(client.Redirects, redirect) {
		slog.Warn("remote: consent refused, redirect", "client", client.Name)
		remoteConsentError(w, http.StatusBadRequest, "The redirect URL is not one Konnekt sends sign-ins to.")
		return
	}
	state := q.Get("state")
	if q.Get("response_type") != "code" {
		a.redirectError(w, r, redirect, state, "unsupported_response_type", "response_type must be code")
		return
	}
	challenge := q.Get("code_challenge")
	if q.Get("code_challenge_method") != "S256" || !validPKCEChallenge(challenge) {
		a.redirectError(w, r, redirect, state, "invalid_request", "PKCE with S256 is required")
		return
	}
	resource := RemoteResource(r.Host)
	if res := q.Get("resource"); res != "" && !strings.EqualFold(res, resource) {
		a.redirectError(w, r, redirect, state, "invalid_target", "the resource is "+resource)
		return
	}
	scopes := strings.Fields(q.Get("scope"))
	if len(scopes) == 0 {
		scopes = []string{RemoteScopeRead}
	}
	if scopes = normalizeRemoteScopes(scopes); scopes == nil {
		a.redirectError(w, r, redirect, state, "invalid_scope", "scopes are konnekt:read and konnekt:operate")
		return
	}
	if !a.PasswordSet() {
		remoteConsentError(w, http.StatusForbidden, "Remote sign-in has not been set up on the desktop.")
		return
	}
	id, err := newRemoteID()
	if err != nil {
		remoteConsentError(w, http.StatusInternalServerError, "Konnekt could not start the sign-in.")
		return
	}
	csrf, err := newRemoteToken()
	if err != nil {
		remoteConsentError(w, http.StatusInternalServerError, "Konnekt could not start the sign-in.")
		return
	}
	c := &remoteConsent{id: id, csrf: csrf, client: client, redirectURI: redirect, state: state,
		challenge: challenge, scopes: scopes, resource: resource}

	a.mu.Lock()
	now := a.now()
	a.pruneConsentsLocked(now)
	if len(a.oauth.consents) >= remoteMaxConsents {
		a.mu.Unlock()
		remoteConsentError(w, http.StatusServiceUnavailable, "Too many sign-ins are waiting. Try again in a few minutes.")
		return
	}
	c.created = now
	a.oauth.consents[id] = c
	view := consentView(c, "")
	a.mu.Unlock()
	writeRemoteConsentPage(w, http.StatusOK, view)
}

// consentLocked finds the live consent a form names, or nil. Caller holds
// a.mu.
func (a *RemoteAuth) consentLocked(id, csrf string) *remoteConsent {
	a.pruneConsentsLocked(a.now())
	c := a.oauth.consents[id]
	if c == nil || subtle.ConstantTimeCompare([]byte(c.csrf), []byte(csrf)) != 1 {
		return nil
	}
	return c
}

func (a *RemoteAuth) pruneConsentsLocked(now time.Time) {
	for id, c := range a.oauth.consents {
		if now.Sub(c.created) > remoteConsentTTL {
			delete(a.oauth.consents, id)
		}
	}
}

func (a *RemoteAuth) pruneCodesLocked(now time.Time) {
	for hash, c := range a.oauth.codes {
		if !now.Before(c.expires) {
			delete(a.oauth.codes, hash)
		}
	}
}

const remoteConsentExpired = "This sign-in page has expired. Go back to Claude and start again."

// serveConsent is POST /authorize: the page's answer. The password is
// checked under the sign-in backoff; right, the desktop is asked, and the
// browser is sent to wait for its answer.
func (a *RemoteAuth) serveConsent(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/x-www-form-urlencoded") {
		remoteConsentError(w, http.StatusUnsupportedMediaType, "The form was not sent as a form.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, remoteOAuthMaxBody)
	if err := r.ParseForm(); err != nil {
		remoteConsentError(w, http.StatusBadRequest, "The form could not be read.")
		return
	}
	id, csrf := r.PostForm.Get("request"), r.PostForm.Get("csrf")

	a.mu.Lock()
	c := a.consentLocked(id, csrf)
	if c == nil {
		a.mu.Unlock()
		remoteConsentError(w, http.StatusBadRequest, remoteConsentExpired)
		return
	}
	if c.waiting {
		a.mu.Unlock()
		http.Redirect(w, r, remoteWaitURL(c), http.StatusSeeOther)
		return
	}
	if r.PostForm.Get("action") == "deny" {
		delete(a.oauth.consents, id)
		redirect, state := c.redirectURI, c.state
		a.mu.Unlock()
		slog.Info("remote: consent cancelled", "client", c.client.Name)
		a.redirectError(w, r, redirect, state, "access_denied", "the user cancelled")
		return
	}
	var granted []string
	for _, s := range r.PostForm["scope"] {
		if slices.Contains(c.scopes, s) {
			granted = append(granted, s)
		}
	}
	if slices.Contains(granted, RemoteScopeOperate) && !slices.Contains(granted, RemoteScopeRead) {
		// Operating a server includes seeing it (remote_grants.go).
		granted = append(granted, RemoteScopeRead)
	}
	granted = normalizeRemoteScopes(granted)
	password := r.PostForm.Get("password")
	if len(granted) == 0 || password == "" {
		message := "Tick at least one permission."
		if password == "" {
			message = "Type the Remote Access password."
		}
		view := consentView(c, message)
		a.mu.Unlock()
		writeRemoteConsentPage(w, http.StatusBadRequest, view)
		return
	}
	encoded := a.state.Password
	wait, admitted := a.beginLoginLocked(remoteConsentKey)
	if !admitted {
		view := consentView(c, "Too many wrong passwords. Try again in "+wait.Round(time.Second).String()+".")
		a.mu.Unlock()
		w.Header().Set("Retry-After", strconv.Itoa(int(wait/time.Second)+1))
		writeRemoteConsentPage(w, http.StatusTooManyRequests, view)
		return
	}
	a.mu.Unlock()

	ok := false
	if encoded != "" && len(password) <= remotePasswordMax*utf8.UTFMax {
		a.verifyMu.Lock()
		ok = verifyRemotePassword(password, encoded)
		a.verifyMu.Unlock()
	}

	a.mu.Lock()
	a.endLoginLocked(remoteConsentKey, ok)
	// Looked up again: the page may have expired while argon2 ran.
	if c = a.consentLocked(id, csrf); c == nil {
		a.mu.Unlock()
		remoteConsentError(w, http.StatusBadRequest, remoteConsentExpired)
		return
	}
	if !ok {
		// One line per counted failure, never the password (§ S8.9).
		slog.Warn("remote: consent refused, password", "client", c.client.Name)
		view := consentView(c, "Wrong password.")
		a.mu.Unlock()
		writeRemoteConsentPage(w, http.StatusUnauthorized, view)
		return
	}
	c.waiting = true
	c.granted = granted
	approve := a.oauth.approve
	client := c.client
	view := remoteConsentView{Title: "Waiting for the desktop", Client: client.Name, WaitURL: remoteWaitURL(c)}
	a.mu.Unlock()

	if approve == nil {
		a.decideConsent(id, errors.New("no desktop to ask"))
	} else {
		reason := client.Name + " wants to connect to Konnekt and " + strings.Join(remoteScopeSummary(granted), ", ")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), remoteConsentTTL)
			defer cancel()
			a.decideConsent(id, approve(ctx, RemoteApprovalRequest{Device: client.Name, Method: remoteConsentMethod, Reason: reason}))
		}()
	}
	writeRemoteConsentPage(w, http.StatusOK, view)
}

func remoteScopeSummary(scopes []string) []string {
	var out []string
	for _, s := range scopes {
		out = append(out, strings.ToLower(remoteScopeText[s][:1])+remoteScopeText[s][1:])
	}
	return out
}

func remoteWaitURL(c *remoteConsent) string {
	return RemoteAuthorizeWaitPath + "?" + url.Values{"request": {c.id}, "csrf": {c.csrf}}.Encode()
}

// decideConsent records the desktop's answer: a code to hand back, or the
// error to send the client.
func (a *RemoteAuth) decideConsent(id string, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c := a.oauth.consents[id]
	if c == nil || c.decided {
		return
	}
	c.decided = true
	if err != nil {
		c.deny = "access_denied"
		slog.Info("remote: consent declined", "client", c.client.Name, "reason", err)
		return
	}
	code, err := newRemoteToken()
	if err != nil {
		c.deny = "server_error"
		slog.Error("remote: consent code", "error", err)
		return
	}
	now := a.now()
	a.pruneCodesLocked(now)
	a.oauth.codes[remoteTokenHash(code)] = &remoteCode{client: c.client, redirectURI: c.redirectURI, challenge: c.challenge,
		scopes: c.granted, resource: c.resource, expires: now.Add(remoteCodeTTL)}
	c.code = code
	slog.Info("remote: consent granted", "client", c.client.Name, "scopes", strings.Join(c.granted, " "))
}

// serveAuthorizeWait is GET /authorize/wait: the waiting page again until
// the desktop has answered, then the redirect back to the client with the
// code and the issuer (RFC 9207), or with access_denied.
func (a *RemoteAuth) serveAuthorizeWait(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	a.mu.Lock()
	c := a.consentLocked(q.Get("request"), q.Get("csrf"))
	if c == nil || !c.waiting {
		a.mu.Unlock()
		remoteConsentError(w, http.StatusBadRequest, remoteConsentExpired)
		return
	}
	if !c.decided {
		view := remoteConsentView{Title: "Waiting for the desktop", Client: c.client.Name, WaitURL: remoteWaitURL(c)}
		a.mu.Unlock()
		writeRemoteConsentPage(w, http.StatusOK, view)
		return
	}
	delete(a.oauth.consents, c.id)
	a.mu.Unlock()
	if c.code == "" {
		a.redirectError(w, r, c.redirectURI, c.state, c.deny, "the desktop did not allow the connection")
		return
	}
	remoteRedirectTo(w, r, c.redirectURI, map[string]string{"code": c.code, "state": c.state, "iss": remoteIssuer(r.Host)})
}

// ── Tokens ──────────────────────────────────────────────────────────────

// serveToken is POST /token, form-encoded as RFC 6749 has it. A code is
// spent on its first presentation whatever happens next, so a second one,
// or a wrong verifier after a right code, buys nothing.
func (a *RemoteAuth) serveToken(w http.ResponseWriter, r *http.Request) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/x-www-form-urlencoded") {
		remoteOAuthError(w, http.StatusBadRequest, "invalid_request", "expected application/x-www-form-urlencoded")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, remoteOAuthMaxBody)
	if err := r.ParseForm(); err != nil {
		remoteOAuthError(w, http.StatusBadRequest, "invalid_request", "malformed form")
		return false
	}
	form := r.PostForm
	clientID := form.Get("client_id")
	switch form.Get("grant_type") {
	case "authorization_code":
		tokens, err := a.exchangeCode(form.Get("code"), form.Get("code_verifier"), clientID, form.Get("redirect_uri"), form.Get("resource"))
		if err != nil {
			remoteTokenError(w, err)
			return false
		}
		writeRemoteTokens(w, tokens)
		return true
	case "refresh_token":
		tokens, err := a.RefreshGrant(form.Get("refresh_token"), clientID)
		if err != nil {
			remoteTokenError(w, err)
			return false
		}
		writeRemoteTokens(w, tokens)
		return true
	default:
		remoteOAuthError(w, http.StatusBadRequest, "unsupported_grant_type", "grant_type is authorization_code or refresh_token")
		return false
	}
}

var (
	errRemoteCode   = errors.New("the code is unknown, expired, spent, or not this client's")
	errRemoteTarget = errors.New("the resource is not the one the code was issued for")
)

// exchangeCode spends code and issues the grant it stood for.
func (a *RemoteAuth) exchangeCode(code, verifier, clientID, redirect, resource string) (remoteTokens, error) {
	if code == "" {
		return remoteTokens{}, errRemoteCode
	}
	defer a.flush()
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.pruneCodesLocked(now)
	hash := remoteTokenHash(code)
	entry := a.oauth.codes[hash]
	delete(a.oauth.codes, hash)
	if entry == nil || entry.client.ID != clientID || (redirect != "" && redirect != entry.redirectURI) || !pkceMatches(verifier, entry.challenge) {
		slog.Warn("remote: code exchange refused")
		return remoteTokens{}, errRemoteCode
	}
	if resource != "" && !strings.EqualFold(resource, entry.resource) {
		return remoteTokens{}, errRemoteTarget
	}
	redirectHost := entry.redirectURI
	if u, err := url.Parse(redirectHost); err == nil && u.Hostname() != "" {
		redirectHost = u.Hostname()
	}
	_, tokens, err := a.issueGrantLocked(entry.client.Name, entry.client.ID, redirectHost, entry.scopes, entry.resource, true)
	return tokens, err
}

func remoteTokenError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errRemoteCode), errors.Is(err, ErrRemoteBearer):
		remoteOAuthError(w, http.StatusBadRequest, "invalid_grant", err.Error())
	case errors.Is(err, errRemoteTarget):
		remoteOAuthError(w, http.StatusBadRequest, "invalid_target", err.Error())
	case errors.Is(err, ErrRemoteGrantsFull), errors.Is(err, ErrRemoteScope), errors.Is(err, ErrRemoteResource):
		remoteOAuthError(w, http.StatusBadRequest, "invalid_request", err.Error())
	default:
		slog.Error("remote: token", "error", err)
		remoteOAuthError(w, http.StatusInternalServerError, "server_error", "could not issue tokens")
	}
}

func writeRemoteTokens(w http.ResponseWriter, t remoteTokens) {
	w.Header().Set("Pragma", "no-cache")
	writeRemoteJSON(w, http.StatusOK, map[string]any{
		"access_token":  t.Access,
		"token_type":    "Bearer",
		"expires_in":    t.ExpiresIn,
		"refresh_token": t.Refresh,
		"scope":         strings.Join(t.Scopes, " "),
	})
}
