/* Performance: the readouts and the chart moving as snapshots arrive, the
 * way stats.go sends one every ten seconds — here every half second, so the
 * dip and the recovery fit in one clip. */

import { snapshot } from "./lib.mjs";

const RUN = [
  [19.8, 31, 4312],
  [19.6, 34, 4360],
  [18.9, 41, 4420],
  [17.2, 52, 4510],
  [14.8, 66, 4680],
  [12.1, 78, 4890],
  [13.4, 74, 4930],
  [16.0, 61, 4810],
  [18.3, 47, 4640],
  [19.5, 38, 4520],
  [19.9, 33, 4450],
  [20.0, 31, 4410],
  [20.0, 30, 4390],
];

export default {
  id: "performance",
  title: "Performance",
  frame: { tile: "performance" },
  poster: "end",
  async run({ emit, wait }) {
    await wait(1000);
    for (const [tps, cpu, ram] of RUN) {
      await emit("stats:snapshot", snapshot({ tps, cpu, ram, players: 4 }));
      await wait(560);
    }
    await wait(600);
  },
};
