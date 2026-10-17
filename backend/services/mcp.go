package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"unicode"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCP is a second client of the Remote Access machinery, not a second backend
// (#507, agent_docs/SECURITY_CHECKLIST.md § S9). A tool is one entry of the
// remote allowlist with a name Claude can say, and a call runs through
// RemoteDispatcher.Invoke like a phone's, so the tier check and the per-server
// scoping hold without a second copy. What this file adds is the shape MCP
// needs around that: an input object instead of positional arguments, a
// result Claude can read, the approval gate for the one tool that needs it,
// and the log line (§ S9.9).
//
// The catalog itself is data in mcp_tools.go at the repo root, beside
// remote_methods.go, because it names bound methods on App; this file knows
// only the dispatcher.

// MCPParam is one named input of a tool. MCP hands a server an object and the
// bridge takes positional arguments, so the catalog lists the inputs in the
// order the bound method takes them, and NewMCPServer refuses a count that
// does not match.
type MCPParam struct {
	Name        string
	Description string
	// Type is the JSON Schema type: "string" unless set.
	Type string
	// Optional inputs may be left out; the bound method then gets the type's
	// zero value.
	Optional bool
}

// MCPTool is one entry of the catalog. Name, Title and Description are
// compile-time constants (§ S9.2): nothing a user or a player wrote goes into
// them, because clients place them in the model's system context.
type MCPTool struct {
	Name        string
	Title       string
	Description string
	// Method is the remote_methods.go entry the tool calls. Its tier must be
	// read or operate (§ S9.1): admin waits on the desktop by design, and
	// never through a tool.
	Method string
	Params []MCPParam
	// Approval makes every call wait for the desktop (§ S9.3), through the
	// same prompt an admin-tier call raises. With no approver wired, such a
	// tool refuses every call rather than running unasked.
	Approval bool
	// The MCP annotations, as hints to the client and nothing more.
	ReadOnly    bool
	Destructive bool
	Idempotent  bool
	// Key names the result in structuredContent when Shape is nil:
	// {"<Key>": result}. Shape replaces that with its own object, and is
	// where a tool leaves out what Claude has no business with (a jar path,
	// a player's IP).
	Key   string
	Shape func(result any) any
}

// MCPServerOptions is what the engine needs besides the catalog.
type MCPServerOptions struct {
	// Caller is the device name the dispatcher sees and the log names: the
	// local bridge's fixed name, or an OAuth client's. Never text from the
	// MCP client itself, which is third-party.
	Caller string
	// Approve answers a tool marked Approval. nil refuses them all.
	Approve RemoteApprover
	// Instructions is the server's static text for the client. A constant.
	Instructions string
}

const (
	// mcpClientNameMax bounds the clientInfo name in the log line. The name is
	// chosen by whoever wrote the client, so it is clamped and never trusted.
	mcpClientNameMax = 40
	mcpServerName    = "konnekt"
)

var (
	ErrMCPToolUnknown  = errors.New("no such tool")
	ErrMCPBadInput     = errors.New("bad input")
	ErrMCPNeedApproval = errors.New("the desktop did not approve")
)

// NewMCPServer builds an MCP server over d from tools. It refuses a catalog
// that names a method the dispatcher lacks, an admin method, a tool whose
// inputs do not match the method's arity, a duplicate name or a name the
// protocol would reject, so a mistake fails in the test that builds it rather
// than on Claude's first call.
func NewMCPServer(d *RemoteDispatcher, tools []MCPTool, version string, opts MCPServerOptions) (*mcp.Server, error) {
	if d == nil {
		return nil, errors.New("mcp: no dispatcher")
	}
	if opts.Caller == "" {
		return nil, errors.New("mcp: no caller name")
	}
	seen := map[string]bool{}
	for _, t := range tools {
		if err := validateMCPTool(d, t); err != nil {
			return nil, fmt.Errorf("mcp: tool %q: %w", t.Name, err)
		}
		if seen[t.Name] {
			return nil, fmt.Errorf("mcp: tool %q: listed twice", t.Name)
		}
		seen[t.Name] = true
	}
	s := mcp.NewServer(&mcp.Implementation{Name: mcpServerName, Title: "Konnekt", Version: version},
		&mcp.ServerOptions{Instructions: opts.Instructions, HasTools: true})
	for _, t := range tools {
		s.AddTool(mcpToolDef(t), mcpHandler(d, t, opts))
	}
	return s, nil
}

