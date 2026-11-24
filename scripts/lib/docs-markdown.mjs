// The Markdown the website's docs are written in, rendered to the site's
// markup. gen-docs.mjs builds whole pages with it, and gen-block-docs.mjs the
// hand-written sections of the block pages. The syntax is in
// docs/website/README.md.

export const problems = []
export const fail = (where, msg) => problems.push(`${where}: ${msg}`)

export const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// ── Front matter ───────────────────────────────────────────────────────────
// key: value, or key: with indented "- item" lines (a list) or indented
// "Name: value" lines (an ordered map).

export function frontMatter(text, where) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) {
    fail(where, 'no front matter')
    return { meta: {}, body: text }
  }
  const meta = {}
  let open = null
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue
    const nested = line.match(/^\s+(?:- (.*)|([^:]+):\s*(.*))$/)
    if (nested && open) {
      if (nested[1] !== undefined) {
        if (!Array.isArray(meta[open])) meta[open] = []
        meta[open].push(nested[1].trim())
      } else {
        if (!meta[open] || Array.isArray(meta[open]) || typeof meta[open] !== 'object') {
          meta[open] = {}
        }
        meta[open][nested[2].trim()] = nested[3].trim()
      }
      continue
    }
    const top = line.match(/^([a-z]+):\s*(.*)$/)
    if (!top) {
      fail(where, `front matter line not understood: ${line}`)
      continue
    }
    open = top[1]
    meta[open] = top[2] === '' ? null : top[2].trim()
  }
  return { meta, body: text.slice(m[0].length) }
}

// ── Inline text ────────────────────────────────────────────────────────────
// **bold**, *em*, `code`, [text](href). Inline HTML passes through, so a page
// can use <kbd> or <br />; anything inside backticks is escaped.

