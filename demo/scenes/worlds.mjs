/* World management: the compact list, then the tile maximized into its
 * planetary view, each world a planet on its own orbit with the active one
 * ringed. The frame follows the maximize onto the panel. */

import { panelCrop } from "./lib.mjs";

export default {
  id: "worlds",
  title: "World management",
  frame: { tile: "worlds" },
  poster: 5,
  // WebGL under a software rasteriser: at 1.5x the frames came out at four a
  // second, and the orbits need the rate more than the text needs the pixels.
  scale: 1,
  async run({ page, tile, wait, glide, setCrop }) {
    await wait(1300);
    await tile.locator('button[aria-label="Maximize tile"]').click();
    setCrop(panelCrop(240));
    await wait(2600);
    await glide(520, 430, 1200);
    await glide(980, 520, 1400);
    await wait(2200);
  },
};
