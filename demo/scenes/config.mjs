/* Config editor: server.properties as a form in the compact tile, then the
 * maximized editor with its file list, switching to a YAML file and back.
 * The editor is a lazy chunk, so the wait after maximizing is real. */

import { panelCrop } from "./lib.mjs";

export default {
  id: "config",
  title: "Config editor",
  frame: { tile: "server-config" },
  poster: "end",
  async run({ page, tile, wait, glide, setCrop }) {
    await wait(900);
    await glide(800, 300, 500);
    await page.mouse.wheel(0, 140);
    await wait(700);
    await page.mouse.wheel(0, 140);
    await wait(900);
    await tile.locator('button[aria-label="Maximize tile"]').click();
    setCrop(panelCrop(60));
    await wait(2600);
    const file = (name) => page.locator("button", { hasText: name }).first();
    let b = await file("bukkit.yml").boundingBox();
    await glide(b.x + 60, b.y + b.height / 2, 700);
    await file("bukkit.yml").click();
    await wait(1800);
    b = await file("server.properties").boundingBox();
    await glide(b.x + 60, b.y + b.height / 2, 500);
    await file("server.properties").click();
    await wait(1500);
  },
};
