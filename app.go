package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	bus                 *services.EventBus
	dataDir             string
}

func NewApp() *App {
	rcon := services.NewRconService()
	srv := services.NewServerService()
	srv.SetRcon(rcon)
	cfg := services.NewConfigService()
	bus := services.NewEventBus()
	srv.SetBus(bus)
	stats := services.NewStatsService(srv)
	stats.SetBus(bus)
	backup := services.NewBackupService(cfg, srv)
	backup.SetBus(bus)
	sched := services.NewSchedulerService(srv, backup, rcon, cfg)
	sched.SetBus(bus)
	mods := services.NewModService(cfg, srv)
	mods.SetBus(bus)
	update := services.NewUpdateService()
	update.SetBus(bus)
	installer := services.NewInstallerService()
	installer.SetBus(bus)
	loader := services.NewLoaderService(cfg, srv, backup, installer)
	loader.SetBus(bus)
	return &App{
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
		bus:                 bus,
	}
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
	if a.serverService.IsRunning() {
		// Stop's error paths here are "server not running" (the IsRunning guard
		// covers it, and a race can only make it true — the benign direction)
		// and "another power action is in progress" (quitting anyway is fine:
		// the stdin stop is best-effort, and the Windows Job Object / Linux
		// Pdeathsig tie the java tree to Konnekt's lifetime). A process that
		// ignores the stdin stop is handled inside Stop by killTree, not
		// reported here.
		_ = a.serverService.Stop(quitStopGrace) //nolint:errcheck // see above
	}
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
	a.installerService.SetContext(ctx)
	a.loaderService.SetContext(ctx)
	a.loaderService.SetDataDir(a.dataDir)
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

// --- Updates ---

func (a *App) GetAppVersion() (string, error) {
	return Version, nil
}

func (a *App) CheckForUpdates() (models.UpdateInfo, error) {
	return a.updateService.CheckForUpdates(a.ctx, Version)
}

// DownloadAndInstallUpdate downloads the latest release's binary for this
// platform, verifies it, and replaces the running executable in place. On
// success it relaunches the app and quits this process — the frontend won't
// see a resolved promise in that case, only a live app restart. A dev build
// (wails dev, no ldflags-stamped tag) has no installable artifact, so it's
// rejected up front rather than attempting a check that would trivially fail.
func (a *App) DownloadAndInstallUpdate() error {
	if strings.Contains(Version, "-dev") {
		return fmt.Errorf("update install: not available in dev builds")
	}
	if err := a.updateService.DownloadAndInstallUpdate(a.ctx, Version); err != nil {
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
	return a.configEditorService.WriteConfigFile(serverID, relPath, content)
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
	return a.serverService.Stop(a.configService.StopGrace())
}

func (a *App) RestartServer(serverID string) error {
	cfg, err := a.configService.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	return a.serverService.Restart(serverID, cfg.JarPath, cfg.JvmArgs, cfg.WorkingDir, a.configService.StopGrace())
}

// ForceStopServer kills the server process tree immediately, bypassing the
// power-action gate — the escape hatch for a stop that is wedged. serverID is
// ignored like StopServer's (single active server).
func (a *App) ForceStopServer(serverID string) error {
	return a.serverService.ForceStop()
}

// GetLastStop reports the most recent stop's detail, the readable getter twin
// of the server:stopped event payload. Zero value until a stop has happened.
func (a *App) GetLastStop() (models.ServerStopped, error) {
	return a.serverService.GetLastStop(), nil
}

func (a *App) AcceptEula(serverID string) error {
	cfg, err := a.configService.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	content := "# EULA accepted via Konnekt\neula=true\n"
	if err := os.WriteFile(filepath.Join(cfg.WorkingDir, "eula.txt"), []byte(content), 0644); err != nil {
		return err
	}
	a.serverService.Narrate("EULA accepted, eula.txt written")
	return nil
}

func (a *App) SendCommand(serverID string, command string) error {
	return a.serverService.SendCommand(command)
}

// --- Status and players ---

func (a *App) GetServerStatus(serverID string) (models.ServerStatus, error) {
	return models.ServerStatus{
		Running:    a.serverService.IsRunning(),
		State:      a.serverService.State(),
		Uptime:     a.serverService.Uptime(),
		Players:    a.serverService.PlayerCount(),
		MaxPlayers: a.serverService.MaxPlayers(),
		TPS:        a.serverService.CurrentTPS(),
		RAMUsed:    a.serverService.RAMUsedMB(),
		RAMTotal:   a.serverService.RAMTotalMB(),
	}, nil
}

func (a *App) GetStatsHistory(serverID string) ([]models.StatsSnapshot, error) {
	return a.statsService.GetStatsHistory(), nil
}

// GetConsoleHistory backfills the console for a client that connected mid-session
// (remote-access seam). serverID is ignored — single active server, like
// GetStatsHistory. No desktop caller yet; pair with useConsoleStore.loadHistory.
func (a *App) GetConsoleHistory(serverID string) ([]models.ConsoleLine, error) {
	return a.serverService.GetConsoleHistory(), nil
}

func (a *App) GetPlayerRoster(serverID string) ([]models.Player, error) {
	return a.playerService.GetRoster(serverID)
}

func (a *App) GetPlayerDetail(serverID string, name string) (models.Player, error) {
	return a.playerService.GetDetail(serverID, name)
}

func (a *App) KickPlayer(serverID string, name string, reason string) error {
	cmd := fmt.Sprintf("kick %s %s", name, reason)
	return a.serverService.SendCommand(cmd)
}

func (a *App) BanPlayer(serverID string, name string, reason string) error {
	cmd := fmt.Sprintf("ban %s %s", name, reason)
	return a.serverService.SendCommand(cmd)
}

func (a *App) PardonPlayer(serverID string, name string) error {
	return a.serverService.SendCommand(fmt.Sprintf("pardon %s", name))
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

func (a *App) SaveCustomCommands(cmds []string) error {
	data, err := json.Marshal(cmds)
	if err != nil {
		return err
	}
	return services.WriteDataFile(a.dataDir, "custom_commands.json", data)
}

// --- Command buttons (unified, ordered, customizable) ---

func (a *App) GetCommandButtons() (string, error) {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "command_buttons.json"))
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) SaveCommandButtons(data string) error {
	return services.WriteDataFile(a.dataDir, "command_buttons.json", []byte(data))
}

// --- Scheduler ---

func (a *App) GetScheduleGraphs() ([]models.Graph, error) {
	return a.schedulerService.GetGraphs()
}

func (a *App) SaveScheduleGraph(g models.Graph) (models.Graph, error) {
	return a.schedulerService.SaveGraph(g)
}

func (a *App) DeleteScheduleGraph(id string) error {
	return a.schedulerService.DeleteGraph(id)
}

func (a *App) SetScheduleGraphEnabled(id string, enabled bool) error {
	return a.schedulerService.SetGraphEnabled(id, enabled)
}

func (a *App) GetScheduleBlockDefs() ([]models.BlockDef, error) {
	return a.schedulerService.GetBlockDefs()
}

func (a *App) RunScheduleGraphNow(id string) (models.RunRecord, error) {
	return a.schedulerService.RunGraphNow(id)
}

func (a *App) GetScheduleRunHistory() ([]models.RunRecord, error) {
	return a.schedulerService.GetRunHistory()
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

func (a *App) ImportScheduleGraphJSON(raw string) (models.Graph, error) {
	return a.schedulerService.ImportGraphJSON(raw)
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
