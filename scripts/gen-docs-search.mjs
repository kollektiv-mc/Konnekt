// The docs search index, website/docs/search.json, read by website/docs.js.
//
// The site has no build step, so the search cannot read the pages themselves
// without fetching every one of them on the first keystroke. This writes each
// docs page's title, kind and lead, and the heading and text of each of its
// sections, into one file the search fetches once. The text is the page's own,
// tags stripped, so a page edited without this run is a stale index, which
// --check in CI's website job turns red.
//
// Run it after gen-block-docs.mjs, whose block pages it reads. Output goes
// through the frontend's Prettier with the site's own config; run
// `pnpm install` in frontend/ first.
//
//   node scripts/gen-docs-search.mjs          rewrite
//   node scripts/gen-docs-search.mjs --check  fail if the index is stale
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");
const DOCS = path.join(ROOT, "website/docs");
const OUT = path.join(DOCS, "search.json");

const check = process.argv.includes("--check");

const PRETTIER = path.join(ROOT, "frontend/node_modules/prettier/index.mjs");
if (!existsSync(PRETTIER)) {
  console.error(
    "gen-docs-search: run `pnpm install` in frontend/ first, for Prettier",
  );
  process.exit(1);
}
const prettier = await import(pathToFileURL(PRETTIER).href);

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function text(html) {
  return html
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, " ")
    .replace(
      /<br\s*\/?>|<\/(p|div|li|td|th|tr|dt|dd|summary|h\d)>|<\/span>(?=<span)/g,
      " ",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      return String.fromCodePoint(
        e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    })
    .replace(/\s+/g, " ")
    .trim();
}

// A page is its doc-head (kind, h1, lead) and its doc-sections, each with an
// id the result links to and one h2. Anything else on the page, such as the
// block index's shelves or the Related links, is navigation and left out.
function page(html, url) {
  const head =
    html.match(/<header class="doc-head[\s\S]*?<\/header>/)?.[0] ?? "";
  const title = text(head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  if (!title)
    throw new Error(`gen-docs-search: ${url} has no h1 in its doc-head`);
  const sections = [];
  for (const [, attrs, body] of html.matchAll(
    /<section\b([^>]*)>([\s\S]*?)<\/section>/g,
  )) {
    if (!/\bclass="doc-section\b/.test(attrs)) continue;
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    if (!id)
      throw new Error(`gen-docs-search: ${url} has a doc-section with no id`);
    const heading = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!heading) throw new Error(`gen-docs-search: ${url}#${id} has no h2`);
    sections.push({
      id,
      title: text(heading[1]),
      // The port legend is the same on every block page, so it would make a
      // word such as "string" find all of them.
      text: text(
        body
          .replace(heading[0], "")
          .replace(/<span class="num">[^<]*<\/span>/, "")
          .replace(/<div class="port-legend">[\s\S]*?<\/div>/, ""),
      ),
    });
  }
  // The section pattern above is the parser's one guess about the markup. A
  // section it fails to match, or one whose text strips to nothing, is a page
  // the search silently cannot reach.
  const marked =
    html.match(/<section\b[^>]*\bclass="doc-section\b/g)?.length ?? 0;
  if (marked !== sections.length) {
    throw new Error(
      `gen-docs-search: ${url} has ${marked} doc-sections, read ${sections.length}`,
    );
  }
  for (const s of sections) {
    if (!s.text) throw new Error(`gen-docs-search: ${url}#${s.id} has no text`);
  }
  return {
    url,
    title,
    kind: head.match(/data-kind="([^"]+)"/)?.[1] ?? "",
    lead: text(head.match(/<p class="doc-lead">([\s\S]*?)<\/p>/)?.[1] ?? ""),
    sections,
  };
}

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) return pages(file);
      if (!e.name.endsWith(".html")) return [];
      const rel = path.relative(DOCS, file).split(path.sep).join("/");
      return [
        page(
          readFileSync(file, "utf8"),
          "/docs/" + rel.replace(/(^|\/)index\.html$/, "$1"),
        ),
      ];
    });
}

const index = pages(DOCS);
const out = await prettier.format(JSON.stringify(index), {
  ...(await prettier.resolveConfig(OUT)),
  filepath: OUT,
});
const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
if (out === current) {
  console.log(`✓ gen-docs-search: ${index.length} pages in the index`);
} else if (check) {
  console.error(
    "✖ gen-docs-search: website/docs/search.json is stale; run node scripts/gen-docs-search.mjs",
  );
  process.exit(1);
} else {
  writeFileSync(OUT, out);
  console.log(
    `gen-docs-search: wrote website/docs/search.json, ${index.length} pages`,
  );
}
