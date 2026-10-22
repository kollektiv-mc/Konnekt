/* Download page: detects the platform and wires the download buttons from the
   latest GitHub release's assets. The detected platform seeds the primary
   card; the "All downloads" grid below switches it, so a visitor on Linux can
   still reach the Windows build without leaving for GitHub. Only platforms
   with a published build are offered: macOS builds from source, which the
   docs cover. */
;(function () {
  // Verify your download starts closed. A link to #verify (the install guide
  // has one) means the reader came for it, so it opens, there and on any later
  // jump to it from this page.
  var verifyDetails = document.getElementById('verify-details')
  function openVerify() {
    if (verifyDetails && window.location.hash === '#verify') verifyDetails.open = true
  }
  openVerify()
  window.addEventListener('hashchange', openVerify)

  var R = window.KonnektRelease
  if (!R) return

  var errorEl = document.getElementById('dl-error')
  var errorMsg = document.getElementById('dl-error-msg')
  var errorTitle = document.getElementById('dl-error-title')
  var versionPill = document.getElementById('dl-version')
  var primaryEl = document.getElementById('dl-primary')
  var gridEl = document.getElementById('dl-grid')
  var snapshotMetaEl = document.getElementById('dl-snapshot-meta')
  var snapshotGridEl = document.getElementById('dl-snapshot-grid')
  var snapshotNoneEl = document.getElementById('dl-snapshot-none')
  var snapshotBuildsEl = document.getElementById('dl-snapshot-builds')

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function show(node) {
    node.hidden = false
  }
  function hide(node) {
    node.hidden = true
  }

  var PLATFORMS = R.PLATFORMS.filter(function (p) {
    return p.match
  })

  // The release being shown. renderOthers' click handlers re-enter the render
  // path long after fetchLatest resolved, so what they need is held here
  // rather than passed down through every call.
  var current = { assets: [], version: '' }

  // Everything the primary card says lives in here rather than directly in
  // #dl-primary, the one box that survives a re-render, so it is what the
  // swap below animates.
  var primaryInner = el('div', 'dl-primary-inner')
  primaryEl.appendChild(primaryInner)

  // ── Swapping the primary card ────────────────────────────────────────────
  // Picking a platform rewrites the card's contents in one synchronous pass,
  // which lands as a hard cut. A short fade and a shade of scale either side
  // of the swap reads as the same card answering a different question.
  //
  // The duration and easing come off the shared motion tokens rather than
  // numbers of their own.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var rootStyle = getComputedStyle(document.documentElement)
  var SWAP_MS = parseFloat(rootStyle.getPropertyValue('--duration-fast')) || 150
  var SWAP_EASE = rootStyle.getPropertyValue('--ease-standard').trim() || 'ease'
  var swapAnim = null
  var swapTimer = 0
  var seeded = false

  function swapPrimary(render) {
    // The first render is the page arriving, which needs no swap. Anything
    // without the Web Animations API, or asking for less motion, gets the
    // plain swap. The release landing on the waiting card is a swap like any
    // other, so it fades in rather than cutting.
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
    primaryInner.appendChild(el('h2', null, 'Konnekt for ' + platform.name))
    primaryInner.appendChild(
      el(
        'p',
        'meta',
        [version, R.formatBytes(asset.size), platform.desc].filter(Boolean).join(' · '),
      ),
    )
    var btn = el('a', 'btn btn-primary', 'Download for ' + platform.name)
    btn.href = asset.browser_download_url
    btn.setAttribute('download', '')
    primaryInner.appendChild(btn)
  }

  // The same three slots again while the release loads, so the card is there
  // from the first frame at the height it will keep, and only its details
  // wait behind the indicator.
  function renderPrimaryLoading(platform) {
    primaryInner.innerHTML = ''
    primaryInner.appendChild(
      el('h2', null, platform ? 'Konnekt for ' + platform.name : 'Choose your platform'),
    )
    primaryInner.appendChild(el('p', 'meta loader', 'Loading the latest release'))
    var btn = el(
      'span',
      'btn ' + (platform ? 'btn-primary' : 'btn-secondary') + ' is-waiting',
      platform ? 'Download for ' + platform.name : 'Build from source',
    )
    btn.setAttribute('aria-disabled', 'true')
    primaryInner.appendChild(btn)
  }

  // The same three slots as above, filled differently, so the card keeps its
  // height: switching platforms should change what the card says about the
  // build, not what it says it is about.
  function renderPrimaryUnavailable(platform) {
    primaryInner.innerHTML = ''
    primaryInner.appendChild(
      el('h2', null, platform ? 'Konnekt for ' + platform.name : 'Choose your platform'),
    )
    primaryInner.appendChild(
      el('p', 'meta', platform ? 'Not in this release' : 'Every build is listed below'),
    )
    var btn = el('a', 'btn btn-secondary', 'Build from source')
    btn.href = '/docs/install.html#build-from-source'
    primaryInner.appendChild(btn)
  }

  // A card's icon, name and description come from the platform table, so
  // they are there from the first frame. Only the last line waits on GitHub,
  // and it is a line of its own so that what it says, however long, never
  // reflows the lines above it. `size` is the text for it, or null while the
  // release is still loading.
  function fillCard(card, p, size, fade) {
    card.appendChild(el('span', 'dl-card-icon', p.tag))
    var text = el('span')
    text.appendChild(el('span', 'dl-card-name', p.name))
    text.appendChild(el('span', 'dl-card-meta', p.desc))
    text.appendChild(
      size == null
        ? el('span', 'dl-card-meta loader', 'Loading')
        : el('span', fade ? 'dl-card-meta appear' : 'dl-card-meta', size),
    )
    card.appendChild(text)
  }

  // With assets null the release is still loading, and every card waits
  // behind the indicator. With `failed`, there is no release to pick from,
  // and every card says why in its last line instead. Only the release's
  // arrival fades; a platform switch redraws the grid as it is.
  var cardsLoaded = false
  function renderOthers(primaryPlatform, assets, failed) {
    gridEl.innerHTML = ''
    PLATFORMS.forEach(function (p) {
      if (primaryPlatform && p.id === primaryPlatform.id) return
      var asset = assets ? R.matchAsset(p, assets) : null
      var card = el('button', 'dl-card')
      card.type = 'button'
      if (failed) {
        card.disabled = true
        card.className += ' is-unavailable'
        fillCard(card, p, failed, true)
      } else if (!assets) {
        card.disabled = true
        card.className += ' is-waiting'
        fillCard(card, p, null)
      } else {
        if (!asset) card.className += ' is-unavailable'
        card.addEventListener('click', function () {
          selectPlatform(p)
        })
        fillCard(card, p, asset ? R.formatBytes(asset.size) : 'Not in this release', !cardsLoaded)
      }
      gridEl.appendChild(card)
    })
    if (assets) cardsLoaded = true
  }

  // ── Snapshot channel ─────────────────────────────────────────────────────
  // The rolling `snapshot` prerelease, rebuilt from main. Unlike the grid
  // above it lists only platforms that actually have an asset: the release
  // above already says which platforms exist. Until it is read, every
  // platform waits there, as in the grid above.

  function renderSnapshotLoading() {
    PLATFORMS.forEach(function (p) {
      var card = el('span', 'dl-card is-waiting')
      fillCard(card, p, null)
      snapshotGridEl.appendChild(card)
    })
  }

  function renderSnapshot(rel) {
    snapshotGridEl.innerHTML = ''
    var count = 0

    PLATFORMS.forEach(function (p) {
      var asset = R.matchAsset(p, rel.assets || [])
      if (!asset) return
      var card = el('a', 'dl-card')
      card.href = asset.browser_download_url
      card.setAttribute('download', '')
      fillCard(card, p, R.formatBytes(asset.size), true)
      snapshotGridEl.appendChild(card)
      count++
    })

    // A published snapshot with nothing attached (an interrupted build) has
    // nothing to offer.
    if (!count) {
      snapshotNone('No snapshot builds are published right now.')
      return
    }

    var sha = R.shortSha(rel.target_commitish)
    var built = R.formatDate(rel.published_at)
    snapshotMetaEl.textContent = [built ? 'built ' + built : '', sha ? 'commit ' + sha : '']
      .filter(Boolean)
      .join(' · ')
  }

  function snapshotNone(text) {
    hide(snapshotBuildsEl)
    snapshotNoneEl.textContent = text
    show(snapshotNoneEl)
  }

  function render(rel) {
    var version = rel.tag_name || ''
    var date = R.formatDate(rel.published_at)
    var assets = rel.assets || []

    versionPill.textContent = [version, date].filter(Boolean).join(' · ')

    current.assets = assets
    current.version = version

    // An undetected platform, or one with no published build, seeds nothing,
    // so the grid below lists every build and the card asks which you want.
    selectPlatform(seed)
  }

  function setPill(text) {
    versionPill.textContent = text
  }

  // The platform the visitor is on, or null for one with no published build.
  // It decides which card the hero holds and so which the grid leaves out.
  var detected = R.platformById(R.detectPlatform())
  var seed = detected && detected.match ? detected : null
  renderPrimaryLoading(seed)
  seeded = true
  renderOthers(seed, null)
  renderSnapshotLoading()

  // Without a release the cards stop waiting, and say why.
  function showEmpty() {
    renderOthers(seed, null, 'Not released yet')
    hide(primaryEl)
    setPill('Not yet released')
    errorTitle.textContent = 'No public build yet'
    errorMsg.textContent = 'No release has been published yet.'
    show(errorEl)
  }

  function showError(msg) {
    renderOthers(seed, null, 'Release unavailable')
    hide(primaryEl)
    setPill('Version unavailable')
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
  // snapshot published), a rate limit or an outage says so in the section and
  // leaves the release download working, which is what the page is for.
  // Either way the waiting cards go: they say a request is in flight, so they
  // must not outlive one.
  R.fetchSnapshot()
    .then(function (res) {
      if (res.ok && res.data) renderSnapshot(res.data)
      else if (res.status === 404) snapshotNone('No snapshot is published right now.')
      else snapshotNone('Could not reach GitHub for the snapshot builds.')
    })
    .catch(function () {
      snapshotNone('Could not reach GitHub for the snapshot builds.')
    })
})()
