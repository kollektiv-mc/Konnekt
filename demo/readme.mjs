/* Makes the README's images from the demo.
 *
 *   node demo/build.mjs && DEMO_KEEP_FRAMES=1 node demo/record.mjs &&
 *   node demo/readme.mjs
 *
 * Each filmed scene becomes an animated WebP, because a README plays no video
 * that lives in the repository. It is encoded from the recorder's lossless
 * frames: encoded from the mp4, every frame carried that clip's compression
 * noise, which blurred the colours and kept WebP from reusing the parts of
 * the frame that did not change. Two stills come from the demo itself: the
 * banner, and the scheduler editor, which has no scene. Everything lands in
 * docs/images/readme/, overwriting what is there.
 *
 * Environment: DEMO_FFMPEG and DEMO_CHROMIUM as for record.mjs.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEMO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEMO, "..");
const DIST = path.join(DEMO, "dist");
const OUT = path.join(ROOT, "docs", "images", "readme");
const FRAMES = path.join(DEMO, ".frames");
const FFMPEG = process.env.DEMO_FFMPEG || "ffmpeg";

const require = createRequire(path.join(ROOT, "frontend", "package.json"));
const { chromium } = require("playwright");
const { SCENES } = await import(
  pathToFileURL(path.join(DEMO, "scenes/index.mjs")).href
);
const { PANEL } = await import(
  pathToFileURL(path.join(DEMO, "scenes/lib.mjs")).href
);

const log = (...a) => console.log("readme:", ...a);
const kb = (file) => `${Math.round(statSync(file).size / 1024)} KB`;

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("readme: no demo/dist, run `node demo/build.mjs` first");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// ── Clips ───────────────────────────────────────────────────────────────
for (const scene of SCENES) {
  const frames = path.join(FRAMES, scene.id);
  if (!existsSync(path.join(frames, "f00000.png"))) {
    console.error(
      `readme: no frames for ${scene.id}, run \`DEMO_KEEP_FRAMES=1 node demo/record.mjs\``,
    );
    process.exit(1);
  }
  const out = path.join(OUT, `${scene.id}.webp`);
  // 1224px is the clip's width in CSS pixels, whatever DEMO_SCALE filmed it at.
  execFileSync(FFMPEG, [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    "30",
    "-i",
    path.join(frames, "f%05d.png"),
    "-vf",
    "fps=15,scale=1224:-2:flags=lanczos",
    "-an",
    "-c:v",
    "libwebp_anim",
    "-quality",
    "80",
    "-compression_level",
    "6",
    "-loop",
    "0",
    out,
  ]);
  log(`${scene.id}.webp ${kb(out)}`);
}

// ── Stills ──────────────────────────────────────────────────────────────
// Served through Playwright's router rather than a socket: the demo is
// static files and nothing else.
const browser = await chromium.launch({
  executablePath: process.env.DEMO_CHROMIUM || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  colorScheme: "dark",
});
await context.route("http://demo/**", (route) => {
  const url = new URL(route.request().url());
  const rel = decodeURIComponent(url.pathname);
  const file = path.join(DIST, rel.endsWith("/") ? `${rel}index.html` : rel);
  return file.startsWith(DIST) && existsSync(file)
    ? route.fulfill({ path: file })
    : route.fulfill({ status: 404 });
});

async function shoot(url, prepare, clip) {
  const page = await context.newPage();
  await page.goto(`http://demo/${url}`);
  await page.waitForSelector("[data-tile-id]", { timeout: 20_000 });
  await page.waitForTimeout(6000);
  // The boot replay raises toasts; a still shows the dashboard without them.
  const dismiss = page.locator(
    '[aria-label="Notifications"] button[aria-label="Dismiss"]',
  );
  for (let left = 10; left && (await dismiss.count()); left--) {
    await dismiss.first().click();
    await page.waitForTimeout(600);
  }
  await page.mouse.move(700, 880);
  await prepare?.(page);
  await page.waitForTimeout(800);
  const png = await page.screenshot({ clip, omitBackground: true });
  await page.close();
  return png;
}

function webp(name, png) {
  const out = path.join(OUT, `${name}.webp`);
  execFileSync(
    FFMPEG,
    ["-y", "-loglevel", "error", "-i", "pipe:0", "-c:v", "libwebp"].concat([
      "-pix_fmt",
      "yuva420p",
      "-quality",
      "88",
      out,
    ]),
    { input: png },
  );
  log(`${name}.webp ${kb(out)}`);
}

// The banner: the top of the window, framed, fading to transparent so it
// sits on GitHub's light and dark themes alike.
const dashboard = await shoot("");
const frame = await context.newPage();
await frame.setViewportSize({ width: 1600, height: 620 });
await frame.setContent(`<body style="margin:0;padding:40px 80px 0">
  <div style="height:580px;overflow:hidden;border:1px solid rgb(255 255 255 / 0.14);
    border-bottom:0;border-radius:14px 14px 0 0;
    mask-image:linear-gradient(to bottom,#000 35%,transparent)">
    <img style="display:block;width:1440px"
      src="data:image/png;base64,${dashboard.toString("base64")}">
  </div></body>`);
await frame.waitForTimeout(300);
webp("banner", await frame.screenshot({ omitBackground: true }));
await frame.close();

webp(
  "scheduler",
  await shoot(
    "?tile=scheduler&h=9",
    async (page) => {
      await page
        .locator(
          '[data-tile-id="scheduler"] button[aria-label="Maximize tile"]',
        )
        .click();
      await page.waitForTimeout(1500);
    },
    PANEL,
  ),
);

await browser.close();
