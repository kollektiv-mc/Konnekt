/* Five backups to scroll through.
 *
 * Three details the tile depends on, each learned from the code rather than
 * guessed:
 *
 *  - Newest first. ListBackups sorts descending on createdAt and
 *    overview/BackupsSection just takes [0], so ordering here is load-bearing.
 *  - `tags` is always an array, never absent. The backend coerces nil to []
 *    in scanBackupsInDir, and BackupCard/BackupRow call .map and .includes on
 *    it unguarded — one missing field would throw inside the carousel.
 *  - The filename keeps the {5-digit}_{DD}_{MM}_{YY}_{HHMMSS}.zip shape.
 *    format.ts's extractID regexes ^(\d{5})_ for the card's fallback label; a
 *    filename that misses it shows the whole string across the card face.
 *
 * The maximized tile filters to kind === 'server', so the two world-kind
 * entries only surface in the Overview section — which is the point of having
 * them: that path renders a KindTag and would otherwise never be exercised.
 */

import { daysAgo, hoursAgo } from "./server.js";

const GB = 1024 ** 3;

/** Formats a timestamp the way reserveBackupFile does: DD_MM_YY_HHMMSS. */
function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return [
    p(d.getDate()),
    p(d.getMonth() + 1),
    p(d.getFullYear() % 100),
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
  ].join("_");
}

const entry = (id, ms, sizeGB, extra = {}) => ({
  filename: `${id}_${stamp(ms)}.zip`,
  createdAt: ms,
  sizeBytes: Math.round(sizeGB * GB),
  displayName: "",
  tags: [],
  kind: "server",
  ...extra,
});

export const BACKUPS = [
  entry(48213, hoursAgo(1), 101.24, { tags: ["auto", "nightly"] }),
  entry(47908, hoursAgo(13), 100.87, { tags: ["auto", "nightly"] }),
  entry(47651, daysAgo(1), 98.42, {
    displayName: "Before 1.21.1 update",
    tags: ["manual", "keep"],
  }),
  entry(47144, daysAgo(3), 96.05, { tags: ["auto", "nightly"] }),
  entry(46802, daysAgo(6), 94.7, {
    displayName: "Pre-plugin-sweep",
    tags: ["manual"],
  }),
  // World-kind entries: invisible in the maximized tile by design, visible in
  // the Overview section, which is the only place KindTag renders `world`.
  {
    ...entry(46540, daysAgo(8), 4.19),
    kind: "world",
    world: "Overworld",
    displayName: "Overworld only",
    tags: ["world"],
  },
  {
    ...entry(46201, daysAgo(11), 1.82),
    kind: "world",
    world: "Middleworld",
    tags: ["world"],
  },
];
