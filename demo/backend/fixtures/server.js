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

/* Running, deliberately. An offline dashboard is a dashboard of empty states —
   the console reads "Server offline — start it to see output" with a dead
   input, players shows nothing, performance says "start the server to begin
   recording". Nothing simulates a *start*: StartServer still refuses. This is
   simply the state the demo is in when you arrive. */
export const SERVER_STATUS = {
  running: true,
  state: "running",
  uptime: "3h 12m",
  players: 4,
  maxPlayers: 20,
  tps: 19.8,
  ramUsed: 4312,
  ramTotal: 6144,
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

/* The console's scrollback. There is no fetch path into the console —
   GetConsoleHistory is bound in Go but imported nowhere in src/ — so this is
   replayed as log:line events once at boot and then nothing more is emitted.
   Static, as the console tile is meant to be here: no simulated server.
   `source: 'manager'` lines are Konnekt's own narration, which the tile draws
   as a boxed block rather than a plain line. */
export const CONSOLE_LINES = [
  ["manager", "Starting Survival", "ok"],
  [null, "Starting minecraft server version 1.21.1"],
  [null, "Loading properties"],
  [null, "Default game type: SURVIVAL"],
  [null, "Generating keypair"],
  [null, "Starting Minecraft server on *:25565"],
  [null, "Using epoll channel type"],
  [null, "Paper: Using Java 21 (Eclipse Adoptium 21.0.4+7)"],
  [null, 'Preparing level "Overworld"'],
  [null, "Preparing start region for dimension minecraft:overworld"],
  [null, "Preparing spawn area: 4%"],
  [null, "Preparing spawn area: 41%"],
  [null, "Preparing spawn area: 88%"],
  [null, "Time elapsed: 3841 ms"],
  [null, "Preparing start region for dimension minecraft:the_nether"],
  [null, "Time elapsed: 902 ms"],
  [null, "Preparing start region for dimension minecraft:the_end"],
  [null, "Time elapsed: 611 ms"],
  [null, "[Sodium] Loaded configuration file"],
  [null, "[Lithium] Applying 47 mixin patches"],
  [null, "[FerriteCore] Reduced memory footprint by 312 MB"],
  [null, 'Done (6.129s)! For help, type "help"'],
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
