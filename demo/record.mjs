/* Films the scenes under demo/scenes/ and writes the website's clips.
 *
 *   node demo/record.mjs [scene id ...]        # every scene by default
 *
 * Runs against the demo that demo/build.mjs just built: a static server on a
 * loopback port, one Chromium context per scene at a 1440x900 viewport, and a
 * loop of clip screenshots of the frame's region while the scene's run()
 * drives the page. The frames are lossless PNGs, one per thirtieth of a
 * second of scene time, and ffmpeg turns them into three files per scene:
 *
 *   demo/dist/scenes/<id>.webm     VP9, the site's primary source
 *   demo/dist/scenes/<id>.mp4      H.264, for anything that cannot play VP9
 *   demo/dist/scenes/<id>.webp     the poster the site shows before playback
 *
 * plus scenes/index.json listing what was made. Every clip is the same size,
 * one tile across the full grid at nine rows (backend/frame.js), so the site
 * can hold one box for all of them and switch what plays in it.
 *
 * Time is the page's fake clock, not the wall's. Playwright's clock is
 * installed before the page loads and paused once the demo has booted, and
 * from then on the loop below is the only thing that moves it: capture a
 * frame, advance the clock one tick, capture the next. Every timer, every
 * requestAnimationFrame and every Date.now() in the page — the shim's boot
 * log, the grid's drag animation, the worlds scene's orbits — advances
 * exactly one tick per frame, so a clip is the same 30 frames a second on
 * this machine, on a CI runner and on one twice as slow. Measured before
 * this was done: real-time capture managed twelve frames a second on a
 * four-core box and under five for anything with WebGL in it, and that
 * number would have been the clip's.
 *
 * Scenes therefore never wait on the wall clock. ctx.wait(ms) resolves when
 * the scene clock has moved that far, ctx.glide moves the pointer a step per
 * tick, and ctx.type presses a key every few ticks. Anything the page does on
 * its own timers, like the boot log, is paced by the same clock. Network is
 * the one thing that stays real, and it is a loopback static server.
 *
 * Why screenshots and not a screencast: Playwright's recorder and the CDP
 * screencast both hand over the viewport at CSS size, one device pixel per
 * CSS pixel, and the recorder then re-encodes to VP8 at about a megabit —
 * 12px console text came out visibly soft. A clip screenshot can ask for
 * more pixels per CSS pixel: 1.5x by default (DEMO_SCALE changes it), which
 * is 1836x684 frames, near crisp in an 1120px box on a 2x display.
 *
 * The scenes are the load-bearing part and the reason this runs in CI: a
 * tile whose controls move so that a scene cannot find them fails the demo
 * job loudly, the same bargain build.mjs makes with the bindings, rather
 * than the site quietly showing a stale clip.
 *
 * Environment: DEMO_FFMPEG names the ffmpeg binary (default: ffmpeg on PATH,
 * built with libvpx-vp9, libx264 and libwebp), DEMO_CHROMIUM overrides
 * Playwright's own Chromium, DEMO_SCALE sets pixels per CSS pixel, and
 * DEMO_KEEP_FRAMES keeps the PNGs under demo/.frames for inspection.
 */

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEMO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEMO, "..");
const FRONTEND = path.join(ROOT, "frontend");
const DIST = path.join(DEMO, "dist");
const OUT = path.join(DIST, "scenes");
const TMP = path.join(DEMO, ".frames");

// Playwright is a devDependency of frontend/, the only package.json in the
// repo with tooling in it, so it is resolved from there.
const require = createRequire(path.join(FRONTEND, "package.json"));
const { chromium } = require("playwright");

const FFMPEG = process.env.DEMO_FFMPEG || "ffmpeg";
const SCALE = Number(process.env.DEMO_SCALE || 1.5);
const VIEWPORT = { width: 1440, height: 900 };
// One tile across all six columns at nine rows, in CSS pixels, measured in
// the viewport above. Tile scenes assert their tile is this size; window
// scenes cut this much out of the ordinary dashboard.
const CROP = { width: 1224, height: 456 };
const FPS = 30;
const TICK_MS = 1000 / FPS;
const SETTLE_MS = 2400; // the splash, the reveal after it, and the boot replay
const HOLD_MS = 1200;
const SCENE_TIMEOUT_MS = 240_000; // wall time; a 15s scene is ~450 captures
// Scenes filmed at once. Capture is one page rendering and encoding a frame
// at a time, so a second context on a four-core box comes close to doubling
// the throughput — and two Chromium pages holding 1.5x surfaces was also what
// got the process killed on a 16 GB box here, so one is the default and
// DEMO_PARALLEL=2 is an opt-in for a runner known to have the memory.
const PARALLEL = Number(process.env.DEMO_PARALLEL || 1);

