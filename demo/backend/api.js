/* Every bound method, in three classes.
 *
 *   1. read     — resolves a fixture
 *   2. modrinth — goes out to the real API
 *   3. refuse   — rejects with a demo error and raises the notice
 *
 * demo/build.mjs cross-checks the keys of the object exported here against
 * frontend/wailsjs/go/main/App.d.ts and fails the build on either a method the
 * app can call that the demo has not answered, or a method here that no longer
 * exists. That check is the whole reason this file is one flat table rather
 * than something clever: a binding added upstream should break the demo build
 * loudly, not surface as a tile that mysteriously does nothing.
 *
 * Three groups of writes deliberately succeed rather than refusing, because
 * refusing them would break the interaction the demo exists to show — see
 * `mutate` below, and state.js for the two lifecycle calls.
 */

import { showDemoNotice } from "./toast.js";
import * as modrinth from "./modrinth.js";
import * as state from "./state.js";
import * as frame from "./frame.js";
import {
  SERVER_ID,
  SERVER_CONFIGS,
  STATS_HISTORY,
  PLAYERS,
  daysAgo,
  minutesAgo,
  configFor,
  summaryFor,
} from "./fixtures/server.js";
import { WORLDS, BACKUP_WORLDS, SURVIVAL_WORLDS } from "./fixtures/worlds.js";
import { BACKUPS } from "./fixtures/backups.js";
import { RELEASE_NOTES } from "./fixtures/releases.js";
import {
  INSTALLED_MODS,
  MOD_UPDATES,
  PACK_PLAN,
  PACK_STATE,
  SURVIVAL_PLUGINS,
  SURVIVAL_PLUGIN_UPDATES,
} from "./fixtures/mods.js";
import { configFiles, readConfigFile } from "./fixtures/config.js";
import { DESTINATIONS, NEXT_RUNS } from "./fixtures/scheduler.js";
import {
  COMMAND_BUTTONS,
  KOMMANDS_SAVED,
  KOMMANDS_STATUS,
} from "./fixtures/commands.js";
import BLOCK_DEFS from "./fixtures/blockdefs.json" with { type: "json" };

/** Resolves a copy, so a tile that mutates what it is handed cannot poison the
 *  fixture for the next reader. Structured clone matches what IPC would do.
 *
 *  The arguments are forwarded, which is not incidental: ReadConfigFile picks
 *  its file by relPath and PreviewScheduleNode by node id, so swallowing them
 *  made the config tile answer "Could not read server.properties" for every
 *  file it has. */
const read =
  (value) =>
  async (...args) =>
    typeof value === "function"
      ? structuredClone(await value(...args))
      : structuredClone(value);

/** Refuses, visibly. The rejection is what makes the app revert its optimistic
 *  update and keep its editor open; the notice is what explains why. */
const refuse = (what) => async () => {
  showDemoNotice(what);
  throw new Error(`${what} is not available in the demo`);
};

/** Succeeds against in-memory state. Resets on reload, which is deliberate:
 *  every visitor should get the same first impression. */
const mutate =
  (fn) =>
  async (...args) =>
    structuredClone(await fn(...args));

/** Only the first server has history, a roster and backups; the second is
 *  offline and mostly empty, which is what makes a switch visible. */
const first = (id) => id === SERVER_ID;

