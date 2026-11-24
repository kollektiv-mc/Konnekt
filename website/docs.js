/* Docs search, on the docs home and the block index. It reads every docs page
   from /docs/search.json (scripts/gen-docs-search.mjs) and lists the pages and
   sections that hold every word typed, each linking to its section. While it
   lists them, the page's shelves step aside. The input's data-scope keeps it
   to the pages under that path.
   With this file missing the page is a plain list of links. */
;(function () {
  var input = document.getElementById('doc-search')
  var results = document.getElementById('doc-results')
  var empty = document.getElementById('doc-empty')
  if (!input || !results || !empty) return

  var scope = input.getAttribute('data-scope') || '/docs/'
  var shelves = [].slice.call(document.querySelectorAll('.shelf'))
  var main = input.closest('main') || document.body
  var index = null
  var loading = null

  // shortcut: one fetch of every page's text (about 30 KB gzipped); a page
  // count in the hundreds wants a prebuilt token index instead.
  function load() {
    loading =
      loading ||
      fetch('/docs/search.json')
        .then(function (r) {
          if (!r.ok) throw new Error(r.status)
          return r.json()
        })
        .then(function (pages) {
          index = pages
            .filter(function (p) {
              return p.url.indexOf(scope) === 0
            })
            .map(function (p) {
              var head = (p.title + ' ' + p.lead).toLowerCase()
              return {
                page: p,
                head: head,
                title: p.title.toLowerCase(),
                sections: p.sections.map(function (s) {
                  return { s: s, title: s.title.toLowerCase(), text: s.text.toLowerCase() }
                }),
              }
            })
        })
    return loading
  }

  function words(text) {
    return text.toLowerCase().split(/\s+/).filter(Boolean)
  }

  function all(q, hay) {
    return q.every(function (w) {
      return hay.indexOf(w) !== -1
    })
  }

  function count(q, hay) {
    return q.filter(function (w) {
      return hay.indexOf(w) !== -1
    }).length
  }

  // A page whose title and lead hold the words is one hit, ahead of any
  // section; otherwise each section holding them is, with the page's title and
  // lead counted in. A hit on a title outranks one on a heading, which
  // outranks one in the text. Up to three sections per page.
  function search(q) {
    var hits = []
    index.forEach(function (p, order) {
      if (all(q, p.head)) {
        hits.push({ p: p, s: null, score: 100 + count(q, p.title), order: order })
        return
      }
      p.sections
        .filter(function (s) {
          return all(q, p.head + ' ' + s.title + ' ' + s.text)
        })
        .map(function (s) {
          return { p: p, s: s, score: 10 * count(q, p.title) + count(q, s.title), order: order }
        })
        .sort(function (a, b) {
          return b.score - a.score
        })
        .slice(0, 3)
        .forEach(function (hit) {
          hits.push(hit)
        })
    })
    return hits.sort(function (a, b) {
      return b.score - a.score || a.order - b.order
    })
  }

  // About 160 characters of the text around the first word it holds, cut at
  // spaces, with every typed word marked.
  function snippet(text, q) {
    var lower = text.toLowerCase()
    var at = -1
    q.some(function (w) {
      at = lower.indexOf(w)
      return at !== -1
    })
    var start = Math.max(0, at - 60)
    var end = Math.min(text.length, start + 160)
    if (start > 0) start = text.indexOf(' ', start) + 1
    if (end < text.length) end = Math.max(text.lastIndexOf(' ', end), start)
    var part = text.slice(start, end)

    var el = document.createElement('span')
    el.className = 'result-text'
    if (start > 0) el.append('… ')
    var pattern = new RegExp(
      '(' +
        q
          .map(function (w) {
            return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('|') +
        ')',
      'gi',
    )
    part.split(pattern).forEach(function (piece, i) {
      if (i % 2) {
        var mark = document.createElement('mark')
        mark.textContent = piece
        el.append(mark)
      } else if (piece) {
        el.append(piece)
      }
    })
    if (end < text.length) el.append(' …')
    return el
  }

  function row(hit, q) {
    var page = hit.p.page
    var link = document.createElement('a')
    link.className = 'page-link result'
    link.href = page.url + (hit.s ? '#' + hit.s.s.id : '')
    var title = document.createElement('span')
    title.className = 'result-title'
    title.textContent = page.title
    if (hit.s) {
      var section = document.createElement('span')
      section.className = 'result-section'
      section.textContent = hit.s.s.title
      title.append(section)
    }
    link.append(title, snippet(hit.s ? hit.s.s.text : page.lead, q))
    return link
  }

  function apply() {
    var q = words(input.value)
    var hits = q.length && index ? search(q) : []
    results.replaceChildren.apply(
      results,
      hits.map(function (hit) {
        return row(hit, q)
      }),
    )
    results.hidden = hits.length === 0
    shelves.forEach(function (shelf) {
      shelf.hidden = q.length > 0
    })
    empty.hidden = q.length === 0 || hits.length > 0
  }

  // Typing eases the page to its new length and fades back in what a shorter
  // query brings back (site.js).
  function update() {
    var M = window.KonnektMotion
    if (M) M.resize(main, apply)
    else apply()
  }

  function failed() {
    empty.textContent = 'Search could not load.'
    empty.hidden = false
  }

  input.addEventListener('input', function () {
    if (index || !input.value.trim()) return update()
    load().then(update, failed)
  })
  // Fetched on focus, so the first keystroke rarely waits.
  input.addEventListener('focus', function () {
    load().catch(failed)
  })
  // A query kept by the browser's back button searches straight away.
  if (input.value.trim()) load().then(apply, failed)
})()
