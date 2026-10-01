package main

import "konnekt/backend/services"

// The Remote Access allowlist (agent_docs/SECURITY_CHECKLIST.md § S8.1).
//
// Every method app.go binds is in exactly one of the two maps below, and
// remote_methods_test.go reads app.go to hold that: a new bound method fails
// the test until its author has decided, in writing, what a phone may do with
// it. The tiers are defined on services.RemoteTier; the short version is that
// read observes, operate does what the tiles do all day, and admin amounts to
// code execution on the host and waits for the desktop's approval (§ S8.2).
//
// The dispatcher resolves these names against App once (services.
// NewRemoteDispatcher); nothing reflects over App as a whole.
var remoteMethods = map[string]services.RemoteMethod{
	// Servers and settings.
	"GetServerConfigs": {Tier: services.RemoteTierRead, Reason: "the server list"},
	"SaveServerConfig": {Tier: services.RemoteTierAdmin, Reason: "JVM arguments and the jar path become a process on the next start"},
	"DeleteServerConfig": {Tier: services.RemoteTierAdmin,
		Reason: "removes a server from the app; recoverable only by re-adding it on the desktop"},
	"GetActiveServerID": {Tier: services.RemoteTierRead, Reason: "the remote mirrors the desktop's selection"},
	"GetAppSettings":    {Tier: services.RemoteTierRead, Reason: "theme and behaviour flags, nothing secret"},
	"SaveAppSettings":   {Tier: services.RemoteTierAdmin, Reason: "auto-start and stop grace change what runs and for how long (§ S8.2)"},
	"GetDataDir":        {Tier: services.RemoteTierRead, Reason: "shown in About; a path, not a file"},
	"GetLogPath":        {Tier: services.RemoteTierRead, Reason: "shown in About; a path, not a file"},
	"LogClientError":    {Tier: services.RemoteTierOperate, Reason: "writes a clamped line to konnekt.log; a remote tile crash is worth a line too"},
	"GetAppVersion":     {Tier: services.RemoteTierRead, Reason: "the About pane"},
	"CheckForUpdates":   {Tier: services.RemoteTierRead, Reason: "asks GitHub, changes nothing"},
	"DownloadAndInstallUpdate": {Tier: services.RemoteTierAdmin,
		Reason: "replaces the running executable (§ S8.2)"},

	// Config files.
	"ListConfigFiles": {Tier: services.RemoteTierRead, Reason: "file names under the server directory"},
	"ReadConfigFile": {Tier: services.RemoteTierRead,
		Reason: "the config editor; server.properties carries the RCON password, which the editor shows on the desktop too (§ S2.1)"},
	"WriteConfigFile": {Tier: services.RemoteTierAdmin, Reason: "a config file is what the server runs on (§ S8.2)"},

	// Installer and loader.
	"InspectServerFile": {Tier: services.RemoteTierAdmin,
		Reason: "reads a jar at any host path; the preflight of InstallServer and gated the same way"},
	"InstallServer":      {Tier: services.RemoteTierAdmin, Reason: "runs an installer at a host path (§ S8.2)"},
	"AbortInstall":       {Tier: services.RemoteTierOperate, Reason: "stops a job; the safe direction"},
	"GetLoaderStatus":    {Tier: services.RemoteTierRead, Reason: "the loader tile's summary"},
	"ListLoaderVersions": {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"UpdateLoader":       {Tier: services.RemoteTierAdmin, Reason: "downloads and runs a loader installer (§ S8.2)"},
	"DetectServerLoader": {Tier: services.RemoteTierRead, Reason: "reads the server directory and reports; saves nothing"},

	// Lifecycle and console.
	"GetServerSummary":  {Tier: services.RemoteTierRead, Reason: "the overview tile"},
	"StartServer":       {Tier: services.RemoteTierOperate, Reason: "runs the configured server; the config that decides what runs is admin"},
	"StopServer":        {Tier: services.RemoteTierOperate, Reason: "the power buttons"},
	"RestartServer":     {Tier: services.RemoteTierOperate, Reason: "the power buttons"},
	"ForceStopServer":   {Tier: services.RemoteTierOperate, Reason: "the power buttons"},
	"GetLastStop":       {Tier: services.RemoteTierRead, Reason: "why the server stopped"},
	"AcceptEula":        {Tier: services.RemoteTierOperate, Reason: "writes eula.txt's one boolean"},
	"SendCommand":       {Tier: services.RemoteTierOperate, Reason: "the console; a server command, not a host command"},
	"GetServerStatus":   {Tier: services.RemoteTierRead, Reason: "the status strip"},
	"GetStatsHistory":   {Tier: services.RemoteTierRead, Reason: "the performance tile"},
	"GetConsoleHistory": {Tier: services.RemoteTierRead, Reason: "primes the console after a reconnect"},

	// Players.
	"GetPlayerRoster": {Tier: services.RemoteTierRead, Reason: "the players tile"},
	"GetPlayerDetail": {Tier: services.RemoteTierRead, Reason: "the players tile"},
	"KickPlayer":      {Tier: services.RemoteTierOperate, Reason: "moderation; a game action"},
	"BanPlayer":       {Tier: services.RemoteTierOperate, Reason: "moderation; a game action"},
	"PardonPlayer":    {Tier: services.RemoteTierOperate, Reason: "moderation; a game action"},

	// Layout. Shared with the desktop until #47 decides whether a phone keeps
	// its own; a remote write rearranges the desktop's canvas, which is
	// annoying and nothing worse.
	"GetLayoutPresets":   {Tier: services.RemoteTierRead, Reason: "the canvas layout"},
	"SaveLayoutPreset":   {Tier: services.RemoteTierOperate, Reason: "the canvas layout"},
	"DeleteLayoutPreset": {Tier: services.RemoteTierOperate, Reason: "the canvas layout"},
	"GetActiveTiles":     {Tier: services.RemoteTierRead, Reason: "the canvas layout"},
	"SaveActiveTiles":    {Tier: services.RemoteTierOperate, Reason: "the canvas layout"},
	"GetTileLayouts":     {Tier: services.RemoteTierRead, Reason: "the canvas layout"},
	"SaveTileLayouts":    {Tier: services.RemoteTierOperate, Reason: "the canvas layout"},
	"GetActiveLayout":    {Tier: services.RemoteTierRead, Reason: "the canvas layout"},
	"SaveActiveLayout":   {Tier: services.RemoteTierOperate, Reason: "the canvas layout"},

	// Backups and worlds.
	"ListBackups":      {Tier: services.RemoteTierRead, Reason: "the backups tile"},
	"GetBackupWorlds":  {Tier: services.RemoteTierRead, Reason: "the backups tile"},
	"CreateBackup":     {Tier: services.RemoteTierOperate, Reason: "writes an archive under the backup dir"},
	"RestoreBackup":    {Tier: services.RemoteTierOperate, Reason: "replaces world data from an archive Konnekt made; a server action"},
	"DeleteBackup":     {Tier: services.RemoteTierOperate, Reason: "deletes one archive under the backup dir"},
	"UpdateBackupMeta": {Tier: services.RemoteTierOperate, Reason: "a display name and tags"},
	"ListWorlds":       {Tier: services.RemoteTierRead, Reason: "the worlds tile"},
	"SetActiveWorld":   {Tier: services.RemoteTierOperate, Reason: "level-name in server.properties"},
	"DeleteWorld":      {Tier: services.RemoteTierOperate, Reason: "a world folder under the server directory, guarded by S3"},
	"RenameWorld":      {Tier: services.RemoteTierOperate, Reason: "a world folder under the server directory, guarded by S3"},
	"DuplicateWorld":   {Tier: services.RemoteTierOperate, Reason: "a world folder under the server directory, guarded by S3"},
	"BackupWorld":      {Tier: services.RemoteTierOperate, Reason: "writes an archive under the backup dir"},

	// Commands and Kommands.
	"GetCustomCommands":   {Tier: services.RemoteTierRead, Reason: "the quick-commands grid"},
	"GetCommandButtons":   {Tier: services.RemoteTierRead, Reason: "the quick-commands grid"},
	"SaveCommandButtons":  {Tier: services.RemoteTierOperate, Reason: "the grid's own file; a button runs a server command, not a host one"},
	"RefreshKommands":     {Tier: services.RemoteTierRead, Reason: "re-reads Kommands' shared file"},
	"GetKommandsCommands": {Tier: services.RemoteTierRead, Reason: "the Kommands list"},

	// Scheduler. A graph carries HTTP-request and command blocks, so writing
	// one is writing something that runs.
	"GetScheduleGraphs":       {Tier: services.RemoteTierRead, Reason: "the scheduler tile"},
	"SaveScheduleGraph":       {Tier: services.RemoteTierAdmin, Reason: "a graph's blocks run on a timer (§ S8.2)"},
	"ImportScheduleGraphJSON": {Tier: services.RemoteTierAdmin, Reason: "a graph's blocks run on a timer (§ S8.2)"},
	"DeleteScheduleGraph":     {Tier: services.RemoteTierOperate, Reason: "removes a graph; the safe direction"},
	"SetScheduleGraphEnabled": {Tier: services.RemoteTierOperate, Reason: "pauses or resumes a graph the desktop wrote"},
	"GetScheduleBlockDefs":    {Tier: services.RemoteTierRead, Reason: "static block definitions"},
	"RunScheduleGraphNow":     {Tier: services.RemoteTierOperate, Reason: "runs a graph the desktop wrote, which its trigger would run anyway"},
	"GetScheduleRunHistory":   {Tier: services.RemoteTierRead, Reason: "the run log"},
	"GetScheduleNextRuns":     {Tier: services.RemoteTierRead, Reason: "the countdowns"},
	"PreviewScheduleNode":     {Tier: services.RemoteTierRead, Reason: "evaluates data nodes only; action nodes are described, never run"},

	// Mods. Installing a jar the server JVM loads is code execution on the
	// host, however it was downloaded, so it waits for the desktop; enabling
	// or removing one already on disk is not.
	"ModSearch":              {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModGetProject":          {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModGetVersions":         {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModGetAllVersions":      {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModResolveDependencies": {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModInstall":             {Tier: services.RemoteTierAdmin, Reason: "downloads a jar the server will execute (§ S8.2)"},
	"ModListInstalled":       {Tier: services.RemoteTierRead, Reason: "the mods tile"},
	"ModRescan":              {Tier: services.RemoteTierOperate, Reason: "re-reads the mods folder"},
	"ModSetEnabled":          {Tier: services.RemoteTierOperate, Reason: "renames a jar already in the mods folder"},
	"ModUninstall":           {Tier: services.RemoteTierOperate, Reason: "deletes a jar from the mods folder"},
	"ModCategories":          {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModMoreByAuthor":        {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
	"ModCheckUpdates":        {Tier: services.RemoteTierRead, Reason: "a provider lookup"},
}

// neverRemote are the bound methods a remote client can never reach, each
// with the reason. They are not in the dispatcher's table at all, so to a
// phone they do not exist.
var neverRemote = map[string]string{
	"BrowseJarFile":     "a native file dialog on the desktop",
	"BrowseDirectory":   "a native directory dialog on the desktop",
	"OpenDataDir":       "opens a folder on the desktop",
	"OpenBackupDir":     "opens a folder on the desktop",
	"OpenWorldFolder":   "opens a folder on the desktop",
	"ModInstallLocal":   "a native file dialog on the desktop",
	"SetActiveServerID": "would change what the desktop is looking at (§ S8.11); the remote mirrors the selection instead",

	// The desktop's own control over remote access. A session that could call
	// any of these could approve itself, or lock the desktop's user out.
	"GetRemoteAccessState": "lists the devices, the waiting requests and the arguments of calls awaiting approval",
	"SetRemotePassword":    "the first factor; set at the desktop only",
	"StartRemoteAccess":    "switched on at the desktop only (§ S8.8)",
	"StopRemoteAccess":     "a browser that could stop the listener could lock every other device out; closing the tab is its way to leave",
	"ApproveRemoteDevice":  "the second factor (§ S8.6); a browser that could call it could approve itself",
	"DenyRemoteDevice":     "the desktop's answer to a waiting device",
	"RemoveRemoteDevice":   "the desktop's list of who may sign in",
	"RevokeRemoteSessions": "revocation is the desktop's (§ S8.5)",
	"AnswerRemoteApproval": "the approval itself (§ S8.2); a browser that could call it could approve its own admin calls",
}
