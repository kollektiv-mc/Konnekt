/* Download page — detects platform and wires the download buttons from the
   latest GitHub release's assets. */
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
    var sub = el('p', 'dl-sub')
    var link = el('a', null, 'All downloads')
    link.href = '#dl-grid'
    sub.appendChild(link)
    primaryEl.appendChild(sub)
  }

  function renderPrimaryUnavailable(platform) {
    primaryEl.innerHTML = ''
    primaryEl.appendChild(el('div', 'dl-os-icon', platform ? platform.tag : '?'))
    var heading = platform ? 'No ' + platform.name + ' build yet' : 'Choose your platform'
    primaryEl.appendChild(el('h2', null, heading))
    var btn = el('a', 'btn btn-primary', 'Run from source')
    btn.href = R.REPO_URL
    btn.target = '_blank'
    btn.rel = 'noopener'
    primaryEl.appendChild(btn)
    var sub = el('p', 'dl-sub')
    var link = el('a', null, 'All downloads')
    link.href = '#dl-grid'
    sub.appendChild(link)
    primaryEl.appendChild(sub)
  }

  function renderOthers(primaryPlatform, assets) {
    gridEl.innerHTML = ''
    R.PLATFORMS.forEach(function (p) {
      if (primaryPlatform && p.id === primaryPlatform.id) return
      var asset = R.matchAsset(p, assets)
      var card = el(asset ? 'a' : 'div', 'dl-card')
      if (asset) {
        card.href = asset.browser_download_url
        card.setAttribute('download', '')
      } else {
        card.className += ' is-unavailable'
      }
      card.appendChild(el('span', 'dl-card-icon', p.tag))
      var meta = el('div')
      meta.appendChild(el('div', 'dl-card-name', p.name))
      var line = asset ? p.desc + ' · ' + R.formatBytes(asset.size) : p.desc
      meta.appendChild(el('div', 'dl-card-meta', line))
      card.appendChild(meta)
      gridEl.appendChild(card)
    })
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

    var detected = R.detectPlatform()
    var primary = detected === 'unknown' ? null : R.platformById(detected)
    var primaryAsset = R.matchAsset(primary, assets)

    if (primary && primaryAsset) {
      renderPrimaryAvailable(primary, primaryAsset, version)
      renderOthers(primary, assets)
    } else {
      renderPrimaryUnavailable(primary)
      renderOthers(null, assets)
    }

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
})()
