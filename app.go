package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"konnekt/backend/models"
	"konnekt/backend/services"
)

type App struct {
	ctx                 context.Context
	serverService       *services.ServerService
	configService       *services.ConfigService
	configEditorService *services.ConfigEditorService
	rconService         *services.RconService
	statsService        *services.StatsService
	playerService       *services.PlayerService
	backupService       *services.BackupService
	schedulerService    *services.SchedulerService
	worldService        *services.WorldService
	modService          *services.ModService
	updateService       *services.UpdateService
	installerService    *services.InstallerService
	loaderService       *services.LoaderService
	commandsService     *services.CommandsService
	kommandsService     *services.KommandsService
	remoteService       *services.RemoteService
	remoteAuth          *services.RemoteAuth
	remoteApprovals     *services.RemoteApprovals
	tunnelService       *services.TunnelService
	localMCP            *services.LocalMCPService
	fontService         *services.FontService
	destinationService  *services.DestinationService
	bus                 *services.EventBus
	dataDir             string
}

func NewApp() *App {
	rcon := services.NewRconService()
	srv := services.NewServerService()
	srv.SetRcon(rcon)
	cfg := services.NewConfigService()
	srv.SetConfig(cfg)
	bus := services.NewEventBus()
	srv.SetBus(bus)
	stats := services.NewStatsService(srv)
	stats.SetBus(bus)
	backup := services.NewBackupService(cfg, srv)
	backup.SetBus(bus)
	sched := services.NewSchedulerService(srv, backup, rcon, cfg)
	sched.SetBus(bus)
	destinations := services.NewDestinationService()
	sched.SetDestinations(destinations)
	mods := services.NewModService(cfg, srv)
	mods.SetBus(bus)
	update := services.NewUpdateService()
	update.SetBus(bus)
	installer := services.NewInstallerService()
	installer.SetBus(bus)
	loader := services.NewLoaderService(cfg, srv, backup, installer)
	loader.SetBus(bus)
	commands := services.NewCommandsService()
	commands.SetBus(bus)
	kommands := services.NewKommandsService(commands)
	kommands.SetBus(bus)
	app := &App{
		serverService:       srv,
		configService:       cfg,
		configEditorService: services.NewConfigEditorService(cfg),
		rconService:         rcon,
		statsService:        stats,
		playerService:       services.NewPlayerService(cfg, srv, rcon),
		backupService:       backup,
		schedulerService:    sched,
		worldService:        services.NewWorldService(cfg, srv, backup),
		modService:          mods,
		updateService:       update,
		installerService:    installer,
		loaderService:       loader,
		commandsService:     commands,
		kommandsService:     kommands,
		fontService:         services.NewFontService(),
		destinationService:  destinations,
		bus:                 bus,
	}
	// Remote Access (#43). Built here so the allowlist is resolved against the
	// real App and remote_methods_test.go constructs exactly what ships; not
	// started here: StartRemoteAccess is what does, from Settings.
	dispatcher, err := services.NewRemoteDispatcher(app, remoteMethods)
	if err != nil {
		// Unreachable past the test, which fails on the same error. Logged
		// rather than fatal because the desktop app is whole without remote.
		slog.Error("remote: allowlist", "error", err)
	}
	// Admin-tier calls wait on the desktop (#462), which answers through
	// AnswerRemoteApproval.
	app.remoteApprovals = services.NewRemoteApprovals()
	if dispatcher != nil {
		dispatcher.SetApprover(app.remoteApprovals.Ask)
	}
	app.remoteService = services.NewRemoteService(bus, dispatcher)
	// Who may use it (#45). Until SetRemotePassword has been called every
	// sign-in is refused, and StartRemoteAccess will not start without one.
	app.remoteAuth = services.NewRemoteAuth()
	app.remoteAuth.OnRevoke(app.remoteService.CloseSessions)
	app.remoteService.SetAuthorizer(app.remoteAuth)
	// A connector's sign-in (#514) ends on the same desktop prompt as an
	// admin call, after the password.
	app.remoteAuth.SetConsentApprover(app.remoteApprovals.Ask)
	// One event for all three, with no payload: the desktop reads the state
	// back through GetRemoteAccessState.
	remoteChanged := services.RemoteChangeNotifier(bus)
	app.remoteAuth.OnChange(remoteChanged)
	app.remoteApprovals.OnChange(remoteChanged)
	// The tunnel (#46) carries the loopback listener to a public URL. Binding
	// it also registers the listener's OnChange, which is why that is not set
	// here: the listener stopping takes the tunnel down with it.
	app.tunnelService = services.NewTunnelService()
	services.BindTunnel(app.remoteService, app.remoteAuth, app.tunnelService, remoteChanged)
	// The MCP catalog over the same dispatcher (#509), served to the local
	// bridge (#511) through a loopback endpoint that is off until Settings
	// switches it on. Calls arrive as device local-mcp; the one tool that
	// asks the desktop asks through the same prompt as an admin call.
	mcpServer, err := services.NewMCPServer(dispatcher, mcpTools, Version, services.MCPServerOptions{
		Caller: services.LocalMCPCaller, Approve: app.remoteApprovals.Ask, Instructions: mcpInstructions})
	if err != nil {
		// Unreachable past mcp_tools_test.go, which builds the same catalog.
		slog.Error("mcp: catalog", "error", err)
	}
	app.localMCP = services.NewLocalMCPService(mcpServer)
	app.localMCP.OnChange(remoteChanged)
	// The same catalog on the remote listener (#513), for Claude's connectors
	// through the named tunnel. A call there is named for its grant and bound
	// by the grant's scopes; the fixed name is only the fallback the engine
	// insists on. 404 until SetRemoteConnectorsEnabled turns it on.
	connectorServer, err := services.NewMCPServer(dispatcher, mcpTools, Version, services.MCPServerOptions{
		Caller: "connector", Approve: app.remoteApprovals.Ask, Instructions: mcpInstructions})
	if err != nil {
		slog.Error("mcp: connector catalog", "error", err)
	}
	app.remoteService.SetMCPServer(connectorServer)
	app.remoteService.SetMCPOperateTools(services.MCPOperateTools(dispatcher, mcpTools))
	return app
}

