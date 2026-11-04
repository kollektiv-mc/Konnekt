/* Mods and plugins: the compact face at a glance, then the maximized library
 * filtered by typing, laid out in more columns, and back. Since #773 the
 * filter and the column picker live only on the maximized face. Browsing
 * Modrinth is live in the demo and needs the network, which a recording must
 * not depend on, so the clip stays with what is installed. */

import { centre, panelCrop } from "./lib.mjs";

export default {
  id: "mods",
  title: "Mods and plugins",
  frame: { tile: "mods" },
  poster: 5,
  async run({ page, tile, wait, glide, type, setCrop }) {
    await wait(1100);
    await tile.locator('button[aria-label="Maximize tile"]').click();
    setCrop(panelCrop(60));
    await wait(1800);
    const filter = page.locator('input[placeholder="Filter…"]');
    let p = await centre(filter);
    await glide(p.x - 300, p.y, 600);
    await filter.click();
    await type("luck", 110);
    await wait(1500);
    await filter.fill("");
    await wait(900);
    const cols = page.locator('button[aria-label="3 columns"]');
    p = await centre(cols);
    await glide(p.x, p.y, 800);
    await cols.click();
    await wait(1600);
    const one = page.locator('button[aria-label="1 column"]');
    p = await centre(one);
    await glide(p.x, p.y, 500);
    await one.click();
    await wait(1200);
  },
};
