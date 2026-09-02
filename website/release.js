/* Shared GitHub helpers for the download, changelog and roadmap pages. */
;(function () {
  var OWNER_REPO = 'kollektiv-mc/Konnekt'
  var API = 'https://api.github.com/repos/' + OWNER_REPO
  var SEARCH = 'https://api.github.com/search/issues'

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
  // them unchanged is better than showing nothing. It is a fallback and not a
  // second supported shape, because the whole body lands on the page, install
  // steps and all. release.yml writes every release in the shape above, and a
  // release edited by hand should keep it.
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

  // DD/MM/YY, in UTC. A merge timestamp near midnight would otherwise name a
  // different day depending on who is reading, and the date beside a changelog
  // line is a fact about the merge rather than about the reader's evening.
  function formatShortDate(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    if (isNaN(d)) return ''
    function pad(n) {
      return (n < 10 ? '0' : '') + n
    }
    return (
      pad(d.getUTCDate()) +
      '/' +
      pad(d.getUTCMonth() + 1) +
      '/' +
      String(d.getUTCFullYear()).slice(2)
    )
  }

  // ── Merged pull requests, by title ─────────────────────────────────────
  // The title is the only key a release body offers: release-notes.py writes
  // each bullet as the pull request's title with its whitespace collapsed and
  // nothing else, deliberately, so the notes are not a wall of attribution.
  // Matching back on it is exact rather than fuzzy — measured against the live
  // snapshot, all 54 of its bullets resolved to a pull request.
  //
  // Paging costs requests, and the rest of this file draws on 60 an hour
  // unauthenticated, so the map is cached for an hour: a reader who reloads or
  // comes back spends nothing, and a first visit spends three. A browser with
  // storage blocked pays the requests every time and is otherwise unaffected.
  var PULLS_KEY = 'konnekt:merged-pulls:v1'
  var PULLS_TTL_MS = 60 * 60 * 1000
  var PULLS_PER_PAGE = 100
  // A stop for a repo that has grown past what the short-page check would
  // reach in a sane number of requests. Three pages covers every closed pull
  // request today.
  var PULLS_MAX_PAGES = 5

  function readPullCache() {
    try {
      var entry = JSON.parse(window.localStorage.getItem(PULLS_KEY))
      if (!entry || Date.now() - entry.at > PULLS_TTL_MS) return null
      return entry.byTitle || null
    } catch (e) {
      return null // no storage, a quota error, or an entry from an older shape
    }
  }

  function writePullCache(byTitle) {
    try {
      window.localStorage.setItem(PULLS_KEY, JSON.stringify({ at: Date.now(), byTitle: byTitle }))
    } catch (e) {
      /* The map is still good for this page load. */
    }
  }

  function normalizeTitle(text) {
    return String(text || '')
      .split(/\s+/)
      .join(' ')
      .trim()
  }

  // Resolves to a { title: { number, mergedAt } } map, and to whatever it had
  // when something goes wrong: a partial map decorates the lines it can and
  // leaves the rest alone, which is the same thing an empty one does.
  function fetchMergedPulls() {
    var cached = readPullCache()
    if (cached) return Promise.resolve(cached)

    var byTitle = {}
    function page(n) {
      if (n > PULLS_MAX_PAGES) return Promise.resolve(byTitle)
      return fetch(API + '/pulls?state=closed&per_page=' + PULLS_PER_PAGE + '&page=' + n, {
        headers: { Accept: 'application/vnd.github+json' },
      })
        .then(function (res) {
          if (!res.ok) return byTitle
          return res.json().then(function (list) {
            if (!Array.isArray(list) || !list.length) return byTitle
            list.forEach(function (pull) {
              if (!pull.merged_at) return
              var title = normalizeTitle(pull.title)
              // The list comes back newest first, and first seen wins. Two
              // merged pull requests sharing a title is rare enough that
              // either is as defensible as the other.
              if (title && !byTitle[title]) {
                byTitle[title] = { number: pull.number, mergedAt: pull.merged_at }
              }
            })
            // A short page is the end of the list.
            return list.length < PULLS_PER_PAGE ? byTitle : page(n + 1)
          })
        })
        .catch(function () {
          return byTitle
        })
    }

    return page(1).then(function (map) {
      if (Object.keys(map).length) writePullCache(map)
      return map
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

  // Issues, and only issues. /issues returns pull requests alongside them —
  // one page of 100 is 49 issues and 45 pull requests today, and the roadmap's
  // own issues drop off that first page as more land — so the roadmap asks
  // search instead, which is the only endpoint that can say is:issue.
  //
  // Search carries its own rate limit, 10 a minute per address unauthenticated
  // rather than the 60 an hour the rest of this file draws on. One call per
  // page load sits well inside it. Add a second page when the repo passes 100
  // issues; it is at 49.
  function searchIssues() {
    var url =
      SEARCH + '?q=' + encodeURIComponent('repo:' + OWNER_REPO + ' is:issue') + '&per_page=100'
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (res) {
      if (!res.ok) return { ok: false, status: res.status, data: null }
      return res.json().then(function (data) {
        return { ok: true, status: res.status, data: (data && data.items) || [] }
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
    formatShortDate: formatShortDate,
    normalizeTitle: normalizeTitle,
    shortSha: shortSha,
    fetchMergedPulls: fetchMergedPulls,
    pullUrl: function (number) {
      return 'https://github.com/' + OWNER_REPO + '/pull/' + number
    },
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
    ISSUES_URL: 'https://github.com/' + OWNER_REPO + '/issues',
    fetchIssues: searchIssues,
  }
})()
