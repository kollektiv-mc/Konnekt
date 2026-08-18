// Resolves website/'s own internal links and assets against the files on disk.
//
// website/ ships to Cloudflare Pages, which watches this branch and is
// configured outside this repo, so there is no deploy step to hang a check off.
// It also has no build step, no package.json and no bundler, which means a
// renamed image or a retitled section is otherwise only found by loading the
// page. This is that check, with no dependency to install: the site's own HTML,
// CSS and sitemap, resolved against the tree.
//
// What it checks:
//   1. Every internal href/src (and the og:/twitter: meta URLs) resolves to a file
//   2. Every #fragment resolves to an id on the page it points at
//   3. Every CSS url() resolves, relative to the stylesheet
//   4. sitemap.xml both ways: every <loc> resolves, and every page is listed
//   5. Every page links the stylesheets in REQUIRED_STYLESHEETS
//
// What it deliberately does NOT check:
//   - Anything a .js file builds at runtime. No JS is parsed at all, which is
//     what makes rule 1 safe: markdown.js concatenates '<a href="' + href + '"',
//     and download.js assembles release asset URLs from the GitHub API. A
//     JS-aware pass would have to guess which fragments compose into a URL and
//     would be wrong in both directions, so it does not look.
//   - External URLs. Fetching makes a flaky CI job, and a dead third-party link
//     is not a reason to fail a build.
//   - Unreferenced assets, duplicate ids, orphan pages, whether an image is the
//     *right* image, or whether a page renders.
//
// Regex rather than a DOM parser is forced by the zero-dependency rule, and is
// defensible here: the input is this repo's own hand-written HTML, Prettier now
// normalises it, and comments and <script> bodies are stripped before scanning.
// A regex miss leaves a link unchecked; it does not invent a failure.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const SITE = path.join(import.meta.dirname, '..', 'website')
const ORIGIN = 'https://konnekt.pages.dev'
const REQUIRED_STYLESHEETS = ['/tokens.css', '/styles.css']
const URL_META = new Set(['og:image', 'og:url', 'twitter:image'])

// A check that could not run is a failure to report, not a silent pass — the
// same rule scripts/coverage-floor and .claude/suite-check.py hold themselves to.
if (!existsSync(SITE)) {
  console.error(`check-website-links: no website/ at ${SITE}`)
  process.exit(1)
}

const problems = []
const fail = (file, message) => problems.push({ file, message })

const strip = (html) =>
  html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')

const pages = readdirSync(SITE)
  .filter((f) => f.endsWith('.html'))
  .sort()

const raw = new Map(pages.map((p) => [p, readFileSync(path.join(SITE, p), 'utf8')]))
const clean = new Map(pages.map((p) => [p, strip(raw.get(p))]))
const ids = new Map(
  pages.map((p) => [p, new Set([...clean.get(p).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))]),
)

// Resolve one reference to a repo-relative path, or to a reason it is not ours
// to check. Returns { skip } for anything external, { file, fragment } otherwise.
function resolve(value, fromFile) {
  let v = value.trim()
  if (v.startsWith(ORIGIN)) v = v.slice(ORIGIN.length) || '/'
  if (v === '' || v.startsWith('//')) return { skip: true }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return { skip: true }

  const hash = v.indexOf('#')
  const fragment = hash === -1 ? null : v.slice(hash + 1)
  if (hash !== -1) v = v.slice(0, hash)
  v = v.split('?')[0]

  if (v === '') return { fragment, file: fromFile } // same-page #anchor
  let rel = v.startsWith('/') ? v.slice(1) : path.posix.join(path.posix.dirname(fromFile), v)
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'

  // Pages serves a directory as its index.html; mirror that.
  const abs = path.join(SITE, rel)
  if (existsSync(abs) && statSync(abs).isDirectory()) rel = path.posix.join(rel, 'index.html')
  return { fragment, file: rel }
}

function checkRef(value, fromFile, what) {
  const r = resolve(value, fromFile)
  if (r.skip) return
  if (!existsSync(path.join(SITE, r.file))) {
    fail(fromFile, `${what} "${value}" -> ${r.file} does not exist`)
    return
  }
  if (r.fragment) {
    const target = ids.get(r.file)
    if (!target) return // a fragment into a non-HTML file has nothing to resolve against
    if (!target.has(r.fragment)) fail(fromFile, `${what} "${value}" -> no id="${r.fragment}"`)
  }
}

// 1 + 2 + 5 — HTML references, fragments, required stylesheets.
let refCount = 0
for (const page of pages) {
  const body = clean.get(page)

  for (const [, attr, value] of body.matchAll(/\b(href|src)="([^"]*)"/g)) {
    refCount++
    checkRef(value, page, attr)
  }

  // Two-pass, so attribute order inside the tag does not matter.
  for (const [tag] of body.matchAll(/<meta\b[^>]*>/g)) {
    const key = (tag.match(/\b(?:property|name)="([^"]+)"/) || [])[1]
    const content = (tag.match(/\bcontent="([^"]*)"/) || [])[1]
    if (key && content && URL_META.has(key)) {
      refCount++
      checkRef(content, page, key)
    }
  }

  const sheets = [...body.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(
    (m) => (m[0].match(/\bhref="([^"]*)"/) || [])[1],
  )
  for (const required of REQUIRED_STYLESHEETS) {
    if (!sheets.includes(required)) fail(page, `does not link ${required}`)
  }
}

// 3 — CSS url() references, resolved against the stylesheet that holds them.
let assetCount = 0
for (const sheet of readdirSync(SITE).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(path.join(SITE, sheet), 'utf8')
  for (const [, value] of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    if (value.startsWith('data:')) continue
    assetCount++
    checkRef(value, sheet, 'url()')
  }
}

// 4 — sitemap.xml, both directions.
const sitemapPath = path.join(SITE, 'sitemap.xml')
if (!existsSync(sitemapPath)) {
  fail('sitemap.xml', 'missing')
} else {
  const xml = readFileSync(sitemapPath, 'utf8')
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  if (locs.length === 0) fail('sitemap.xml', 'declares no <loc> entries')

  const listed = new Set()
  for (const loc of locs) {
    if (!loc.startsWith(ORIGIN)) {
      fail('sitemap.xml', `<loc> "${loc}" is not under ${ORIGIN}`)
      continue
    }
    const r = resolve(loc, 'index.html')
    if (!existsSync(path.join(SITE, r.file))) {
      fail('sitemap.xml', `<loc> "${loc}" -> ${r.file} does not exist`)
      continue
    }
    listed.add(r.file)
  }

  // The reverse direction is the valuable half: it catches a new page that
  // shipped without anyone touching sitemap.xml. A page opts out by saying so
  // itself, so the exemption cannot go stale the way a hardcoded list would.
  for (const page of pages) {
    if (listed.has(page)) continue
    const noindex = /<meta\b[^>]*\bname="robots"[^>]*\bcontent="[^"]*noindex/i.test(raw.get(page))
    if (!noindex) {
      fail(
        'sitemap.xml',
        `${page} is not listed, and does not declare <meta name="robots" ... noindex>`,
      )
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✖ check-website-links: ${problems.length} problem(s) in website/\n`)
  for (const { file, message } of problems) console.error(`  ${file}: ${message}`)
  console.error('')
  process.exit(1)
}

console.log(
  `✓ website/: ${pages.length} pages, ${refCount} internal references, ${assetCount} CSS assets, ` +
    `sitemap in sync — all resolve.`,
)
