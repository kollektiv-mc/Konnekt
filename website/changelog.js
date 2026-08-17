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
    var notes = (rel.body || '').trim()
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
  function renderSnapshot(rel) {
    var notes = (rel.body || '').trim()
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
})()