// quitStopGrace bounds the close-time stop. Deliberately NOT the user's
// configurable stop grace: quitting the app must not hang for a minute or
// ten, and the Windows Job Object / Linux Pdeathsig tie the java tree to
// Konnekt's lifetime anyway, so the OS finishes whatever this best-effort
// stop does not. 8 seconds preserves the pre-#110 quit behavior exactly.
// #117 (ask on close, re-adopt on relaunch) will rewrite this path.
const quitStopGrace = 8 * time.Second

func (a *App) beforeClose(ctx context.Context) bool {
	a.schedulerService.StopScheduler()
	// A browser's next call should find nothing listening, not a half-closed
	// app. Stop is a no-op when remote access is off.
	if err := a.remoteService.Stop(); err != nil {
		slog.Warn("remote: stop on close", "error", err)
	}
	// Same for the bridge's endpoint: Stop also clears the port and secret
	// from mcp-local.json, so a bridge started after this finds "not running"
	// rather than a stale port.
	if err := a.localMCP.Stop(); err != nil {
		slog.Warn("mcp: stop on close", "error", err)
	}
	// Before the server stop below, so a poll cannot land mid-shutdown and
	// rewrite command_buttons.json while the app is on its way out.
	a.kommandsService.Stop()
	// Same reasoning for the mod folder scan and its manifest writes.
	a.modService.Stop()
	// StopRunning rather than a named stop: quitting has no server id to give,
	// and scoping this to the *selected* server would skip the graceful stop
	// whenever the running one was not selected (#239). Its error paths are
	// "server not running" (a race can only make that true, the benign
	// direction) and "another power action is in progress" — quitting anyway is
	// fine, since the stdin stop is best-effort and the Windows Job Object /
	// Linux Pdeathsig tie the java tree to Konnekt's lifetime. A process that
	// ignores the stdin stop is handled inside stop by killTree, not here.
	_ = a.serverService.StopRunning(quitStopGrace) //nolint:errcheck // see above
	return false
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.bus.SetContext(ctx)
	a.serverService.SetContext(ctx)
	a.statsService.SetContext(ctx)
	a.backupService.SetContext(ctx)

	// Same helper main() used to open the log, so the two cannot disagree about
	// where the app's files live.
	a.dataDir = services.DataDir()
	// Best-effort warm-up so the directory exists before the user goes looking
	// for it. It is not the only thing that creates it: every write into the
	// data dir goes through services.WriteDataFile, which re-creates it and
	// reports a real error naming the directory. Failing here therefore costs
	// nothing a later save would not report better, and startup is a Wails
	// lifecycle hook with nowhere to return an error to anyway.
	_ = os.MkdirAll(a.dataDir, 0755) //nolint:errcheck // see above
	a.configService.SetDataDir(a.dataDir)
	a.configEditorService.SetDataDir(a.dataDir)
	a.backupService.SetDataDir(a.dataDir)
	a.schedulerService.SetDataDir(a.dataDir)
	a.schedulerService.SetContext(ctx)
	a.modService.SetContext(ctx)
	a.modService.SetDataDir(a.dataDir)
	// Watches every server's mods/ and plugins/ folder for as long as the app
	// lives, so a jar dropped in from outside Konnekt is noticed and identified
	// rather than sitting there unlisted. The responsive path is ModRescan,
	// which the frontend calls on window focus.
	a.modService.Start(ctx)
	a.installerService.SetContext(ctx)
	a.loaderService.SetContext(ctx)
	a.loaderService.SetDataDir(a.dataDir)
	a.commandsService.SetDataDir(a.dataDir)
	a.updateService.SetDataDir(a.dataDir)
	a.initRemote(a.dataDir)
	// The local MCP endpoint comes back up if it was on when the app last
	// quit: a Claude Code session that registered the bridge should find it
	// after a restart without a trip to Settings. Logged, not fatal: the
	// desktop is whole without it, and GetLocalMCPState shows the switch on
	// and the endpoint off.
	a.localMCP.SetDataDir(a.dataDir)
	if a.localMCP.Enabled() {
		if err := a.localMCP.Start(); err != nil {
			slog.Error("mcp: local endpoint", "error", err)
		}
	}
	a.destinationService.SetDataDir(a.dataDir)
	// Reads Kommands' shared file on a slack timer for as long as the app
	// lives. The responsive path is RefreshKommands, which the frontend calls
	// on window focus; this only catches an edit made while Konnekt already
	// has focus. ctx is the Wails lifetime, so the goroutine ends with the app.
	a.kommandsService.Start(ctx)
}

// --- File dialogs ---

// BrowseJarFile picks the server's entry point. Modern NeoForge/Forge installs
// have no runnable jar — only run.sh/run.bat — so those are offered too; the
// caller keeps the containing directory as the working dir either way.
func (a *App) BrowseJarFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Server File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Server launcher (*.jar, run.sh, run.bat)", Pattern: "*.jar;*.sh;*.bat"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
}

func (a *App) BrowseDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Working Directory",
	})
}

// --- Server config ---

func (a *App) GetServerConfigs() ([]models.ServerConfig, error) {
	return a.configService.GetServerConfigs()
}

func (a *App) SaveServerConfig(cfg models.ServerConfig) error {
	return a.configService.SaveServerConfig(cfg)
}

