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
