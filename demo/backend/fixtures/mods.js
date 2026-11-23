/* What the two servers have installed, so the tile is never an empty shelf.
 *
 * These are real Modrinth projects with their real ids, versions and icon
 * URLs, because the tile renders `iconUrl` straight into an <img>. The icon
 * URL is the project's `icon_url` from the Modrinth API, copied as is: the
 * real backend stores that field too (modservice.go), and a path guessed from
 * the project id (`data/<id>/icon.png`) exists for some projects only, which
 * is how ViaVersion showed a broken image. Browsing is live against Modrinth
 * (see ../modrinth.js); only the installed lists are fixed, since installing
 * is the one thing the demo cannot do.
 *
 * `installedAt` descending because useMods sorts on it with 0 sinking to the
 * bottom, and one entry per server is disabled so the tile shows that state
 * too: the backend derives `enabled` from the `.jar` vs `.jar.disabled`
 * suffix, so the filename has to agree with the flag.
 */

import { daysAgo, hoursAgo } from "./server.js";

const KB = 1024;
const CDN = "https://cdn.modrinth.com/data";

const installed = (loader, targetFolder) => (o) => ({
  displayName: o.displayName,
  fileName: o.fileName,
  iconUrl: `${CDN}/${o.projectId}/${o.icon}`,
  modId: o.modId,
  source: "modrinth",
  provider: "modrinth",
  projectId: o.projectId,
  versionId: o.versionId,
  versionNumber: o.versionNumber,
  loader,
  targetFolder,
  enabled: o.enabled ?? true,
  sizeBytes: o.sizeKB * KB,
  installedAt: o.installedAt,
});

const mod = installed("neoforge", "mods");
const plugin = installed("paper", "plugins");

/* The NeoForge server: Distant Horizons first, a content pack around Create,
   and the usual performance mods. */
