package models

// RemoteDevice is a browser the desktop has approved for Remote Access (#45).
// Name is what the desktop called it at approval, and is the only thing about
// a remote caller that konnekt.log names.
type RemoteDevice struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ApprovedAt int64  `json:"approvedAt"` // Unix ms
	LastSeen   int64  `json:"lastSeen"`   // Unix ms of its last sign-in
	Sessions   int    `json:"sessions"`   // live sessions right now
}

// RemotePendingDevice is a browser that gave the right password and is waiting
// for the desktop to approve it. Code is shown on both screens, so the person
// approving can tell their own phone from somebody else's request. UserAgent is
// what the browser said about itself: a hint for the prompt, clamped and
// stripped of control characters, and never a fact.
type RemotePendingDevice struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	UserAgent   string `json:"userAgent"`
	RequestedAt int64  `json:"requestedAt"` // Unix ms
}

// RemoteApproval is an admin-tier call a remote device made that is waiting
// for the desktop's answer (#462). Reason is why the method is gated, from the
// allowlist. Args are the call's arguments as JSON, one string each, exactly
// as the device sent them: the prompt shows them so the answer is a decision
// about this call and not about the method's name.
type RemoteApproval struct {
	ID          string   `json:"id"`
	Device      string   `json:"device"`
	Method      string   `json:"method"`
	Reason      string   `json:"reason"`
	Args        []string `json:"args"`
	RequestedAt int64    `json:"requestedAt"` // Unix ms
	ExpiresAt   int64    `json:"expiresAt"`   // Unix ms; unanswered, the call is refused then
}

// RemoteAccessState is everything the desktop shows about Remote Access: the
// Settings pane, the prompts and the title bar's indicator all read it. It is
// the getter twin of the remote:changed event.
type RemoteAccessState struct {
	PasswordSet bool `json:"passwordSet"`
	Running     bool `json:"running"`
	// Addr is the listener's loopback address while running, else "".
	Addr string `json:"addr"`
	// Clients is how many browser tabs hold a live connection.
	Clients        int                   `json:"clients"`
	Devices        []RemoteDevice        `json:"devices"`
	PendingDevices []RemotePendingDevice `json:"pendingDevices"`
	Approvals      []RemoteApproval      `json:"approvals"`
	// Tunnel is the public way in: off unless switched on, and only while the
	// listener runs.
	Tunnel TunnelState `json:"tunnel"`
}

// TunnelState is what the desktop shows about the tunnel.
type TunnelState struct {
	Status  string `json:"status"`  // "off" | "downloading" | "starting" | "running" | "failed"
	URL     string `json:"url"`     // https://<name>.trycloudflare.com, or https://<named hostname>, while running
	Error   string `json:"error"`   // why it failed, when Status is "failed"
	Percent int    `json:"percent"` // download progress, 0-100, while "downloading"
	Version string `json:"version"` // the pinned cloudflared version
	// Named is the named tunnel's configuration (#512). With a hostname and a
	// token set, the switch runs that tunnel instead of a quick one.
	Named NamedTunnel `json:"named"`
}

// NamedTunnel is a remotely-managed Cloudflare tunnel on the user's own
// account (#512): one hostname that stays the same across runs. The token
// itself is never here (§ S2.3, S9.8); TokenSet says whether one is stored.
type NamedTunnel struct {
	Hostname string `json:"hostname"` // lowercase DNS name, "" when none is configured
	Port     int    `json:"port"`     // the loopback port the dashboard's ingress rule names
	TokenSet bool   `json:"tokenSet"`
}

// LocalMCPState is what the desktop shows about the local MCP bridge (#511):
// whether "Allow Claude on this computer" is on, whether its loopback
// endpoint is listening, and the executable the setup command names. The
// secret the endpoint checks is never here.
type LocalMCPState struct {
	Enabled bool   `json:"enabled"`
	Running bool   `json:"running"`
	Addr    string `json:"addr"`    // 127.0.0.1:<port> while running, else ""
	Command string `json:"command"` // what to register with a client: "<exe>" mcp
}
