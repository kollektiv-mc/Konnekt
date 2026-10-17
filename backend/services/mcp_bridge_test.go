package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The bridge's server half (#511): the catalog listed from the binary, each
// call handed on with the client's own name, an error from the far side
// returned as a tool error rather than a protocol one.

type bridgeCall struct {
	client string
	name   string
	args   any
}

func newBridgeClient(t *testing.T, forward MCPForward) *mcp.ClientSession {
	t.Helper()
	s, err := NewMCPBridgeServer(mcpTestTools, "0.0.0-test", "bridge instructions", forward)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	st, ct := mcp.NewInMemoryTransports()
	if _, err := s.Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "claude-code", Version: "2"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cs.Close(); err != nil {
			t.Error(err)
		}
	})
	return cs
}

func TestMCPBridgeListsTheCatalogItself(t *testing.T) {
	cs := newBridgeClient(t, func(context.Context, *mcp.Implementation, string, any) (*mcp.CallToolResult, error) {
		t.Fatal("tools/list reached the forwarder")
		return nil, nil
	})
	if got := cs.InitializeResult().Instructions; got != "bridge instructions" {
		t.Errorf("instructions %q", got)
	}
	listed, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != len(mcpTestTools) {
		t.Fatalf("%d tools listed, %d in the catalog", len(listed.Tools), len(mcpTestTools))
	}
	for i := 1; i < len(listed.Tools); i++ {
		if listed.Tools[i-1].Name >= listed.Tools[i].Name {
			t.Errorf("not sorted at %q", listed.Tools[i].Name)
		}
	}
	for _, tool := range listed.Tools {
		if tool.Name == "echo" && (tool.Annotations == nil || !tool.Annotations.ReadOnlyHint) {
			t.Errorf("echo lost its read-only annotation: %+v", tool.Annotations)
		}
	}
}

func TestMCPBridgeForwardsTheClientAndTheArgs(t *testing.T) {
	var calls []bridgeCall
	cs := newBridgeClient(t, func(_ context.Context, client *mcp.Implementation, name string, args any) (*mcp.CallToolResult, error) {
		calls = append(calls, bridgeCall{client: client.Name + "/" + client.Version, name: name, args: args})
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "from the app"}},
			StructuredContent: map[string]any{"result": "ok"}}, nil
	})
	res := callMCPTool(t, cs, "echo", map[string]any{"s": "hi"})
	if res.IsError || mcpText(t, res) != "from the app" {
		t.Errorf("result %+v", res)
	}
	if len(calls) != 1 || calls[0].client != "claude-code/2" || calls[0].name != "echo" {
		t.Fatalf("forwarded %+v", calls)
	}
	// The arguments go on as the client sent them, undecoded.
	raw, err := json.Marshal(calls[0].args)
	if err != nil {
		t.Fatal(err)
	}
	var args map[string]any
	if err := json.Unmarshal(raw, &args); err != nil || args["s"] != "hi" {
		t.Errorf("args %s", raw)
	}
}

func TestMCPBridgeForwardErrorIsAToolError(t *testing.T) {
	cs := newBridgeClient(t, func(context.Context, *mcp.Implementation, string, any) (*mcp.CallToolResult, error) {
		return nil, ErrLocalMCPOff
	})
	res := callMCPTool(t, cs, "echo", map[string]any{"s": "hi"})
	if !res.IsError || !strings.Contains(mcpText(t, res), "Konnekt is not running") {
		t.Errorf("result %+v", res)
	}
	if _, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "no_such_tool"}); err == nil {
		t.Error("an unknown tool was forwarded")
	}
}

func TestNewMCPBridgeServerRefusesBadInput(t *testing.T) {
	noop := func(context.Context, *mcp.Implementation, string, any) (*mcp.CallToolResult, error) {
		return nil, errors.New("unused")
	}
	if _, err := NewMCPBridgeServer(mcpTestTools, "0", "", nil); err == nil {
		t.Error("nil forwarder accepted")
	}
	twice := append([]MCPTool{}, mcpTestTools...)
	twice = append(twice, mcpTestTools[0])
	if _, err := NewMCPBridgeServer(twice, "0", "", noop); err == nil || !strings.Contains(err.Error(), "twice") {
		t.Errorf("duplicate tool: %v", err)
	}
	if _, err := NewMCPBridgeServer([]MCPTool{{Description: "nameless"}}, "0", "", noop); err == nil {
		t.Error("nameless tool accepted")
	}
}
