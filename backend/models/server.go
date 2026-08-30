package models

type ServerConfig struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	JarPath    string   `json:"jarPath"`
	JvmArgs    []string `json:"jvmArgs"`
	WorkingDir string   `json:"workingDir"`
	MCVersion  string   `json:"mcVersion"` // e.g. "1.20.1"; empty = undetected
	Loader     string   `json:"loader"`    // fabric|forge|neoforge|quilt|paper|spigot|bukkit|purpur|velocity|vanilla

	// LoaderVersion is the loader's own build, e.g. "21.1.72" for NeoForge or
	// "1.20.1-47.2.0" for Forge. Empty for loaders that have no such build
	// (vanilla, Paper) and for installs Konnekt has not detected one from.
	//
	// Stored rather than always detected because detection reads the install
	// directory, which a stopped-and-moved server may no longer have; the
	// stored value is the last thing Konnekt knew for certain. Detection still
	// wins when it finds something, since the disk is the truth.
	LoaderVersion string `json:"loaderVersion"`
}

// ServerSummary is the at-a-glance description of a configured server, for the
// sidebar hover tooltip. Running is per-server, unlike ServerStatus.Running.
type ServerSummary struct {
	MCVersion  string `json:"mcVersion"`
	Loader     string `json:"loader"`
	WorkingDir string `json:"workingDir"`
	LaunchFile string `json:"launchFile"`
	Running    bool   `json:"running"`

	// LoaderVersion is the loader build, and LoaderSource says where it came
	// from: "script" (parsed out of run.sh/run.bat, so it is exactly what the
	// next start will use), "libraries" (found under libraries/ when no script
	// is readable), "config" (the last value Konnekt stored, the install
	// directory having yielded nothing) or "" when it is unknown. The UI shows
	// the distinction because a config-sourced version can be stale in a way a
	// script-sourced one cannot.
	LoaderVersion string `json:"loaderVersion"`
	LoaderSource  string `json:"loaderSource"`
}

// ServerStatus's State is the lifecycle phase (offline|starting|running|
// stopping, #108); Running stays "process alive" — true through starting,
// running and stopping — because every consumer gating on "is there a live
// process to talk to / stop first" reads it.
type ServerStatus struct {
	Running    bool    `json:"running"`
	State      string  `json:"state"`
	Uptime     string  `json:"uptime"`
	Players    int     `json:"players"`
	MaxPlayers int     `json:"maxPlayers"`
	TPS        float64 `json:"tps"`
	RAMUsed    float64 `json:"ramUsed"`
	RAMTotal   float64 `json:"ramTotal"`
}

// ServerStateChange is the server:state event payload (#108). State is one of
// offline|starting|running|stopping. TimedOut marks a running state reached by
// the starting-timeout fallback rather than a matched ready line; its durable
// record is the [Konnekt] console banner. Readable getter twin:
// GetServerStatus().State.
type ServerStateChange struct {
	State    string `json:"state"`
	TimedOut bool   `json:"timedOut"`
}

// ServerStopped is the server:stopped event payload, and what GetLastStop
// returns as its readable getter twin. ExitCode follows os.ProcessState:
// -1 means the process was killed by a signal (or the status was
// unobtainable), anything else is the process's own exit code.
type ServerStopped struct {
	Expected bool `json:"expected"`
	ExitCode int  `json:"exitCode"`
}

type StatsSnapshot struct {
	Timestamp  int64   `json:"timestamp"`
	TPS        float64 `json:"tps"`
	RAMUsedMB  float64 `json:"ramUsedMB"`
	RAMTotalMB float64 `json:"ramTotalMB"`
	CPUPercent float64 `json:"cpuPercent"`
	Players    int     `json:"players"`
}