func validateMCPTool(d *RemoteDispatcher, t MCPTool) error {
	if t.Name == "" || strings.IndexFunc(t.Name, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_')
	}) >= 0 {
		return errors.New("the name is lowercase letters, digits and underscores")
	}
	if t.Description == "" {
		return errors.New("no description")
	}
	tier, ok := d.Tier(t.Method)
	if !ok {
		return fmt.Errorf("%s is not remote-callable", t.Method)
	}
	if tier != RemoteTierRead && tier != RemoteTierOperate {
		return fmt.Errorf("%s is %s-tier; a tool reaches read and operate only (§ S9.1)", t.Method, tier)
	}
	if n, known := d.Arity(t.Method); !known || n != len(t.Params) {
		return fmt.Errorf("%s takes %d arguments, the tool names %d", t.Method, n, len(t.Params))
	}
	names := map[string]bool{}
	for _, p := range t.Params {
		if p.Name == "" || names[p.Name] {
			return fmt.Errorf("parameter %q is empty or repeated", p.Name)
		}
		names[p.Name] = true
	}
	if t.Key == "" && t.Shape == nil {
		return errors.New("no result key and no shape")
	}
	return nil
}

func mcpToolDef(t MCPTool) *mcp.Tool {
	props := make(map[string]*jsonschema.Schema, len(t.Params))
	var required []string
	for _, p := range t.Params {
		typ := p.Type
		if typ == "" {
			typ = "string"
		}
		props[p.Name] = &jsonschema.Schema{Type: typ, Description: p.Description}
		if !p.Optional {
			required = append(required, p.Name)
		}
	}
	sort.Strings(required)
	destructive, open := t.Destructive, false
	return &mcp.Tool{
		Name:        t.Name,
		Title:       t.Title,
		Description: t.Description,
		InputSchema: &jsonschema.Schema{
			Type:                 "object",
			Properties:           props,
			Required:             required,
			AdditionalProperties: &jsonschema.Schema{Not: &jsonschema.Schema{}},
		},
		Annotations: &mcp.ToolAnnotations{
			Title:           t.Title,
			ReadOnlyHint:    t.ReadOnly,
			DestructiveHint: &destructive,
			IdempotentHint:  t.Idempotent,
			OpenWorldHint:   &open,
		},
	}
}

// mcpHandler turns one call into one dispatcher invocation. A refusal or a
// method error comes back as an MCP error result, which the model reads, not
// as a protocol error, which it does not.
func mcpHandler(d *RemoteDispatcher, t MCPTool, opts MCPServerOptions) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args, serverID, err := mcpArgs(t, req.Params.Arguments)
		if err != nil {
			return mcpErrorResult(err), nil
		}
		client := mcpClientLabel(req.ClientInfo())
		var result any
		if t.Approval {
			err = mcpApprove(ctx, opts, t, args)
		}
		if err == nil {
			result, err = d.Invoke(ctx, opts.Caller, t.Method, args)
		}
		// One line per call naming the tool, the client and the server id,
		// never an argument (§ S9.9): a console command is an argument.
		slog.Info("mcp: call", "tool", t.Name, "client", client, "server", serverID, "ok", err == nil)
		if err != nil {
			return mcpErrorResult(err), nil
		}
		return mcpResult(t, result)
	}
}

