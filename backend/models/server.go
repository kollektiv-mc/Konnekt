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

// ─── Server-scoped event payloads ─────────────────────────────────────────
//
// Every server-scoped event carries a serverID, so a subscriber can tell which
// server it is hearing about (#233). Backup, mod and loader events already did;
// these are the nine that did not.
//
// The id is added by embedding rather than by a field on the model itself, and
// that is not a style preference. ServerStatus, ServerStopped and StatsSnapshot
// are reachable from bound method signatures, so Wails generates each as a
// TypeScript class with every field required; a new field there fails
// `pnpm typecheck` at every object literal annotated with it, one of them
// production (stores/useServerStore.ts's defaultStatus). An event-only struct is
// reachable from no binding and so is never generated at all — ServerStateChange
// above has been the standing proof of that. encoding/json flattens an embedded
// struct, so the wire shape is byte-identical to what it always was plus one key.
//
// The trap these types set: scheduler_triggers.go type-asserts what it receives,
// and two of its asserts swallow a miss. Change an emitted type without changing
// the assert and every clean stop fires the Crashed trigger, or every TPS trigger
// stops firing, with nothing logged either way. See serverevents_test.go.
//
// An empty ServerID is meaningful and not a bug, so a subscriber filtering by id
// has to decide what to do with it rather than assume it cannot happen. Two
// sources: NewServerService keeps a bootstrap instance under the empty id, which
// is what carries narration reached before any server has booted (a backup, a
// loader update, app.go's EULA write), and StatsService.tick reports on
// CurrentServerID, which is empty until a start claims one. Dropping those on the
// floor would lose console lines a user can see today, which is the thing for
// #234's filter to get right.

// ServerLifecycleEvent is the payload for the server-scoped events that carry no
// data of their own: server:started and server:eula-required, both of which used
// to emit nil.
type ServerLifecycleEvent struct {
	ServerID string `json:"serverID"`
}

// ServerStatusEvent is the server:status payload.
type ServerStatusEvent struct {
	ServerStatus
	ServerID string `json:"serverID"`
}

// ServerStateEvent is the server:state payload.
type ServerStateEvent struct {
	ServerStateChange
	ServerID string `json:"serverID"`
}

// ServerStoppedEvent is the server:stopped payload. GetLastStop still returns a
// bare ServerStopped: it is a getter, and its caller already knows which server
// it asked about.
type ServerStoppedEvent struct {
	ServerStopped
	ServerID string `json:"serverID"`
}

// StatsSnapshotEvent is the stats:snapshot payload. GetStatsHistory still returns
// bare StatsSnapshots, for the same reason.
type StatsSnapshotEvent struct {
	StatsSnapshot
	ServerID string `json:"serverID"`
}