func (a *App) DeleteServerConfig(id string) error {
	return a.configService.DeleteServerConfig(id)
}

func (a *App) GetActiveServerID() (string, error) {
	return a.configService.GetActiveServerID()
}

func (a *App) SetActiveServerID(id string) error {
	return a.configService.SetActiveServerID(id)
}

func (a *App) GetAppSettings() (models.AppSettings, error) {
	return a.configService.GetAppSettings()
}

func (a *App) SaveAppSettings(s models.AppSettings) error {
	return a.configService.SaveAppSettings(s)
}

// ListFontFamilies returns the font families installed on this machine, for the
// font pickers in Settings > Appearance (#444). The webview cannot list them
// itself: the Local Font Access API is Chromium-only and Linux and macOS render
// through WebKit, so the Go side reads the platform's font directories. The
// slice is never nil, so the frontend does not receive null.
func (a *App) ListFontFamilies() ([]string, error) {
	return a.fontService.ListFamilies(), nil
}

// GetPhysicalMemoryMB returns the machine's installed RAM in megabytes, so the
// server form can warn when a heap setting approaches it (#120). Host-wide and
// constant for a run, so the frontend reads it once.
func (a *App) GetPhysicalMemoryMB() (int, error) {
	return services.TotalPhysicalMemoryMB(context.Background())
}

// --- Bucket destinations (#480) ---

// ListDestinations returns the saved buckets. Each says whether a secret is
// stored for it (SecretSet); the secret itself never crosses the bridge.
func (a *App) ListDestinations() ([]models.Destination, error) {
	return a.destinationService.List()
}

// SaveDestination adds a bucket (empty ID) or replaces one. The secret access
// key is a separate argument so it never sits in a struct that is stored,
// listed or logged; a blank secret keeps the one already stored.
func (a *App) SaveDestination(d models.Destination, secret string) (models.Destination, error) {
	return a.destinationService.Save(d, secret)
}

// DeleteDestination removes a bucket and its stored secret.
func (a *App) DeleteDestination(id string) error {
	return a.destinationService.Delete(id)
}

// TestDestination checks a bucket's settings with a signed HEAD of a key nobody
// wrote, so nothing is written to it. A blank secret tests with the stored one.
// The answer is always a verdict in words, never an error.
func (a *App) TestDestination(d models.Destination, secret string) (models.DestinationTestResult, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.destinationService.Test(ctx, d, secret), nil
}

// --- Private snapshot link (#561) ---

// GetSnapshotLink returns the address of a destination's latest published
// snapshot, for the Copy link button. It is the only call that returns the link:
// in private mode the address carries the token, so nothing that lists, saves or
// emits a destination does. It refuses until something has been published.
func (a *App) GetSnapshotLink(id string) (models.SnapshotLinkResult, error) {
	return a.destinationService.GetSnapshotLink(id)
}

// RotateSnapshotLink gives a destination's private link a new token and moves the
// latest snapshot under it, so everyone holding the old link loses access. It
// takes as long as the bucket needs to build each level's database again.
func (a *App) RotateSnapshotLink(id string) (models.SnapshotLinkResult, error) {
	return a.destinationService.RotateSnapshotLink(a.linkContext(), id)
}

// SetSnapshotLinkPrivate switches a destination's published snapshot between
// public and a private link, moving it to the other layout. The link everyone
// uses changes with it.
func (a *App) SetSnapshotLinkPrivate(id string, private bool) (models.SnapshotLinkResult, error) {
	return a.destinationService.SetSnapshotLinkPrivate(a.linkContext(), id, private)
}

// linkContext is the app's lifetime, which ends a long move when the app closes,
// or a background one before the window has started.
func (a *App) linkContext() context.Context {
	if a.ctx == nil {
		return context.Background()
	}
	return a.ctx
}

func (a *App) OpenDataDir() error {
	return services.OpenPath(a.dataDir)
}

// GetDataDir returns where the app's files actually live, for display next to
// OpenDataDir's button. The About pane used to hard-code "~/.config/konnekt",
// which is only true on Linux.
func (a *App) GetDataDir() (string, error) {
	return a.dataDir, nil
}

// GetLogPath returns the app log's absolute path so the UI can tell a bug
// reporter what to attach. Returns the path even when the file does not exist
// yet: naming where it will be is more useful than an error, and the first
// warning written creates it.
func (a *App) GetLogPath() (string, error) {
	return services.LogPath(a.dataDir), nil
}

// LogClientError writes an error the frontend caught into konnekt.log, next to
// the backend's own diagnostics. React reports a caught render error through
// console.error, and an uncaught exception or an unhandled rejection goes to
// the WebView's console; a packaged build has neither a terminal nor devtools,
// so until this existed a tile crash the user could see on screen was still
// one they could not attach to a bug report (#245). origin names the path that
// caught it: "render" for an ErrorBoundary, "error" and "unhandledrejection"
// for the window listeners. stack carries the JS stack and, for a render
// error, React's component stack, which is what names the tile.
//
// Clamped rather than trusted: a stack from a minified bundle is long and a
// component stack can be longer, and one line must not be able to eat the log
// on its own. Never fails: a logger that can fail is a second error to log.
func (a *App) LogClientError(origin, message, stack string) error {
	slog.Error("frontend: uncaught error",
		"origin", clampForLog(origin, 64),
		"message", clampForLog(message, 1024),
		"stack", clampForLog(stack, 8192),
	)
	return nil
}

// clampForLog truncates s to at most max runes, marking the cut, so a clamp
// never splits a multi-byte character.
func clampForLog(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "...[truncated]"
}

// --- Updates ---

func (a *App) GetAppVersion() (string, error) {
	return Version, nil
}

