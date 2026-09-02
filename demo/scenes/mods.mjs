/* Mods and plugins: the installed list filtered by typing, laid out in more
 * columns, and back. Browsing Modrinth is live in the demo and needs the
 * network, which a recording must not depend on, so the clip stays with what
 * is installed. */

import { centre } from "./lib.mjs";

export default {
  id: "mods",
  title: "Mods and plugins",
  frame: { tile: "mods" },
  poster: 3,
  async run({ page, tile, wait, glide, type }) {
    await wait(900);
    const filter = tile.locator('input[placeholder="Filter…"]');
    let p = await centre(filter);
    await glide(p.x - 300, p.y, 600);
    await filter.click();
    await type("luck", 110);
    await wait(1500);
    await filter.fill("");
    await wait(900);
    const cols = tile.locator('button[title="3 columns"]');
    p = await centre(cols);
    await glide(p.x, p.y, 800);
    await cols.click();
    await wait(1600);
    const one = tile.locator('button[title="1 column"]');
    p = await centre(one);
    await glide(p.x, p.y, 500);
    await one.click();
    await wait(1200);
  },
};
