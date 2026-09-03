// Holds the home page's feature showcase, main.js's scene table and
// demo/scenes/ to one list.
//
// The showcase (website/index.html) has a tab per scene, named in data-scene.
// main.js carries the demo's origin and the same scenes in the same order,
// each with the tile its "Open in the demo" link frames, as constants: a URL
// built from text read off the page is what CodeQL reports as DOM text
// reinterpreted as HTML, so nothing there reads the attributes back.
// demo/record.mjs films exactly the scenes demo/scenes/index.mjs exports.
// Nothing else ties the three: the site has no build, the link checker skips
// external URLs by design, and the clips live on another Pages project. A
// scene renamed on any side would therefore show up as a box with a poster
// that never loads, on the live site, and nowhere earlier. This is the
// earlier.
//
// What it checks:
//   1. main.js's table names the scenes, all of them, in the recorder's order
//   2. Each entry's tile is the tile its scene frames (the ?tile= link)
//   3. The tabs name the same scenes in the same order
//   4. The markup's own clip URLs (the first tab's sources and poster) are
//      the demo origin plus /scenes/<first id>
//   5. The hero's "Try the demo" points at the same origin
//
// Zero dependencies, same as check-website-links.mjs. The scene modules are
// imported for real rather than parsed: they are plain data with no browser
// globals, and importing is the check that they load at all. main.js is
// parsed by regex, the same bargain the link checker makes with the HTML:
// the input is this repo's own hand-written source, Prettier-normalised.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");
const html = readFileSync(
  path.join(ROOT, "website/index.html"),
  "utf8",
).replace(/<!--[\s\S]*?-->/g, " ");
const { SCENES } = await import(
  pathToFileURL(path.join(ROOT, "demo/scenes/index.mjs")).href
);

const problems = [];
const fail = (m) => problems.push(m);

const js = readFileSync(path.join(ROOT, "website/main.js"), "utf8");
const demo = (js.match(/\bvar DEMO = '([^']+)'/) || [])[1];
const table = js.match(/\bvar SCENES = \[([\s\S]*?)\n\s*\]/);
if (!demo || !table) {
  console.error(
    "check-website-scenes: no `var DEMO = '…'` or `var SCENES = [ … ]` in website/main.js",
  );
  process.exit(1);
}
if (demo.endsWith("/")) fail(`DEMO "${demo}" should not end in a slash`);
const jsScenes = [
  ...table[1].matchAll(/\{\s*id:\s*'([^']*)',\s*tile:\s*'([^']*)'\s*\}/g),
].map((m) => ({ id: m[1], tile: m[2] }));

// 1 + 2 — main.js's table against the recorder's scenes
const sceneIds = SCENES.map((s) => s.id);
const jsIds = jsScenes.map((s) => s.id);
if (jsIds.join(",") !== sceneIds.join(",")) {
  fail(
    `main.js's SCENES and demo/scenes/index.mjs disagree\n    main.js: ${jsIds.join(", ")}\n    demo:    ${sceneIds.join(", ")}`,
  );
}
for (const entry of jsScenes) {
  const scene = SCENES.find((s) => s.id === entry.id);
  if (!scene) continue;
  const tile = scene.frame.tile ?? "";
  if (entry.tile !== tile)
    fail(
      `main.js has tile '${entry.tile}' for "${entry.id}" but the scene frames "${tile}"`,
    );
}

// 3 — the tabs
const tabs = [
  ...html.matchAll(/<button\b[^>]*\bclass="showcase-tab"[^>]*>/g),
].map(([tag]) => (tag.match(/\bdata-scene="([^"]*)"/) || [])[1]);
if (tabs.join(",") !== sceneIds.join(",")) {
  fail(
    `the tabs and demo/scenes/index.mjs disagree\n    site:  ${tabs.join(", ")}\n    demo:  ${sceneIds.join(", ")}`,
  );
}

// 4 — the clip URLs the markup carries itself
const first = sceneIds[0];
const media =
  html.match(/<figure class="showcase-media[\s\S]*?<\/figure>/)?.[0] ?? "";
for (const [, url] of media.matchAll(/\b(?:src|poster)="([^"]+)"/g)) {
  const want = `${demo}/scenes/${first}.`;
  if (!url.startsWith(want)) fail(`clip URL "${url}" is not under ${want}…`);
}

// 5 — one demo origin on the page
for (const [, href] of html.matchAll(
  /<a\b[^>]*\bhref="([^"]+)"[^>]*>\s*Try the demo/g,
)) {
  if (href !== `${demo}/`)
    fail(`the hero's "Try the demo" points at "${href}", not "${demo}/"`);
}

if (problems.length) {
  console.error("check-website-scenes: " + problems.length + " problem(s)");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(
  `✓ website showcase: ${tabs.length} tabs match ${SCENES.length} scenes, clips under ${demo}/scenes/`,
);
