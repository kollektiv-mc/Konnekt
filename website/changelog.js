/* Changelog page — lists GitHub releases, rendered by markdown.js. */
;(function () {
  var R = window.KonnektRelease
  var MD = window.KonnektMarkdown
  if (!R || !MD) return

  var loadingEl = document.getElementById('cl-loading')
  var listEl = document.getElementById('cl-list')
  var errorEl = document.getElementById('cl-error')
  var errorMsg = document.getElementById('cl-error-msg')
  var errorTitle = document.getElementById('cl-error-title')
  var snapshotEl = document.getElementById('cl-snapshot')
  var snapshotMetaEl = document.getElementById('cl-snapshot-meta')
  var snapshotBodyEl = document.getElementById('cl-snapshot-body')

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  // ── One line, one pull request ─────────────────────────────────────────
  // Each bullet in a generated release body is a merged pull request's title,
  // so a title that resolves against the map turns its whole line into a link
  // to that pull request with the merge date after it. A line that resolves
  // against nothing is left exactly as it renders now: hand-written notes
  // (v0.1.0-alpha.1 has no generated section at all) and a rate-limited fetch
  // both land there, and an invented date would be worse than none.
  //
  // The whole line is the target rather than the date alone. What a reader
  // wants is the change, not a stamp at the end of it, and a 7-character hit
  // area beside a sentence is the worse click of the two.
  function decorate(root, pulls) {
    if (!pulls) return
    ;[].slice.call(root.querySelectorAll('.md li')).forEach(function (li) {
      // A title carrying its own markdown link would nest anchors, which is
      // invalid and would swallow the inner one's target. Rare, and cheaper to
      // skip than to unpick.
      if (li.querySelector('a') || li.querySelector('.change-pr')) return

      // textContent against the pull request's own title, both whitespace
      // collapsed, which is exactly what release-notes.py wrote the bullet
      // from. A title carrying markdown would render to something other than
      // its source and miss — none of the repo's 113 merged titles has a
      // backtick, asterisk or bracket in it, and a miss costs a plain line.
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
        // The long date and the number, for anyone who wants to know what the
        // line points at before clicking it.
        stamp.title = 'Merged ' + R.formatDate(pull.mergedAt) + ' in #' + pull.number
        link.appendChild(document.createTextNode(' '))
        link.appendChild(stamp)
      }
      li.appendChild(link)
    })
  }

  function renderRelease(rel, isLatest) {
    var wrap = el('article', 'release')

    var head = el('div', 'release-head')
    var version = el('h2', 'release-version')
    version.appendChild(document.createTextNode(rel.name || rel.tag_name || 'Untitled'))
    if (isLatest) version.appendChild(el('span', 'release-latest', 'LATEST'))
    if (rel.prerelease) version.appendChild(el('span', 'release-latest', 'PRE-RELEASE'))
    head.appendChild(version)
    var date = R.formatDate(rel.published_at)
    if (date) head.appendChild(el('span', 'release-date', date))
    wrap.appendChild(head)

    var body = el('div', 'md')
    var notes = R.changesOnly(rel.body)
    if (notes) {
      body.innerHTML = MD.render(notes)
    } else {
      body.appendChild(el('p', null, 'No notes.'))
    }
    wrap.appendChild(body)
    return wrap
  }

  // The snapshot's notes are generated against the newest release, not against
  // the previous snapshot (.github/workflows/snapshot.yml), so the body is
  // already "everything not yet released" and needs no assembling here.
  //
  // Only the changes are shown. The body's preamble says what a snapshot is and
  // that it can be broken, which this card already carries above — see the
  // disclaimer in changelog.html, which used to be that preamble's job.
  function renderSnapshot(rel) {
    var notes = R.changesOnly(rel.body)
    if (!notes) return
    snapshotBodyEl.innerHTML = MD.render(notes)

    var built = R.formatDate(rel.published_at)
    var sha = R.shortSha(rel.target_commitish)
    snapshotMetaEl.textContent = [built ? 'built ' + built : '', sha ? 'commit ' + sha : '']
      .filter(Boolean)
      .join(' · ')

    snapshotEl.classList.remove('is-hidden')
  }

  function render(releases) {
    var visible = releases.filter(function (r) {
      // The rolling `snapshot` prerelease is a moving build of main, not a
      // released version. It would sit at the top of this list wearing a
      // LATEST badge, above the releases it isn't one of; it belongs on the
      // download page instead.
      return !r.draft && r.tag_name !== R.SNAPSHOT_TAG
    })
    if (!visible.length) {
      showEmpty()
      return
    }
    listEl.innerHTML = ''
    visible.forEach(function (rel, idx) {
      listEl.appendChild(renderRelease(rel, idx === 0))
    })
    loadingEl.classList.add('is-hidden')
    listEl.classList.remove('is-hidden')
  }

  function showEmpty() {
    loadingEl.classList.add('is-hidden')
    errorEl.classList.remove('is-error')
    errorTitle.textContent = 'No releases yet'
    errorMsg.textContent = 'No releases published yet.'
    errorEl.classList.remove('is-hidden')
  }

  function showError(msg) {
    loadingEl.classList.add('is-hidden')
    errorTitle.textContent = "Couldn't load the changelog"
    errorMsg.textContent = msg
    errorEl.classList.remove('is-hidden')
  }

  // In flight from the first frame alongside the pair below, but deliberately
  // not part of it: the dates are decoration on a page that is a changelog
  // without them, and three more requests are not worth holding the first paint
  // for. It decorates whatever has rendered by the time it lands, and on a
  // repeat visit the cache makes that the first frame anyway.
  var pullsPromise = R.fetchMergedPulls().catch(function () {
    return null
  })

  // Both requests are awaited together so the page resolves once. Rendering
  // the snapshot on its own clock would drop a block in above the list after
  // it had already been read. The snapshot is the optional half: a 404 (none
  // published), a rate limit or an outage leaves it out and the list alone is
  // still the changelog, so its failure is swallowed here rather than
  // rejecting the pair.
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
        showEmpty()
        return
      }
      if (!list.ok) {
        showError(
          list.status === 403
            ? 'GitHub rate limit hit. Try again later.'
            : 'GitHub returned status ' + list.status + '.',
        )
        return
      }
      render(Array.isArray(list.data) ? list.data : [])
    })
    .catch(function () {
      showError('Check your connection and try again.')
    })
    // After the page has resolved either way, and swallowing its own failures:
    // this runs past the catch above, so a throw in here would otherwise put
    // "check your connection" over a changelog that rendered fine.
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
