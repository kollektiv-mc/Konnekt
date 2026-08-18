/* Download page — detects platform and wires the download buttons from the
   latest GitHub release's assets. The detected platform seeds the primary
   card; the "All downloads" grid below switches it, so a visitor on Linux can
   still reach the Windows build (or read how to build the one that isn't
   published) without leaving for GitHub. */
;(function () {
  var R = window.KonnektRelease
  if (!R) return

  var loadingEl = document.getElementById('dl-loading')
  var contentEl = document.getElementById('dl-content')
  var errorEl = document.getElementById('dl-error')
  var errorMsg = document.getElementById('dl-error-msg')
  var errorTitle = document.getElementById('dl-error-title')
  var versionPill = document.getElementById('dl-version')
  var primaryEl = document.getElementById('dl-primary')
  var gridEl = document.getElementById('dl-grid')
  var footnoteEl = document.getElementById('dl-footnote')
  var snapshotEl = document.getElementById('dl-snapshot')
  var snapshotLoadingEl = document.getElementById('dl-snapshot-loading')
  var snapshotMetaEl = document.getElementById('dl-snapshot-meta')
  var snapshotGridEl = document.getElementById('dl-snapshot-grid')
  var snapshotFootnoteEl = document.getElementById('dl-snapshot-footnote')

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function show(node) {
    node.classList.remove('is-hidden')
  }
  function hide(node) {
    node.classList.add('is-hidden')
  }

  // The release being shown. renderOthers' click handlers re-enter the render
  // path long after fetchLatest resolved, so what they need is held here
  // rather than passed down through every call.
  var current = { assets: [], version: '' }

  function selectPlatform(platform) {
    var asset = R.matchAsset(platform, current.assets)
    if (platform && asset) {
      renderPrimaryAvailable(platform, asset, current.version)
    } else {
      renderPrimaryUnavailable(platform)
    }
    renderOthers(platform, current.assets)
  }

  function renderPrimaryAvailable(platform, asset, version) {
    primaryEl.innerHTML = ''
    primaryEl.appendChild(el('div', 'dl-os-icon', platform.tag))
    primaryEl.appendChild(el('h2', null, 'Konnekt for ' + platform.name))
    primaryEl.appendChild(
      el(
        'p',
        'dl-meta',
        [version, R.formatBytes(asset.size), platform.desc].filter(Boolean).join(' · '),
      ),
    )
    var btn = el('a', 'btn btn-primary', 'Download ' + platform.tag + ' build')
    btn.href = asset.browser_download_url
    btn.setAttribute('download', '')
    primaryEl.appendChild(btn)
  }

  function renderPrimaryUnavailable(platform) {
    primaryEl.innerHTML = ''
    primaryEl.appendChild(el('div', 'dl-os-icon', platform ? platform.tag : '?'))
    var heading = platform ? 'No ' + platform.name + ' build yet' : 'Choose your platform'
    primaryEl.appendChild(el('h2', null, heading))
    var btn = el('a', 'btn btn-primary', 'Build from source')
    btn.href = R.REPO_URL
    btn.target = '_blank'
    btn.rel = 'noopener'
    primaryEl.appendChild(btn)
  }

  function renderOthers(primaryPlatform, assets) {
    gridEl.innerHTML = ''
    R.PLATFORMS.forEach(function (p) {
      if (primaryPlatform && p.id === primaryPlatform.id) return
      var asset = R.matchAsset(p, assets)
      var card = el('button', 'dl-card')
      card.type = 'button'
      if (!asset) card.className += ' is-unavailable'
      card.addEventListener('click', function () {
        selectPlatform(p)
      })
      card.appendChild(el('span', 'dl-card-icon', p.tag))
      var meta = el('span')
      meta.appendChild(el('span', 'dl-card-name', p.name))
      var line = asset ? p.desc + ' · ' + R.formatBytes(asset.size) : p.desc
      meta.appendChild(el('span', 'dl-card-meta', line))
      card.appendChild(meta)
      gridEl.appendChild(card)
    })
  }

  // ── Snapshot channel ─────────────────────────────────────────────────────
  // The rolling `snapshot` prerelease, rebuilt from main. Unlike the grid
  // above it lists only platforms that actually have an asset: the release
  // above already says which platforms exist, and repeating "Coming soon"
  // here would read as a promise about snapshots specifically.

  function renderSnapshot(rel) {
    snapshotGridEl.innerHTML = ''
    var count = 0

    R.PLATFORMS.forEach(function (p) {
      var asset = R.matchAsset(p, rel.assets || [])
      if (!asset) return
      var card = el('a', 'dl-card')
      card.href = asset.browser_download_url
      card.setAttribute('download', '')
      card.appendChild(el('span', 'dl-card-icon', p.tag))
      var meta = el('span')
      meta.appendChild(el('span', 'dl-card-name', p.name))
      meta.appendChild(el('span', 'dl-card-meta', p.desc + ' · ' + R.formatBytes(asset.size)))
      card.appendChild(meta)
      snapshotGridEl.appendChild(card)
      count++
    })

    // A published snapshot with nothing attached (an interrupted build) has
    // nothing to offer — leave the section hidden.
    if (!count) return

    var sha = R.shortSha(rel.target_commitish)
    var built = R.formatDate(rel.published_at)
    snapshotMetaEl.textContent = [built ? 'built ' + built : '', sha ? 'commit ' + sha : '']
      .filter(Boolean)
      .join(' · ')

    snapshotFootnoteEl.innerHTML = ''
    var link = el('a', null, 'Snapshot notes on GitHub')
    link.href = R.SNAPSHOT_URL
    link.target = '_blank'
    link.rel = 'noopener'
    snapshotFootnoteEl.appendChild(link)

    show(snapshotEl)
  }

  function render(rel) {
    var version = rel.tag_name || ''
    var date = R.formatDate(rel.published_at)
    var assets = rel.assets || []

    versionPill.innerHTML = ''
    versionPill.appendChild(el('span', 'dot'))
    versionPill.appendChild(
      document.createTextNode(' ' + [version, date].filter(Boolean).join(' · ')),
    )

    current.assets = assets
    current.version = version

    // An undetected platform seeds nothing, so the grid below lists every
    // platform and the primary card asks which one you want.
    var detected = R.detectPlatform()
    selectPlatform(detected === 'unknown' ? null : R.platformById(detected))

    footnoteEl.innerHTML = ''
    var relLink = el('a', null, 'All releases on GitHub')
    relLink.href = R.RELEASES_URL
    relLink.target = '_blank'
    relLink.rel = 'noopener'
    footnoteEl.appendChild(relLink)

    hide(loadingEl)
    show(contentEl)
  }

  function setPill(text) {
    versionPill.innerHTML = ''
    versionPill.appendChild(el('span', 'dot'))
    versionPill.appendChild(document.createTextNode(' ' + text))
  }

  function showEmpty() {
    hide(loadingEl)
    setPill('alpha · not yet released')
    errorEl.classList.remove('is-error')
    errorTitle.textContent = 'No public build yet'
    errorMsg.textContent = 'No release has been published yet.'
    show(errorEl)
  }

  function showError(msg) {
    hide(loadingEl)
    setPill('version unavailable')
    errorTitle.textContent = "Couldn't reach GitHub"
    errorMsg.textContent = msg
    show(errorEl)
  }

  R.fetchLatest()
    .then(function (res) {
      if (res.status === 404) {
        showEmpty()
        return
      }
      if (!res.ok) {
        showError(
          res.status === 403
            ? 'GitHub rate limit hit. Try again later.'
            : 'GitHub returned status ' + res.status + '.',
        )
        return
      }
      render(res.data)
    })
    .catch(function () {
      showError('Check your connection and try again.')
    })

  // Second request, deliberately independent of the one above: a 404 (no
  // snapshot published), a rate limit or an outage leaves the section hidden
  // and the release download working, which is what the page is for. Either
  // way the placeholder goes: it says a request is in flight, so it must not
  // outlive one.
  R.fetchSnapshot()
    .then(function (res) {
      hide(snapshotLoadingEl)
      if (res.ok && res.data) renderSnapshot(res.data)
    })
    .catch(function () {
      hide(snapshotLoadingEl)
    })
})()