func (a *App) CheckForUpdates() (models.UpdateInfo, error) {
	return a.updateService.CheckForUpdates(a.ctx, Version, a.updateChannel())
}

// GetReleaseNotes is Settings > What's New: the notes of every release up to
// this build, from GitHub Releases or, offline, the copy cached last time.
func (a *App) GetReleaseNotes() (models.ReleaseNotes, error) {
	return a.updateService.GetReleaseNotes(a.ctx, Version)
}

// updateChannel reads the configured update channel. Unreadable settings fall
// back to stable, the conservative answer, and one a snapshot build overrides
// for itself inside the service (services.EffectiveChannel). Unexported on
// purpose: the frontend already reads the channel off GetAppSettings(), and a
// bound method here would be a second source of the same value.
func (a *App) updateChannel() string {
	s, err := a.configService.GetAppSettings()
	if err != nil {
		return services.UpdateChannelStable
	}
	return s.UpdateChannel
}

// DownloadAndInstallUpdate downloads the latest release's binary for this
// platform, verifies it, and replaces the running executable in place. On
// success it relaunches the app and quits this process — the frontend won't
// see a resolved promise in that case, only a live app restart. A local
// `wails dev` build (no ldflags-stamped version) has no installable artifact,
// so it's rejected up front rather than attempting a check that would
// trivially fail. A snapshot is not one of those: it is a real checksummed
// binary published on the rolling `snapshot` prerelease, and it can replace
// itself, so the gate is IsInstallableBuild rather than a "-dev" substring.
func (a *App) DownloadAndInstallUpdate() error {
	if !services.IsInstallableBuild(Version) {
		return fmt.Errorf("update install: not available in local dev builds")
	}
	if err := a.updateService.DownloadAndInstallUpdate(a.ctx, Version, a.updateChannel()); err != nil {
		return err
	}

	// Give the IPC response time to reach the frontend before the process
	// exits, then relaunch the (now-replaced) executable and quit.
	go func() {
		time.Sleep(500 * time.Millisecond)
		if exePath, err := os.Executable(); err == nil {
			// Convenience relaunch only. The update is already installed on
			// disk at this point, and this process must exit either way for
			// the swapped binary to take effect, so a failed spawn leaves the
			// user starting Konnekt by hand rather than losing the update.
			// There is also no one left to tell: the frontend is a moment from
			// being torn down by the Quit below.
			_ = exec.Command(exePath).Start() //nolint:errcheck // see above
		}
		runtime.Quit(a.ctx)
	}()
	return nil
}

// --- Config editor ---

func (a *App) ListConfigFiles(serverID string) ([]models.ConfigFile, error) {
	return a.configEditorService.ListConfigFiles(serverID)
}

func (a *App) ReadConfigFile(serverID string, relPath string) (string, error) {
	return a.configEditorService.ReadConfigFile(serverID, relPath)
}

func (a *App) WriteConfigFile(serverID string, relPath string, content string) error {
	if err := a.configEditorService.WriteConfigFile(serverID, relPath, content); err != nil {
		return err
	}
	// max-players lives in this file, and a stopped server's status reads it
	// from disk, so push the new figure now rather than on the next stats tick.
	if filepath.Clean(relPath) == "server.properties" {
		a.serverService.PushStatus(serverID)
	}
	return nil
}

// --- Server install ---

// InspectServerFile reports whether a picked file is a Forge/NeoForge installer
// rather than a runnable server, so the UI can offer to install it.
func (a *App) InspectServerFile(path string) (services.InstallerInfo, error) {
	return services.InspectInstaller(path)
}

// InstallServer runs a Forge/NeoForge installer into targetDir. It returns as
// soon as the installer starts; follow install:log / install:finished /
// install:failed for the rest.
func (a *App) InstallServer(jarPath string, targetDir string) error {
	return a.installerService.InstallServer(jarPath, targetDir)
}

// AbortInstall kills a running installer. No-op when none is running.
func (a *App) AbortInstall() error {
	return a.installerService.Abort()
}

// --- Mod loader ---

// GetLoaderStatus reports the loader build a server is on and whether Konnekt
// can move it.
func (a *App) GetLoaderStatus(serverID string) (models.LoaderStatus, error) {
	return a.loaderService.Status(serverID)
}

// ListLoaderVersions lists the builds this server could move to, newest first.
func (a *App) ListLoaderVersions(serverID string) ([]models.LoaderVersion, error) {
	return a.loaderService.AvailableVersions(serverID)
}

// UpdateLoader moves a server to a different loader build in place. It returns
// as soon as the update has been accepted; follow loader:update-finished /
// loader:update-failed for the outcome and install:log for the installer's
// output.
func (a *App) UpdateLoader(req models.LoaderUpdateRequest) error {
	return a.loaderService.Update(req)
}

// GetServerSummary describes one configured server for the sidebar tooltip.
// Unlike GetServerStatus, its Running field is specific to this server.
func (a *App) GetServerSummary(serverID string) (models.ServerSummary, error) {
	cfg, err := a.configService.GetServerConfig(serverID)
	if err != nil {
		return models.ServerSummary{}, err
	}
	return a.serverService.Summary(*cfg), nil
}

// --- Server lifecycle ---

func (a *App) StartServer(serverID string) error {
	cfg, err := a.configService.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	return a.serverService.Start(serverID, cfg.JarPath, cfg.JvmArgs, cfg.WorkingDir)
}

func (a *App) StopServer(serverID string) error {
	return a.serverService.Stop(serverID, a.configService.StopGrace())
}

func (a *App) RestartServer(serverID string) error {
	cfg, err := a.configService.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	return a.serverService.Restart(serverID, cfg.JarPath, cfg.JvmArgs, cfg.WorkingDir, a.configService.StopGrace())
}

