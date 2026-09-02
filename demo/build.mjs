/* Builds the browser demo into demo/dist.
 *
 *   node demo/build.mjs
 *
 * Three things happen, in order, and the first two can fail the build:
 *
 *  1. The scheduler palette is regenerated from Go. It is the one fixture that
 *     is derived rather than authored, because scheduler_blocks.go is the only
 *     honest source for it.
 *  2. The shim's method table is cross-checked against the generated bindings.
 *     A binding the app can call that the demo does not answer is a tile that
 *     silently does nothing; this turns that into a build failure instead.
 *  3. Vite builds the untouched app, then the shim is copied in beside it and
 *     an index.html is written that loads the shim first.
 *
 * The app build goes to demo/dist via --outDir, never to frontend/dist:
 * main.go embeds that directory and scripts/check-bundle-size.mjs measures it,
 * so a demo build leaking into it would both bloat the desktop binary and give
 * CI a stale artifact to size.
 */

import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEMO, "..");
const FRONTEND = path.join(ROOT, "frontend");
const OUT = path.join(DEMO, "dist");

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });

// ── 1. Regenerate the scheduler palette from the Go registry ─────────────
console.log("demo: generating the block palette from backend/services");
const defs = run("go", ["run", "./demo/tools/dump-blockdefs"], ROOT);
writeFileSync(path.join(DEMO, "backend/fixtures/blockdefs.json"), defs);

// ── 2. Every binding the app can call must be answered ───────────────────
// Parsed rather than imported: reading the .d.ts needs no bundler and no
// module resolution, and the .d.ts is the same file the app's own imports are
// typed against.
const dts = readFileSync(
  path.join(FRONTEND, "wailsjs/go/main/App.d.ts"),
  "utf8",
);
const bound = new Set(
  [...dts.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]),
);

const apiSrc = readFileSync(path.join(DEMO, "backend/api.js"), "utf8");
const table = apiSrc.slice(apiSrc.indexOf("export const api = {"));
const answered = new Set([...table.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]));

const missing = [...bound].filter((m) => !answered.has(m)).sort();
const extra = [...answered].filter((m) => !bound.has(m)).sort();

if (missing.length || extra.length) {
  if (missing.length) {
    console.error(
      `\ndemo: ${missing.length} bound method(s) the demo does not answer.\n` +
        "Each one is a tile that will silently do nothing. Add them to\n" +
        "demo/backend/api.js as read / modrinth / refuse:\n  " +
        missing.join("\n  "),
    );
  }
  if (extra.length) {
    console.error(
      `\ndemo: ${extra.length} method(s) in the demo that no longer exist upstream:\n  ` +
        extra.join("\n  "),
    );
  }
  process.exit(1);
}
console.log(`demo: all ${bound.size} bound methods answered`);

// ── 3. Build the app, then wrap it ───────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log("demo: building the frontend");
run(
  "pnpm",
  ["exec", "vite", "build", "--outDir", OUT, "--emptyOutDir", "--base", "./"],
  FRONTEND,
);

cpSync(path.join(DEMO, "backend"), path.join(OUT, "demo-backend"), {
  recursive: true,
});

// Vite's index.html already carries the hashed module script; the shim goes in
// ahead of it. Module scripts run in document order with their full import
// graph resolved first, so both globals exist before the app's entry evaluates.
const html = readFileSync(path.join(OUT, "index.html"), "utf8");
// A hosted page with no icon is a blank tab and a 404 on every load; the app's
// own index.html has no link because a WebView has no tab to put one in.
const shim =
  '<link rel="icon" href="./demo-backend/favicon.png" />\n    ' +
  '<script type="module" src="./demo-backend/index.js"></script>';
if (!html.includes('<script type="module"')) {
  console.error(
    "demo: no module script in the built index.html — cannot place the shim",
  );
  process.exit(1);
}
writeFileSync(
  path.join(OUT, "index.html"),
  html.replace('<script type="module"', `${shim}\n    <script type="module"`),
);

const bytes = readdirSync(path.join(OUT, "assets")).length;
console.log(`demo: built ${OUT} (${bytes} assets)`);
