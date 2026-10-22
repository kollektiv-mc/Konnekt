/* Roadmap page: the stage and area filters, the search, and what GitHub says
   is done or newly filed.

   The rows are static markup, so this file is enhancement: with it removed the
   page is still the whole roadmap. Every count is derived from the rows rather
   than restated in a second place that could disagree with them. */
;(function () {
  var groupsEl = document.getElementById('rm-groups')
  if (!groupsEl) return

  var AREA_COUNT = document.querySelectorAll('.area[data-area]:not([data-area=""])').length

  var searchEl = document.getElementById('rm-search')
  var statusEl = document.getElementById('rm-status')
  var clearBtn = document.getElementById('rm-clear')
  var emptyEl = document.getElementById('rm-empty')
  var totalEl = document.getElementById('rm-total')
  var stageBtns = [].slice.call(document.querySelectorAll('.stage[data-stage]'))
  var areaBtns = [].slice.call(document.querySelectorAll('.area[data-area]'))

  var state = { stage: '', area: '', q: '' }

  // ── Index ──────────────────────────────────────────────────────────────
  // One record per row, rebuilt whenever GitHub adds rows. Filtering is then a
  // comparison over strings that never touches layout until the end.
  var rows = []

  function index() {
    rows = [].slice.call(groupsEl.querySelectorAll('.row')).map(function (el) {
      var group = el.closest('.rm-group')
      var path = group.getAttribute('data-path') || ''
      var name = el.querySelector('.row-name').textContent
      return {
        el: el,
        group: group,
        path: path,
        stage: el.getAttribute('data-stage'),
        text: (name + ' ' + path + ' ' + (el.getAttribute('data-search') || '')).toLowerCase(),
      }
    })
  }

  function inArea(row, area) {
    return !area || row.path === area || row.path.indexOf(area + '/') === 0
  }

  // ── Filtering ──────────────────────────────────────────────────────────
  function apply() {
    var needle = state.q.trim().toLowerCase()
    var shown = 0

    rows.forEach(function (row) {
      var on =
        inArea(row, state.area) &&
        (!state.stage || row.stage === state.stage) &&
        (!needle || row.text.indexOf(needle) !== -1)
      row.el.hidden = !on
      if (on) shown++
    })

    groupsEl.querySelectorAll('.rm-group').forEach(function (group) {
      var visible = group.querySelectorAll('.row:not([hidden])').length
      group.hidden = visible === 0
      group.querySelector('.rm-count').textContent = visible
    })

    stageBtns.forEach(function (btn) {
      var s = btn.getAttribute('data-stage')
      btn.setAttribute('aria-pressed', state.stage === s ? 'true' : 'false')
      btn.querySelector('.stage-count').textContent = rows.filter(function (row) {
        return row.stage === s && inArea(row, state.area)
      }).length
    })

    areaBtns.forEach(function (btn) {
      var a = btn.getAttribute('data-area')
      btn.setAttribute('aria-pressed', state.area === a ? 'true' : 'false')
      btn.querySelector('.area-count').textContent = rows.filter(function (row) {
        return inArea(row, a)
      }).length
    })

    var filtered = !!(state.stage || state.area || needle)
    statusEl.textContent =
      shown +
      (shown === 1 ? ' feature' : ' features') +
      (filtered ? ' shown' : ' across ' + AREA_COUNT + ' areas')
    clearBtn.hidden = !filtered
    emptyEl.hidden = shown !== 0
    if (totalEl) totalEl.textContent = rows.length + ' features · ' + AREA_COUNT + ' areas'
  }

  // ── Controls ───────────────────────────────────────────────────────────
  stageBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var s = btn.getAttribute('data-stage')
      state.stage = state.stage === s ? '' : s
      apply()
    })
  })

  areaBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.area = btn.getAttribute('data-area')
      apply()
    })
  })

  searchEl.addEventListener('input', function () {
    state.q = searchEl.value
    apply()
  })

  clearBtn.addEventListener('click', function () {
    state = { stage: '', area: '', q: '' }
    searchEl.value = ''
    apply()
    searchEl.focus()
  })

  index()
  apply()

  // ── GitHub sync ────────────────────────────────────────────────────────
  // The rows are the editorial layer: their names, search terms and grouping
  // are written for this page, and none of that exists on an issue. What
  // GitHub is authoritative about is the other half: whether a planned thing
  // is done, and what has been filed since this page was written. That is all
  // this reads back, and all of it is additive, so a rate limit, an outage or
  // an offline visitor leaves the page exactly as authored.
  var R = window.KonnektRelease
  if (!R || !R.fetchIssues) return

  // How many closed, completed issues no row links get added as done rows.
  var SHIPPED_MAX = 20

  var STAGE_LABEL = { alpha: 'ALPHA', beta: 'BETA', release: 'RELEASE', later: 'LATER' }

  // Both issue forms share a required "Which part of Konnekt?" dropdown, and
  // GitHub renders the answer into the body under that heading. The options
  // are fixed by .github/ISSUE_TEMPLATE/*.yml, and
  // frontend/scripts/check-issue-templates.mjs keeps the two forms holding the
  // same list. An answer this does not know lands in requested/, which is also
  // where "Something else, or not sure" goes.
  var AREA_GROUPS = {
    console: 'rm-console',
    commands: 'rm-console',
    stats: 'rm-stats',
    players: 'rm-players',
    performance: 'rm-performance',
    scheduler: 'rm-scheduler',
    worlds: 'rm-worlds',
    backups: 'rm-backups',
    config: 'rm-config',
    notifications: 'rm-notifications',
    'plugins and mods': 'rm-mods',
    'tile layout and dashboard': 'rm-layout',
    settings: 'rm-settings',
    'server setup and install': 'rm-server',
    updater: 'rm-release',
  }

  // The per-area `area:` labels in .github/labels.yml, plus `area:remote`. A
  // form is one way to file an issue, and one filed any other way has no
  // dropdown heading to parse. `area:ui`, `area:build` and `area:agents` name
  // no group, so an issue carrying only those falls through to its form answer.
  var LABEL_GROUPS = {
    'area:console': 'rm-console',
    'area:commands': 'rm-console',
    'area:stats': 'rm-stats',
    'area:players': 'rm-players',
    'area:performance': 'rm-performance',
    'area:scheduler': 'rm-scheduler',
    'area:worlds': 'rm-worlds',
    'area:backups': 'rm-backups',
    'area:config': 'rm-config',
    'area:notifications': 'rm-notifications',
    'area:mods': 'rm-mods',
    'area:layout': 'rm-layout',
    'area:settings': 'rm-settings',
    'area:server-setup': 'rm-server',
    'area:updater': 'rm-release',
    'area:remote': 'rm-remote-access',
  }

  var AREA_HEADING = /^###\s+Which part of Konnekt\?\s*$/im

  function mk(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function areaOf(body) {
    var text = String(body || '').replace(/\r\n/g, '\n')
    var at = text.search(AREA_HEADING)
    if (at === -1) return ''
    var lines = text.slice(at).split('\n').slice(1)
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) return lines[i].trim().toLowerCase()
    }
    return ''
  }

  function labelsOf(issue) {
    return (issue.labels || []).map(function (l) {
      return String((l && l.name) || l).toLowerCase()
    })
  }

  // Built the first time something needs it, so a quiet week leaves no empty
  // group at the bottom of the page.
  var requestedEl = null

  function requested() {
    if (requestedEl) return requestedEl
    requestedEl = mk('section', 'rm-group')
    requestedEl.id = 'rm-requested'
    requestedEl.setAttribute('data-path', 'requested')
    var head = mk('h2', 'rm-path')
    head.appendChild(mk('span', null, 'requested /'))
    head.appendChild(mk('span', 'rm-count'))
    requestedEl.appendChild(head)
    requestedEl.appendChild(mk('ul', 'rows'))
    groupsEl.insertBefore(requestedEl, emptyEl)
    return requestedEl
  }

  // The label wins over the form answer: it is a maintainer's decision, where
  // the answer is whatever a reporter picked as the closest option.
  function groupFor(area, labels) {
    var id = AREA_GROUPS[area]
    labels.forEach(function (label) {
      if (LABEL_GROUPS[label]) id = LABEL_GROUPS[label]
    })
    return (id && document.getElementById(id)) || requested()
  }

  // The markup an authored row uses, so every style applies to it.
  // data-github stays on it so the DOM shows which rows the tracker wrote.
  function buildRow(issue, stage) {
    // Fades in once. The filters hide rows with the hidden attribute, and an
    // animation restarts on the way back from display: none, so the class goes
    // when it has run rather than replaying on every filter change.
    var li = mk('li', 'row appear')
    li.addEventListener('animationend', function () {
      li.classList.remove('appear')
    })
    li.setAttribute('data-stage', stage)
    li.setAttribute('data-github', '')
    // The form prefixes every request's title, which is noise in a list that
    // is nothing but features.
    li.appendChild(mk('span', 'row-name', issue.title.replace(/^\[Feature\]:\s*/i, '')))

    var meta = mk('span', 'row-meta')
    var link = mk('a', 'row-issue', '#' + issue.number)
    link.href = issue.html_url
    link.target = '_blank'
    link.rel = 'noopener'
    meta.appendChild(link)
    var tag = mk('span', 'row-stage')
    var marker = mk('span', 'marker')
    marker.setAttribute('aria-hidden', 'true')
    tag.appendChild(marker)
    tag.appendChild(document.createTextNode(STAGE_LABEL[stage]))
    meta.appendChild(tag)
    li.appendChild(meta)
    return li
  }

  function markDone(row) {
    if (row.classList.contains('is-done')) return
    row.classList.add('is-done')
    var meta = row.querySelector('.row-meta')
    meta.insertBefore(mk('span', 'row-done', 'done'), meta.firstChild)
  }

  // Every row that links an issue, by number.
  var referenced = {}
  groupsEl.querySelectorAll('.row-issue').forEach(function (a) {
    var m = /\/issues\/(\d+)$/.exec(a.getAttribute('href') || '')
    if (m) referenced[m[1]] = a.closest('.row')
  })

  // Says a request is in flight, and then what came of it, so the rows the
  // tracker adds never arrive unannounced.
  var syncNote = mk('span', 'rm-sync loader', 'syncing with GitHub')
  statusEl.parentNode.insertBefore(syncNote, clearBtn)

  function settleSync(text) {
    syncNote.className = 'rm-sync appear'
    syncNote.textContent = text
  }

  R.fetchIssues()
    .then(function (res) {
      if (!res.ok || !res.data) {
        settleSync('could not sync with GitHub')
        return
      }

      var shipped = []
      var open = []
      res.data.forEach(function (issue) {
        var known = referenced[issue.number]
        if (known) {
          if (issue.state === 'closed') markDone(known)
          return
        }

        // Only planned work, and only once a person has looked at it. The form
        // stamps status:needs-triage on everything it files, so nothing reaches
        // the public roadmap unread. Bugs stay off: they are fixed as they
        // surface rather than listed. A bug label wins over a feature label
        // rather than tying (#53 carries both).
        var labels = labelsOf(issue)
        if (labels.indexOf('status:needs-triage') !== -1) return
        if (labels.indexOf('type:feature') === -1 && labels.indexOf('enhancement') === -1) return
        if (labels.indexOf('type:bug') !== -1 || labels.indexOf('bug') !== -1) return

        if (issue.state === 'open') open.push(issue)
        // Closed as completed is work that landed. not_planned and duplicate
        // are decisions not to build it, which a roadmap does not list.
        else if (issue.state_reason === 'completed') shipped.push(issue)
      })

      // Only the newest few: a closed issue no row links is history, and the
      // whole of it would bury the open work. Added after the open rows, so
      // within a group the done ones sit last.
      shipped.sort(function (a, b) {
        return String(b.closed_at || '').localeCompare(String(a.closed_at || ''))
      })
      shipped = shipped.slice(0, SHIPPED_MAX)

      var filed = 0
      function addRow(issue, done) {
        var labels = labelsOf(issue)
        // milestone:remote-access and no milestone at all are both Later: not
        // scheduled, and not forgotten. A closed row has been built, so with no
        // milestone it is read as alpha, and the done mark says the rest.
        var stage = labels.indexOf('milestone:beta') !== -1 ? 'beta' : done ? 'alpha' : 'later'
        if (done && labels.indexOf('milestone:later') !== -1) stage = 'later'
        if (done && labels.indexOf('milestone:remote-access') !== -1) stage = 'later'
        var row = buildRow(issue, stage)
        groupFor(areaOf(issue.body), labels).querySelector('.rows').appendChild(row)
        if (done) markDone(row)
        else filed++
      }

      open.forEach(function (issue) {
        addRow(issue, false)
      })
      shipped.forEach(function (issue) {
        addRow(issue, true)
      })

      if (open.length || shipped.length) {
        index()
        apply()
      }

      settleSync(filed ? 'synced with GitHub · ' + filed + ' filed since' : 'synced with GitHub')
    })
    .catch(function () {
      // The page is the roadmap without this.
      settleSync('could not sync with GitHub')
    })
})()
