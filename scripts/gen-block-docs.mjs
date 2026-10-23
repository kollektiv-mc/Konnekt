// The scheduler block pages under website/docs/blocks/, kept in step with the
// block registry.
//
// The app opens https://konnekt.pages.dev/docs/blocks/<type> on F1
// (frontend/src/lib/docs.ts), so every registered block needs a page, and a
// page's ports and fields have to be the ones the editor shows. Written by
// hand, those tables would be wrong the first time a default moved, and
// nothing would say so. So each page carries two regions this script owns,
// and the rest of the page is written by hand:
//
//   <!-- gen:ports -->   the port diagram, from the block's ports
//   <!-- gen:fields -->  the fields table: label, default and a select's
//                        choices from the registry; the "What it does" and
//                        "Limits" cells are kept from the page as written
//
// It also writes ports.css (the editor's port colours, read from blockMeta.ts),
// the index's list of blocks, and each page's description meta from its lead.
// A block with no page gets one scaffolded, with <!-- write: --> markers where
// the hand-written parts go.
//
// The registry is read from demo/backend/fixtures/blockdefs.json, which
// demo.yml holds to `go run ./demo/tools/dump-blockdefs`, so this needs no Go.
// Output goes through the frontend's Prettier with the site's own config, so
// what this writes is what `pnpm format:website` expects; run
// `pnpm install` in frontend/ first.
//
//   node scripts/gen-block-docs.mjs          rewrite
//   node scripts/gen-block-docs.mjs --check  fail on anything stale or unwritten
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.join(import.meta.dirname, '..')
const SITE = path.join(ROOT, 'website')
const DIR = path.join(SITE, 'docs/blocks')
const DEFS = path.join(ROOT, 'demo/backend/fixtures/blockdefs.json')
const META = path.join(ROOT, 'frontend/src/tiles/scheduler/editor/blockMeta.ts')
const SHELL = path.join(SITE, 'docs/requirements.html')
const ORIGIN = 'https://konnekt.pages.dev'

const check = process.argv.includes('--check')

const PRETTIER = path.join(ROOT, 'frontend/node_modules/prettier/index.mjs')
if (!existsSync(PRETTIER)) {
  console.error('gen-block-docs: run `pnpm install` in frontend/ first, for Prettier')
  process.exit(1)
}
const prettier = await import(pathToFileURL(PRETTIER).href)
const format = async (file, text) =>
  prettier.format(text, { ...(await prettier.resolveConfig(file)), filepath: file })
const problems = []

const defs = JSON.parse(readFileSync(DEFS, 'utf8'))
const slug = (id) => id.replaceAll('.', '-')

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

// ── The editor's palette ────────────────────────────────────────────────────

const metaSrc = readFileSync(META, 'utf8')

