/* Two schedules, wired from real blocks.
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

export const GRAPHS = [
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
        { preset: "", command: "say Restarting in 60s" },
        320,
        200,
      ),
      node("n4", "action.delay", { seconds: 60 }, 600, 130),
      node("n5", "action.backup", {}, 880, 60),
      node(
        "n6",
        "action.command",
        { preset: "__restart__", command: "" },
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
        { preset: "", command: "say Live map: https://map.example.gg" },
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
      node("l3", "action.rcon", { preset: "save-all", command: "" }, 360, 200),
    ],
    edges: [
      control("le1", "l1", "onComplete", "l2"),
      control("le2", "l1", "onComplete", "l3"),
    ],
  },
];

/* graphID → next fire time, in Unix ms. Only enabled graphs get one — a
   disabled graph has no next run, and the summary counts on that to render
   "2 active" against three total. */
export const NEXT_RUNS = {
  "graph-auto-restart": minutesAgo(-386), // ~06:26 from now
  "graph-bluemap": minutesAgo(-19),
};
