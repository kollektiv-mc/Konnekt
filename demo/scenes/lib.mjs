/* What every scene reaches for. Small on purpose: a scene should read as a
 * list of the things a person does and the things the server does back. */

/** fixtures/server.js's SERVER_ID. A literal rather than an import, so the
 *  scenes stay plain modules with no reach into the shim; a mismatch fails
 *  loudly the first time a scene starts or stops it. */
export const SERVER = "demo-survival";

/** The maximized panel: Dashboard.tsx lays the tile over the main area with
 *  a 24px inset, which at a 1440x900 viewport is this box in CSS pixels. A
 *  scene that maximizes crops inside it; `y` picks the band worth watching. */
export const PANEL = { x: 216, y: 60, width: 1200, height: 816 };

/** A crop of the recorder's frame size centred horizontally on the panel,
 *  at the given top. */
export const panelCrop = (y) => ({ x: PANEL.x - 12, y });

/** The centre of a locator's box, for the mouse. */
export async function centre(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`nothing to point at: ${locator}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A stats:snapshot with the shape backend/models expects. */
export const snapshot = ({ tps, cpu, ram, players }) => ({
  timestamp: Date.now(),
  tps,
  ramUsedMB: ram,
  ramTotalMB: 6144,
  cpuPercent: cpu,
  players,
});