function record(name) {
  const m = metaSrc.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`gen-block-docs: ${name} not found in blockMeta.ts`)
  return Object.fromEntries(
    [...m[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map(([, key, value]) => [key, value]),
  )
}

function constant(name) {
  const m = metaSrc.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`))
  if (!m) throw new Error(`gen-block-docs: ${name} not found in blockMeta.ts`)
  return m[1]
}

const CATEGORY_ORDER = [...metaSrc.match(/CATEGORY_ORDER = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map(
  (m) => m[1],
)
const CATEGORY_COLOR = record('CATEGORY_COLOR')
const CTRL_PORT_COLOR = record('CTRL_PORT_COLOR')
const PORT_TYPE_COLOR = record('PORT_TYPE_COLOR')
const CTRL_FALLBACK_IN = constant('CTRL_PORT_FALLBACK_IN')
const UNRESOLVED = constant('PALETTE_FALLBACK')

const CATEGORY_NAME = {
  trigger: 'Trigger',
  data: 'Data',
  action: 'Action',
  control: 'Control',
  notify: 'Notify',
}
const categoryName = (c) => CATEGORY_NAME[c] ?? c[0].toUpperCase() + c.slice(1)

function portsCss() {
  const rules = [
    '/* GENERATED FILE, DO NOT EDIT.',
    ' *',
    ' * The scheduler editor\'s colours, written by scripts/gen-block-docs.mjs from',
    ' * frontend/src/tiles/scheduler/editor/blockMeta.ts. Like the editor\'s, they are',
    ' * the graph\'s own and not design tokens. */',
    '',
  ]
  for (const [cat, color] of Object.entries(CATEGORY_COLOR)) {
    rules.push(`[data-category='${cat}'] {\n  --category-color: ${color};\n}\n`)
  }
  rules.push(`[data-shape='control'] {\n  --port-color: ${CTRL_FALLBACK_IN};\n}\n`)
  for (const [port, color] of Object.entries(CTRL_PORT_COLOR)) {
    rules.push(`[data-shape='control'][data-port='${port}'] {\n  --port-color: ${color};\n}\n`)
  }
  rules.push(`[data-shape='data'] {\n  --port-color: ${UNRESOLVED};\n}\n`)
  for (const [type, color] of Object.entries(PORT_TYPE_COLOR)) {
    rules.push(`[data-shape='data'][data-type='${type}'] {\n  --port-color: ${color};\n}\n`)
  }
  return rules.join('\n').replace(/\n+$/, '\n')
}

// ── Regions ─────────────────────────────────────────────────────────────────

function region(html, name) {
  const m = html.match(new RegExp(`( *)<!-- gen:${name} -->([\\s\\S]*?)<!-- /gen:${name} -->`))
  return m ? { indent: m[1], body: m[2], whole: m[0] } : null
}

function replaceRegion(html, name, body) {
  const r = region(html, name)
  if (!r) throw new Error(`no gen:${name} region`)
  const indented = body
    .split('\n')
    .map((line) => (line ? r.indent + line : line))
    .join('\n')
  return html.replace(
    r.whole,
    () => `${r.indent}<!-- gen:${name} -->\n${indented}\n${r.indent}<!-- /gen:${name} -->`,
  )
}

// ── Ports ───────────────────────────────────────────────────────────────────

function portItem(p) {
  return p.shape === 'control'
    ? `<li class="port" data-shape="control" data-port="${esc(p.id)}"><span>${esc(p.id)}</span><span class="port-type">control</span></li>`
    : `<li class="port" data-shape="data" data-type="${esc(p.type)}"><span>${esc(p.label)}</span><span class="port-type">${esc(p.type)}</span></li>`
}

function portColumn(side, ports) {
  const items = ports.length
    ? ports.map(portItem)
    : ['<li class="port-none">None</li>']
  return [
    `<ul class="port-col port-${side}" aria-label="${side === 'in' ? 'Inputs' : 'Outputs'}">`,
    `  <li class="port-col-label" aria-hidden="true">${side}</li>`,
    ...items.map((i) => `  ${i}`),
    '</ul>',
  ].join('\n')
}

function portsSection(def) {
  const ins = [
    ...(def.controlInputs ?? []).map((id) => ({ shape: 'control', id })),
    ...(def.dataInputs ?? []).map((p) => ({ shape: 'data', ...p })),
  ]
  const outs = [
    ...(def.controlOutputs ?? []).map((id) => ({ shape: 'control', id })),
    ...(def.dataOutputs ?? []).map((p) => ({ shape: 'data', ...p })),
  ]
  const types = Object.keys(PORT_TYPE_COLOR)
  return `<section class="doc-section block" id="ports" aria-labelledby="ports-title">
  <div class="band doc-band">
    <div class="band-title">
      <span class="num">01</span>
      <h2 id="ports-title">Ports</h2>
    </div>
  </div>
  <div class="port-stage">
    <div class="port-canvas">
      <div class="port-node" data-category="${esc(def.category)}">
        <div class="port-node-head">
          <span>${esc(def.label)}</span><span class="port-node-cat">${esc(def.category)}</span>
        </div>
        <div class="port-cols">
${indent(portColumn('in', ins), 10)}
${indent(portColumn('out', outs), 10)}
        </div>
      </div>
    </div>
    <div class="port-legend">
      <span class="label">Ports</span>
      <span class="port-key" data-shape="control">Control</span>
      <span class="port-key" data-shape="data">Data</span>
      <hr />
      <span class="label">Data types</span>
${types.map((t) => `      <span class="port-key" data-shape="data" data-type="${t}"><code>${t}</code></span>`).join('\n')}
      <p class="doc-prose">
        Strings accept any data input.<br />
        Numbers accept boolean input.
      </p>
    </div>
  </div>
</section>`
}

const indent = (text, n) =>
  text
    .split('\n')
    .map((l) => (l ? ' '.repeat(n) + l : l))
    .join('\n')

// ── Fields ──────────────────────────────────────────────────────────────────

const CHOICE_TYPES = new Set(['select', 'command', 'attribute'])

function defaultCell(field) {
  const d = field.default
  if (d === undefined || d === null || d === '') return 'None'
  if (typeof d === 'boolean') return d ? 'On' : 'Off'
  const option = (field.options ?? []).find((o) => o.value === d)
  return `<code>${esc(option ? option.label : d)}</code>`
}

// The hand-written cells of an existing table, by field key.
function writtenCells(html) {
  const cells = new Map()
  const r = region(html, 'fields')
  if (!r) return cells
  for (const [, key, row] of r.body.matchAll(/<tr data-field="([^"]+)">([\s\S]*?)<\/tr>/g)) {
    const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim())
    cells.set(key, { does: tds[1] ?? '', limits: tds[3] ?? '' })
  }
  return cells
}

function limitsCell(field, written) {
  if (CHOICE_TYPES.has(field.type) && field.options?.length) {
    const items = field.options.map((o) => `<li><code>${esc(o.label)}</code></li>`).join('')
    return `<ul class="field-options">${items}</ul>`
  }
  return written
}

function fieldsSection(def, cells) {
  const fields = def.configSchema ?? []
  if (fields.length === 0) {
    return `<section class="doc-section block" id="fields" aria-labelledby="fields-title">
  <div class="band doc-band">
    <div class="band-title">
      <span class="num">02</span>
      <h2 id="fields-title">Fields</h2>
    </div>
  </div>
  <div class="doc-body">
    <p class="doc-prose">None.</p>
  </div>
</section>`
  }
  const rows = fields.map((f) => {
    const c = cells.get(f.key) ?? { does: '', limits: '' }
    return `<tr data-field="${esc(f.key)}">
  <td>${esc(f.label)}</td>
  <td>${c.does}</td>
  <td>${defaultCell(f)}</td>
  <td>${limitsCell(f, c.limits)}</td>
</tr>`
  })
  return `<section class="doc-section block" id="fields" aria-labelledby="fields-title">
  <div class="band doc-band">
    <div class="band-title">
      <span class="num">02</span>
      <h2 id="fields-title">Fields</h2>
    </div>
  </div>
  <div class="doc-body">
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">What it does</th>
            <th scope="col">Default</th>
            <th scope="col">Limits</th>
          </tr>
        </thead>
        <tbody>
${indent(rows.join('\n'), 10)}
        </tbody>
      </table>
    </div>
  </div>
</section>`
}

// ── Page shell, for a block with no page yet ───────────────────────────────

function shell() {
  const html = readFileSync(SHELL, 'utf8')
  const head = html.slice(0, html.indexOf('        <main id="main"'))
  const tail = html.slice(html.indexOf('        </main>'))
  return { head, tail: tail.replace(/\n {4}<script src="\/docs\/[^"]+"><\/script>/, '') }
}

function scaffold(def) {
  const { head, tail } = shell()
  const url = `${ORIGIN}/docs/blocks/${slug(def.id)}.html`
  const title = `Konnekt docs: ${def.label} block`
  const top = head
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replaceAll(
      /(property="og:title"|name="twitter:title") content="[^"]*"/g,
      (_, attr) => `${attr} content="${esc(title)}"`,
    )
    .replace(/rel="canonical" href="[^"]*"/, `rel="canonical" href="${url}"`)
    .replace(/property="og:url" content="[^"]*"/, `property="og:url" content="${url}"`)
    .replace(
      '    <link rel="stylesheet" href="/docs.css" />',
      '    <link rel="stylesheet" href="/docs.css" />\n    <link rel="stylesheet" href="/docs/blocks/blocks.css" />\n    <link rel="stylesheet" href="/docs/blocks/ports.css" />',
    )
  const main = `        <main id="main" class="group">
          <header class="doc-head block">
            <div class="doc-head-main">
              <div class="doc-trail">
                <span class="kind" data-kind="reference">Reference</span>
                <nav aria-label="Breadcrumb">
                  <ol class="doc-crumbs">
                    <li><a href="/docs.html">Docs</a></li>
                    <li><a href="/docs.html#scheduler">Scheduler</a></li>
                    <li><a href="/docs/blocks/">Scheduler blocks</a></li>
                    <li><span aria-current="page">${esc(def.label)}</span></li>
                  </ol>
                </nav>
              </div>
              <h1>${esc(def.label)}</h1>
              <p class="doc-lead"><!-- write: one sentence, what the block does --></p>
            </div>
            <dl class="doc-facts">
              <div class="doc-fact">
                <dt class="label">Category</dt>
                <dd>${esc(categoryName(def.category))}</dd>
              </div>
              <div class="doc-fact">
                <dt class="label">Topics</dt>
                <dd>Scheduler</dd>
              </div>
            </dl>
          </header>

          <!-- gen:ports -->
          <!-- /gen:ports -->

          <!-- gen:fields -->
          <!-- /gen:fields -->

          <section class="doc-section block" id="run" aria-labelledby="run-title">
            <div class="band doc-band">
              <div class="band-title">
                <span class="num">03</span>
                <h2 id="run-title">What a run does</h2>
              </div>
            </div>
            <div class="doc-body">
              <!-- write: what happens when the block runs, and which port it leaves by -->
            </div>
          </section>

          <section class="doc-section block" id="errors" aria-labelledby="errors-title">
            <div class="band doc-band">
              <div class="band-title">
                <span class="num">04</span>
                <h2 id="errors-title">Errors</h2>
              </div>
            </div>
            <div class="doc-body">
              <!-- write: a Message says / Do table of the errors this block returns -->
            </div>
          </section>

          <nav class="doc-related block" aria-label="Related">
            <div class="shelf-label"><span class="label">Related</span></div>
            <!-- write: related-link entries -->
          </nav>
`
  return top + main + tail
}

// ── The index's list ────────────────────────────────────────────────────────

// A lead's words without its markup. The text is escaped again wherever it is
// written; stripping until nothing changes, then dropping any stray angle
// bracket, keeps a tag split by an earlier pass from surviving as one.
const leadOf = (html) => {
  const m = html.match(/<p class="doc-lead">([\s\S]*?)<\/p>/)
  if (!m) return ''
  let text = m[1]
  let prev
  do {
    prev = text
    text = text.replace(/<[^<>]*>/g, '')
  } while (text !== prev)
  return text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

function indexList(pages) {
  const cats = [
    ...CATEGORY_ORDER.filter((c) => defs.some((d) => d.category === c)),
    ...[...new Set(defs.map((d) => d.category))].filter((c) => !CATEGORY_ORDER.includes(c)),
  ]
  return cats
    .map((cat) => {
      // Ungrouped first, then each palette group together, as the palette shows them.
      const inCat = defs.filter((d) => d.category === cat)
      const ordered = [...inCat.filter((d) => !d.group), ...inCat.filter((d) => d.group)]
      const links = ordered.map(
        (d) => `<a class="page-link" href="/docs/blocks/${slug(d.id)}.html"
  ><span class="page-link-move"
    ><span class="page-link-title">${esc(d.label)}</span
    ><span class="page-link-sum">${esc(pages.get(d.id) ?? '')}</span></span
  ></a
>`,
      )
      return `<section class="shelf block" id="${cat}" aria-labelledby="${cat}-title">
  <div class="shelf-label"><h2 class="label" id="${cat}-title">${esc(categoryName(cat))}</h2></div>
  <div class="shelf-rows">
    <div class="shelf-grid">
${indent(links.join('\n'), 6)}
    </div>
  </div>
</section>`
    })
    .join('\n')
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function emit(file, text) {
  const next = await format(file, text)
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (prev === next) return
  const rel = path.relative(ROOT, file)
  if (check) problems.push(`${rel} is stale; run node scripts/gen-block-docs.mjs`)
  else {
    writeFileSync(file, next)
    console.log(`gen-block-docs: wrote ${rel}`)
  }
}

await emit(path.join(DIR, 'ports.css'), portsCss())

const known = new Set(defs.map((d) => slug(d.id)))
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.html') && f !== 'index.html')) {
  if (!known.has(f.slice(0, -5))) problems.push(`website/docs/blocks/${f} names no registered block`)
}

const leads = new Map()
for (const def of defs) {
  const file = path.join(DIR, `${slug(def.id)}.html`)
  let html = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (html === null && check) {
    problems.push(`${def.id} has no page; run node scripts/gen-block-docs.mjs`)
    continue
  }
  html ??= scaffold(def)

  const cells = writtenCells(html)
  html = replaceRegion(html, 'ports', portsSection(def))
  html = replaceRegion(html, 'fields', fieldsSection(def, cells))

  const lead = leadOf(html)
  leads.set(def.id, lead)
  if (lead) {
    const description = esc(`${def.label}: ${lead}`)
    html = html.replaceAll(
      /(name="description"|property="og:description"|name="twitter:description") content="[^"]*"/g,
      (_, attr) => `${attr} content="${description}"`,
    )
  }

  const rel = `website/docs/blocks/${slug(def.id)}.html`
  if (html.includes('<!-- write:')) problems.push(`${rel} has unwritten parts (<!-- write: -->)`)
  for (const f of def.configSchema ?? []) {
    if (!(cells.get(f.key)?.does ?? '')) problems.push(`${rel}: field "${f.key}" has no What it does`)
  }
  await emit(file, html)
}

const indexFile = path.join(DIR, 'index.html')
if (existsSync(indexFile)) {
  await emit(indexFile, replaceRegion(readFileSync(indexFile, 'utf8'), 'index', indexList(leads)))
} else {
  problems.push('website/docs/blocks/index.html is missing')
}

if (problems.length) {
  console.error(`\n✖ gen-block-docs: ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('')
  // Writing leaves unwritten pages behind on purpose; only --check fails on them.
  if (check) process.exit(1)
} else {
  console.log(`✓ gen-block-docs: ${defs.length} block pages in step with the registry`)
}
