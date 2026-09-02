/* Three worlds, each with all three dimensions.
 *
 * A dimension is a nested entry on the world with a `kind` discriminator, not
 * a world of its own: backend/services/worlds.go collapses Paper's sibling
 * folders (world, world_nether, world_the_end) and vanilla's DIM-1/DIM1
 * subfolders into this one shape. The literals are "overworld" | "nether" |
 * "the_end" — underscore, not "end".
 *
 * The 3D visualizer needs none of the things a real world has. It never reads
 * terrain, NBT, a seed or a heightmap: scene/Galaxy.tsx sizes each planet from
 * `totalSize` alone and takes orbit radius and speed from the array index,
 * while scene/Planet.tsx turns every non-overworld dimension into a moon by
 * looking `kind` up in KIND_COLOR and MOON_ORBIT. So three fully-specified
 * worlds light the entire scene.
 *
 * Giving all three worlds their nether and end is also what exercises the
 * intermediate planetary view: WorldsScene.selectWorld branches on
 * `dimensions.some(d => d.kind !== 'overworld')` and skips straight past it
 * for a world that has only an overworld.
 */

import { daysAgo, hoursAgo, minutesAgo } from "./server.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function dimensions(base, sizes, modified) {
  return [
    { kind: "overworld", path: base, size: sizes[0], modified },
    { kind: "nether", path: `${base}_nether`, size: sizes[1], modified },
    { kind: "the_end", path: `${base}_the_end`, size: sizes[2], modified },
  ];
}

export const WORLDS = [
  {
    name: "Overworld",
    active: true,
    totalSize: Math.round(4.21 * GB),
    modified: minutesAgo(2),
    dimensions: dimensions(
      "/home/mc/survival/Overworld",
      [Math.round(3.02 * GB), Math.round(880 * MB), Math.round(340 * MB)],
      minutesAgo(2),
    ),
    meta: {
      found: true,
      levelName: "Overworld",
      version: "1.21.1",
      gameMode: "survival",
      difficulty: "normal",
      hardcore: false,
      lastPlayed: minutesAgo(2),
      seed: "-4172144997902289642",
      spawnX: 128,
      spawnY: 71,
      spawnZ: -244,
    },
  },
  {
    name: "Middleworld",
    active: false,
    totalSize: Math.round(1.84 * GB),
    modified: daysAgo(4),
    dimensions: dimensions(
      "/home/mc/survival/Middleworld",
      [Math.round(1.41 * GB), Math.round(310 * MB), Math.round(122 * MB)],
      daysAgo(4),
    ),
    meta: {
      found: true,
      levelName: "Middleworld",
      version: "1.21.1",
      gameMode: "creative",
      difficulty: "peaceful",
      hardcore: false,
      lastPlayed: daysAgo(4),
      seed: "8391027465518823110",
      spawnX: 0,
      spawnY: 96,
      spawnZ: 0,
    },
  },
  {
    name: "Underworld",
    active: false,
    totalSize: Math.round(822 * MB),
    modified: daysAgo(23),
    dimensions: dimensions(
      "/home/mc/survival/Underworld",
      [Math.round(602 * MB), Math.round(158 * MB), Math.round(62 * MB)],
      daysAgo(23),
    ),
    meta: {
      found: true,
      levelName: "Underworld",
      version: "1.20.6",
      gameMode: "survival",
      difficulty: "hard",
      hardcore: true,
      lastPlayed: daysAgo(23),
      seed: "-77120043318806441",
      spawnX: -1904,
      spawnY: 63,
      spawnZ: 2210,
    },
  },
];

/* What a backup's zip is reported to contain. The server-zip path in
   backup.go fills Kind and Path but leaves Size and Modified at zero, summing
   the bytes onto the parent's TotalSize instead — and DimRow guards on
   `size > 0`, so zeroes here are the realistic shape rather than missing data.
   Mirroring that keeps the backup inspector honest about what it can know. */
export const BACKUP_WORLDS = WORLDS.map((w) => ({
  ...w,
  modified: hoursAgo(1),
  dimensions: w.dimensions.map((d) => ({ ...d, size: 0, modified: 0 })),
  meta: { ...w.meta, lastPlayed: hoursAgo(1) },
}));
