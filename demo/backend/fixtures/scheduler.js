/* Four schedules, wired from real blocks. The Distant Horizons one comes
 * first because the graph editor opens on the first graph in the list.
 *
 * The palette itself is not here — it is generated into blockdefs.json by
 * demo/tools/dump-blockdefs, because backend/services/scheduler_blocks.go is
 * the only honest source for it and a hand-copied palette would be wrong the
 * first time a block is added. These graphs only have to agree with it, so
 * every `type`, port name and config key below is taken from that dump.
 *
 * Two things a reader of the model would get wrong: a control edge targets the
 * port named "trigger", not "in" (the comment on models.Edge says "in", the
 * registry says otherwise), and an action's outputs are "onComplete" /
 * "onFailed" while control.condition branches on "onTrue" / "onFalse".
 *
 * These are also the two names in the app screenshot on the website's front
 * page, so the demo and the marketing shot describe the same server.
 */

import { daysAgo, minutesAgo } from "./server.js";

const node = (id, type, config, x, y) => ({
  id,
  type,
  config,
  position: { x, y },
});
const control = (id, source, sourcePort, target) => ({
  id,
  kind: "control",
  source,
  sourcePort,
  target,
  targetPort: "trigger",
});

/* The one bucket the DH graph publishes to. A Destination as ListDestinations
   returns it: the secret is never sent to the frontend, only that it is set. */
export const DESTINATIONS = [
  {
    id: "dest-lod",
    name: "LOD bucket",
    endpoint: "https://0f3c9a7e21d84b6c.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "creative-lod",
    prefix: "",
    publicBaseUrl: "https://lod.example.gg",
    accessKeyId: "8b1f…c42a",
    secretSet: true,
    privateLink: false,
  },
];

export const GRAPHS = [
  {
    id: "graph-dh-snapshot",
    name: "Distant Horizons",
    enabled: true,
    createdAt: daysAgo(18),
    updatedAt: daysAgo(2),
    nodes: [
      node("d1", "trigger.cron", { cron: "0 4 * * 0" }, 40, 140),
      node(
        "d2",
        "action.dhSnapshot",
        {
          destination: "LOD bucket",
          leadSeconds: 300,
          message:
            "The server will stop in {time} for a world snapshot and be back shortly.",
        },
        320,
        140,
      ),
      node(
        "d3",
        "action.dhPublish",
        { destination: "LOD bucket", keep: 3 },
        620,
        140,
      ),
      node(
        "d4",
        "action.httpRequest",
        {
          method: "POST",
          url: "https://hooks.example.gg/lod",
          body: '{"content":"New LOD snapshot is up"}',
          contentType: "application/json",
        },
        920,
        60,
      ),
      node(
        "d5",
        "action.notify",
        { kind: "error", message: "Publish failed", deliver: "both" },
        920,
        240,
      ),
    ],
    edges: [
      control("de1", "d1", "onComplete", "d2"),
      control("de2", "d2", "onComplete", "d3"),
      control("de3", "d3", "onComplete", "d4"),
      control("de4", "d3", "onFailed", "d5"),
    ],
  },
  {
    id: "graph-auto-restart",
    name: "Auto Restart",
    enabled: true,
    createdAt: daysAgo(21),
    updatedAt: daysAgo(3),
    nodes: [
      node("n1", "trigger.cron", { cron: "0 5 * * *" }, 40, 120),
      node(
        "n2",
        "action.notify",
        { kind: "warn", message: "Restarting in 60 seconds" },
        320,
        60,
      ),
      node(
        "n3",
        "action.command",
        { command: "say Restarting in 60s" },
        320,
        200,
      ),
      node("n4", "action.delay", { seconds: 60 }, 600, 130),
      node("n5", "action.backup", {}, 880, 60),
      node(
        "n6",
        "action.command",
        { command: "__restart__" },
        880,
        200,
      ),
    ],
    edges: [
      control("e1", "n1", "onComplete", "n2"),
      control("e2", "n1", "onComplete", "n3"),
      control("e3", "n3", "onComplete", "n4"),
      control("e4", "n4", "onComplete", "n5"),
      control("e5", "n5", "onComplete", "n6"),
    ],
  },
  {
    id: "graph-bluemap",
    name: "BlueMap Message",
    enabled: true,
    createdAt: daysAgo(9),
    updatedAt: daysAgo(9),
    nodes: [
      node("m1", "trigger.interval", { intervalMinutes: 30 }, 40, 120),
      node(
        "m2",
        "action.rcon",
        { command: "say Live map: https://map.example.gg" },
        360,
        120,
      ),
    ],
    edges: [control("me1", "m1", "onComplete", "m2")],
  },
  {
    id: "graph-lag-watch",
    name: "Lag Watch",
    enabled: false,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(12),
    nodes: [
      node(
        "l1",
        "trigger.tpsThreshold",
        { threshold: 14, cooldownSeconds: 300 },
        40,
        120,
      ),
      node(
        "l2",
        "action.notify",
        { kind: "warn", message: "TPS below 14" },
        360,
        60,
      ),
      node("l3", "action.rcon", { command: "save-all" }, 360, 200),
    ],
    edges: [
      control("le1", "l1", "onComplete", "l2"),
      control("le2", "l1", "onComplete", "l3"),
    ],
  },
];

/* `0 4 * * 0` in the visitor's own time zone, as the scheduler reads cron. */
function nextSundayAt4() {
  const d = new Date();
  d.setHours(4, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 7);
  return d.getTime();
}

/* graphID → next fire time, in Unix ms. Only enabled graphs get one — a
   disabled graph has no next run, and the summary counts on that to render
   "3 active" against four total. */
export const NEXT_RUNS = {
  "graph-dh-snapshot": nextSundayAt4(),
  "graph-auto-restart": minutesAgo(-386), // ~06:26 from now
  "graph-bluemap": minutesAgo(-19),
};
