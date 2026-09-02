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
  SERVER_CONFIG,
  SERVER_CONFIGS,
  STATS_HISTORY,
  PLAYERS,
  configFor,
  summaryFor,
} from "./fixtures/server.js";
import { WORLDS, BACKUP_WORLDS, CREATIVE_WORLDS } from "./fixtures/worlds.js";
import { BACKUPS } from "./fixtures/backups.js";
import { INSTALLED_MODS, MOD_UPDATES } from "./fixtures/mods.js";
import { CONFIG_FILES, readConfigFile } from "./fixtures/config.js";
import { GRAPHS, NEXT_RUNS } from "./fixtures/scheduler.js";
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

/** Only the first server has history, a roster, backups and plugins; the
 *  second is offline and empty, which is what makes a switch visible. */
const survival = (id) => id === SERVER_ID;

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
  GetStatsHistory: read((id) => (survival(id) ? STATS_HISTORY : [])),
  GetConsoleHistory: read([]), // console is fed by log:line; see events.js

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
  GetLoaderStatus: read((id) => ({
    loader: configFor(id).loader,
    installedVersion: configFor(id).loaderVersion,
    mcVersion: configFor(id).mcVersion,
    source: "",
    managed: false,
    reason: `Konnekt cannot update ${configFor(id).loader} servers yet.`,
  })),
  ListLoaderVersions: read([]),
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
  ListWorlds: read((id) => (survival(id) ? WORLDS : CREATIVE_WORLDS)),
  GetBackupWorlds: read((id) => (survival(id) ? BACKUP_WORLDS : [])),
  SetActiveWorld: refuse("Switching worlds"),
  RenameWorld: refuse("Renaming a world"),
  DuplicateWorld: refuse("Duplicating a world"),
  DeleteWorld: refuse("Deleting a world"),
  BackupWorld: refuse("Backing up a world"),
  OpenWorldFolder: refuse("Opening the world folder"),

  // ── Backups ───────────────────────────────────────────────────────────
  ListBackups: read((id) => (survival(id) ? BACKUPS : [])),
  CreateBackup: refuse("Creating a backup"),
  RestoreBackup: refuse("Restoring a backup"),
  DeleteBackup: refuse("Deleting a backup"),
  UpdateBackupMeta: refuse("Renaming a backup"),
  OpenBackupDir: refuse("Opening the backup folder"),

  // ── Config files ──────────────────────────────────────────────────────
  ListConfigFiles: read(CONFIG_FILES),
  ReadConfigFile: read(async (_id, relPath) => readConfigFile(relPath)),
  WriteConfigFile: refuse("Saving a config file"),

  // ── Scheduler ─────────────────────────────────────────────────────────
  // Graph edits stick: wiring nodes together is one of the things worth
  // showing, and a refusal would revert every drag. Running one does not —
  // that is acting on a real server.
  GetScheduleBlockDefs: read(BLOCK_DEFS),
  GetScheduleGraphs: read(() => state.graphs()),
  GetScheduleNextRuns: read(NEXT_RUNS),
  GetScheduleRunHistory: read([]),
  SaveScheduleGraph: mutate((g) => state.saveGraph(g)),
  DeleteScheduleGraph: mutate((id) => state.deleteGraph(id)),
  SetScheduleGraphEnabled: mutate((id, on) => state.setGraphEnabled(id, on)),
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
  ModListInstalled: read((id) => (survival(id) ? INSTALLED_MODS : [])),
  ModCheckUpdates: read((id) => (survival(id) ? MOD_UPDATES : [])),
  ModRescan: async () => undefined, // a no-op scan is honest: nothing changed
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
  ModCategories: (id) => modrinth.categories(configFor(id).loader),
  ModMoreByAuthor: (id, username, exclude) =>
    modrinth.moreByAuthor(username, exclude, configFor(id).loader),
  ModResolveDependencies: read([]),
  ModInstall: refuse("Installing a plugin"),
  ModInstallLocal: refuse("Adding a local file"),
  ModSetEnabled: refuse("Enabling a plugin"),
  ModUninstall: refuse("Removing a plugin"),

  // ── Commands ──────────────────────────────────────────────────────────
  // `seeded: false` with no items is what makes useCommandsStore synthesise
  // the app's own default button grid. A rejection here would leave the tile
  // empty instead, so this is a fixture that deliberately returns nothing.
  GetCommandButtons: read({ seeded: false, items: [] }),
  GetCustomCommands: read([]),
  // Succeeds, and it has to: seeding is a *write*. The store synthesises the
  // default grid and immediately saves it back, so refusing here fired the
  // demo notice the instant the page loaded, before anyone had clicked
  // anything. Editing the buttons then sticks for the session, which is the
  // same bargain the layout and scheduler writes make.
  SaveCommandButtons: mutate(() => undefined),
  RefreshKommands: read({
    installed: false,
    path: "",
    unsupported: false,
    version: 0,
    error: "",
  }),
  GetKommandsCommands: read([]),

  // ── Layout and tiles ──────────────────────────────────────────────────
  // All of these succeed. Dragging, resizing and adding tiles is the headline
  // interaction; refusing it would make the board read as broken. Empty reads
  // are not laziness — useTileStore falls back to ALL_TILE_IDS and
  // useLayoutStore seeds DEFAULT_LAYOUT_PRESETS, so the demo inherits the
  // app's own shipped defaults and cannot drift from them. The one exception
  // is a `?tile=` link (frame.js), which answers both reads with that tile.
  GetActiveTiles: read(() => frame.activeTiles()),
  SaveActiveTiles: mutate(() => undefined),
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
  OpenDataDir: refuse("Opening the data folder"),
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

  // ── Native dialogs ────────────────────────────────────────────────────
  // No browser analogue at all: these open an OS file picker.
  BrowseDirectory: refuse("Browsing for a folder"),
  BrowseJarFile: refuse("Browsing for a file"),
};