export function inline(s) {
  const codes = []
  let out = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  out = out.replace(/&(?!(#\d+|#x[\da-f]+|[a-z]+);)/gi, '&amp;')
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const ext = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''
    return `<a href="${href}"${ext}>${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>')
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i])
}

// One sentence per line: lines of a paragraph join with a break.
const lines = (ls) => ls.map((l) => inline(l.trim())).join('<br />\n')

// ── Figures ────────────────────────────────────────────────────────────────
// Each fenced block with one of these languages is a picture drawn from text,
// placed beside the section's words. A leading * marks the part a step adds.

function marked(line) {
  const hit = line.startsWith('* ')
  return { hit, text: hit ? line.slice(2) : line }
}

function nodeHtml(text, extra = '') {
  const { hit, text: t } = marked(text.trim())
  const i = t.indexOf(': ')
  const kind = i === -1 ? t : t.slice(0, i)
  const value = i === -1 ? '' : t.slice(i + 2)
  const cls = ['fig-node', hit && 'is-hit', extra].filter(Boolean).join(' ')
  return {
    html:
      `<div class="${cls}"><span class="fig-kind">${inline(kind)}</span>` +
      (value ? `<span class="fig-value">${inline(value)}</span>` : '') +
      `</div>`,
    label: value ? `${kind} ${value}` : kind,
  }
}

// flow: a scheduler graph, top to bottom.
//   Kind: value        a block, and its setting
//   [port]             names the wire to the next block
//   <- Kind: value     a data block feeding the block above
//   -> [port] Kind: v  a branch from the last block, side by side
function flow(body, where) {
  const parts = []
  const said = []
  let port = ''
  const lanes = []
  for (const raw of body) {
    const line = raw.trim()
    if (!line) continue
    if (/^\[[^\]]+\]$/.test(line)) {
      port = line.slice(1, -1)
      continue
    }
    if (line.startsWith('<- ')) {
      const last = parts.at(-1)
      if (!last || last.type !== 'node') {
        fail(where, 'flow: a data feed must follow a block')
        continue
      }
      const n = nodeHtml(line.slice(3), 'is-data')
      last.feeds.push(n.html)
      said.push(`with ${n.label} as data`)
      continue
    }
    if (line.startsWith('-> ')) {
      const m = line.slice(3).match(/^\[([^\]]+)\]\s+(.*)$/)
      if (!m) {
        fail(where, `flow: a branch needs a [port]: ${line}`)
        continue
      }
      const n = nodeHtml(m[2])
      lanes.push(
        `<div class="fig-lane"><span class="fig-wire"><span class="fig-port">${esc(m[1])}</span></span>${n.html}</div>`,
      )
      said.push(`on ${m[1]}, ${n.label}`)
      continue
    }
    if (parts.length) parts.push({ type: 'wire', port })
    const n = nodeHtml(line)
    parts.push({ type: 'node', html: n.html, feeds: [] })
    said.push(port ? `then on ${port}, ${n.label}` : n.label)
    port = ''
  }
  if (!parts.length) fail(where, 'flow: no blocks')
  const html = parts
    .map((p) => {
      if (p.type === 'wire') {
        return `<span class="fig-wire">${p.port ? `<span class="fig-port">${esc(p.port)}</span>` : ''}</span>`
      }
      if (!p.feeds.length) return p.html
      const feeds = p.feeds
        .map((f) => `<span class="fig-wire fig-wire-data" aria-hidden="true"></span>${f}`)
        .join('')
      return `<div class="fig-row">${p.html}<div class="fig-feeds">${feeds}</div></div>`
    })
    .join('')
  const lanesHtml = lanes.length ? `<div class="fig-lanes">${lanes.join('')}</div>` : ''
  return figure('flow', html + lanesHtml, `Graph: ${said.join(', ')}.`)
}

// tree: folders and files by indentation, two spaces a level.
//   name/          a folder
//   name  # note   a note beside it
function tree(body, where) {
  const rows = body
    .filter((l) => l.trim())
    .map((l) => {
      const depth = (l.match(/^ */)[0].length / 2) | 0
      const [name, note] = l.trim().split(/\s+#\s+/)
      const { hit, text } = marked(name)
      return { depth, hit, text, note }
    })
  if (!rows.length) fail(where, 'tree: empty')
  const html = rows
    .map((r) => {
      const cls = ['fig-tree-row', r.hit && 'is-hit'].filter(Boolean).join(' ')
      const note = r.note ? `<span class="fig-tree-note">${inline(r.note)}</span>` : ''
      return `<li class="${cls}" style="--depth: ${r.depth}"><code>${esc(r.text)}</code>${note}</li>`
    })
    .join('')
  return figure('tree', `<ul class="fig-tree-list">${html}</ul>`, null)
}

// timeline: moments in order.
//   when: what happens
function timeline(body, where) {
  const rows = body
    .filter((l) => l.trim())
    .map((l) => {
      const { hit, text } = marked(l.trim())
      const i = text.indexOf(': ')
      if (i === -1) fail(where, `timeline: a line needs "when: what": ${l}`)
      return { hit, when: text.slice(0, i), what: text.slice(i + 2) }
    })
  const html = rows
    .map(
      (r) =>
        `<li class="${r.hit ? 'is-hit' : ''}"><span class="fig-when">${inline(r.when)}</span><span class="fig-what">${inline(r.what)}</span></li>`,
    )
    .join('')
  return figure('timeline', `<ol class="fig-timeline-list">${html}</ol>`, null)
}

// ui: a sketch of a panel in the app.
//   # Title          the panel's title bar
//   a | [b] | {c}    a row: text, a button, a field
//   [*b*] or {*c*}   the control the step uses
function ui(body, where) {
  let title = ''
  const said = []
  const rows = []
  for (const raw of body) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# ')) {
      title = line.slice(2)
      continue
    }
    const cells = line.split(/\s+\|\s+/).map((c) => {
      const m = c.match(/^([[{])(\*?)(.*?)\2([\]}])$/)
      if (!m) return `<span class="fig-ui-text">${inline(c)}</span>`
      const hit = m[2] === '*'
      if (hit) said.push(m[3])
      const kind = m[1] === '[' ? 'btn' : 'field'
      return `<span class="fig-ui-${kind}${hit ? ' is-hit' : ''}">${inline(m[3])}</span>`
    })
    rows.push(`<div class="fig-ui-row">${cells.join('')}</div>`)
  }
  if (!rows.length) fail(where, 'ui: no rows')
  const head = title ? `<div class="fig-ui-title">${inline(title)}</div>` : ''
  const label = `${title || 'Panel'}${said.length ? `, with ${said.join(' and ')} marked` : ''}.`
  return figure('ui', head + rows.join(''), label)
}

function figure(kind, inner, label) {
  const aria = label ? ` role="img" aria-label="${esc(label.replace(/`|\*\*/g, ''))}"` : ''
  return `<figure class="fig fig-${kind}"${aria}>${inner}</figure>`
}

const FIGURES = { flow, tree, timeline, ui }

// ── Blocks ─────────────────────────────────────────────────────────────────

const CALLOUTS = {
  NOTE: { tone: 'note', label: 'Note' },
  TIP: { tone: 'tip', label: 'Tip' },
  WARNING: { tone: 'warn', label: 'Heads up' },
}

function table(rows, where) {
  const cells = (r) =>
    r
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replaceAll('\\|', '|'))
  const [head, rule, ...body] = rows
  if (!rule || !/^\|?\s*:?-+/.test(rule)) fail(where, 'table: second row must be |---|')
  const th = cells(head)
    .map((c) => `<th scope="col">${inline(c)}</th>`)
    .join('')
  const tr = body
    .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="doc-table-wrap"><table class="doc-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`
}

// A list item and its indented continuation lines.
function items(ls, marker) {
  const out = []
  for (const l of ls) {
    const m = l.match(marker)
    if (m) out.push([l.slice(m[0].length)])
    else out.at(-1).push(l.trim())
  }
  return out
}

// Splits a section's lines into blocks, and renders each.
function blocks(ls, where) {
  const main = []
  const figs = []
  const faq = []
  const flushFaq = () => {
    if (faq.length) main.push(`<div class="doc-faq">${faq.splice(0).join('')}</div>`)
  }
  let i = 0
  const take = (pred) => {
    const got = []
    while (i < ls.length && pred(ls[i])) got.push(ls[i++])
    return got
  }
  while (i < ls.length) {
    const line = ls[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.startsWith('### ') && !line.trimEnd().endsWith('?')) {
      flushFaq()
      main.push(`<h3 class="doc-sub">${inline(line.slice(4))}</h3>`)
      i++
      continue
    }
    if (line.startsWith('### ')) {
      // A question and its answer, up to the next heading.
      const q = line.slice(4)
      i++
      const answer = take((l) => !l.startsWith('### '))
      const inner = blocks(answer, `${where} ${q}`)
      faq.push(`<details><summary>${inline(q)}</summary>${inner.main}</details>`)
      continue
    }
    flushFaq()
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      i++
      const body = take((l) => !/^```\s*$/.test(l))
      i++
      const draw = FIGURES[fence[1]]
      if (draw) figs.push(draw(body, where))
      else main.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    if (line.startsWith('<')) {
      const html = take((l) => l.trim() !== '').join('\n')
      if (/^<figure\b/.test(html)) figs.push(html)
      else main.push(html)
      continue
    }
    if (line.startsWith('>')) {
      const quote = take((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''))
      const m = quote[0].match(/^\[!(\w+)\]\s*$/)
      const c = m && CALLOUTS[m[1]]
      if (!c) {
        fail(where, `a quote must start with [!NOTE], [!TIP] or [!WARNING]: ${quote[0]}`)
        continue
      }
      main.push(
        `<div class="doc-note" data-tone="${c.tone}"><span class="label">${c.label}</span><p>${lines(quote.slice(1).filter((l) => l.trim()))}</p></div>`,
      )
      continue
    }
    if (line.startsWith('|')) {
      main.push(table(take((l) => l.startsWith('|')), where))
      continue
    }
    if (line.startsWith('- [ ] ')) {
      const list = items(
        take((l) => l.startsWith('- [ ] ') || /^\s{2,}\S/.test(l)),
        /^- \[ \] /,
      )
      const lis = list.map(([title, ...desc]) => {
        const d = desc.length ? `<span class="doc-check-desc">${lines(desc)}</span>` : ''
        return `<li class="doc-check"><span class="doc-check-text"><span>${inline(title)}</span>${d}</span></li>`
      })
      main.push(`<ul class="doc-checks">${lis.join('')}</ul>`)
      continue
    }
    if (/^\d+\. /.test(line)) {
      const list = items(
        take((l) => /^\d+\. /.test(l) || /^\s{2,}\S/.test(l)),
        /^\d+\. /,
      )
      main.push(`<ol class="doc-steps">${list.map((it) => `<li>${lines(it)}</li>`).join('')}</ol>`)
      continue
    }
    if (line.startsWith('- ')) {
      const list = items(
        take((l) => l.startsWith('- ') || /^\s{2,}\S/.test(l)),
        /^- /,
      )
      main.push(`<ul class="doc-points">${list.map((it) => `<li>${lines(it)}</li>`).join('')}</ul>`)
      continue
    }
    if (/^#{1,2} /.test(line)) {
      fail(where, `a heading inside a section: ${line}`)
      i++
      continue
    }
    const para = take(
      (l) => l.trim() !== '' && !/^(```|<|>|\||- |\d+\. |#)/.test(l),
    )
    main.push(`<p class="doc-prose">${lines(para)}</p>`)
  }
  flushFaq()
  return { main: main.join('\n'), figs }
}

// ── Sections ───────────────────────────────────────────────────────────────

// A body's "## Heading {#id}" sections, each with its lines.
export function parseSections(body, where) {
  const sections = []
  let current = null
  for (const line of body.split('\n')) {
    const h = line.match(/^## (.*?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/)
    if (h) {
      current = { title: h[1], id: h[2] || slugify(h[1]), lines: [] }
      sections.push(current)
    } else if (current) current.lines.push(line)
    else if (line.trim()) fail(where, `text before the first section: ${line}`)
  }
  if (!sections.length) fail(where, 'no sections')
  const ids = new Set()
  for (const s of sections) {
    if (ids.has(s.id)) fail(where, `two sections with id ${s.id}`)
    ids.add(s.id)
  }
  return sections
}

// The sections as the page's numbered blocks, counting on from `after`. A
// section headed "Before you start" is 00.
export function sectionsHtml(sections, where, after = 0) {
  let n = after
  return sections
    .map((s) => {
      const num = s.id === 'before-you-start' ? 0 : ++n
      const { main, figs } = blocks(s.lines, `${where}#${s.id}`)
      if (!main) fail(where, `section ${s.id} has no text`)
      const inner = figs.length
        ? `<div class="doc-body doc-split"><div class="doc-main">${main}</div><div class="doc-figs">${figs.join('')}</div></div>`
        : `<div class="doc-body">${main}</div>`
      return `<section class="doc-section block" id="${s.id}" aria-labelledby="${s.id}-title">
  <div class="band doc-band">
    <div class="band-title">
      <span class="num">${String(num).padStart(2, '0')}</span>
      <h2 id="${s.id}-title">${inline(s.title)}</h2>
    </div>
  </div>
  ${inner}
</section>`
    })
    .join('\n')
}
