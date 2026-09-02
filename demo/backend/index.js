/* Installs the two globals Wails would have injected, then hands over.
 *
 * This is the seam frontend/src/main.tsx already names in a comment:
 *
 *   "Remote-mode seam: before React mounts, a remote runtime shim can polyfill
 *    window.go.main.App and window.runtime here so every tile works over
 *    HTTP/WS without per-tile changes."
 *
 * Same seam, different backing — fixtures instead of an embedded HTTP server.
 * Nothing under frontend/src/ imports anything in this directory, and nothing
 * here is imported by the app: the demo is assembled entirely by being loaded
 * first, which is why the desktop binary carries none of it and why the app's
 * 165 KB entry budget is untouched.
 *
 * Load order is the only requirement. demo/index.html puts this module script
 * before the app's, and module scripts execute in document order with their
 * whole import graph resolved first, so both globals exist before React
 * mounts. `hasWailsBridge()` is a bare `'go' in window` check, so the app is
 * satisfied the moment the assignment below runs.
 */

import { api } from "./api.js";
import * as events from "./events.js";
import { startStatusTicker } from "./state.js";
import {
  CONSOLE_LINES,
  SERVER_ID,
  SERVER_STATUS,
  minutesAgo,
} from "./fixtures/server.js";

// ── window.go ───────────────────────────────────────────────────────────
// The generated bindings index this by method name at call time
// (window['go']['main']['App'][Method]), so the shape has to match exactly.
window.go = { main: { App: api } };

// ── window.runtime ──────────────────────────────────────────────────────
// Every vendored runtime export derefs one of these inside its own body.
// BrowserOpenURL is the only one with a real browser equivalent; the window
// controls belong to a native title bar that has no meaning in a tab, so they
// are no-ops rather than refusals — the app calls them from its own chrome and
// a toast on every click would be noise.
const noop = () => {};
window.runtime = {
  EventsOnMultiple: events.EventsOnMultiple,
  EventsOn: events.EventsOn,
  EventsOnce: events.EventsOnce,
  EventsOff: events.EventsOff,
  EventsOffAll: events.EventsOffAll,
  EventsEmit: events.EventsEmit,

  BrowserOpenURL: (url) => window.open(url, "_blank", "noopener"),

  WindowReload: () => window.location.reload(),
  WindowReloadApp: () => window.location.reload(),
  WindowSetTitle: (title) => {
    document.title = title;
  },
  WindowMinimise: noop,
  WindowUnminimise: noop,
  WindowMaximise: noop,
  WindowUnmaximise: noop,
  WindowToggleMaximise: noop,
  WindowFullscreen: noop,
  WindowUnfullscreen: noop,
  WindowIsMaximised: async () => false,
  WindowIsMinimised: async () => false,
  WindowIsFullscreen: async () => false,
  WindowIsNormal: async () => true,
  WindowCenter: noop,
  WindowShow: noop,
  WindowHide: noop,
  WindowSetSize: noop,
  WindowGetSize: async () => ({ w: window.innerWidth, h: window.innerHeight }),
  WindowSetPosition: noop,
  WindowGetPosition: async () => ({ x: 0, y: 0 }),
  WindowSetAlwaysOnTop: noop,
  WindowSetLightTheme: noop,
  WindowSetDarkTheme: noop,
  WindowSetSystemDefaultTheme: noop,
  WindowSetBackgroundColour: noop,
  ScreenGetAll: async () => [],
  Quit: noop,
  Environment: async () => ({
    buildType: "demo",
    platform: "web",
    arch: "wasm",
  }),
  ClipboardGetText: () =>
    navigator.clipboard?.readText?.() ?? Promise.resolve(""),
  ClipboardSetText: (text) =>
    navigator.clipboard?.writeText?.(text) ?? Promise.resolve(false),

  LogTrace: noop,
  LogPrint: noop,
  LogDebug: noop,
  LogInfo: noop,
  LogWarning: noop,
  LogError: console.error.bind(console),
  LogFatal: console.error.bind(console),
  LogSetLogLevel: noop,
};

// ── The one-shot boot replay ────────────────────────────────────────────
// The console has no fetch path at all — GetConsoleHistory is bound in Go but
// imported nowhere in src/, so the tile is fed entirely by log:line events
// buffered in App.tsx. This is the scrollback, delivered the only way in.
//
// It runs once, on a timer long enough for App.tsx to have subscribed, and
// then nothing further is emitted unless a visitor presses Stop or Start
// (state.js). The demo shows a console with history in it, not a server
// pretending to still be running.
const REPLAY_DELAY_MS = 400;

function replayConsole() {
  const base = minutesAgo(CONSOLE_LINES.length * 0.4);
  CONSOLE_LINES.forEach(([source, line, outcome], i) => {
    events.EventsEmit("log:line", {
      timestamp: new Date(base + i * 24_000).toISOString(),
      line,
      ...(source ? { source } : {}),
      ...(outcome ? { outcome } : {}),
    });
  });
}

// The notifications tile is the other purely event-fed surface — it has no IPC
// of any kind and reads a store that only App.tsx writes to, from events. Left
// alone it is permanently empty, so these give it the four kinds it can show.
function seedNotifications() {
  events.EventsEmit("server:started");
  events.EventsEmit("player:joined", { name: "Frangfurd" });
  events.EventsEmit("player:joined", { name: "Direwolf20" });
  events.EventsEmit("backup:completed", {
    serverID: SERVER_ID,
    filename: "nightly",
  });
  // Trips the low-TPS latch in App.tsx, which is the only path to a `warn`.
  // The same event also appends to the performance ring, so a lone spike would
  // leave the chart — and the tile's headline numbers — reading as a server
  // that is lagging right now. A recovery sample straight after puts the
  // readout back on a healthy value and makes the spike a moment in the
  // history rather than the current state. The warn does not repeat: the latch
  // in App.tsx is one-shot.
  const snapshot = (tps, cpu) => ({
    timestamp: Date.now(),
    tps,
    ramUsedMB: SERVER_STATUS.ramUsed,
    ramTotalMB: SERVER_STATUS.ramTotal,
    cpuPercent: cpu,
    players: SERVER_STATUS.players,
  });
  events.EventsEmit("stats:snapshot", snapshot(13.4, 72));
  events.EventsEmit("stats:snapshot", snapshot(SERVER_STATUS.tps, 31));
}

window.setTimeout(() => {
  replayConsole();
  seedNotifications();
  startStatusTicker();
}, REPLAY_DELAY_MS);