export const api = {
  // ── Server lifecycle ──────────────────────────────────────────────────
  // Start and Stop succeed against state.js, which replays a boot log and
  // moves the status through starting, running, stopping and offline with
  // the same events the Go side emits. Everything else that acts on a
  // process keeps refusing, commands included: a console that answers `list`
  // from a table would be a script pretending to be a server.
  StartServer: mutate((id) => state.startServer(id)),
  StopServer: mutate((id) => state.stopServer(id)),
  RestartServer: refuse("Restarting a server"),
  ForceStopServer: refuse("Force stopping a server"),
  SendCommand: refuse("Sending a command"),
  AcceptEula: refuse("Accepting the EULA"),
  GetServerStatus: read((id) => state.status(id)),
  GetServerSummary: read((id) => ({
    ...summaryFor(id),
    running: state.running(id),
  })),
  GetLastStop: read(() => state.lastStop(state.activeServer())),
  GetStatsHistory: read((id) => (first(id) ? STATS_HISTORY : [])),
  GetConsoleHistory: read([]), // console is fed by log:line; see events.js
  GetServerLogTail: read([]), // the demo server writes no log file

  // ── Servers ───────────────────────────────────────────────────────────
  GetServerConfigs: read(SERVER_CONFIGS),
  GetActiveServerID: read(() => state.activeServer()),
  SetActiveServerID: mutate((id) => state.setActiveServer(id)),
  SaveServerConfig: refuse("Editing a server"),
  DeleteServerConfig: refuse("Removing a server"),
  DetectServerLoader: read((id) => configFor(id)),
  InspectServerFile: read({
    isInstaller: false,
    loader: "",
    version: "",
    mcVersion: "",
  }),
  InstallServer: refuse("Installing a server"),
  AbortInstall: refuse("Cancelling an install"),

  // ── Loader ────────────────────────────────────────────────────────────
  // NeoForge is the loader Konnekt manages (loader.go), and a run.sh install
  // is the "script" source it can update; Paper it cannot.
  GetLoaderStatus: read((id) => {
    const { loader, loaderVersion, mcVersion } = configFor(id);
    const managed = loader === "neoforge";
    return {
      loader,
      installedVersion: loaderVersion,
      mcVersion,
      source: managed ? "script" : "",
      managed,
      reason: managed ? "" : `Konnekt cannot update ${loader} servers yet.`,
    };
  }),
  ListLoaderVersions: read((id) =>
    configFor(id).loader === "neoforge"
      ? ["21.1.267", "21.1.266", "21.1.265"].map((version, i) => ({
          version,
          mcVersion: "1.21.1",
          stable: true,
          latest: i === 0,
        }))
      : [],
  ),
  UpdateLoader: refuse("Updating the loader"),

  // ── Players ───────────────────────────────────────────────────────────
  GetPlayerRoster: read((id) => state.players(id)),
  GetPlayerDetail: read(
    async (_id, name) => PLAYERS.find((p) => p.name === name) ?? PLAYERS[0],
  ),
  KickPlayer: refuse("Kicking a player"),
  BanPlayer: refuse("Banning a player"),
  PardonPlayer: refuse("Pardoning a player"),

  // ── Worlds ────────────────────────────────────────────────────────────
  ListWorlds: read((id) => (first(id) ? WORLDS : SURVIVAL_WORLDS)),
  GetBackupWorlds: read((id) => (first(id) ? BACKUP_WORLDS : [])),
  SetActiveWorld: refuse("Switching worlds"),
  RenameWorld: refuse("Renaming a world"),
  DuplicateWorld: refuse("Duplicating a world"),
  DeleteWorld: refuse("Deleting a world"),
  BackupWorld: refuse("Backing up a world"),
  OpenWorldFolder: refuse("Opening the world folder"),

  // ── Backups ───────────────────────────────────────────────────────────
  ListBackups: read((id) => (first(id) ? BACKUPS : [])),
  CreateBackup: refuse("Creating a backup"),
  RestoreBackup: refuse("Restoring a backup"),
  DeleteBackup: refuse("Deleting a backup"),
  UpdateBackupMeta: refuse("Renaming a backup"),
  OpenBackupDir: refuse("Opening the backup folder"),

  // ── Config files ──────────────────────────────────────────────────────
  ListConfigFiles: read((id) => configFiles(id)),
  ReadConfigFile: read(async (id, relPath) => readConfigFile(id, relPath)),
  WriteConfigFile: refuse("Saving a config file"),

  // ── Scheduler ─────────────────────────────────────────────────────────
  // Graph edits stick: wiring nodes together is one of the things worth
  // showing, and a refusal would revert every drag. Running one does not —
  // that is acting on a real server.
  // The serverID each of these now leads with (#236) is ignored: the demo has
  // one server, so scoping to it is the identity, and dropping the argument
  // here would only hide a signature change the real app has to honour.
  GetScheduleBlockDefs: read(BLOCK_DEFS),
  GetScheduleGraphs: read(() => state.graphs()),
  GetScheduleNextRuns: read(NEXT_RUNS),
  GetScheduleRunHistory: read([]),
  // The demo's server is running with RCON up, which is the case with nothing to
  // warn about. An answer is a list of { nodeId, text }, one per block it is about.
  GetScheduleGraphWarnings: read([]),
  SaveScheduleGraph: mutate((_serverId, g) => state.saveGraph(g)),
  DeleteScheduleGraph: mutate((_serverId, id) => state.deleteGraph(id)),
  SetScheduleGraphEnabled: mutate((_serverId, id, on) =>
    state.setGraphEnabled(id, on),
  ),
  ImportScheduleGraphJSON: refuse("Importing a graph"),
  RunScheduleGraphNow: refuse("Running a schedule"),
  PreviewScheduleNode: read(async (_g, nodeId) => ({
    nodeId,
    attributes: [],
    console: ["Previewing a node needs a live server."],
    ok: false,
  })),

  // ── Mods and plugins ──────────────────────────────────────────────────
  // Browsing is live; installing is not.
  ModListInstalled: read((id) =>
    first(id) ? INSTALLED_MODS : SURVIVAL_PLUGINS,
  ),
  ModCheckUpdates: read((id) =>
    first(id) ? MOD_UPDATES : SURVIVAL_PLUGIN_UPDATES,
  ),
  ModRescan: async () => undefined, // a no-op scan is honest: nothing changed
  // Only Modrinth is live here. CurseForge needs an API key the demo does not
  // have, so it reports none and the tile says so instead of searching.
  ModSearch: (id, query, offset, categories, sort) =>
    modrinth.search(
      query,
      offset,
      categories,
      sort,
      configFor(id).loader,
      configFor(id).mcVersion,
    ),
  ModGetProject: (projectID) => modrinth.getProject(projectID),
  ModGetVersions: (id, projectID) =>
    modrinth.getVersions(
      projectID,
      configFor(id).loader,
      configFor(id).mcVersion,
    ),
  ModGetAllVersions: (projectID) => modrinth.getAllVersions(projectID),
  ModCategories: (id, source) =>
    source === "curseforge"
      ? Promise.resolve([])
      : modrinth.categories(configFor(id).loader),
  ModCurseForgeStatus: read({ keySet: false, builtIn: false }),
  ModSetCurseForgeKey: refuse("Saving a CurseForge key"),
  ModClearCurseForgeKey: refuse("Removing a CurseForge key"),
  ModMoreByAuthor: (id, username, exclude) =>
    modrinth.moreByAuthor(username, exclude, configFor(id).loader),
  ModResolveDependencies: read([]),
  ModInstall: refuse("Installing a plugin"),
  ModInstallLocal: refuse("Adding a local file"),
  ModSetEnabled: refuse("Enabling a plugin"),
  ModUninstall: refuse("Removing a plugin"),
  ModSyncState: read((id) =>
    first(id) ? PACK_STATE : { source: null, history: [] },
  ),
  ModPlanSync: read((id) => {
    if (!first(id)) throw new Error("no pack is set for this server");
    return PACK_PLAN;
  }),
  ModSetPackSource: refuse("Choosing a pack"),
  ModClearPackSource: refuse("Unbinding a pack"),
  ModApplySync: refuse("Syncing a pack"),
  ModRollbackSync: refuse("Rolling back a sync"),

  // ── Commands ──────────────────────────────────────────────────────────
  // A seeded set with three buttons linked from Kommands (fixtures/commands.js).
  GetCommandButtons: read(COMMAND_BUTTONS),
  GetCustomCommands: read([]),
  // Succeeds, so editing the buttons sticks for the session in the store,
  // which is the same bargain the layout and scheduler writes make.
  SaveCommandButtons: mutate(() => undefined),
  RefreshKommands: read(KOMMANDS_STATUS),
  GetKommandsCommands: read(KOMMANDS_SAVED),

  // ── Layout and tiles ──────────────────────────────────────────────────
  // All of these succeed. Dragging, resizing and adding tiles is the headline
  // interaction; refusing it would make the board read as broken. Empty reads
  // are not laziness — useTileStore falls back to ALL_TILE_IDS and
  // useLayoutStore seeds DEFAULT_LAYOUT_PRESETS, so the demo inherits the
  // app's own shipped defaults and cannot drift from them. The one exception
  // is a `?tile=` link (frame.js), which answers both reads with that tile.
  GetActiveTiles: read(() => frame.activeTiles()),
  SaveActiveTiles: mutate(() => undefined),
  GetTileLayouts: read({}),
  SaveTileLayouts: mutate(() => undefined),
  GetActiveLayout: read(() => frame.activeLayout()),
  SaveActiveLayout: mutate(() => undefined),
  GetLayoutPresets: read([]),
  SaveLayoutPreset: mutate(() => undefined),
  DeleteLayoutPreset: mutate(() => undefined),

  // ── Settings, app, updates ────────────────────────────────────────────
  GetAppSettings: read(() => state.settings()),
  SaveAppSettings: mutate((s) => state.saveSettings(s)),
  GetAppVersion: read("demo"),
  GetDataDir: read("/home/mc/.config/konnekt"),
  GetLogPath: read("/home/mc/.config/konnekt/konnekt.log"),
  GetLogTail: read(""),
  // The visitor's machine is not the demo's host; a typical desktop stands in.
  GetPhysicalMemoryMB: read(16384),
  OpenDataDir: refuse("Opening the data folder"),
  // The real answer is the visitor's own installed fonts, which no page can read
  // in every browser (the reason the app asks Go). A few families most machines
  // ship stand in, so the picker has something to suggest; a name that is not
  // installed falls through to the default, same as in the app.
  ListFontFamilies: read([
    "Arial",
    "Courier New",
    "Georgia",
    "Tahoma",
    "Verdana",
  ]),
  // Remote Access shown running through a named tunnel on the user's own
  // domain. The demo has no listener, so every action refuses and says why.
  GetRemoteAccessState: read({
    passwordSet: true,
    running: true,
    addr: "127.0.0.1:8765",
    clients: 1,
    devices: [
      {
        id: "dev-phone",
        name: "Phone",
        approvedAt: daysAgo(20),
        lastSeen: minutesAgo(12),
        sessions: 1,
      },
      {
        id: "dev-laptop",
        name: "Work laptop",
        approvedAt: daysAgo(41),
        lastSeen: daysAgo(3),
        sessions: 0,
      },
    ],
    pendingDevices: [],
    approvals: [],
    tunnel: {
      status: "running",
      url: "https://konnekt.example.gg",
      error: "",
      percent: 0,
      version: "",
      named: { hostname: "konnekt.example.gg", port: 8765, tokenSet: true },
    },
    connectors: { enabled: false, url: "", grants: [] },
    localMcp: { enabled: false, running: false, addr: "", command: "", executable: "" },
  }),
  SetRemotePassword: refuse("Remote access"),
  StartRemoteAccess: refuse("Remote access"),
  StopRemoteAccess: refuse("Remote access"),
  StartRemoteTunnel: refuse("Remote access"),
  StopRemoteTunnel: refuse("Remote access"),
  SaveRemoteTunnel: refuse("Remote access"),
  ForgetRemoteTunnel: refuse("Remote access"),
  GetLocalMCPState: read({ enabled: false, running: false, addr: "", command: "", executable: "" }),
  SetLocalMCPEnabled: refuse("Remote access"),
  SetRemoteConnectorsEnabled: refuse("Remote access"),
  RevokeRemoteGrant: refuse("Remote access"),
  RevokeAllRemoteGrants: refuse("Remote access"),
  ApproveRemoteDevice: refuse("Remote access"),
  DenyRemoteDevice: refuse("Remote access"),
  RemoveRemoteDevice: refuse("Remote access"),
  RevokeRemoteSessions: refuse("Remote access"),
  AnswerRemoteApproval: refuse("Remote access"),
  // Bucket destinations hold a credential and test it against a live endpoint,
  // so the demo lists the DH graph's one and refuses every write.
  ListDestinations: read(DESTINATIONS),
  SaveDestination: refuse("Saving a bucket destination"),
  DeleteDestination: refuse("Deleting a bucket destination"),
  TestDestination: refuse("Testing a bucket destination"),
  GetSnapshotLink: refuse("Copying a snapshot link"),
  RotateSnapshotLink: refuse("Rotating a snapshot link"),
  SetSnapshotLinkPrivate: refuse("Changing a snapshot link"),
  LogClientError: async () => undefined,
  CheckForUpdates: read({
    currentVersion: "demo",
    latestVersion: "demo",
    updateAvailable: false,
    channel: "stable",
    releaseUrl: "",
    releaseNotes: "",
  }),
  DownloadAndInstallUpdate: refuse("Updating Konnekt"),
  GetReleaseNotes: read(RELEASE_NOTES),

  // ── Native dialogs ────────────────────────────────────────────────────
  // No browser analogue at all: these open an OS file picker.
  BrowseDirectory: refuse("Browsing for a folder"),
  BrowseJarFile: refuse("Browsing for a file"),
};
