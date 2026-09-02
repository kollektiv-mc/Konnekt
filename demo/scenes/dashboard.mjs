/* Tile dashboard: a tile dragged above its neighbour and the column
 * snapping around it, then resized by its corner, then closed back into the
 * crate. The ordinary dashboard, cut to the top of the grid, where the
 * default layout keeps the console on the left and a column of readouts on
 * the right; the gestures all happen in that column so they stay in frame. */

export default {
  id: "dashboard",
  title: "Tile dashboard",
  frame: { window: { x: 204, y: 48 } },
  poster: "end",
  async run({ page, wait, glide }) {
    const column = async () =>
      (
        await page.$$eval("[data-tile-id]", (els) =>
          els.map((el) => {
            const b = el.closest(".react-grid-item").getBoundingClientRect();
            return {
              id: el.dataset.tileId,
              x: b.x,
              y: b.y,
              w: b.width,
              h: b.height,
            };
          }),
        )
      )
        .filter((t) => t.x > 700)
        .sort((a, b) => a.y - b.y);

    await wait(1000);

    // The second tile in the right column, dragged up over the first.
    let [first, second] = await column();
    const handle = page.locator(`[data-tile-id="${second.id}"] .drag-handle`);
    const hb = await handle.boundingBox();
    await glide(hb.x + 60, hb.y + hb.height / 2, 600);
    await page.mouse.down();
    await wait(150);
    await glide(first.x + 160, first.y + 30, 1000);
    await wait(300);
    await page.mouse.up();
    await wait(1300);

    // Whatever is on top now, taller by its corner.
    [first] = await column();
    const corner = { x: first.x + first.w - 6, y: first.y + first.h - 6 };
    await glide(corner.x, corner.y, 700);
    await page.mouse.down();
    await wait(150);
    await glide(corner.x, corner.y + 110, 900);
    await wait(250);
    await page.mouse.up();
    await wait(1200);

    // And closed: back to the crate, the column compacts up.
    [first] = await column();
    const close = page.locator(
      `[data-tile-id="${first.id}"] button[aria-label="Remove tile"]`,
    );
    const cb = await close.boundingBox();
    await glide(cb.x + cb.width / 2, cb.y + cb.height / 2, 600);
    await wait(150);
    await close.click();
    await wait(1400);
  },
};