// ForceStopServer kills the named server's process tree immediately, bypassing
// the power-action gate — the escape hatch for a stop that is wedged. It targets
// the current instance rather than scanning for a running one on purpose: during
// a boot the running flag is still false, and a force stop that no-opped on a
// wedged boot would miss the case it exists for.
func (a *App) ForceStopServer(serverID string) error {
	return a.serverService.ForceStop(serverID)
}

// GetLastStop reports the most recent stop's detail, the readable getter twin
// of the server:stopped event payload. Zero value until a stop has happened.
//
// Bound without a serverID and with no frontend caller, so it answers for the
// current server rather than growing a parameter nothing would pass. When #233
// puts an id on server:stopped, this getter should take one too and the two stay
// twins.
func (a *App) GetLastStop() (models.ServerStopped, error) {
	return a.serverService.GetLastStop(a.serverService.CurrentServerID()), nil
}

// AcceptEula writes the server's eula.txt through the config editor service
// (atomic write, empty-directory guard) and narrates it: app.go does no file
// I/O of its own, so a crash cannot leave a torn flag file (#259).
func (a *App) AcceptEula(serverID string) error {
	if err := a.configEditorService.AcceptEula(serverID); err != nil {
		return err
	}
	a.serverService.NarrateDone(serverID, "EULA accepted, eula.txt written")
	return nil
}

func (a *App) SendCommand(serverID string, command string) error {
	return a.serverService.SendCommand(serverID, command)
}

// --- Status and players ---

// GetServerStatus reports on the server it names, not on whichever one happens
// to be running (#239). A stopped or unknown server answers offline rather than
// failing: the frontend treats a rejection as an unreachable backend.
func (a *App) GetServerStatus(serverID string) (models.ServerStatus, error) {
	return a.serverService.Status(serverID), nil
}

func (a *App) GetStatsHistory(serverID string) ([]models.StatsSnapshot, error) {
	return a.statsService.GetStatsHistory(serverID), nil
}

// GetConsoleHistory backfills the console for a client that connected
// mid-session (remote-access seam), and now returns the named server's ring
// rather than whichever one was current (#239). Each server keeps its own since
// #232, so this is what makes them reachable. No desktop caller yet; pair with
// useConsoleStore.loadHistory.
func (a *App) GetConsoleHistory(serverID string) ([]models.ConsoleLine, error) {
	return a.serverService.GetConsoleHistory(serverID), nil
}

func (a *App) GetPlayerRoster(serverID string) ([]models.Player, error) {
	return a.playerService.GetRoster(serverID)
}

func (a *App) GetPlayerDetail(serverID string, name string) (models.Player, error) {
	return a.playerService.GetDetail(serverID, name)
}

// The moderation methods take one player's name and refuse anything else
// (services.ValidPlayerName, #510): `kick` and `ban` accept target selectors,
// so an unchecked `@a` from a phone or an MCP tool would hit everyone online.

func (a *App) KickPlayer(serverID string, name string, reason string) error {
	if err := services.ValidPlayerName(name); err != nil {
		return err
	}
	cmd := fmt.Sprintf("kick %s %s", name, reason)
	return a.serverService.SendCommand(serverID, cmd)
}

func (a *App) BanPlayer(serverID string, name string, reason string) error {
	if err := services.ValidPlayerName(name); err != nil {
		return err
	}
	cmd := fmt.Sprintf("ban %s %s", name, reason)
	return a.serverService.SendCommand(serverID, cmd)
}

func (a *App) PardonPlayer(serverID string, name string) error {
	if err := services.ValidPlayerName(name); err != nil {
		return err
	}
	return a.serverService.SendCommand(serverID, fmt.Sprintf("pardon %s", name))
}

// --- Layout presets ---

func (a *App) GetLayoutPresets() ([]models.LayoutPreset, error) {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "layout_presets.json"))
	if os.IsNotExist(err) {
		return []models.LayoutPreset{}, nil
	}
	if err != nil {
		return nil, err
	}
	var presets []models.LayoutPreset
	if err := json.Unmarshal(data, &presets); err != nil {
		return nil, err
	}
	return presets, nil
}

func (a *App) SaveLayoutPreset(name string, layout string) error {
	presets, err := a.GetLayoutPresets()
	if err != nil {
		return err
	}
	for i, p := range presets {
		if p.Name == name {
			presets[i].Layout = layout
			return a.writeLayoutPresets(presets)
		}
	}
	presets = append(presets, models.LayoutPreset{Name: name, Layout: layout})
	return a.writeLayoutPresets(presets)
}

func (a *App) DeleteLayoutPreset(name string) error {
	presets, err := a.GetLayoutPresets()
	if err != nil {
		return err
	}
	filtered := presets[:0]
	for _, p := range presets {
		if p.Name != name {
			filtered = append(filtered, p)
		}
	}
	return a.writeLayoutPresets(filtered)
}

func (a *App) writeLayoutPresets(presets []models.LayoutPreset) error {
	data, err := json.Marshal(presets)
	if err != nil {
		return err
	}
	return services.WriteDataFile(a.dataDir, "layout_presets.json", data)
}

// --- Active tiles ---

func (a *App) GetActiveTiles() ([]string, error) {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "active_tiles.json"))
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

func (a *App) SaveActiveTiles(ids []string) error {
	data, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return services.WriteDataFile(a.dataDir, "active_tiles.json", data)
}

// --- Tile layouts ---
// Which in-tile layout each tile shows on the canvas (frontend/src/types
// TileLayout: "detailed", "default" or "expanded"), keyed by tile id. A tile that
// is not in the map is on its default. Kept apart from active_tiles.json and
// the layout presets so a preset switch, which rearranges the board, never
// changes how a tile reads.

