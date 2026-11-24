// The website's docs pages, built from the Markdown under docs/website/.
//
// Each docs/website/<path>.md becomes website/docs/<path>.html, laid out by
// its kind: a guide reads as numbered steps beside a picture, a concept as
// short points beside a diagram, a reference and a settings page as tables.
// The layout lives here and in docs.css, so a page says only what it says, and
// two pages of a kind cannot drift apart. The syntax a page may use is in
// docs/website/README.md.
//
// It also writes the docs home's shelves (website/docs.html, between
// <!-- gen:shelves --> markers) from each page's shelf, order and summary.
//
// The block pages under website/docs/blocks/ are gen-block-docs.mjs's, and
// this leaves them alone. Run this before gen-docs-search.mjs, which reads the
// pages this writes. Output goes through the frontend's Prettier with the
// site's own config; run `pnpm install` in frontend/ first.
//
//   node scripts/gen-docs.mjs               rewrite
//   node scripts/gen-docs.mjs --check       fail if a page or the shelves are stale
//   node scripts/gen-docs.mjs --page a.md   rewrite one page, and report only its problems
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  esc,
  fail,
  frontMatter,
  inline,
  parseSections,
  problems,
  sectionsHtml,
  tocHtml,
} from "./lib/docs-markdown.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const SRC = path.join(ROOT, "docs/website");
const SITE = path.join(ROOT, "website");
const OUT = path.join(SITE, "docs");
const HUB = path.join(SITE, "docs.html");
const ORIGIN = "https://konnekt.pages.dev";

const check = process.argv.includes("--check");
const only = process.argv.includes("--page")
  ? process.argv[process.argv.indexOf("--page") + 1]
  : null;

const PRETTIER = path.join(ROOT, "frontend/node_modules/prettier/index.mjs");
if (!existsSync(PRETTIER)) {
  console.error(
    "gen-docs: run `pnpm install` in frontend/ first, for Prettier",
  );
  process.exit(1);
}
const prettier = await import(pathToFileURL(PRETTIER).href);
const format = async (file, text) =>
  prettier.format(text, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });

const KINDS = {
  guide: "Guide",
  concept: "Concept",
  reference: "Reference",
  settings: "Settings",
};

// The docs home's shelves, in order. A page names its shelf by id.
const SHELVES = [
  { id: "new-here", name: "New here" },
  { id: "tutorials", name: "Tutorials" },
  { id: "dashboard", name: "Dashboard" },
  { id: "scheduler", name: "Scheduler" },
  { id: "settings", name: "Settings" },
];

// Shelf entries for pages this script does not write.
const EXTRA_LINKS = [
  {
    shelf: "scheduler",
    order: 2,
    href: "/docs/blocks/",
    title: "Scheduler blocks",
    summary: "Ports, fields and errors of every block.",
  },
];

// ── Pages ──────────────────────────────────────────────────────────────────

function sources(dir, rel = "") {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      // blocks/ holds the block pages' sections, which gen-block-docs.mjs writes.
      if (e.isDirectory())
        return r === "blocks" ? [] : sources(path.join(dir, e.name), r);
      if (!e.name.endsWith(".md") || e.name === "README.md") return [];
      return [r];
    });
}

function parse(rel) {
  const where = `docs/website/${rel}`;
  const { meta, body } = frontMatter(
    readFileSync(path.join(SRC, rel), "utf8"),
    where,
  );
  for (const key of ["title", "kind", "lead", "shelf", "summary"]) {
    if (!meta[key]) fail(where, `front matter needs ${key}`);
  }
  if (meta.kind && !KINDS[meta.kind]) fail(where, `unknown kind ${meta.kind}`);
  if (meta.shelf && !SHELVES.some((s) => s.id === meta.shelf)) {
    fail(where, `unknown shelf ${meta.shelf}`);
  }
  const sections = parseSections(body, where);
  return {
    rel,
    where,
    href: `/docs/${rel.replace(/\.md$/, ".html")}`,
    out: path.join(OUT, rel.replace(/\.md$/, ".html")),
    meta,
    sections,
  };
}