func mcpApprove(ctx context.Context, opts MCPServerOptions, t MCPTool, args []json.RawMessage) error {
	if opts.Approve == nil {
		return fmt.Errorf("%w: %s needs the desktop and nothing is there to ask", ErrMCPNeedApproval, t.Name)
	}
	req := RemoteApprovalRequest{Device: opts.Caller, Method: t.Method, Reason: t.Description, Args: args}
	if err := opts.Approve(ctx, req); err != nil {
		return fmt.Errorf("%w: %w", ErrMCPNeedApproval, err)
	}
	return nil
}

// mcpArgs turns the call's input object into the positional arguments the
// bridge takes, in the catalog's order. It also returns the server id when
// the tool has one, for the log line. The schema is advice to the client; the
// server refuses an unknown member here and a mistyped one when the
// dispatcher decodes it.
func mcpArgs(t MCPTool, input any) ([]json.RawMessage, string, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %w", ErrMCPBadInput, err)
	}
	members := map[string]json.RawMessage{}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &members); err != nil {
			return nil, "", fmt.Errorf("%w: the input is not an object", ErrMCPBadInput)
		}
	}
	known := make(map[string]bool, len(t.Params))
	for _, p := range t.Params {
		known[p.Name] = true
	}
	for name := range members {
		if !known[name] {
			return nil, "", fmt.Errorf("%w: %s is not an input of this tool", ErrMCPBadInput, name)
		}
	}
	args := make([]json.RawMessage, len(t.Params))
	var serverID string
	for i, p := range t.Params {
		v, ok := members[p.Name]
		switch {
		case ok:
			args[i] = v
		case p.Optional:
			args[i] = mcpZero(p.Type)
		default:
			return nil, "", fmt.Errorf("%w: %s is required", ErrMCPBadInput, p.Name)
		}
		if p.Name == serverIDParam {
			// Decoded for the log line only; the dispatcher decodes it again
			// for the call. A non-string here is the schema's refusal to make.
			if err := json.Unmarshal(args[i], &serverID); err != nil {
				return nil, "", fmt.Errorf("%w: %s must be a string", ErrMCPBadInput, p.Name)
			}
		}
	}
	return args, serverID, nil
}

// serverIDParam is the input name every server-scoped tool uses, matching the
// bound methods' own parameter name (.claude/rules/ipc.md).
const serverIDParam = "serverID"

func mcpZero(typ string) json.RawMessage {
	switch typ {
	case "integer", "number":
		return json.RawMessage(`0`)
	case "boolean":
		return json.RawMessage(`false`)
	default:
		return json.RawMessage(`""`)
	}
}

// mcpResult is what Claude reads back: the shaped result as structuredContent,
// and the same JSON as the text part for clients that show only text.
func mcpResult(t MCPTool, result any) (*mcp.CallToolResult, error) {
	var shaped any
	if t.Shape != nil {
		shaped = t.Shape(result)
	} else {
		shaped = map[string]any{t.Key: result}
	}
	text, err := json.Marshal(shaped)
	if err != nil {
		return nil, fmt.Errorf("mcp: encode %s result: %w", t.Name, err)
	}
	return &mcp.CallToolResult{
		Content:           []mcp.Content{&mcp.TextContent{Text: string(text)}},
		StructuredContent: shaped,
	}, nil
}

func mcpErrorResult(err error) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		IsError: true,
		Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
	}
}

// mcpClientLabel is the clientInfo name as the log may carry it: printable,
// clamped, and "unknown" when the client sent none. The client chose it, so
// it names nothing and unlocks nothing.
func mcpClientLabel(info *mcp.Implementation) string {
	if info == nil || info.Name == "" {
		return "unknown"
	}
	var b strings.Builder
	n := 0
	for _, r := range stripANSI(info.Name) {
		if n == mcpClientNameMax {
			break
		}
		if unicode.IsPrint(r) {
			b.WriteRune(r)
			n++
		}
	}
	if n == 0 {
		return "unknown"
	}
	return b.String()
}
