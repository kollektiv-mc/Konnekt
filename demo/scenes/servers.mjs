/* Multi-server: the sidebar's server list, and the whole dashboard changing
 * when a different one is picked. Cut from the window's left edge so the
 * list and the first column of tiles share the frame. */

export default {
  id: "servers",
  title: "Multi-server",
  frame: { window: { x: 0, y: 48 } },
  poster: 2,
  async run({ page, wait, glide }) {
    const row = (name) => page.locator("button", { hasText: name }).first();
    await wait(1100);
    let b = await row("Creative").boundingBox();
    await glide(b.x + 40, b.y + b.height / 2, 700);
    await wait(150);
    await row("Creative").click();
    await wait(2200);
    b = await row("Survival").boundingBox();
    await glide(b.x + 40, b.y + b.height / 2, 700);
    await wait(150);
    await row("Survival").click();
    await wait(1800);
  },
};
