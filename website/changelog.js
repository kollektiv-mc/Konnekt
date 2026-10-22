/* Changelog page: GitHub releases as blocks, newest first, with the nightly
   snapshot above them. Release bodies are rendered by markdown.js. */
;(function () {
  var R = window.KonnektRelease
  var MD = window.KonnektMarkdown
  if (!R || !MD) return

  // Lines a section shows before "Show all".
  var SHOWN = 6

  var countEl = document.getElementById('cl-count')
  var loadingEl = document.getElementById('cl-loading')
  var listEl = document.getElementById('cl-list')
  var errorEl = document.getElementById('cl-error')
  var errorMsg = document.getElementById('cl-error-msg')
  var errorTitle = document.getElementById('cl-error-title')
  var snapshotEl = document.getElementById('cl-snapshot')
  var snapshotMetaEl = document.getElementById('cl-snapshot-meta')
  var snapshotBodyEl = document.getElementById('cl-snapshot-body')
  var snapshotToggle = document.getElementById('cl-snapshot-toggle')

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  // ── Sections ───────────────────────────────────────────────────────────
  // A release body renders to headings and lists. A section is a heading and
  // the bulleted lines under it: "Features", "Fixes", or on the hand-written
  // first release "What's included". Paragraphs and numbered steps (install
  // instructions) are left out; GitHub has them. A body with no such section
  // at all is shown rendered whole rather than as nothing.
  function sectionsOf(markdown) {
    var doc = document.createElement('div')
    // aislop-ignore-next-line security/innerhtml -- MD.render HTML-escapes its input before formatting and restricts link schemes (markdown.js)
    doc.innerHTML = MD.render(markdown)
    var sections = []
    var current = null
    ;[].slice.call(doc.children).forEach(function (node) {
      if (/^H[1-6]$/.test(node.tagName)) {
        current = { name: node.textContent.trim(), items: [] }
        sections.push(current)
      } else if (node.tagName === 'UL') {
        if (!current) {
          current = { name: 'Changes', items: [] }
          sections.push(current)
        }
        ;[].slice.call(node.children).forEach(function (li) {
          current.items.push(li)
        })
      }
    })
    return {
      doc: doc,
      sections: sections.filter(function (s) {
        return s.items.length
      }),
    }
  }

  function renderSection(sec, all) {
    var wrap = el('div', 'changes')
    var head = el('div', 'changes-head')
    head.appendChild(el('span', null, sec.name))
    head.appendChild(el('span', null, String(sec.items.length)))
    wrap.appendChild(head)

    var list = el('ul', 'changes-list')
    sec.items.forEach(function (li, i) {
      if (!all && i >= SHOWN) li.hidden = true
      list.appendChild(li)
    })
    wrap.appendChild(list)

    if (!all && sec.items.length > SHOWN) {
      var more = el('button', 'changes-more', 'Show all ' + sec.items.length)
      more.type = 'button'
      more.setAttribute('aria-expanded', 'false')
      more.addEventListener('click', function () {
        var open = more.getAttribute('aria-expanded') !== 'true'
        more.setAttribute('aria-expanded', open ? 'true' : 'false')
        more.textContent = open ? 'Show fewer' : 'Show all ' + sec.items.length
        sec.items.forEach(function (li, i) {
          if (i >= SHOWN) li.hidden = !open
        })
      })
      wrap.appendChild(more)
    }
    return wrap
  }

  // The accounting footer release-notes.py writes after the last section,
  // which changesOnly cuts off: "52 pull requests are not listed: …".
  var NOT_LISTED = /^_([^\n]*\bnot listed\b[^\n]*)_\s*$/im
  var GENERATED = /^##\s+What's changed\s*$/im

  function renderRelease(rel, isLatest) {
    var tag = rel.tag_name || rel.name || 'Untitled'
    var parsed = sectionsOf(R.changesOnly(rel.body))

    var card = el('article', 'release block' + (isLatest ? ' is-latest' : ''))
    var side = el('div', 'release-side')
    var sticky = el('div', 'release-sticky')
    if (isLatest) {
      var badge = el('span', 'release-badge')
      var dot = el('span', 'release-dot')
      dot.setAttribute('aria-hidden', 'true')
      badge.appendChild(dot)
      badge.appendChild(document.createTextNode('Latest'))
      sticky.appendChild(badge)
    }
    sticky.appendChild(el('h2', 'release-tag', tag))
    var date = R.formatDate(rel.published_at)
    if (date) sticky.appendChild(el('span', 'meta', date))
    // Counted only for a generated body, whose sections are Features and Fixes.
    // A hand-written one names its own, which do not read as a count.
    if (GENERATED.test(String(rel.body || '')) && parsed.sections.length) {
      sticky.appendChild(
        el(
          'span',
          'release-summary',
          parsed.sections
            .map(function (s) {
              return s.items.length + ' ' + s.name.toLowerCase()
            })
            .join(', ') + '.',
        ),
      )
    }
    var actions = el('div', 'release-actions')
    if (isLatest) {
      var dl = el('a', 'btn btn-primary btn-small', 'Download')
      dl.href = '/download.html'
      actions.appendChild(dl)
    }
    var gh = el('a', 'btn btn-secondary btn-small', 'On GitHub')
    gh.href = rel.html_url || R.RELEASES_URL
    gh.target = '_blank'
    gh.rel = 'noopener'
    actions.appendChild(gh)
    sticky.appendChild(actions)
    side.appendChild(sticky)
    card.appendChild(side)

    var main = el('div', 'release-main')
    var cols = el('div', 'release-sections')
    if (parsed.sections.length) {
      parsed.sections.forEach(function (sec) {
        cols.appendChild(renderSection(sec, false))
      })
    } else {
      parsed.doc.className = 'md'
      cols.appendChild(parsed.doc)
    }
    main.appendChild(cols)
    var note = NOT_LISTED.exec(String(rel.body || ''))
    if (note) main.appendChild(el('p', 'release-note', note[1]))
    card.appendChild(main)
    return card
  }

  // The snapshot's notes are generated against the newest release, not the
  // previous snapshot (.github/workflows/snapshot.yml), so the body is already
  // everything not yet released.
  function renderSnapshot(rel) {
    var parsed = sectionsOf(R.changesOnly(rel.body))
    if (!parsed.sections.length) return
    var total = 0
    parsed.sections.forEach(function (sec) {
      total += sec.items.length
      snapshotBodyEl.appendChild(renderSection(sec, true))
    })

    var built = R.formatDate(rel.published_at)
    var sha = R.shortSha(rel.target_commitish)
    snapshotMetaEl.textContent = ['Built from main', built, sha ? 'commit ' + sha : '']
      .filter(Boolean)
      .join(' · ')

    var label = function (open) {
      return (open ? 'Hide ' : 'Show ') + total + (total === 1 ? ' change' : ' changes')
    }
    snapshotToggle.textContent = label(false)
    snapshotToggle.addEventListener('click', function () {
      var open = snapshotToggle.getAttribute('aria-expanded') !== 'true'
      snapshotToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      snapshotToggle.textContent = label(open)
      snapshotBodyEl.hidden = !open
    })
    snapshotEl.hidden = false
  }

  function render(releases) {
    // The rolling `snapshot` prerelease is a moving build of main, not a
    // released version; it has its own block above the list.
    var visible = releases.filter(function (r) {
      return !r.draft && r.tag_name !== R.SNAPSHOT_TAG
    })
    if (!visible.length) {
      showState('No releases yet', 'Nothing has been published.')
      return
    }
    visible.forEach(function (rel, idx) {
      listEl.appendChild(renderRelease(rel, idx === 0))
    })
    var first = R.formatDate(visible[visible.length - 1].published_at)
    countEl.textContent =
      visible.length +
      (visible.length === 1 ? ' release' : ' releases') +
      (first ? ' since ' + first : '')
    countEl.hidden = false
    loadingEl.hidden = true
    listEl.hidden = false
  }

  function showState(title, msg) {
    loadingEl.hidden = true
    errorTitle.textContent = title
    errorMsg.textContent = msg
    errorEl.hidden = false
  }

  // ── One line, one pull request ─────────────────────────────────────────
  // Each bullet in a generated release body is a merged pull request's title,
  // so a title that resolves against the map turns its whole line into a link
  // to that pull request with the merge date after it. A line that resolves
  // against nothing is left as it rendered: hand-written notes and a
  // rate-limited fetch both land there, and an invented date would be worse
  // than none.
  function decorate(root, pulls) {
    if (!pulls) return
    ;[].slice.call(root.querySelectorAll('.changes-list li')).forEach(function (li) {
      // A title carrying its own markdown link would nest anchors.
      if (li.querySelector('a')) return
      var pull = pulls[R.normalizeTitle(li.textContent)]
      if (!pull) return

      var link = el('a', 'change-pr')
      link.href = R.pullUrl(pull.number)
      link.target = '_blank'
      link.rel = 'noopener'
      while (li.firstChild) link.appendChild(li.firstChild)

      var short = R.formatShortDate(pull.mergedAt)
      if (short) {
        var stamp = el('span', 'change-date', short)
        stamp.title = 'Merged ' + R.formatDate(pull.mergedAt) + ' in #' + pull.number
        link.appendChild(document.createTextNode(' '))
        link.appendChild(stamp)
      }
      li.appendChild(link)
    })
  }

  // In flight from the first frame, but not awaited with the pair below: the
  // dates are decoration on a page that is a changelog without them.
  var pullsPromise = R.fetchMergedPulls().catch(function () {
    return null
  })

  // Both awaited together so the page resolves once. The snapshot is the
  // optional half: a 404 (none published), a rate limit or an outage leaves it
  // out and the list alone is still the changelog.
  Promise.all([
    R.fetchList(),
    R.fetchSnapshot().catch(function () {
      return { ok: false, status: 0, data: null }
    }),
  ])
    .then(function (results) {
      var list = results[0]
      var snapshot = results[1]

      if (snapshot.ok && snapshot.data) renderSnapshot(snapshot.data)

      if (list.status === 404) {
        showState('No releases yet', 'Nothing has been published.')
        return
      }
      if (!list.ok) {
        showState(
          'Could not load the changelog',
          list.status === 403
            ? 'GitHub rate limit hit. Try again later.'
            : 'GitHub returned status ' + list.status + '.',
        )
        return
      }
      render(Array.isArray(list.data) ? list.data : [])
    })
    .catch(function () {
      showState('Could not load the changelog', 'Check your connection and try again.')
    })
    // After the page has resolved either way, swallowing its own failures, so
    // a throw in here never puts an error over a changelog that rendered.
    .then(function () {
      return pullsPromise
        .then(function (pulls) {
          decorate(document, pulls)
        })
        .catch(function () {
          /* The lines stay as they rendered. */
        })
    })
})()
