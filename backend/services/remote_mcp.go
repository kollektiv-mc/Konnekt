package services

import (
	"context"
	"net/http"
	"sync/atomic"

	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The MCP endpoint on the remote listener (#513, § S9.5): Streamable HTTP at
// POST /mcp, reached through the tunnel, serving the same catalog as the local
// bridge. It is stateless: every request stands on its bearer token, there is
// no Mcp-Session-Id, and a GET is a 405. The token comes in Authorization and
// nowhere else; the dashboard's cookie is not read here and this token is not
// read by /api/rpc, so one credential never unlocks the other surface.
//
// Only a bearer check and the Host guard stand between the tunnel and the
// catalog, which is why the endpoint answers 404 until "Allow Claude
// connectors" is on, and why that switch is off by default.

// remoteBearerVerifier is the half of an authorizer that checks a bearer
// token for the MCP endpoint. RemoteAuth is the implementation; without it
// the endpoint refuses everyone.
type remoteBearerVerifier interface {
	VerifyBearer(ctx context.Context, token string, r *http.Request) (*auth.TokenInfo, error)
}

// SetMCPServer installs the catalog the endpoint serves. Without one the
// endpoint is a 404 whatever the switch says.
func (s *RemoteService) SetMCPServer(server *mcp.Server) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mcp = nil
	if server != nil {
		s.mcp = mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server },
			&mcp.StreamableHTTPOptions{Stateless: true})
	}
}

// SetMCPEnabled is the switch. Off, the endpoint does not exist.
func (s *RemoteService) SetMCPEnabled(on bool) { s.mcpOn.Store(on) }

// MCPEnabled reports the switch.
func (s *RemoteService) MCPEnabled() bool { return s.mcpOn.Load() }

// SetHoldOpen keeps the listener up past the idle period (§ S9.10). The app
// sets it only while a named tunnel is configured and the connectors switch
// is on, and clears it when either goes, which restores the idle stop.
func (s *RemoteService) SetHoldOpen(hold bool) {
	s.holdOpen.Store(hold)
	if !hold {
		// The idle clock starts again from here rather than from a last call
		// hours ago, so turning the switch off is not an instant stop.
		s.touch()
	}
}

// HoldOpen reports whether the idle stop is held off.
func (s *RemoteService) HoldOpen() bool { return s.holdOpen.Load() }

func (s *RemoteService) handleMCP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.mu.Lock()
	handler, authz := s.mcp, s.auth
	s.mu.Unlock()
	if handler == nil || !s.mcpOn.Load() {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		// Stateless Streamable HTTP has no stream to GET; the route exists
		// so the answer is the transport's 405 rather than the dashboard's
		// 404, which a client would read as the wrong URL.
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "the MCP endpoint takes POST only", http.StatusMethodNotAllowed)
		return
	}
	verifier, ok := authz.(remoteBearerVerifier)
	if !ok {
		s.mcpChallenge(w, r, http.StatusUnauthorized)
		return
	}
	// The SDK's middleware reads the token from Authorization only, puts
	// what the verifier said into the request context, and answers 401 with
	// the challenge otherwise. The tool handler reads the context back
	// through req.Extra.TokenInfo for the caller's name and scopes.
	require := auth.RequireBearerToken(verifier.VerifyBearer, &auth.RequireBearerTokenOptions{
		ResourceMetadataURL: remoteResourceMetadataURL(r.Host),
	})
	require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// An authorized call is activity (§ S8.8); a refused one is not, or
		// anyone with the URL could hold the listener open.
		s.touch()
		handler.ServeHTTP(w, r)
	})).ServeHTTP(w, r)
}

// mcpChallenge is the 401 a client starts sign-in on (§ S9.5): the
// WWW-Authenticate names where the resource metadata lives (#514).
func (s *RemoteService) mcpChallenge(w http.ResponseWriter, r *http.Request, status int) {
	w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+remoteResourceMetadataURL(r.Host)+`"`)
	http.Error(w, "unauthorized", status)
}

// remoteResourceMetadataURL is RFC 9728's well-known URL for the host a
// request arrived at, with the scheme RemoteResource gives that host.
func remoteResourceMetadataURL(host string) string {
	res := RemoteResource(host)
	return res[:len(res)-len(RemoteMCPPath)] + "/.well-known/oauth-protected-resource"
}

// mcpFlags are the two switches the listener consults per request, kept
// off the mutex because the idle watcher reads one of them on a timer.
type mcpFlags struct {
	mcpOn    atomic.Bool
	holdOpen atomic.Bool
}
