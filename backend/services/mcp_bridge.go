package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The stdio half of the local bridge (#511). `konnekt mcp` is an MCP server
// to the client that started it and an MCP client to the app's loopback
// endpoint; this file is the server half, built from the same catalog the app
// serves. The tool list is answered here, from the binary, so a client can
// register the bridge and see the catalog while Konnekt is closed; a call is
// forwarded, and comes back as a plain error when nothing is there to take it.

// MCPForward carries one call to the app. client is who asked, as the stdio
// client introduced itself; the bridge passes it on so the app's log line
// names the real client (§ S9.9).
type MCPForward func(ctx context.Context, client *mcp.Implementation, name string, args any) (*mcp.CallToolResult, error)

// NewMCPBridgeServer builds the bridge's server over tools, forwarding every
// call through forward. The catalog is validated against the real app by the
// root tests; here only the shape the protocol needs is checked.
func NewMCPBridgeServer(tools []MCPTool, version, instructions string, forward MCPForward) (*mcp.Server, error) {
	if forward == nil {
		return nil, errors.New("mcp bridge: nothing to forward to")
	}
	seen := map[string]bool{}
	s := mcp.NewServer(&mcp.Implementation{Name: mcpServerName, Title: "Konnekt", Version: version},
		&mcp.ServerOptions{Instructions: instructions, HasTools: true})
	for _, t := range tools {
		if t.Name == "" || seen[t.Name] {
			return nil, fmt.Errorf("mcp bridge: tool %q is empty or listed twice", t.Name)
		}
		seen[t.Name] = true
		name := t.Name
		s.AddTool(mcpToolDef(t), func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			res, err := forward(ctx, req.ClientInfo(), name, req.Params.Arguments)
			if err != nil {
				return mcpErrorResult(err), nil
			}
			return res, nil
		})
	}
	return s, nil
}