export const INSTALLED_MODS = [
  mod({
    displayName: "Distant Horizons",
    fileName: "DistantHorizons-3.3.3-1.21.1-fabric-neoforge.jar",
    modId: "distanthorizons",
    projectId: "uCdwusMi",
    icon: "e716cda9bb568b5373ff76e363fb4c6d7278fba6_96.webp",
    versionId: "9w34y8ai",
    versionNumber: "3.3.3-1.21.1",
    sizeKB: 27626,
    installedAt: hoursAgo(6),
  }),
  mod({
    displayName: "Waystones",
    fileName: "waystones-neoforge-1.21.1-21.1.46.jar",
    modId: "waystones",
    projectId: "LOpKHB2A",
    icon: "d56c030a875582aff5bab477ddcfec317a1610f0_96.webp",
    versionId: "6Z6MQ6os",
    versionNumber: "21.1.46+neoforge-1.21.1",
    sizeKB: 1194,
    installedAt: daysAgo(1),
  }),
  mod({
    displayName: "Balm",
    fileName: "balm-neoforge-1.21.1-21.0.67.jar",
    modId: "balm",
    projectId: "MBAkmtvl",
    icon: "285b7bcfd6e525c043e640b08f3efc0cde90f7dd_96.webp",
    versionId: "gMedgtzL",
    versionNumber: "21.0.67+neoforge-1.21.1",
    sizeKB: 767,
    installedAt: daysAgo(1),
  }),
  mod({
    displayName: "Create",
    fileName: "create-1.21.1-6.0.10.jar",
    modId: "create",
    projectId: "LNytGWDc",
    icon: "61d716699bcf1ec42ed4926a9e1c7311be6087e2_96.webp",
    versionId: "UjX6dr61",
    versionNumber: "6.0.10+mc1.21.1",
    sizeKB: 18675,
    installedAt: daysAgo(2),
  }),
  mod({
    displayName: "Farmer's Delight",
    fileName: "FarmersDelight-1.21.1-1.3.4.jar",
    modId: "farmersdelight",
    projectId: "R2OftAxM",
    icon: "8e7aa38ab94d94bb0a2894a218b69beb49002b34.png",
    versionId: "XTVZDOol",
    versionNumber: "1.21.1-1.3.4",
    sizeKB: 3086,
    installedAt: daysAgo(2),
  }),
  mod({
    displayName: "Just Enough Items (JEI)",
    fileName: "jei-1.21.1-neoforge-19.71.0.475.jar",
    modId: "jei",
    projectId: "u6dRKJwZ",
    icon: "4a3f18ac0d096c9f8e9176984c44be4e58f94c89_96.webp",
    versionId: "oXFV6wK5",
    versionNumber: "19.71.0.475",
    sizeKB: 6924,
    installedAt: daysAgo(3),
  }),
  mod({
    displayName: "AppleSkin",
    fileName: "appleskin-neoforge-mc1.21-3.0.9.jar",
    modId: "appleskin",
    projectId: "EsAfCjCV",
    icon: "icon.png",
    versionId: "uAKA6Laj",
    versionNumber: "3.0.9+mc1.21",
    sizeKB: 74,
    installedAt: daysAgo(5),
  }),
  mod({
    displayName: "spark",
    fileName: "spark-1.10.124-neoforge.jar",
    modId: "spark",
    projectId: "l6YH9Als",
    icon: "61a777dd08a8447ac93e8b6372e6d27d48cd1e1a_96.webp",
    versionId: "v5qtqRQi",
    versionNumber: "1.10.124-neoforge",
    sizeKB: 3557,
    installedAt: daysAgo(9),
  }),
  mod({
    displayName: "ModernFix",
    fileName: "modernfix-neoforge-5.27.27+mc1.21.1.jar",
    modId: "modernfix",
    projectId: "nmDcB62a",
    icon: "2af94de5e08ae54567ee86b968fc7ce076d9fee5_96.webp",
    versionId: "ZDZENbHH",
    versionNumber: "5.27.27+mc1.21.1",
    sizeKB: 599,
    installedAt: daysAgo(9),
  }),
  mod({
    displayName: "FerriteCore",
    fileName: "ferritecore-7.0.3-neoforge.jar",
    modId: "ferritecore",
    projectId: "uXXizFIs",
    icon: "222a126f26f8f9ae1eb339f3b767677f18bff31f_96.webp",
    versionId: "x7kQWVju",
    versionNumber: "7.0.3-neoforge",
    sizeKB: 118,
    installedAt: daysAgo(9),
  }),
  mod({
    displayName: "Lithium",
    fileName: "lithium-neoforge-0.15.4+mc1.21.1.jar",
    modId: "lithium",
    projectId: "gvQqBUqZ",
    icon: "bcc8686c13af0143adf4285d741256af824f70b7_96.webp",
    versionId: "DDUrRVCA",
    versionNumber: "mc1.21.1-0.15.4-neoforge",
    sizeKB: 756,
    installedAt: daysAgo(9),
  }),
  mod({
    displayName: "LuckPerms",
    fileName: "LuckPerms-NeoForge-5.4.140.jar",
    modId: "luckperms",
    projectId: "Vebnzrzj",
    icon: "90943902cc650e95b167265b8f2d7c893f82c8f4_96.webp",
    versionId: "rnvg05YO",
    versionNumber: "v5.4.140-neoforge",
    sizeKB: 1401,
    installedAt: daysAgo(12),
  }),
  mod({
    displayName: "BlueMap",
    fileName: "bluemap-5.7-neoforge.jar.disabled",
    modId: "bluemap",
    projectId: "swbUV1cr",
    icon: "b9a17ab8c850046101a47e62037225c9b007a2ca_96.webp",
    versionId: "8iJcPOHJ",
    versionNumber: "5.7-neoforge",
    sizeKB: 5287,
    enabled: false,
    installedAt: daysAgo(14),
  }),
];

/* One update available, so the "update" affordance in the installed list has
   something to point at. Indexed by fileName on the frontend, which is why
   ModUpdateInfo carries it rather than being keyed in a map — Wails does not
   descend into map values. */
export const MOD_UPDATES = [
  {
    fileName: "waystones-neoforge-1.21.1-21.1.46.jar",
    updateAvailable: true,
    latestVersionId: "sE6fMBGR",
    latestVersionNumber: "21.1.47+neoforge-1.21.1",
  },
];

