/* The `?tile=` deep link: one tile, the full width of the grid.
 *
 * Two consumers, one door. The website's "in action" tile links here so a
 * visitor lands on the tile they were just watching, and demo/record.mjs films
 * every scene through the same parameter, so the two cannot frame a tile
 * differently.
 *
 * It works entirely through the two layout reads the app makes at boot:
 * GetActiveTiles names the one tile, GetActiveLayout puts it at the top left
 * across all six columns, `h` rows tall. The app then renders the dashboard it
 * was told it had, and nothing under frontend/src/ knows the parameter exists.
 * An id that is not a tile is ignored rather than rejected: the default
 * dashboard is the right answer to a mistyped link.
 *
 * TILE_IDS is a copy of lib/constants.ts's ALL_TILE_IDS, kept by hand because
 * this module runs in a browser with no bundler to import it through.
 * demo/build.mjs diffs the two and fails on any difference, the same bargain
 * api.js makes with the bindings: a tile renamed upstream is a red build, not
 * a link that quietly opens the wrong thing.
 */

export const TILE_IDS = [
  "console",
  "stats",
  "players",
  "quick-commands",
  "performance",
  "scheduler",
  "worlds",
  "backups",
  "server-config",
  "notifications",
  "mods",
];

// lib/constants.ts's COLS and lib/gridSizing.ts's TILE_MIN.h and TILE_MAX.h.
const COLS = 6;
const ROWS_MIN = 4;
const ROWS_MAX = 16;

const params = new URLSearchParams(window.location.search);
const requested = params.get("tile");

/** The tile the link asked for, or null for the ordinary dashboard. */
export const framedTile = TILE_IDS.includes(requested) ? requested : null;

const rows = Math.min(
  ROWS_MAX,
  Math.max(ROWS_MIN, parseInt(params.get("h") ?? "", 10) || ROWS_MAX),
);

export const activeTiles = () => (framedTile ? [framedTile] : []);

export const activeLayout = () =>
  framedTile
    ? JSON.stringify([{ i: framedTile, x: 0, y: 0, w: COLS, h: rows }])
    : "";
