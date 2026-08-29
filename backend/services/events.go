package services

const (
	EventLogLine       = "log:line"
	EventServerStarted = "server:started"
	EventServerStopped = "server:stopped"
	EventEulaRequired  = "server:eula-required"

	// EventServerStatus pushes the full models.ServerStatus on every stats tick,
	// running or not. Payload matches GetServerStatus() exactly, so one frontend
	// setter serves both the initial fetch and the push. Replaces the stats
	// tile's 10s GetServerStatus poll.
	//
	// Deliberately separate from stats:snapshot rather than folded into it:
	// StatsSnapshot carries no Running/Uptime/MaxPlayers, and its emit is gated
	// on the server actually running, so it can never report a stop. Ungating
	// that emit instead would have filled the 1h history with offline zeroes and
	// fired scheduler_triggers.go's stats:snapshot subscriber against a stopped
	// server.
	EventServerStatus = "server:status"

	// EventServerState announces a lifecycle transition (#108). Payload is
	// models.ServerStateChange; emitted by setStateLocked only on an actual
	// change, so subscribers never see duplicate transitions. Readable getter
	// twin: GetServerStatus().State.
	EventServerState = "server:state"

	EventStatsSnapshot    = "stats:snapshot"
	EventPlayerJoined     = "player:joined"
	EventPlayerLeft       = "player:left"
	EventBackupStarted    = "backup:started"
	EventBackupProgress   = "backup:progress"
	EventBackupCompleted  = "backup:completed"
	EventBackupFailed     = "backup:failed"
	EventRestoreCompleted = "backup:restore-completed"

	// Scheduler lifecycle — emitted through EventBus so the frontend and future
	// remote WebSocket clients can observe graph execution in real time.
	EventScheduleRunStarted   = "schedule:run-started"
	EventScheduleNodeStarted  = "schedule:node-started"
	EventScheduleNodeFinished = "schedule:node-finished"
	EventScheduleRunFinished  = "schedule:run-finished"
	EventScheduleNotify       = "schedule:notify"

	// EventScheduleNextRuns pushes graphID → next fire time (Unix ms). Unlike
	// the other schedule:* events its payload is a bare map[string]int64 rather
	// than a map[string]interface{} object, so it matches GetScheduleNextRuns()
	// exactly and one frontend setter serves both the initial fetch and the
	// push. Replaces the frontend's former 30s next-run poll.
	EventScheduleNextRuns = "schedule:next-runs"

	// Mod / plugin install lifecycle.
	EventModInstallStarted  = "mod:install-started"  // {serverID, fileName}
	EventModInstallProgress = "mod:install-progress" // {serverID, fileName, percent}
	EventModInstalled       = "mod:installed"        // {serverID, fileName}
	EventModInstallFailed   = "mod:install-failed"   // {serverID, fileName, error}
	EventModChanged         = "mod:changed"          // {serverID} — list changed (enable/disable/uninstall)

	// Forge/NeoForge server-installer lifecycle. The installer reports no
	// percentage, only log lines, so install:log is the progress signal.
	EventInstallStarted  = "install:started"  // {targetDir}
	EventInstallLog      = "install:log"      // {line}
	EventInstallFinished = "install:finished" // {targetDir, mcVersion, loader, loaderVersion}
	EventInstallFailed   = "install:failed"   // {error}

	// Self-update lifecycle.
	EventUpdateProgress = "update:progress" // {percent}
)
