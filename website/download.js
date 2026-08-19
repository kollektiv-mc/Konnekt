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

  // Everything the primary card says lives in here rather than directly in
  // #dl-primary. The card is chrome — a border, a background and a shadow that
  // should sit still while its contents change — and this is the one box that
  // survives a re-render, so it is what the swap below animates.
  var primaryInner = el('div', 'dl-primary-inner')
  primaryEl.appendChild(primaryInner)

  // ── Swapping the primary card ────────────────────────────────────────────
  // Picking a platform rewrites the card's contents in one synchronous pass,
  // which lands as a hard cut in the middle of a page where everything else
  // arrives on an animation. A short fade and a shade of scale either side of
  // the swap reads as the same card answering a different question.
  //
  // Only the contents, and only this card's. The card's own frame holds still,
  // per primaryInner above; and the grid below is rebuilt element by element,
  // so its cards already carry .dl-grid > .dl-card's staggered intro-in —
  // fading the grid as a whole on top of that would just muddy it.
  //
  // The duration comes off the shared motion token rather than a number of its
  // own, the way backdrop.js takes its colours off the palette tokens.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var SWAP_MS =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-fast')) ||
    150
  var SWAP_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
  var swapAnim = null
  var swapTimer = 0
  var seeded = false

  function swapPrimary(render) {
    // The first render is the page arriving, and .download-primary has its own
    // intro-in for that. Anything without the Web Animations API, or asking for
    // less motion, gets the plain swap.
    if (!seeded || reduceMotion || !primaryInner.animate) {
      seeded = true
      render()
      return
    }

    // A second click mid-swap replaces the first outright. Cancelling does not
    // fire onfinish and the timer goes with it, so the render this one is
    // carrying can never land after the one that overtook it.
    if (swapAnim) swapAnim.cancel()
    if (swapTimer) clearTimeout(swapTimer)

    var applied = false

    function apply() {
      if (applied) return
      applied = true
      clearTimeout(swapTimer)
      swapTimer = 0

      render()

      // Drops the forwards fill, so the card is back under its own styles
      // before the way in starts from them.
      swapAnim.cancel()
      swapAnim = primaryInner.animate(
        [
          { opacity: 0, transform: 'scale(0.985)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: Math.round(SWAP_MS * 1.4), easing: SWAP_EASE },
      )
      swapAnim.onfinish = function () {
        swapAnim = null
      }
    }

    swapAnim = primaryInner.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.985)' },
      ],
      { duration: SWAP_MS, easing: SWAP_EASE, fill: 'forwards' },
    )
    swapAnim.onfinish = apply

    // The card's contents are what the click was for, so they cannot be left
    // waiting on a frame. An animation on a document that stops compositing
    // holds at its last frame and never finishes; this puts the new platform on
    // screen regardless, and is a no-op in the ordinary case where it already is.
    swapTimer = setTimeout(apply, SWAP_MS + 400)
  }

  function selectPlatform(platform) {
    swapPrimary(function () {
      var asset = R.matchAsset(platform, current.assets)
      if (platform && asset) {
        renderPrimaryAvailable(platform, asset, current.version)
      } else {
        renderPrimaryUnavailable(platform)
      }
      renderOthers(platform, current.assets)
    })
  }

  function renderPrimaryAvailable(platform, asset, version) {
    primaryInner.innerHTML = ''
    primaryInner.appendChild(el('div', 'dl-os-icon', platform.tag))
    primaryInner.appendChild(el('h2', null, 'Konnekt for ' + platform.name))
    primaryInner.appendChild(
      el(
        'p',
        'dl-meta',
        [version, R.formatBytes(asset.size), platform.desc].filter(Boolean).join(' · '),
      ),
    )
    var btn = el('a', 'btn btn-primary', 'Download ' + platform.tag + ' build')
    btn.href = asset.browser_download_url
    btn.setAttribute('download', '')
    primaryInner.appendChild(btn)
  }

  // The same four slots as above, filled differently. Nothing pins the card's
  // height, so dropping the .dl-meta line here — as this used to — pulled the
  // button up by a line and its 22px margin the moment you picked a platform
  // with no build, which read as the card twitching rather than as an answer.
  // The heading stays "Konnekt for ..." for the same reason: switching
  // platforms should change what the card says about the build, not what it
  // says it is about.
  function renderPrimaryUnavailable(platform) {
    primaryInner.innerHTML = ''
    primaryInner.appendChild(el('div', 'dl-os-icon', platform ? platform.tag : '?'))
    primaryInner.appendChild(
      el('h2', null, platform ? 'Konnekt for ' + platform.name : 'Choose your platform'),
    )
    primaryInner.appendChild(
      el('p', 'dl-meta', platform ? 'No ' + platform.name + ' build yet' : 'Pick a platform below'),
    )
    var btn = el('a', 'btn btn-primary', 'Build from source')
    btn.href = R.REPO_URL
    btn.target = '_blank'
    btn.rel = 'noopener'
    primaryInner.appendChild(btn)
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
