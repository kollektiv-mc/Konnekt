/* Shared GitHub-release helpers for the download + changelog pages. */
;(function () {
  var OWNER_REPO = 'kollektiv-mc/Konnekt'
  var API = 'https://api.github.com/repos/' + OWNER_REPO

  // The rolling prerelease .github/workflows/snapshot.yml rebuilds from main
  // (see the download page's snapshot section). It's a prerelease, so
  // /releases/latest never returns it — it has to be fetched by tag.
  var SNAPSHOT_TAG = 'snapshot'

  // Platform metadata. `match` tests an asset's `name`; null = not built yet.
  var PLATFORMS = [
    {
      id: 'windows',
      name: 'Windows',
      tag: 'Win',
      desc: '64-bit installer (.exe)',
      match: function (name) {
        return name === 'konnekt-windows-amd64.exe'
      },
    },
    {
      id: 'linux',
      name: 'Linux',
      tag: 'Lin',
      desc: '64-bit binary',
      match: function (name) {
        return name === 'konnekt-linux-amd64'
      },
    },
    {
      id: 'fedora',
      name: 'Fedora / RHEL',
      tag: 'RPM',
      desc: '.rpm package (x86_64)',
      match: function (name) {
        return /^konnekt-.*\.x86_64\.rpm$/.test(name)
      },
    },
    {
      id: 'mac',
      name: 'macOS',
      tag: 'Mac',
      // Not "Coming soon": it runs on macOS today, just not as a published
      // asset. docs.html's platform table says the same thing.
      desc: 'Build from source',
      match: null,
    },
  ]

  function platformById(id) {
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].id === id) return PLATFORMS[i]
    return null
  }

  // Best-effort browser OS detection → a PLATFORMS id (or 'unknown').
  function detectPlatform() {
    var p = ''
    try {
      if (navigator.userAgentData && navigator.userAgentData.platform) {
        p = navigator.userAgentData.platform
      }
    } catch (e) {
      /* older browsers */
    }
    var hay = (
      p +
      ' ' +
      (navigator.userAgent || '') +
      ' ' +
      (navigator.platform || '')
    ).toLowerCase()
    if (/win/.test(hay)) return 'windows'
    if (/mac|iphone|ipad|ipod/.test(hay)) return 'mac'
    if (/linux|x11|android|cros/.test(hay)) return 'linux'
    return 'unknown'
  }

  // First asset from a release matching a platform, or null.
  function matchAsset(platform, assets) {
    if (!platform || !platform.match || !assets) return null
    for (var i = 0; i < assets.length; i++) {
      if (platform.match(assets[i].name)) return assets[i]
    }
    return null
  }

  function formatBytes(n) {
    if (!n && n !== 0) return ''
    if (n < 1024) return n + ' B'
    var kb = n / 1024
    if (kb < 1024) return kb.toFixed(0) + ' KB'
    return (kb / 1024).toFixed(1) + ' MB'
  }

  // A snapshot release records the commit it was cut from in target_commitish.
  // Anything that isn't a full commit sha (a branch name, an older snapshot
  // made by hand) is dropped rather than printed as-is.
  function shortSha(value) {
    return /^[0-9a-f]{40}$/i.test(value || '') ? value.slice(0, 7) : ''
  }

  // The "What's changed" section of a release body, and nothing else.
  //
  // .github/scripts/release-notes.py writes a body for two audiences at once.
  // The list of what changed is for anyone; the rest is release plumbing —
  // the snapshot's build preamble, the accounting line for the pull requests
  // that were left out, the compare link. On GitHub those belong together.
  // Here the page has already said which release this is, when it was built and
  // where to read it in full, so repeating them turns a changelog entry into a
  // wall with the changes buried in the middle.
  //
  // Cuts at the accounting footer, which is the first thing after the last
  // section. Matched on "not listed" rather than the exact sentence so a
  // reworded footer still ends the section instead of being rendered as content.
  //
  // A body with no "What's changed" heading is returned whole: hand-written
  // notes are not this script's output and have no section to find, and showing
  // them unchanged is better than showing nothing. v0.1.0-alpha.1 was that case
  // until its notes were rewritten in this shape.
  var CHANGES_HEADING = /^##\s+What's changed\s*$/im
  var CHANGES_END = /^(?:_[^\n]*\bnot listed\b[^\n]*_|\*\*Full changelog\*\*)/im

  function changesOnly(body) {
    var text = String(body || '').replace(/\r\n/g, '\n')
    var start = text.search(CHANGES_HEADING)
    if (start === -1) return text.trim()

    var rest = text.slice(start)
    var end = rest.search(CHANGES_END)
    if (end !== -1) rest = rest.slice(0, end)
    return rest.trim()
  }

  function formatDate(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    if (isNaN(d)) return ''
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // Resolves to { ok, status, data }. `ok:false, status:404` = no release yet.
  function get(path) {
    return fetch(API + path, {
      headers: { Accept: 'application/vnd.github+json' },
    }).then(function (res) {
      if (res.status === 404) return { ok: false, status: 404, data: null }
      if (!res.ok) return { ok: false, status: res.status, data: null }
      return res.json().then(function (data) {
        return { ok: true, status: res.status, data: data }
      })
    })
  }

  window.KonnektRelease = {
    OWNER_REPO: OWNER_REPO,
    RELEASES_URL: 'https://github.com/' + OWNER_REPO + '/releases',
    REPO_URL: 'https://github.com/' + OWNER_REPO,
    SNAPSHOT_TAG: SNAPSHOT_TAG,
    SNAPSHOT_URL: 'https://github.com/' + OWNER_REPO + '/releases/tag/' + SNAPSHOT_TAG,
    PLATFORMS: PLATFORMS,
    platformById: platformById,
    detectPlatform: detectPlatform,
    matchAsset: matchAsset,
    formatBytes: formatBytes,
    formatDate: formatDate,
    shortSha: shortSha,
    changesOnly: changesOnly,
    fetchLatest: function () {
      return get('/releases/latest')
    },
    fetchList: function () {
      return get('/releases?per_page=20')
    },
    // 404s whenever no snapshot has been published yet — callers treat that
    // as "no snapshot channel", not as an error.
    fetchSnapshot: function () {
      return get('/releases/tags/' + SNAPSHOT_TAG)
    },
  }
})()
