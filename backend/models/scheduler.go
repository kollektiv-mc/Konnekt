package models

// ─── Graph persistence ────────────────────────────────────────────────────────

type Graph struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// ServerID is the server this graph acts on, decided when it was authored
	// rather than by whatever the sidebar currently names (#236). Empty means a
	// graph written before graphs had an owner, which the migration in
	// scheduler_migrate.go could not resolve; it still runs against the active
	// server, which is what every graph used to do.
	ServerID  string `json:"serverId"`
	Enabled   bool   `json:"enabled"`
	Nodes     []Node `json:"nodes"`
	Edges     []Edge `json:"edges"`
	CreatedAt int64  `json:"createdAt"` // Unix ms
	UpdatedAt int64  `json:"updatedAt"`
}

type Node struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`     // BlockDef.ID
	Config   map[string]interface{} `json:"config"`   // may contain {{...}} templates
	Position Position               `json:"position"` // editor hint only
}

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Edge is a control edge (sequences execution with onComplete/onFailed branching)
// or a data edge (carries a typed value from one block's output to another's input).
type Edge struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`       // "control" | "data"
	Source     string `json:"source"`     // source node id
	SourcePort string `json:"sourcePort"` // control: "onComplete"/"onFailed"/etc; data: port id
	Target     string `json:"target"`     // target node id
	TargetPort string `json:"targetPort"` // control: "in"; data: port id
}

// ─── Block descriptor (served to frontend, renders blocks generically) ────────

type BlockDef struct {
	ID             string        `json:"id"`
	Category       string        `json:"category"` // "trigger" | "action" | "control" | "notify"
	Label          string        `json:"label"`
	Description    string        `json:"description"`
	IsTrigger      bool          `json:"isTrigger"`
	ControlInputs  []string      `json:"controlInputs"`  // [] for triggers, ["in"] for actions
	ControlOutputs []string      `json:"controlOutputs"` // e.g. ["onComplete","onFailed"]
	DataInputs     []DataPort    `json:"dataInputs"`
	DataOutputs    []DataPort    `json:"dataOutputs"`
	ConfigSchema   []ConfigField `json:"configSchema"`
	Source         string        `json:"source"`              // "native" | "manifest"
	Primitive      string        `json:"primitive,omitempty"` // manifest blocks only
}

type DataPort struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type"` // "string" | "number" | "bool"
}

type ConfigField struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// "server" was listed here and never implemented: no ConfigField used it, no
	// block read it and the editor had no control for it. It is gone rather than
	// built, because a graph belongs to the server it was authored on (#236) and
	// a per-node override would put back the ambiguity that closed.
	Type     string        `json:"type"` // "string"|"number"|"bool"|"select"|"command"
	Default  interface{}   `json:"default,omitempty"`
	Required bool          `json:"required,omitempty"`
	Options  []FieldOption `json:"options,omitempty"` // for "select"
}

type FieldOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// ─── Run history ──────────────────────────────────────────────────────────────

type RunRecord struct {
	ID         string          `json:"id"`
	GraphID    string          `json:"graphId"`
	GraphName  string          `json:"graphName"`
	Trigger    string          `json:"trigger"` // "manual" | "time" | "event:player:joined" etc
	StartedAt  int64           `json:"startedAt"`
	FinishedAt int64           `json:"finishedAt"`
	Status     string          `json:"status"` // "running" | "success" | "failed" | "skipped"
	Error      string          `json:"error,omitempty"`
	Nodes      []NodeRunRecord `json:"nodes"`
}

// ─── Per-node dry-run preview (data spreadsheet) ────────────────────────────────

type NodePreview struct {
	NodeID     string      `json:"nodeId"`
	Attributes []AttrValue `json:"attributes"`
	Console    []string    `json:"console"`
	OK         bool        `json:"ok"`
}

type AttrValue struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Type     string `json:"type"`
	Writable bool   `json:"writable"`
	Error    string `json:"error,omitempty"`
}

type NodeRunRecord struct {
	NodeID     string `json:"nodeId"`
	Type       string `json:"type"`
	Status     string `json:"status"`    // "success" | "failed" | "skipped"
	FiredPort  string `json:"firedPort"` // which control output was followed
	StartedAt  int64  `json:"startedAt"`
	FinishedAt int64  `json:"finishedAt"`
	Error      string `json:"error,omitempty"`
}