const log = (...a) => console.log("record:", ...a);
const fail = (msg) => {
  console.error(`\nrecord: ${msg}`);
  process.exit(1);
};

if (!existsSync(path.join(DIST, "index.html")))
  fail("no demo/dist — run `node demo/build.mjs` first");

const { SCENES } = await import(
  pathToFileURL(path.join(DEMO, "scenes/index.mjs")).href
);
const wanted = process.argv.slice(2);
const scenes = wanted.length
  ? wanted.map(
      (id) => SCENES.find((s) => s.id === id) ?? fail(`no scene "${id}"`),
    )
  : SCENES;

// ── A static server for demo/dist ───────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://demo");
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory())
    file = path.join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ── Film ────────────────────────────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.DEMO_CHROMIUM || undefined,
});
const made = [];

async function film(scene) {
  log(`${scene.id}: filming`);
  const frameDir = path.join(TMP, scene.id);
  mkdirSync(frameDir, { recursive: true });

  const scale = scene.scale ?? SCALE;
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: scale,
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Installed before the page loads so every timer it ever sets is ours. It
  // runs at real speed until the boot has settled, and is paused below.
  await page.clock.install();

  const { tile, window: region } = scene.frame;
  const url = tile ? `${base}?tile=${tile}&h=9` : base;
  await page.goto(url);
  await page.waitForSelector("[data-tile-id]", { timeout: 20_000 });
  await page.waitForTimeout(SETTLE_MS);

  // Where the clip is cut from, in CSS pixels.
  let crop;
  if (tile) {
    const r = await page.$eval(`[data-tile-id="${tile}"]`, (el) => {
      const b = el.closest(".react-grid-item").getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    const off = (a, b) => Math.abs(a - b) > 2;
    if (off(r.width, CROP.width) || off(r.height, CROP.height))
      fail(
        `${scene.id}: the framed tile is ${Math.round(r.width)}x${Math.round(r.height)}, ` +
          `not ${CROP.width}x${CROP.height} — the grid's metrics changed; update CROP`,
      );
    crop = { x: r.x, y: r.y };
  } else {
    crop = { x: region.x, y: region.y };
  }

  // The loop: capture a frame, advance the scene clock one tick, wake any
  // wait() that has come due, repeat. A scene that moves its frame —
  // maximizing a tile — calls setCrop, and the next capture follows it.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1);
  const cdp = await context.newCDPSession(page);
  let frameCount = 0;
  let elapsed = 0; // scene time, ms
  let cropNow = crop;
  let filming = true;
  const waiters = [];
  const capturing = (async () => {
    while (filming) {
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        optimizeForSpeed: true,
        captureBeyondViewport: false,
        clip: {
          x: cropNow.x,
          y: cropNow.y,
          width: CROP.width,
          height: CROP.height,
          scale,
        },
      });
      writeFileSync(
        path.join(frameDir, `f${String(frameCount).padStart(5, "0")}.png`),
        Buffer.from(data, "base64"),
      );
      frameCount++;
      await page.clock.runFor(TICK_MS);
      elapsed += TICK_MS;
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].until <= elapsed + 0.01) {
          waiters[i].resolve();
          waiters.splice(i, 1);
        }
      }
    }
  })();

  const wait = (ms) =>
    new Promise((resolve) => waiters.push({ until: elapsed + ms, resolve }));
  let pointer = { x: 0, y: 0 };
  const ctx = {
    page,
    tile: tile ? page.locator(`[data-tile-id="${tile}"]`) : null,
    emit: (name, payload) =>
      page.evaluate(
        ([n, p]) => window.runtime.EventsEmit(n, p),
        [name, payload],
      ),
    api: (method, ...args) =>
      page.evaluate(([m, a]) => window.go.main.App[m](...a), [method, args]),
    wait,
    // One pointer step per tick, eased, so a glide reads as a hand moving.
    glide: async (x, y, ms = 600) => {
      const steps = Math.max(2, Math.round(ms / TICK_MS));
      const from = pointer;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        pointer = {
          x: from.x + (x - from.x) * e,
          y: from.y + (y - from.y) * e,
        };
        await page.mouse.move(pointer.x, pointer.y);
        await wait(TICK_MS);
      }
    },
    // A key every few ticks, into whatever has focus.
    type: async (text, perKeyMs = 70) => {
      for (const ch of text) {
        await page.keyboard.type(ch);
        await wait(perKeyMs);
      }
    },
    setCrop: (c) => {
      cropNow = c;
    },
  };

  const started = Date.now();
  // Cleared once the scene is done: a live timer keeps the process alive
  // until it fires, and this one is four minutes long. The first CI run
  // spent three and a half of them idle after the last clip was written.
  let timer;
  try {
    await Promise.race([
      scene.run(ctx),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`took longer than ${SCENE_TIMEOUT_MS}ms`)),
          SCENE_TIMEOUT_MS,
        );
      }),
    ]);
    await wait(scene.hold ?? HOLD_MS);
  } catch (e) {
    fail(`${scene.id}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  filming = false;
  await capturing;
  await context.close();

  if (errors.length) fail(`${scene.id}: page errors\n  ${errors.join("\n  ")}`);
  if (frameCount < 2) fail(`${scene.id}: only ${frameCount} frame(s) captured`);
  const duration = frameCount / FPS;
  const frameAt = (seconds) => {
    const n = Math.min(frameCount - 1, Math.max(0, Math.round(seconds * FPS)));
    return path.join(frameDir, `f${String(n).padStart(5, "0")}.png`);
  };

  // ── Encode ────────────────────────────────────────────────────────────
  // Already cut to the frame; the filter only keeps both sides even for
  // yuv420p.
  const vf = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const input = [
    "-framerate",
    String(FPS),
    "-i",
    path.join(frameDir, "f%05d.png"),
  ];
  const ff = (args) =>
    execFileSync(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

  const webm = path.join(OUT, `${scene.id}.webm`);
  const mp4 = path.join(OUT, `${scene.id}.mp4`);
  const poster = path.join(OUT, `${scene.id}.webp`);

  // prettier-ignore
  ff([
    ...input, "-vf", vf, "-an",
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-row-mt", "1",
    "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p",
    webm,
  ]);
  // prettier-ignore
  ff([
    ...input, "-vf", vf, "-an",
    "-c:v", "libx264", "-crf", "23", "-preset", "medium",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    mp4,
  ]);
  const at =
    scene.poster === "end" || scene.poster == null
      ? frameAt(duration)
      : frameAt(scene.poster);
  // prettier-ignore
  ff([
    "-i", at, "-vf", vf,
    "-c:v", "libwebp", "-quality", "82", "-frames:v", "1",
    poster,
  ]);

  const size = (f) => statSync(f).size;
  made.push({
    id: scene.id,
    title: scene.title,
    duration: Math.round(duration * 10) / 10,
    webm: size(webm),
    mp4: size(mp4),
    poster: size(poster),
  });
  log(
    `${scene.id}: ${frameCount} frames, ${duration.toFixed(1)}s, ` +
      `filmed in ${((Date.now() - started) / 1000).toFixed(0)}s → ` +
      `webm ${(size(webm) / 1024).toFixed(0)} KB, ` +
      `mp4 ${(size(mp4) / 1024).toFixed(0)} KB, ` +
      `poster ${(size(poster) / 1024).toFixed(0)} KB`,
  );
  if (!process.env.DEMO_KEEP_FRAMES)
    rmSync(frameDir, { recursive: true, force: true });
}

// A small pool: the next scene starts as soon as a slot frees up.
const queue = [...scenes];
await Promise.all(
  Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    while (queue.length) await film(queue.shift());
  }),
);
made.sort(
  (a, b) =>
    scenes.findIndex((s) => s.id === a.id) -
    scenes.findIndex((s) => s.id === b.id),
);

await browser.close();
server.close();
if (!process.env.DEMO_KEEP_FRAMES)
  rmSync(TMP, { recursive: true, force: true });

let commit = process.env.GITHUB_SHA || "";
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    /* not a checkout */
  }
}
writeFileSync(
  path.join(OUT, "index.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      commit,
      width: Math.round(CROP.width * SCALE),
      height: Math.round(CROP.height * SCALE),
      fps: FPS,
      scenes: made,
    },
    null,
    2,
  ) + "\n",
);
log(`wrote ${made.length} scene(s) to ${OUT}`);