func (a *App) GetTileLayouts() (map[string]string, error) {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "tile_layouts.json"))
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var layouts map[string]string
	if err := json.Unmarshal(data, &layouts); err != nil {
		return nil, err
	}
	if layouts == nil {
		layouts = map[string]string{}
	}
	return layouts, nil
}

func (a *App) SaveTileLayouts(layouts map[string]string) error {
	data, err := json.Marshal(layouts)
	if err != nil {
		return err
	}
	return services.WriteDataFile(a.dataDir, "tile_layouts.json", data)
}

// --- Active (working) layout ---
// The current on-screen tile arrangement, persisted independently of the named
// layout presets so drags/resizes survive a restart without overwriting templates.

func (a *App) GetActiveLayout() (string, error) {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "active_layout.json"))
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) SaveActiveLayout(layout string) error {
	return services.WriteDataFile(a.dataDir, "active_layout.json", []byte(layout))
}

// --- Backups ---

func (a *App) ListBackups(serverID string) ([]models.Backup, error) {
	return a.backupService.ListBackups(serverID)
}

func (a *App) GetBackupWorlds(serverID string, filename string) ([]models.WorldSystem, error) {
	return a.backupService.GetBackupWorlds(serverID, filename)
}

func (a *App) CreateBackup(serverID string) (models.Backup, error) {
	return a.backupService.CreateBackup(serverID)
}

func (a *App) RestoreBackup(serverID string, filename string) error {
	return a.backupService.RestoreBackup(serverID, filename)
}

func (a *App) DeleteBackup(serverID string, filename string) error {
	return a.backupService.DeleteBackup(serverID, filename)
}

func (a *App) UpdateBackupMeta(serverID string, filename string, displayName string, tags []string) (models.Backup, error) {
	return a.backupService.UpdateBackupMeta(serverID, filename, displayName, tags)
}

func (a *App) OpenBackupDir(serverID string) error {
	return a.backupService.OpenBackupDir(serverID)
}

// --- Custom commands ---

func (a *App) GetCustomCommands() ([]string, error) {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "custom_commands.json"))
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var cmds []string
	if err := json.Unmarshal(data, &cmds); err != nil {
		return nil, err
	}
	return cmds, nil
}

// --- Command buttons (unified, ordered, customizable) ---

// GetCommandButtons returns the button list plus whether a file existed at all.
//
// This used to return the file's raw bytes as a string, with the shape known
// only to the frontend. It is typed now because Go has to read individual items
// to resolve Kommands links (#213 Phase 4); the on-disk format is unchanged.
//
// The Seeded flag replaces what used to be an empty-string check. That check
// could not tell a first launch from a user who had deleted every button, and
// only got the second case right by accident.
func (a *App) GetCommandButtons() (models.CommandButtonSet, error) {
	return a.commandsService.Get()
}

func (a *App) SaveCommandButtons(items []models.CommandButton) error {
	return a.commandsService.Save(items)
}

// RefreshKommands re-reads Kommands' shared file now rather than waiting for
// the background poll, and reports what it found.
//
// Called on window focus, which is the case the 30s timer is deliberately too
// slow for: the user tabs to Kommands, links a command, and tabs back
// expecting it to be there. The reconciliation of buttons already added
// happens on this side of the bridge (CommandsService.SyncLinks) and announces
// itself through commands:changed; the list itself is GetKommandsCommands.
func (a *App) RefreshKommands() (models.KommandsStatus, error) {
	if err := a.kommandsService.Poll(true); err != nil {
		return a.kommandsService.Status(), err
	}
	return a.kommandsService.Status(), nil
}

// GetKommandsCommands returns what Kommands currently has linked, from the last
// successful read.
//
// This is what the library lists under Kommands, each with an Add: the user
// picks which of them become buttons here. It also carries
// models.KommandsSavedCommand into the generated TypeScript, which no other
// bound method's type graph reaches.
func (a *App) GetKommandsCommands() ([]models.KommandsSavedCommand, error) {
	return a.kommandsService.Saved(), nil
}

// --- Scheduler ---

func (a *App) GetScheduleGraphs(serverID string) ([]models.Graph, error) {
	return a.schedulerService.GetGraphs(serverID)
}

func (a *App) SaveScheduleGraph(serverID string, g models.Graph) (models.Graph, error) {
	return a.schedulerService.SaveGraph(serverID, g)
}

func (a *App) DeleteScheduleGraph(serverID string, id string) error {
	return a.schedulerService.DeleteGraph(serverID, id)
}

func (a *App) SetScheduleGraphEnabled(serverID string, id string, enabled bool) error {
	return a.schedulerService.SetGraphEnabled(serverID, id, enabled)
}

func (a *App) GetScheduleBlockDefs() ([]models.BlockDef, error) {
	return a.schedulerService.GetBlockDefs()
}

func (a *App) RunScheduleGraphNow(serverID string, id string) (models.RunRecord, error) {
	return a.schedulerService.RunGraphNow(serverID, id)
}

func (a *App) GetScheduleRunHistory(serverID string) ([]models.RunRecord, error) {
	return a.schedulerService.GetRunHistory(serverID)
}

func (a *App) GetScheduleNextRuns() (map[string]int64, error) {
	return a.schedulerService.NextRuns()
}

// --- Worlds ---

func (a *App) ListWorlds(serverID string) ([]models.WorldSystem, error) {
	return a.worldService.ListWorlds(serverID)
}

func (a *App) SetActiveWorld(serverID, name string) error {
	return a.worldService.SetActiveWorld(serverID, name)
}

func (a *App) DeleteWorld(serverID, name string) error {
	return a.worldService.DeleteWorld(serverID, name)
}

