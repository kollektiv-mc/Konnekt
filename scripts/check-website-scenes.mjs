// Holds the home page's feature showcase and demo/scenes/ to one list.
//
// The showcase (website/index.html) names a scene per tab in data-scene and
// asks the demo for <demo>/scenes/<id>.webm, .mp4 and .webp; demo/record.mjs
// films exactly the scenes demo/scenes/index.mjs exports. Nothing else ties
// the two: the site has no build, the link checker skips external URLs by
// design, and the clips live on another Pages project. A scene renamed on
// either side would therefore show up as a box with a poster that never
// loads, on the live site, and nowhere earlier. This is the earlier.
//
// What it checks:
//   1. The tabs name the scenes, all of them, in the recorder's order
//   2. Each tab's data-tile is the tile its scene frames (the ?tile= link)
//   3. The markup's own clip URLs (the first tab's sources and poster) are
//      the demo origin plus /scenes/<first id>
//   4. The hero's "Try the demo" points at the same origin
//
// Zero dependencies, same as check-website-links.mjs. The scene modules are
// imported for real rather than parsed: they are plain data with no browser
// globals, and importing is the check that they load at all.
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

const showcase = html.match(/<div class="showcase"[^>]*\bdata-demo="([^"]+)"/);
if (!showcase) {
  console.error(
    'check-website-scenes: no <div class="showcase" data-demo=…> in website/index.html',
  );
  process.exit(1);
}
const demo = showcase[1];
if (demo.endsWith("/")) fail(`data-demo "${demo}" should not end in a slash`);

// 1 + 2 — the tabs
const tabs = [
  ...html.matchAll(/<button\b[^>]*\bclass="showcase-tab"[^>]*>/g),
].map(([tag]) => ({
  scene: (tag.match(/\bdata-scene="([^"]*)"/) || [])[1],
  tile: (tag.match(/\bdata-tile="([^"]*)"/) || [])[1],
}));
const siteIds = tabs.map((t) => t.scene);
const sceneIds = SCENES.map((s) => s.id);
if (siteIds.join(",") !== sceneIds.join(",")) {
  fail(
    `the tabs and demo/scenes/index.mjs disagree\n    site:  ${siteIds.join(", ")}\n    demo:  ${sceneIds.join(", ")}`,
  );
}
for (const tab of tabs) {
  const scene = SCENES.find((s) => s.id === tab.scene);
  if (!scene) continue;
  const tile = scene.frame.tile ?? "";
  if (tab.tile !== tile)
    fail(
      `tab "${tab.scene}" has data-tile="${tab.tile}" but the scene frames "${tile}"`,
    );
}

// 3 — the clip URLs the markup carries itself
const first = sceneIds[0];
const media =
  html.match(/<figure class="showcase-media[\s\S]*?<\/figure>/)?.[0] ?? "";
for (const [, url] of media.matchAll(/\b(?:src|poster)="([^"]+)"/g)) {
  const want = `${demo}/scenes/${first}.`;
  if (!url.startsWith(want)) fail(`clip URL "${url}" is not under ${want}…`);
}

// 4 — one demo origin on the page
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