// What a link in "related" shows: the page's kind and title, read from its
// source, or from the page itself for one this script does not write.
function describe(href, pages, where) {
  const page = pages.find((p) => p.href === href.replace(/#.*$/, ""));
  if (page) return { kind: page.meta.kind, title: page.meta.title };
  const bare = href.replace(/#.*$/, "");
  const file = path.join(SITE, bare.endsWith("/") ? `${bare}index.html` : bare);
  if (!existsSync(file)) {
    fail(where, `related page ${href} does not exist`);
    return { kind: "reference", title: href };
  }
  const html = readFileSync(file, "utf8");
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].trim() ?? href;
  return { kind: html.match(/data-kind="([^"]+)"/)?.[1] ?? "reference", title };
}

function shell() {
  const html = readFileSync(HUB, "utf8");
  const head = html.slice(0, html.indexOf('        <main id="main"'));
  const tail = html.slice(html.indexOf("        </main>"));
  return {
    head,
    tail: tail.replace(/\n {4}<script src="\/docs\.js"><\/script>/, ""),
  };
}

function render(page, pages, { head, tail }) {
  const { meta, sections, href, where } = page;
  const url = `${ORIGIN}${href}`;
  const title = `Konnekt docs: ${meta.title}`;
  const description = `${meta.title}: ${meta.lead}`;
  const css = [].concat(meta.css ?? []);
  const js = [].concat(meta.js ?? []);
  const top = head
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replaceAll(
      /(property="og:title"|name="twitter:title") content="[^"]*"/g,
      (_, a) => `${a} content="${esc(title)}"`,
    )
    .replaceAll(
      /(name="description"|property="og:description"|name="twitter:description")\s+content="[^"]*"/g,
      (_, a) => `${a} content="${esc(description)}"`,
    )
    .replace(/rel="canonical" href="[^"]*"/, `rel="canonical" href="${url}"`)
    .replace(
      /property="og:url" content="[^"]*"/,
      `property="og:url" content="${url}"`,
    )
    .replace(
      '    <link rel="stylesheet" href="/docs.css" />',
      ['    <link rel="stylesheet" href="/docs.css" />']
        .concat(css.map((c) => `    <link rel="stylesheet" href="${c}" />`))
        .join("\n"),
    );
  const shelf = SHELVES.find((s) => s.id === meta.shelf) ?? SHELVES[0];
  const facts = Object.entries(meta.facts ?? {})
    .map(
      ([k, v]) =>
        `<div class="doc-fact"><dt class="label">${esc(k)}</dt><dd>${inline(v)}</dd></div>`,
    )
    .join("");
  const header = `<header class="doc-head block">
  <div class="doc-head-main">
    <div class="doc-trail">
      <span class="kind" data-kind="${meta.kind}">${KINDS[meta.kind] ?? ""}</span>
      <nav aria-label="Breadcrumb">
        <ol class="doc-crumbs">
          <li><a href="/docs.html">Docs</a></li>
          <li><a href="/docs.html#${shelf.id}">${shelf.name}</a></li>
          <li><span aria-current="page">${inline(meta.title)}</span></li>
        </ol>
      </nav>
    </div>
    <h1>${inline(meta.title)}</h1>
    <p class="doc-lead">${inline(meta.lead)}</p>
  </div>
  ${facts ? `<dl class="doc-facts">${facts}</dl>` : ""}
</header>`;

  const body = sectionsHtml(sections, where);

  const related = [].concat(meta.related ?? []);
  const relatedHtml = related.length
    ? `<nav class="doc-related block" aria-label="Related">
  <div class="shelf-label"><span class="label">Related</span></div>
  ${related
    .map((r) => {
      const d = describe(r, pages, where);
      return `<a class="related-link" href="${r}"><span class="kind" data-kind="${d.kind}">${KINDS[d.kind] ?? d.kind}</span>${d.title}</a>`;
    })
    .join("")}
</nav>`
    : "";

  const scripts = js.map((j) => `\n    <script src="${j}"></script>`).join("");
  const end = tail.replace(/(\n {2}<\/body>)/, `${scripts}$1`);
  return `${top}        <main id="main" class="group">
<!-- Written by scripts/gen-docs.mjs from docs/website/${page.rel}. Edit that file. -->
${header}
<div class="doc-layout">
${tocHtml(body)}
<div class="doc-flow">
${body}
</div>
</div>
${relatedHtml}
${end}`;
}

// The docs home's shelves, between <!-- gen:shelves --> markers.
function shelves(pages) {
  const links = pages
    .map((p) => ({
      shelf: p.meta.shelf,
      order: Number(p.meta.order ?? 99),
      href: p.href,
      title: p.meta.title,
      summary: p.meta.summary,
    }))
    .concat(EXTRA_LINKS);
  return SHELVES.map((s) => {
    const own = links
      .filter((l) => l.shelf === s.id)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    if (!own.length) return "";
    return `<section class="shelf block" id="${s.id}" aria-labelledby="${s.id}-title">
  <div class="shelf-label"><h2 class="label" id="${s.id}-title">${s.name}</h2></div>
  <div class="shelf-rows">
    <div class="shelf-grid">
      ${own
        .map(
          (l) =>
            `<a class="page-link" href="${l.href}" data-summary="${esc(l.summary)}">${esc(l.title)}</a>`,
        )
        .join("\n")}
    </div>
  </div>
</section>`;
  }).join("\n");
}

// ── Write or check ─────────────────────────────────────────────────────────

const pages = sources(SRC).map(parse);
if (only && !pages.some((p) => p.rel === only))
  fail(only, "no such page under docs/website/");
const frame = shell();
const outputs = [];
for (const page of pages) {
  if (only && page.rel !== only) continue;
  outputs.push([page.out, render(page, pages, frame)]);
}
if (only) {
  // Other pages may be half written: their problems are theirs.
  const own = `docs/website/${only}`;
  problems.splice(
    0,
    problems.length,
    ...problems.filter((p) => p.startsWith(own)),
  );
}
const hub = readFileSync(HUB, "utf8");
const START = "<!-- gen:shelves -->";
const STOP = "<!-- /gen:shelves -->";
if (only) {
  // The shelves wait for a full run.
} else if (!hub.includes(START) || !hub.includes(STOP)) {
  fail("website/docs.html", `no ${START} region`);
} else {
  const before = hub.slice(0, hub.indexOf(START) + START.length);
  const after = hub.slice(hub.indexOf(STOP));
  outputs.push([HUB, `${before}\n${shelves(pages)}\n${after}`]);
}

if (problems.length) {
  for (const p of problems) console.error(`gen-docs: ${p}`);
  process.exit(1);
}

let stale = 0;
for (const [file, html] of outputs) {
  const text = await format(file, html);
  const now = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (now === text) continue;
  stale++;
  if (check) console.error(`gen-docs: ${path.relative(ROOT, file)} is stale`);
  else writeFileSync(file, text);
}
if (check && stale) {
  console.error(
    "gen-docs: run `node scripts/gen-docs.mjs` and commit the result",
  );
  process.exit(1);
}
if (!check) console.log(`gen-docs: ${pages.length} pages, ${stale} written`);