/* The Paper server's plugins, shown when the visitor switches to it. */
export const SURVIVAL_PLUGINS = [
  plugin({
    displayName: "ViaVersion",
    fileName: "ViaVersion-5.1.1.jar",
    modId: "viaversion",
    projectId: "P1OZGk5p",
    icon: "ad14260a7308dc9e4c3385f3f6b5bdabfe17f295_96.webp",
    versionId: "kMFbtWQd",
    versionNumber: "5.1.1",
    sizeKB: 4820,
    installedAt: hoursAgo(6),
  }),
  plugin({
    displayName: "Chunky",
    fileName: "Chunky-1.4.36.jar",
    modId: "chunky",
    projectId: "fALzjamp",
    icon: "e1954413665e57b7bae1feef44eda530270c7d47_96.webp",
    versionId: "sTzhJVaB",
    versionNumber: "1.4.36",
    sizeKB: 312,
    installedAt: daysAgo(2),
  }),
  plugin({
    displayName: "LuckPerms",
    fileName: "LuckPerms-Bukkit-5.4.145.jar",
    modId: "luckperms",
    projectId: "Vebnzrzj",
    icon: "90943902cc650e95b167265b8f2d7c893f82c8f4_96.webp",
    versionId: "Hb3Ck1QC",
    versionNumber: "5.4.145",
    sizeKB: 3140,
    installedAt: daysAgo(5),
  }),
  plugin({
    displayName: "Spark",
    fileName: "spark-1.10.119-bukkit.jar",
    modId: "spark",
    projectId: "l6YH9Als",
    icon: "61a777dd08a8447ac93e8b6372e6d27d48cd1e1a_96.webp",
    versionId: "FbfF6Rsw",
    versionNumber: "1.10.119",
    sizeKB: 2280,
    installedAt: daysAgo(9),
  }),
  plugin({
    displayName: "BlueMap",
    fileName: "BlueMap-5.4-paper.jar.disabled",
    modId: "bluemap",
    projectId: "swbUV1cr",
    icon: "b9a17ab8c850046101a47e62037225c9b007a2ca_96.webp",
    versionId: "kZKqBpRp",
    versionNumber: "5.4",
    sizeKB: 18400,
    enabled: false,
    installedAt: daysAgo(14),
  }),
];

export const SURVIVAL_PLUGIN_UPDATES = [
  {
    fileName: "Chunky-1.4.36.jar",
    updateAvailable: true,
    latestVersionId: "nHVsRYHZ",
    latestVersionNumber: "1.4.40",
  },
];

/* The NeoForge server follows a packwiz pack, so the mods tile's Pack view has
   a source, a past sync and a plan to show. Checking returns the plan; applying
   and changing the source are refused like every other mod write. */
export const PACK_STATE = {
  source: {
    serverID: "demo-creative",
    format: "packwiz",
    location: "url",
    address: "https://packs.example.net/creative/pack.toml",
    exclude: [],
    include: [],
  },
  history: [
    {
      id: "sync-1",
      appliedAt: daysAgo(6),
      packName: "Creative",
      packVersion: "1.2.0",
      fingerprint: "",
      added: 4,
      updated: 0,
      removed: 0,
      disabled: 0,
      rolledBack: false,
    },
  ],
};

const row = (action, fileName, name, side, reason, extra = {}) => ({
  action,
  fileName,
  name,
  key: name.toLowerCase().replaceAll(" ", "-"),
  side,
  reason,
  ...extra,
});

export const PACK_PLAN = {
  serverID: "demo-creative",
  planId: "demo-plan",
  packName: "Creative",
  packVersion: "1.3.0",
  minecraft: "1.21.1",
  loader: "neoforge",
  loaderVersion: "21.1.267",
  fingerprint: "",
  rows: [
    row(
      "update",
      "waystones-neoforge-1.21.1-21.1.47.jar",
      "Waystones",
      "both",
      "newer in the pack",
      { from: "waystones-neoforge-1.21.1-21.1.46.jar" },
    ),
    row(
      "add",
      "supplementaries-1.21.1-4.1.4-neoforge.jar",
      "Supplementaries",
      "both",
      "new in the pack",
    ),
    row("add", "moonlight-1.21.1-3.8.3-neoforge.jar", "Moonlight Lib", "both", "new in the pack"),
    row("skip", "sodium-neoforge-0.8.13+mc1.21.1.jar", "Sodium", "client", "client side"),
    row("keep", "create-1.21.1-6.0.10.jar", "Create", "both", "already installed"),
    row(
      "keep",
      "DistantHorizons-3.3.3-1.21.1-fabric-neoforge.jar",
      "Distant Horizons",
      "both",
      "already installed",
    ),
  ],
  blockers: [],
  warnings: [],
  added: 2,
  updated: 1,
  removed: 0,
  disabled: 0,
  kept: 2,
  adopted: 0,
  skipped: 1,
  upToDate: false,
  last: PACK_STATE.history[0],
};
