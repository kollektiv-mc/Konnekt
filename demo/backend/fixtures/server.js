/* The one server the demo is about, and the readings it reports.
 *
 * Everything here is anchored to page load rather than to fixed dates, so the
 * dashboard never looks abandoned: a visitor in a year still sees a backup
 * from "1h ago" and a world played this morning.
 */

export const SERVER_ID = "demo-survival";

const now = Date.now();
export const BOOT = now;
export const minutesAgo = (m) => now - m * 60_000;
export const hoursAgo = (h) => now - h * 3_600_000;
export const daysAgo = (d) => now - d * 86_400_000;

/* Paper on 1.21.1 — chosen so the mods tile says "plugins" (the noun comes
   from config.loader ∈ PLUGIN_LOADERS) and the Modrinth facets below ask for
   plugins, which is the busier and better-illustrated half of Modrinth. */
export const SERVER_CONFIG = {
  id: SERVER_ID,
  name: "Survival",
  jarPath: "/home/mc/survival/paper-1.21.1.jar",
  jvmArgs: ["-Xms2G", "-Xmx6G"],
  workingDir: "/home/mc/survival",
  mcVersion: "1.21.1",
  loader: "paper",
  loaderVersion: "",
};

/* A second server, so that switching is something the demo can show. Fabric,
   so the plugins tile's noun changes with it, and offline, so the switch reads
   as a change of server rather than a re-skin: an offline dashboard is a
   visibly different picture, and an honest one, since nothing but the Start
   button brings it up. */
export const CREATIVE_ID = "demo-creative";

export const CREATIVE_CONFIG = {
  id: CREATIVE_ID,
  name: "Creative",
  jarPath: "/home/mc/creative/fabric-server-mc.1.21.1-loader.0.16.5.jar",
  jvmArgs: ["-Xms1G", "-Xmx4G"],
  workingDir: "/home/mc/creative",
  mcVersion: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.5",
};

export const SERVER_CONFIGS = [SERVER_CONFIG, CREATIVE_CONFIG];

/** The config behind an id the app passed, falling back to the first server. */
export const configFor = (id) =>
  SERVER_CONFIGS.find((c) => c.id === id) ?? SERVER_CONFIG;

/* Running, deliberately. An offline dashboard is a dashboard of empty states —
   the console reads "Server offline — start it to see output" with a dead
   input, players shows nothing, performance says "start the server to begin
   recording". This is the state the demo is in when you arrive; state.js owns
   it from there, and the Stop and Start buttons move it. */
export const SERVER_STATUS = {
  running: true,
  state: "running",
  uptime: "3h 12m 0s",
  players: 4,
  maxPlayers: 20,
  tps: 19.8,
  ramUsed: 4312,
  ramTotal: 6144,
};

/* What "3h 12m" means as an instant, so the readout keeps counting from it
   rather than sitting on a string. */
export const STARTED_AT = now - (3 * 60 + 12) * 60_000;

export const CREATIVE_STATUS = {
  running: false,
  state: "offline",
  uptime: "0s",
  players: 0,
  maxPlayers: 20,
  tps: 0,
  ramUsed: 0,
  ramTotal: 4096,
};

export const SERVER_SUMMARY = {
  mcVersion: "1.21.1",
  loader: "paper",
  workingDir: "/home/mc/survival",
  launchFile: "paper-1.21.1.jar",
  running: true,
  loaderVersion: "",
  loaderSource: "",
};

export const CREATIVE_SUMMARY = {
  mcVersion: "1.21.1",
  loader: "fabric",
  workingDir: "/home/mc/creative",
  launchFile: "fabric-server-mc.1.21.1-loader.0.16.5.jar",
  running: false,
  loaderVersion: "0.16.5",
  loaderSource: "",
};

export const summaryFor = (id) =>
  id === CREATIVE_ID ? CREATIVE_SUMMARY : SERVER_SUMMARY;

/* Both performance charts need at least two points, and the maximized view
   offers a 1h window, so this covers an hour at 30s spacing. Generated rather
   than listed: 120 hand-written samples would be unreadable and would still
   look hand-written. The shapes are deliberate — a sagging TPS dip around the
   middle and a CPU hump to match, so the chart has something to show. */
export const STATS_HISTORY = Array.from({ length: 120 }, (_, i) => {
  const t = i / 119;
  const dip = Math.exp(-(((t - 0.55) / 0.12) ** 2)); // one slowdown, mid-window
  const wobble = Math.sin(t * 22) * 0.12 + Math.sin(t * 7) * 0.08;
  return {
    timestamp: now - (119 - i) * 30_000,
    tps: Math.round((20 - dip * 6.4 + wobble) * 10) / 10,
    ramUsedMB: Math.round(3600 + dip * 900 + Math.sin(t * 9) * 180),
    ramTotalMB: 6144,
    cpuPercent: Math.round((28 + dip * 44 + Math.sin(t * 13) * 6) * 10) / 10,
    players: i < 40 ? 2 : i < 78 ? 5 : 4,
  };
});