func (a *App) RenameWorld(serverID, oldName, newName string) error {
	return a.worldService.RenameWorld(serverID, oldName, newName)
}

func (a *App) DuplicateWorld(serverID, name, newName string) error {
	return a.worldService.DuplicateWorld(serverID, name, newName)
}

func (a *App) OpenWorldFolder(serverID, name string) error {
	return a.worldService.OpenWorldFolder(serverID, name)
}

func (a *App) BackupWorld(serverID, name string) (models.Backup, error) {
	return a.worldService.BackupWorld(serverID, name)
}

func (a *App) ImportScheduleGraphJSON(serverID string, raw string) (models.Graph, error) {
	return a.schedulerService.ImportGraphJSON(serverID, raw)
}

func (a *App) GetScheduleGraphWarnings(serverID string, g models.Graph) ([]models.GraphWarning, error) {
	return a.schedulerService.GraphWarnings(serverID, g)
}

func (a *App) PreviewScheduleNode(g models.Graph, nodeID string) (models.NodePreview, error) {
	return a.schedulerService.PreviewNode(g, nodeID)
}

// --- Mods / Plugins ---

var validModSortIndex = map[string]bool{
	"relevance": true,
	"newest":    true,
	"updated":   true,
	"downloads": true,
	"follows":   true,
}

func (a *App) ModSearch(serverID, query string, offset int, categories []string, sort string) (models.ModSearchResult, error) {
	if !validModSortIndex[sort] {
		sort = ""
	}
	return a.modService.Search(serverID, query, offset, categories, sort)
}

func (a *App) ModGetProject(projectID string) (models.ModProject, error) {
	return a.modService.GetProject(projectID)
}

func (a *App) ModGetVersions(serverID, projectID string) ([]models.ModVersion, error) {
	return a.modService.GetVersions(serverID, projectID)
}

func (a *App) ModGetAllVersions(projectID string) ([]models.ModVersion, error) {
	return a.modService.GetAllVersions(projectID)
}

func (a *App) ModResolveDependencies(serverID, versionID string) ([]models.ResolvedDependency, error) {
	return a.modService.ResolveDependencies(serverID, versionID)
}

func (a *App) ModInstall(serverID string, versionIDs []string) error {
	return a.modService.Install(serverID, versionIDs)
}

func (a *App) ModListInstalled(serverID string) ([]models.InstalledMod, error) {
	return a.modService.ListInstalled(serverID)
}

// ModRescan looks at the server's mod folders now rather than waiting out the
// background scan's 30s tick, identifying anything that arrived from outside
// Konnekt. Called on window focus and when the mods tile mounts, which is the
// case the timer is deliberately too slack for: a user drags a jar into
// plugins/ in their file manager and switches straight back to the app.
//
// Emits mod:changed itself when something moved, so the caller does not have to
// re-read on the strength of having asked.
func (a *App) ModRescan(serverID string) error {
	return a.modService.Rescan(serverID)
}

func (a *App) ModSetEnabled(serverID, fileName string, enabled bool) error {
	return a.modService.SetEnabled(serverID, fileName, enabled)
}

func (a *App) ModUninstall(serverID, fileName string) error {
	return a.modService.Uninstall(serverID, fileName)
}

func (a *App) ModCategories(serverID string) ([]string, error) {
	return a.modService.Categories(serverID)
}

func (a *App) ModMoreByAuthor(serverID, username, excludeProjectID string) ([]models.ModProject, error) {
	return a.modService.MoreByAuthor(serverID, username, excludeProjectID)
}

func (a *App) ModCheckUpdates(serverID string) ([]models.ModUpdateInfo, error) {
	return a.modService.CheckUpdates(serverID)
}

func (a *App) ModInstallLocal(serverID string) error {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Mod/Plugin Files",
		Filters: []runtime.FileFilter{
			{DisplayName: "JAR Files (*.jar)", Pattern: "*.jar"},
		},
	})
	if err != nil || len(paths) == 0 {
		return err
	}
	return a.modService.InstallLocal(serverID, paths)
}

func (a *App) DetectServerLoader(serverID string) (models.ServerConfig, error) {
	return a.modService.DetectServerLoader(serverID)
}

// ── Remote Access, the desktop's side ───────────────────────────────────
//
// Every method below is in neverRemote (remote_methods.go): a browser that
// could call one could approve itself. The state they change is announced by
// remote:changed, and GetRemoteAccessState is what the desktop reads back.

func (a *App) GetRemoteAccessState() (models.RemoteAccessState, error) {
	return models.RemoteAccessState{
		PasswordSet:    a.remoteAuth.PasswordSet(),
		Running:        a.remoteService.Running(),
		Addr:           a.remoteService.Addr(),
		Clients:        a.remoteService.ClientCount(),
		Devices:        a.remoteAuth.Devices(),
		PendingDevices: a.remoteAuth.Pending(),
		Approvals:      a.remoteApprovals.Pending(),
		Tunnel:         a.tunnelService.State(),
		Connectors:     a.connectorsState(),
		LocalMCP:       a.localMCP.State(mcpBridgeExecutable()),
	}, nil
}

func (a *App) connectorsState() models.ConnectorsState {
	state := models.ConnectorsState{Enabled: a.remoteAuth.ConnectorsEnabled(), Grants: a.remoteAuth.Grants()}
	if named := a.tunnelService.Named(); named.Hostname != "" {
		state.URL = services.RemoteResource(named.Hostname)
	}
	return state
}

