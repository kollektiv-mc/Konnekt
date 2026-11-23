/* The quick commands tile with Kommands installed and three of its commands
 * added as buttons.
 *
 * GetCommandButtons answers `seeded: true`, so the tile shows this set rather
 * than synthesising the app's first-launch defaults: a visitor sees what a
 * user who links commands from Kommands sees. The first six are the defaults
 * from frontend/src/components/commands/presets.ts as a seeded file holds them.
 *
 * Kommands targets 1.21.1, so the commands are written in its syntax:
 * enchantments still nest under `levels` there (1.21.5 dropped it).
 */

import { daysAgo, hoursAgo } from "./server.js";

const button = (id, label, kind, value, link) => ({
  id,
  label,
  kind,
  value,
  ...(link ? { link } : {}),
});

export const KOMMANDS_SAVED = [
  {
    id: "k-sword",
    revision: 1,
    label: "Sharpness V sword",
    command:
      'give @p minecraft:diamond_sword[minecraft:enchantments={levels:{"minecraft:sharpness":5}}]',
    updatedAt: daysAgo(6),
  },
  {
    id: "k-night-vision",
    revision: 3,
    label: "Night vision",
    command: "effect give @a minecraft:night_vision infinite 0 true",
    updatedAt: hoursAgo(2),
  },
  {
    id: "k-daylight",
    revision: 1,
    label: "Freeze daylight",
    command: "gamerule doDaylightCycle false",
    updatedAt: daysAgo(9),
  },
  {
    id: "k-weather",
    revision: 1,
    label: "Clear weather",
    command: "weather clear",
    updatedAt: daysAgo(9),
  },
];

const linked = (id, status) => {
  const saved = KOMMANDS_SAVED.find((s) => s.id === id);
  return button(`b-${id}`, saved.label, "cmd", saved.command, {
    source: "kommands",
    id,
    revision: saved.revision,
    status,
  });
};

export const COMMAND_BUTTONS = {
  seeded: true,
  items: [
    button("b-start", "Start", "lifecycle", "start"),
    button("b-stop", "Stop", "lifecycle", "stop"),
    button("b-restart", "Restart", "lifecycle", "restart"),
    button("b-force-stop", "Force Stop", "lifecycle", "force-stop"),
    button("b-save-all", "Save All", "cmd", "save-all"),
    button("b-tps", "TPS", "cmd", "tps"),
    linked("k-sword", "ok"),
    // Edited in Kommands two hours ago and applied here, not yet acknowledged.
    linked("k-night-vision", "changed"),
    linked("k-daylight", "ok"),
  ],
};

export const KOMMANDS_STATUS = {
  installed: true,
  path: "/home/mc/.config/kommands/saved-commands.json",
  unsupported: false,
  version: 1,
  error: "",
  savedCount: KOMMANDS_SAVED.length,
  linkedCount: 3,
  rejected: 0,
  brokenCount: 0,
  changedCount: 1,
};