export const PLAYERS = [
  {
    name: "Frangfurd",
    uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    online: true,
    ip: "192.168.1.24",
    lastOnline: minutesAgo(1),
    opLevel: 4,
    whitelisted: true,
    banned: false,
    banReason: "",
    primaryGroup: "owner",
    groups: ["owner", "staff"],
  },
  {
    name: "Direwolf20",
    uuid: "853c80ef-3c37-49fd-aa49-938b674adae6",
    online: true,
    ip: "192.168.1.31",
    lastOnline: minutesAgo(1),
    opLevel: 0,
    whitelisted: true,
    banned: false,
    banReason: "",
    primaryGroup: "builder",
    groups: ["builder"],
  },
  {
    name: "Aletheia",
    uuid: "61699b2e-d327-4a01-9f1e-0ea8c3f06bc6",
    online: true,
    ip: "192.168.1.47",
    lastOnline: minutesAgo(1),
    opLevel: 0,
    whitelisted: true,
    banned: false,
    banReason: "",
    primaryGroup: "member",
    groups: ["member"],
  },
  {
    name: "Korbin",
    uuid: "4566e69f-c907-48ee-8d71-d7ba5aa00d20",
    online: true,
    ip: "192.168.1.52",
    lastOnline: minutesAgo(1),
    opLevel: 0,
    whitelisted: true,
    banned: false,
    banReason: "",
    primaryGroup: "member",
    groups: ["member"],
  },
  {
    name: "Sable",
    uuid: "d8d5a923-7b20-43d8-883b-1150148d6955",
    online: false,
    ip: "192.168.1.18",
    lastOnline: hoursAgo(19),
    opLevel: 0,
    whitelisted: true,
    banned: false,
    banReason: "",
    primaryGroup: "member",
    groups: ["member"],
  },
  {
    name: "Grieferman",
    uuid: "f84c6a79-0a4e-45e0-879b-cd49ebd4c4e2",
    online: false,
    ip: "10.0.0.91",
    lastOnline: daysAgo(6),
    opLevel: 0,
    whitelisted: false,
    banned: true,
    banReason: "Griefing spawn",
    primaryGroup: "member",
    groups: [],
  },
];

/* What a server prints between the jar starting and its ready line. Replayed
   at boot as the top of the scrollback, and again, live, whenever the Start
   button is pressed (state.js). The handful of lines that differ between the
   two servers come from BOOT_PROFILE; the rest is the same for both, as it is
   for any two servers of the same version. */
const BOOT_PROFILE = {
  [SERVER_ID]: {
    gameType: "SURVIVAL",
    level: "Overworld",
    port: 25565,
    loaderLine: "Paper: Using Java 21 (Eclipse Adoptium 21.0.4+7)",
  },
  [CREATIVE_ID]: {
    gameType: "CREATIVE",
    level: "Creative",
    port: 25566,
    loaderLine: "Loading Minecraft 1.21.1 with Fabric Loader 0.16.5",
  },
};

export const bootLines = (id) => {
  const { gameType, level, port, loaderLine } =
    BOOT_PROFILE[id] ?? BOOT_PROFILE[SERVER_ID];
  return [
    `Starting minecraft server version ${configFor(id).mcVersion}`,
    "Loading properties",
    `Default game type: ${gameType}`,
    "Generating keypair",
    `Starting Minecraft server on *:${port}`,
    "Using epoll channel type",
    loaderLine,
    `Preparing level "${level}"`,
    "Preparing start region for dimension minecraft:overworld",
    "Preparing spawn area: 4%",
    "Preparing spawn area: 41%",
    "Preparing spawn area: 88%",
    "Time elapsed: 3841 ms",
    "Preparing start region for dimension minecraft:the_nether",
    "Time elapsed: 902 ms",
    "Preparing start region for dimension minecraft:the_end",
    "Time elapsed: 611 ms",
    "[Sodium] Loaded configuration file",
    "[Lithium] Applying 47 mixin patches",
    "[FerriteCore] Reduced memory footprint by 312 MB",
    'Done (6.129s)! For help, type "help"',
  ];
};

/* What a graceful stop prints, in the order Paper prints it. */
export const STOP_LINES = [
  "Stopping the server",
  "Stopping server",
  "Saving players",
  "Saving worlds",
  'Saving chunks for level "Overworld"/minecraft:overworld',
  'Saving chunks for level "Overworld"/minecraft:the_nether',
  'Saving chunks for level "Overworld"/minecraft:the_end',
  "ThreadedAnvilChunkStorage: All dimensions are saved",
];

/* The console's scrollback. There is no fetch path into the console —
   GetConsoleHistory is bound in Go but imported nowhere in src/ — so this is
   replayed as log:line events once at boot, and after that only the Start and
   Stop buttons add to it. `source: 'manager'` lines are Konnekt's own
   narration, which the tile draws as a boxed block rather than a plain line. */
export const CONSOLE_LINES = [
  ["manager", "Starting Survival", "ok"],
  ...bootLines(SERVER_ID).map((line) => [null, line]),
  [null, "Timings Reset"],
  [
    null,
    "Frangfurd[/192.168.1.24:53114] logged in with entity id 214 at (128.5, 71.0, -244.5)",
  ],
  [null, "Frangfurd joined the game"],
  [
    null,
    "Direwolf20[/192.168.1.31:49022] logged in with entity id 289 at (96.5, 64.0, -201.5)",
  ],
  [null, "Direwolf20 joined the game"],
  [null, "<Frangfurd> anyone got spare diamonds"],
  [null, "<Direwolf20> check the shulker in the vault"],
  [
    null,
    "Aletheia[/192.168.1.47:51880] logged in with entity id 401 at (12.5, 78.0, 340.5)",
  ],
  [null, "Aletheia joined the game"],
  ["manager", "Scheduled backup started", "progress"],
  [null, "Automatic saving is now disabled"],
  [null, "Saving the game (this may take a moment!)"],
  [null, "Saved the game"],
  ["manager", "Backup complete — 101.24 GB", "ok"],
  [null, "Automatic saving is now enabled"],
  [
    null,
    "Korbin[/192.168.1.52:60411] logged in with entity id 508 at (204.5, 69.0, 88.5)",
  ],
  [null, "Korbin joined the game"],
  [null, "<Aletheia> the nether portal at spawn is broken again"],
  [
    null,
    "Can't keep up! Is the server overloaded? Running 2841ms or 56 ticks behind",
  ],
  [null, "<Direwolf20> ill fix it"],
];
