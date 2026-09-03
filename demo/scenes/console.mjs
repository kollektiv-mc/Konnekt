/* Live console: the server stops, and comes back up with its boot log
 * streaming in. Stop and Start are the two lifecycle calls the demo answers
 * (backend/state.js); the buttons that fire them live on the Commands tile,
 * off this frame, so the scene presses them through the shim instead. */

import { SERVER } from "./lib.mjs";

export default {
  id: "console",
  title: "Live console",
  frame: { tile: "console" },
  poster: "end",
  async run({ api, wait }) {
    await wait(1400);
    await api("StopServer", SERVER);
    await wait(4400);
    await api("StartServer", SERVER);
    await wait(6200);
  },
};
