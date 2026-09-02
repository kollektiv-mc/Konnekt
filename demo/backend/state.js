/* The little that the demo lets you change.
 *
 * Three groups, and only three: the servers' lifecycle, scheduler graphs and
 * app settings. Layout and tile writes are accepted but not stored, because
 * the app keeps its own copy in the Zustand store and only reads ours once at
 * boot — persisting them would change nothing a visitor can see within a
 * session, and across sessions the demo deliberately resets.
 *
 * Nothing here touches localStorage. A demo that remembers is a demo where the
 * second visitor sees the first visitor's mess; resetting on reload is the
 * feature, not a shortcut.
 */

import * as events from "./events.js";
import { GRAPHS } from "./fixtures/scheduler.js";
import {
  SERVER_ID,
  SERVER_STATUS,
  STARTED_AT,
  CREATIVE_ID,
  CREATIVE_STATUS,
  configFor,
  bootLines,
  STOP_LINES,
} from "./fixtures/server.js";

// ── Servers ─────────────────────────────────────────────────────────────
/* Start and Stop succeed, and they are the only two lifecycle calls that do.
   Restart and force stop keep refusing: the point is to show a server coming
   up, its boot log streaming into the console and its status moving through
   starting and running, and one round trip of that is the whole demonstration.

   What a start emits is what backend/services/server.go emits, in the same
   order — server:state on every transition, log:line for each line the
   process would print, server:started once the ready line has gone by — so
   every tile reacts exactly as it would to a real boot, and nothing in the
   app knows it was a fixture. The pacing is the one liberty: a real boot's
   lines arrive in bursts, and these arrive evenly so they can be watched. */
const servers = new Map([
  [
    SERVER_ID,
    {
      status: structuredClone(SERVER_STATUS),
      startedAt: STARTED_AT,
      lastStop: { expected: true, exitCode: 0 },
    },
  ],
  [
    CREATIVE_ID,
    {
      status: structuredClone(CREATIVE_STATUS),
      startedAt: 0,
      lastStop: { expected: true, exitCode: 0 },
    },
  ],
]);

let activeServerId = SERVER_ID;

export const activeServer = () => activeServerId;

export function setActiveServer(id) {
  if (servers.has(id)) activeServerId = id;
}

const rec = (id) => servers.get(id) ?? servers.get(SERVER_ID);

/* uptimeSince in server.go, to the letter, so the Overview reads the same. */
function uptime(r) {
  if (!r.status.running) return "0s";
  const total = Math.round((Date.now() - r.startedAt) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export const status = (id) => ({ ...rec(id).status, uptime: uptime(rec(id)) });
export const running = (id) => rec(id).status.running;
export const lastStop = (id) => rec(id).lastStop;

const BOOT_LINE_MS = 190; // twenty-one lines in about four seconds
const STOP_LINE_MS = 240;

function line(text, extra) {
  events.EventsEmit("log:line", {
    timestamp: new Date().toISOString(),
    line: text,
    ...extra,
  });
}

/* Konnekt's own narration, the boxed lines the console draws around a
   lifecycle event. */
function narrate(text, outcome) {
  line(text, { source: "manager", outcome });
}

function transition(id, state, patch) {
  const r = rec(id);
  r.status = { ...r.status, state, ...patch };
  events.EventsEmit("server:state", { state, timedOut: false });
  events.EventsEmit("server:status", status(id));
}

/* Runs [gapMs, fn] steps one after another, each gap measured from the step
   before it. Timers rather than an async loop so the caller's promise can
   resolve at once, the way the Go side returns as soon as the process is
   spawned rather than when it is ready. */
function play(steps) {
  let at = 0;
  for (const [gap, fn] of steps) {
    at += gap;
    window.setTimeout(fn, at);
  }
}

export function startServer(id) {
  const r = rec(id);
  const { name, mcVersion } = configFor(id);
  if (r.status.running) throw new Error(`${name} is already running`);
  if (r.status.state !== "offline")
    throw new Error(`${name} is still ${r.status.state}`);

  transition(id, "starting", {
    running: false,
    players: 0,
    tps: 0,
    ramUsed: 0,
  });
  narrate(`Starting ${name} (${mcVersion})`, "progress");
  const lines = bootLines(id);
  play([
    ...lines.map((text, i) => [i === 0 ? 450 : BOOT_LINE_MS, () => line(text)]),
    [
      250,
      () => {
        r.startedAt = Date.now();
        transition(id, "running", {
          running: true,
          players: id === SERVER_ID ? SERVER_STATUS.players : 0,
          tps: 20,
          ramUsed: Math.round(r.status.ramTotal * 0.31),
        });
        narrate(`${name} is running`, "ok");
        events.EventsEmit("server:started");
      },
    ],
  ]);
}

export function stopServer(id) {
  const r = rec(id);
  const { name } = configFor(id);
  if (!r.status.running) throw new Error(`${name} is not running`);

  transition(id, "stopping", {});
  narrate(`Stopping ${name}`, "progress");
  play([
    ...STOP_LINES.map((text, i) => [
      i === 0 ? 350 : STOP_LINE_MS,
      () => line(text),
    ]),
    [
      300,
      () => {
        r.lastStop = { expected: true, exitCode: 0 };
        transition(id, "offline", {
          running: false,
          players: 0,
          tps: 0,
          ramUsed: 0,
        });
        narrate(`${name} stopped`, "ok");
        events.EventsEmit("server:stopped", r.lastStop);
      },
    ],
  ]);
}

/* stats.go pushes server:status every ten seconds whether or not the server
   is up. This is that tick, and it is what keeps the uptime counting after a
   start rather than reading "0s" until something else happens. */
export function startStatusTicker() {
  window.setInterval(
    () => events.EventsEmit("server:status", status(activeServerId)),
    10_000,
  );
}

// ── Scheduler graphs ────────────────────────────────────────────────────
let graphList = structuredClone(GRAPHS);

export const graphs = () => graphList;

export function saveGraph(graph) {
  const now = Date.now();
  const i = graphList.findIndex((g) => g.id === graph.id);
  // The Go side returns the authoritative graph, and the store replaces its
  // optimistic copy with whatever comes back — so the ids and timestamps this
  // assigns are what the editor ends up holding.
  const saved = {
    ...graph,
    id: graph.id || `graph-${now.toString(36)}`,
    createdAt: i === -1 ? now : graphList[i].createdAt,
    updatedAt: now,
  };
  if (i === -1) graphList.push(saved);
  else graphList[i] = saved;
  return saved;
}

export function deleteGraph(id) {
  graphList = graphList.filter((g) => g.id !== id);
}

export function setGraphEnabled(id, enabled) {
  const g = graphList.find((x) => x.id === id);
  if (g) {
    g.enabled = enabled;
    g.updatedAt = Date.now();
  }
}

// ── Settings ────────────────────────────────────────────────────────────
/* Settings are stored so the skin picker works: changing the accent repaints
   the whole dashboard through applySkin(), which is worth being able to try. */
let appSettings = {
  theme: "dark",
  skinId: "default",
  accentColor: "#4ade80",
  successColor: "#22c55e",
  warningColor: "#f59e0b",
  dangerColor: "#f87171",
  backgroundStyle: "solid",
  autoStartActiveServer: false,
  confirmBeforeStop: true,
  stopGraceSeconds: 60,
};

export const settings = () => appSettings;

export function saveSettings(next) {
  appSettings = { ...appSettings, ...next };
  return appSettings;
}
