/* The scenes, in the order the website's feature section lists them.
 *
 * A scene is a small module:
 *
 *   export default {
 *     id: "console",                 // the site's data-scene id, and the file name
 *     title: "Live console",
 *     frame: { tile: "console" },    // framed through ?tile= (backend/frame.js),
 *                                    // or { window: { x, y } } for a region of
 *                                    // the ordinary dashboard, in CSS pixels
 *     poster: "end",                 // the still: the last frame, or seconds in
 *     hold: 1200,                    // ms to rest on the final frame (optional)
 *     scale: 1.5,                    // pixels per CSS pixel (optional)
 *     async run({ page, tile, emit, api, wait, glide, type, setCrop }) {},
 *   }
 *
 * run() drives the real app with Playwright and feeds it events through the
 * shim's bus, exactly as the Go side would. Time is the recorder's: wait,
 * glide and type all count in scene time, one frame per thirtieth of a
 * second, so a scene plays the same on any machine (record.mjs). setCrop
 * moves the frame after a gesture, such as maximizing a tile; lib.mjs's
 * panelCrop knows where the maximized panel is.
 */

import dashboard from "./dashboard.mjs";
import console from "./console.mjs";
import players from "./players.mjs";
import performance from "./performance.mjs";
import worlds from "./worlds.mjs";
import backups from "./backups.mjs";
import config from "./config.mjs";
import mods from "./mods.mjs";
import servers from "./servers.mjs";

export const SCENES = [
  dashboard,
  console,
  players,
  performance,
  worlds,
  backups,
  config,
  mods,
  servers,
];
