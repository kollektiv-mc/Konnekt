/* Players: who is online, and one of them opened and kicked with a reason.
 * The kick is refused by the demo like every other command, so the leaving is
 * the server's side of it, played through the scene hook exactly as
 * server.go would report a player going.
 *
 * The detail popup is portaled out of the tile (#257: a grid tile is
 * transformed, and a transformed ancestor clamps a `fixed` overlay to the
 * tile's box), so it is found from the page rather than the tile, and it
 * centres on the window rather than on the tile. The frame follows it while
 * it is open and comes back to the tile when it closes; the jump lands on the
 * backdrop dimming, which reads as a cut anyway. */

import { centre } from "./lib.mjs";

export default {
  id: "players",
  title: "Players",
  frame: { tile: "players" },
  poster: "end",
  async run({ page, tile, frame, wait, glide, type, setCrop }) {
    await wait(900);
    const player = tile.locator("button", { hasText: "ceramichello" });
    let p = await centre(player);
    await glide(p.x, p.y, 700);
    await player.click();

    // The popup's backdrop covers the window; cut a frame around its centre.
    const popup = page.locator("div.fixed.inset-0", {
      hasText: "ceramichello",
    });
    const b = await popup.boundingBox();
    setCrop({
      x: frame.x,
      y: Math.round(b.y + b.height / 2 - frame.height / 2),
    });
    await wait(1100);

    const kick = popup.locator("button", { hasText: /^kick$/ });
    p = await centre(kick);
    await glide(p.x, p.y, 600);
    await kick.click();
    await wait(600);
    await popup.locator("input").first().click();
    await type("afk for an hour", 55);
    await wait(500);
    const confirm = popup.locator("button", { hasText: "Confirm kick" });
    p = await centre(confirm);
    await glide(p.x, p.y, 500);
    await confirm.click();
    setCrop({ x: frame.x, y: frame.y });
    await wait(500);
    await page.evaluate(() => window.konnektDemo.playerLeft("ceramichello"));
    await wait(3000);
  },
};
