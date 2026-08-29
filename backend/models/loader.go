package models

// LoaderVersion is one published build of a mod loader.
//
// MCVersion is derived rather than reported: NeoForge encodes the Minecraft
// version it targets in its own version number, and no separate field for it
// exists in the maven metadata.
type LoaderVersion struct {
	Version   string `json:"version"`   // "21.1.209"
	MCVersion string `json:"mcVersion"` // "1.21.1", derived from Version
	Stable    bool   `json:"stable"`    // a release rather than a beta

	// Latest marks the one build Konnekt would recommend for this MCVersion:
	// the newest stable, or the newest beta when that Minecraft version has no
	// stable release yet.
	Latest bool `json:"latest"`
}

// LoaderStatus describes the loader a configured server is running on.
type LoaderStatus struct {
	Loader           string `json:"loader"`
	InstalledVersion string `json:"installedVersion"`
	MCVersion        string `json:"mcVersion"`

	// Source is where InstalledVersion came from: "script", "libraries",
	// "config" or "". See ServerSummary.LoaderSource.
	Source string `json:"source"`

	// Managed is whether Konnekt can update this loader in place. False for
	// every loader with no provider behind it, which is all of them but
	// NeoForge today, and false for a server whose loader was never detected.
	Managed bool `json:"managed"`

	// Reason explains an unmanaged loader in words the UI can show directly.
	// Empty when Managed is true.
	Reason string `json:"reason"`
}

// LoaderUpdateRequest is the input to UpdateLoader.
//
// A struct rather than three parameters because FullBackup is a decision the
// user makes in the confirm dialog, and a bare bool in a bound signature reads
// as nothing at the call site.
type LoaderUpdateRequest struct {
	ServerID string `json:"serverId"`
	Version  string `json:"version"`

	// FullBackup runs a complete server backup before touching anything. Off by
	// default: an update rewrites the launch files and adds a libraries tree, and
	// the snapshot covers that, so zipping a modded server's worlds every time a
	// build is bumped is a cost the user should opt into rather than out of.
	FullBackup bool `json:"fullBackup"`
}
