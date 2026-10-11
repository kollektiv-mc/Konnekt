package models

type Backup struct {
	Filename    string   `json:"filename"`
	CreatedAt   int64    `json:"createdAt"` // Unix ms
	SizeBytes   int64    `json:"sizeBytes"`
	DisplayName string   `json:"displayName"` // empty = use filename
	Tags        []string `json:"tags"`
	Kind        string   `json:"kind"`            // "server" | "world"
	World       string   `json:"world,omitempty"` // set for kind="world"
	// LodsSkipped marks an archive taken while the server ran, so it holds no
	// Distant Horizons database (#563).
	LodsSkipped bool `json:"lodsSkipped,omitempty"`
}
