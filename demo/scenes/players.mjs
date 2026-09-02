/* Players: who is online, one of them opened, kicked with a reason, and
 * someone else arriving. The kick is refused by the demo like every other
 * command, so the leaving is the server's side of it, played through the
 * scene hook exactly as server.go would report a player going. */

import { centre } from "./lib.mjs";

export default {
  id: "players",
  title: "Players",
  frame: { tile: "players" },
  poster: "end",
  async run({ page, tile, wait, glide, type }) {
    await wait(900);
    const korbin = tile.locator("button", { hasText: "Korbin" });
    let p = await centre(korbin);
    await glide(p.x, p.y, 700);
    await korbin.click();
    await wait(1100);

    const kick = tile.locator("button", { hasText: /^kick$/ });
    p = await centre(kick);
    await glide(p.x, p.y, 600);
    await kick.click();
    await wait(600);
    await tile.locator("input").first().click();
    await type("afk for an hour", 55);
    await wait(500);
    const confirm = tile.locator("button", { hasText: "Confirm kick" });
    p = await centre(confirm);
    await glide(p.x, p.y, 500);
    await confirm.click();
    await wait(500);
    await page.evaluate(() => window.konnektDemo.playerLeft("Korbin"));
    await wait(1600);
    await page.evaluate(() => window.konnektDemo.playerJoined("Sable"));
    await wait(1400);
  },
};
