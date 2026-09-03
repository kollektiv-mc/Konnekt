/* Backups: the compact summary, then the maximized carousel scrolled with
 * its arrows and narrowed with a tag search. Restoring is refused by the
 * demo, so it is looked at, not pressed. */

import { centre, panelCrop } from "./lib.mjs";

export default {
  id: "backups",
  title: "Backups",
  frame: { tile: "backups" },
  poster: "end",
  async run({ page, tile, wait, glide, type, setCrop }) {
    await wait(1100);
    await tile.locator('button[aria-label="Maximize tile"]').click();
    setCrop(panelCrop(350));
    await wait(1800);
    const next = page.locator('button[title="Next backup (→)"]');
    let p = await centre(next);
    await glide(p.x, p.y, 800);
    await next.click();
    await wait(1200);
    await next.click();
    await wait(1200);
    const search = page.locator(
      'input[placeholder="Search by #tag, date, or ID"]',
    );
    p = await centre(search);
    await glide(p.x - 400, p.y, 700);
    await search.click();
    await type("#keep", 90);
    await wait(1800);
  },
};