// SetRemoteConnectorsEnabled is "Allow Claude connectors" (#513): on, the
// listener answers MCP at /mcp to a client holding a grant; off, that path
// does not exist. Off by default, and decided at the desktop only.
func (a *App) SetRemoteConnectorsEnabled(on bool) error {
	if err := a.remoteAuth.SetConnectorsEnabled(on); err != nil {
		return err
	}
	a.syncConnectors()
	return nil
}

// RevokeRemoteGrant ends one connector's grant (#513); its next call is
// refused.
func (a *App) RevokeRemoteGrant(id string) error {
	return a.remoteAuth.RevokeGrant(id)
}

// RevokeAllRemoteGrants ends every connector's grant (#515). Each signs in
// again from scratch, through the password and the desktop.
func (a *App) RevokeAllRemoteGrants() error {
	return a.remoteAuth.RevokeGrants()
}

// initRemote reads Remote Access's saved state from dir at startup. The named
// tunnel loads before syncConnectors runs, because the idle hold depends on
// its hostname: the other way round, every restart computed the hold from an
// empty tunnel and the listener idle-stopped under a saved connector (#620).
func (a *App) initRemote(dir string) {
	a.remoteAuth.SetDataDir(dir)
	a.tunnelService.SetDataDir(dir)
	a.syncConnectors()
}

// syncConnectors gives the listener the switch and the idle hold it follows
// (§ S9.10): held open only while a named tunnel is configured and the switch
// is on, because a connector used once a day would otherwise find the
// listener stopped, and a quick tunnel's random hostname is not worth
// keeping a listener up for.
func (a *App) syncConnectors() {
	on := a.remoteAuth.ConnectorsEnabled()
	a.remoteService.SetMCPEnabled(on)
	a.remoteService.SetHoldOpen(on && a.tunnelService.Named().Hostname != "")
}

// SetRemotePassword sets or replaces the one password. Replacing it signs
// every device out.
func (a *App) SetRemotePassword(password string) error {
	return a.remoteAuth.SetPassword(password)
}

// StartRemoteAccess starts the listener on a loopback port: a free one, or
// the named tunnel's fixed one while that is configured (#512), because the
// dashboard's ingress rule names it. It refuses without a password: a
// listener nobody can sign in to is only attack surface.
func (a *App) StartRemoteAccess() error {
	if !a.remoteAuth.PasswordSet() {
		return errors.New("set a password before switching remote access on")
	}
	port := 0
	if named := a.tunnelService.Named(); named.Hostname != "" {
		port = named.Port
	}
	_, err := a.remoteService.Start(port)
	return err
}

// StopRemoteAccess stops the listener, and with it the tunnel if one is up.
func (a *App) StopRemoteAccess() error {
	return a.remoteService.Stop()
}

// StartRemoteTunnel makes the running listener reachable from the internet
// through a Cloudflare quick tunnel (#46). It returns once the work has
// started; GetRemoteAccessState's Tunnel reports the download, the URL or the
// failure. The listener has to be running: there is nothing to point it at
// otherwise, and the sign-in in front of the dashboard is the listener's.
func (a *App) StartRemoteTunnel() error {
	addr := a.remoteService.Addr()
	if addr == "" {
		return errors.New("switch remote access on before opening the tunnel")
	}
	return a.tunnelService.Start(addr)
}

func (a *App) StopRemoteTunnel() error {
	return a.tunnelService.Stop()
}

// SaveRemoteTunnel configures the named tunnel (#512): the hostname the user
// routed in their Cloudflare dashboard, the loopback port its ingress rule
// names, and the tunnel token. An empty token keeps the stored one. The token
// goes to an owner-only file and nowhere else (§ S9.8); it is not in the
// state this method's twin returns, only whether one is set.
func (a *App) SaveRemoteTunnel(hostname string, port int, token string) error {
	if err := a.tunnelService.SaveNamed(hostname, port, token); err != nil {
		return err
	}
	a.syncConnectors()
	return nil
}

// ForgetRemoteTunnel deletes the named tunnel's token and configuration, and
// the devices approved on its hostname. The switch runs a quick tunnel again.
func (a *App) ForgetRemoteTunnel() error {
	if err := a.tunnelService.ForgetNamed(); err != nil {
		return err
	}
	a.syncConnectors()
	return nil
}

// GetLocalMCPState is what Settings shows about the local bridge (#511): the
// switch, the endpoint and the command to register with a client. The secret
// is not in it.
func (a *App) GetLocalMCPState() (models.LocalMCPState, error) {
	return a.localMCP.State(mcpBridgeExecutable()), nil
}

// SetLocalMCPEnabled is "Allow Claude on this computer": on starts the
// loopback endpoint with a fresh secret, off stops it. Off by default, and
// decided at the desktop only (neverRemote).
func (a *App) SetLocalMCPEnabled(on bool) error {
	return a.localMCP.SetEnabled(on)
}

// ApproveRemoteDevice approves a waiting browser under the name the person at
// the desktop typed (§ S8.6).
func (a *App) ApproveRemoteDevice(requestID, name string) error {
	return a.remoteAuth.ApproveDevice(requestID, name)
}

func (a *App) DenyRemoteDevice(requestID string) error {
	return a.remoteAuth.DenyDevice(requestID)
}

// RemoveRemoteDevice forgets an approved device and ends its sessions.
func (a *App) RemoveRemoteDevice(deviceID string) error {
	return a.remoteAuth.RemoveDevice(deviceID)
}

// RevokeRemoteSessions signs every device out (§ S8.5). They stay approved.
func (a *App) RevokeRemoteSessions() error {
	a.remoteAuth.RevokeSessions()
	return nil
}

// AnswerRemoteApproval is the desktop's yes or no to one admin-tier call
// (§ S8.2, #462).
func (a *App) AnswerRemoteApproval(id string, allow bool) error {
	return a.remoteApprovals.Answer(id, allow)
}
