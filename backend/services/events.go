package services

const (
	EventLogLine          = "log:line"
	EventServerStarted    = "server:started"
	EventServerStopped    = "server:stopped"
	EventEulaRequired     = "server:eula-required"
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
	EventInstallFinished = "install:finished" // {targetDir, mcVersion, loader}
	EventInstallFailed   = "install:failed"   // {error}

	// Self-update lifecycle.
	EventUpdateProgress = "update:progress" // {percent}
)
