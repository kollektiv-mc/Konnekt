/* Five plugins "installed", so the tile is never an empty shelf.
 *
 * These are real Modrinth projects with their real ids, because the tile
 * renders `iconUrl` straight into an <img> pointing at cdn.modrinth.com — a
 * made-up id gives five broken images. Browsing is live against Modrinth (see
 * ../modrinth.js); only the installed list is fixed, since installing is the
 * one thing the demo cannot do.
 *
 * `installedAt` descending because useMods sorts on it with 0 sinking to the
 * bottom, and one entry is disabled so the tile shows that state too — the
 * backend derives `enabled` from the `.jar` vs `.jar.disabled` suffix, so the
 * filename has to agree with the flag.
 */

import { daysAgo, hoursAgo } from "./server.js";

const KB = 1024;

const plugin = (o) => ({
  displayName: o.displayName,
  fileName: o.fileName,
  iconUrl: `https://cdn.modrinth.com/data/${o.projectId}/icon.png`,
  modId: o.modId,
  source: "modrinth",
  provider: "modrinth",
  projectId: o.projectId,
  versionId: o.versionId,
  versionNumber: o.versionNumber,
  loader: "paper",
  targetFolder: "plugins",
  enabled: o.enabled ?? true,
  sizeBytes: o.sizeKB * KB,
  installedAt: o.installedAt,
});

export const INSTALLED_MODS = [
  plugin({
    displayName: "ViaVersion",
    fileName: "ViaVersion-5.1.1.jar",
    modId: "viaversion",
    projectId: "P1OZGk5p",
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
    versionId: "kZKqBpRp",
    versionNumber: "5.4",
    sizeKB: 18400,
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
    fileName: "Chunky-1.4.36.jar",
    updateAvailable: true,
    latestVersionId: "nHVsRYHZ",
    latestVersionNumber: "1.4.40",
  },
];

/* The creative server follows a packwiz pack, so the mods tile's Pack view has
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
  loader: "fabric",
  loaderVersion: "0.16.5",
  fingerprint: "",
  rows: [
    row("update", "sodium-fabric-0.6.5.jar", "Sodium", "both", "newer in the pack", {
      from: "sodium-fabric-0.6.3.jar",
    }),
    row("add", "worldedit-mod-7.3.8.jar", "WorldEdit", "both", "new in the pack"),
    row("skip", "iris-fabric-1.8.1.jar", "Iris", "client", "client side"),
    row("keep", "fabric-api-0.116.1.jar", "Fabric API", "both", "already installed"),
    row("keep", "lithium-fabric-0.15.0.jar", "Lithium", "both", "already installed"),
  ],
  blockers: [],
  warnings: [],
  added: 1,
  updated: 1,
  removed: 0,
  disabled: 0,
  kept: 2,
  adopted: 0,
  skipped: 1,
  upToDate: false,
  last: PACK_STATE.history[0],
};
