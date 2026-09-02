/* The little that the demo lets you change.
 *
 * Two groups, and only two: scheduler graphs and app settings. Layout and tile
 * writes are accepted but not stored, because the app keeps its own copy in
 * the Zustand store and only reads ours once at boot — persisting them would
 * change nothing a visitor can see within a session, and across sessions the
 * demo deliberately resets.
 *
 * Nothing here touches localStorage. A demo that remembers is a demo where the
 * second visitor sees the first visitor's mess; resetting on reload is the
 * feature, not a shortcut.
 */

import { GRAPHS } from "./fixtures/scheduler.js";

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
