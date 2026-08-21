/* Roadmap page — search, sort, filter and keyboard navigation over the feature
   tree in roadmap.html.

   The tree itself is static markup, so this file is pure enhancement: with it
   removed the page is still the whole roadmap and <details> still opens. That
   is also why nothing here builds a row — it only reads what the page already
   says, and every count, dot and stage total is derived from the markup rather
   than restated in a second place that could disagree with it. */
;(function () {
  var tree = document.getElementById('rm-tree')
  if (!tree) return

  var STAGES = ['alpha', 'beta', 'release', 'later']
  // Shorter than the FAQ's 220ms on purpose: a tree is browsed several clicks
  // deep, so the panel duration is paid on every one of them.
  var FOLD_MS = 140
  var TARGET_MS = 1200

  var statusText = document.getElementById('rm-status-text')
  var clearBtn = document.getElementById('rm-clear')
  var emptyEl = document.getElementById('rm-empty')
  var searchEl = document.getElementById('rm-search')
  var dirBtn = document.getElementById('rm-dir')

  // ── Index ───────────────────────────────────────────────────────────────
  // One pass at load. Everything the toolbar needs later is read off this map
  // rather than out of the DOM again: sorting a list is then a comparison over
  // numbers and strings, and filtering is a substring test, neither of which
  // touches layout.
  var info = new Map()
  var nodes = [].slice.call(tree.querySelectorAll('.rm-node'))
  var lists = [tree].concat([].slice.call(tree.querySelectorAll('.rm-children')))
  var folders = []
  var leaves = []
  var usedIds = {}

  function slugify(name) {
    var base =
      'rm-' +
      name
        .toLowerCase()
        .replace(/\/$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    var id = base
    var n = 2
    while (usedIds[id]) id = base + '-' + n++
    usedIds[id] = true
    return id
  }

  // The five area folders carry hand-written ids, because those are the ones
  // worth linking to from outside. Claim them before anything is generated so
  // a generated id can never collide with one.
  ;[].slice.call(tree.querySelectorAll('[id]')).forEach(function (el) {
    usedIds[el.id] = true
  })

  function indexNode(el, i) {
    var isFolder = el.classList.contains('rm-node-folder')
    var details = isFolder ? el.querySelector(':scope > .rm-folder') : null
    var nameEl = el.querySelector('.rm-name')
    var descEl = isFolder ? null : el.querySelector('.rm-desc')
    var name = nameEl.textContent
    var desc = descEl ? descEl.textContent : ''

    var rec = {
      el: el,
      folder: isFolder,
      details: details,
      row: el.querySelector('.rm-row'),
      nameEl: nameEl,
      descEl: descEl,
      name: name,
      desc: desc,
      key: name.replace(/\/$/, '').toLowerCase(),
      stage: isFolder ? -1 : STAGES.indexOf(el.getAttribute('data-stage')),
      order: i,
      countEl: isFolder ? el.querySelector('.rm-count') : null,
      dotsEl: isFolder ? el.querySelector('.rm-dots') : null,
      kids: [],
      visible: true,
    }

    info.set(el, rec)
    if (isFolder) folders.push(rec)
    else leaves.push(rec)

    var target = isFolder ? details : el
    if (!target.id) target.id = slugify(name)

    // The issue a row names, which is what the sync matches on.
    var link = isFolder ? null : el.querySelector('.rm-issue')
    var num = link ? Number(link.getAttribute('href').split('/').pop()) : 0
    if (num) {
      rec.issue = num
      referenced[num] = rec
    }

    return rec
  }

  // Parent, and the path a search matches against. Searching a tree means
  // searching paths: typing "backups" should bring back the folder and
  // everything in it, not only the four rows whose own text happens to repeat
  // the word, so a leaf carries its ancestors' names.
  function linkNode(rec) {
    var parentList = rec.el.parentNode
    var parentNode = parentList === tree ? null : parentList.closest('.rm-node')
    rec.parent = parentNode ? info.get(parentNode) : null

    var path = rec.name
    for (var p = rec.parent; p; p = p.parent) path = p.name + ' ' + path
    rec.hay = (path + ' ' + rec.desc).toLowerCase()
  }

  // Derived from the tree rather than stored: re-run after the sync adds rows
  // and every count on the page is right again without a second bookkeeping
  // path that could disagree with the first.
  function recount() {
    folders.forEach(function (f) {
      f.kids = []
    })
    leaves.forEach(function (leaf) {
      for (var p = leaf.parent; p; p = p.parent) p.kids.push(leaf)
    })
    folders.forEach(setFolderStage)
    countStages()
  }

  // The stage cards' totals. Authored into the markup so the page is right
  // without JavaScript, and recomputed here so it stays right when the sync
  // adds to it.
  function countStages() {
    document.querySelectorAll('.rm-stage-card').forEach(function (card) {
      var stage = card.getAttribute('data-stage')
      var n = leaves.filter(function (leaf) {
        return STAGES[leaf.stage] === stage
      }).length
      card.querySelector('.rm-stage-count').textContent = n
    })
  }

  var referenced = {}
  nodes.forEach(indexNode)
  nodes.forEach(function (el) {
    linkNode(info.get(el))
  })

  // Everything the status line and the stage cards say is counted from the
  // markup at load, not only when a filter runs: the authored numbers are what
  // the page shows without JavaScript, and they should not be able to drift
  // from the tree they describe once it is running.

  // A folder's stage is the last thing it is waiting on, not the first: sorted
  // by when each one is finished, an area with nothing but shipped work comes
  // before an area still waiting on a Beta tile, which comes before one waiting
  // on Later. Taking the earliest instead would tie every folder on Alpha —
  // all five areas contain something that shipped — and collapse the stage
  // sort into the name sort.
  function setFolderStage(f) {
    f.stage = f.kids.reduce(function (max, l) {
      return Math.max(max, l.stage)
    }, 0)
  }

  recount()

  // ── Filtering ───────────────────────────────────────────────────────────
  var query = ''
  var lastQuery = null
  var active = {}
  var savedOpen = null

  function stageFiltered() {
    return STAGES.some(function (s) {
      return active[s]
    })
  }

  function filtering() {
    return query !== '' || stageFiltered()
  }

  // Rebuilt from text nodes rather than from a string of HTML: the names and
  // descriptions are this page's own copy, but a <mark> assembled by
  // concatenation is the habit that eventually meets text that isn't.
  function paint(el, text, q) {
    el.textContent = ''
    if (!q) {
      el.textContent = text
      return
    }
    var lower = text.toLowerCase()
    var i = 0
    var at
    while ((at = lower.indexOf(q, i)) !== -1) {
      if (at > i) el.appendChild(document.createTextNode(text.slice(i, at)))
      var m = document.createElement('mark')
      m.textContent = text.slice(at, at + q.length)
      el.appendChild(m)
      i = at + q.length
    }
    el.appendChild(document.createTextNode(text.slice(i)))
  }

  function apply() {
    var byStage = stageFiltered()
    var shown = 0

    leaves.forEach(function (leaf) {
      var ok =
        (!byStage || active[STAGES[leaf.stage]]) && (query === '' || leaf.hay.indexOf(query) !== -1)
      leaf.visible = ok
      leaf.el.classList.toggle('is-filtered', !ok)
      if (ok) shown++
    })

    // Only when the text changed: a stage toggle cannot move a highlight, and
    // repainting every name for it would be work with nothing to show for it.
    if (query !== lastQuery) {
      leaves.forEach(function (leaf) {
        paint(leaf.nameEl, leaf.name, query)
        if (leaf.descEl) paint(leaf.descEl, leaf.desc, query)
      })
      lastQuery = query
    }

    if (filtering() && savedOpen === null) {
      savedOpen = folders.filter(function (f) {
        return f.details.open
      })
    }

    folders.forEach(function (f) {
      var live = f.kids.filter(function (l) {
        return l.visible
      })
      f.visible = live.length > 0
      f.el.classList.toggle('is-filtered', !f.visible)
      f.countEl.textContent = live.length
      f.dotsEl.textContent = ''
      STAGES.forEach(function (s, si) {
        if (
          !live.some(function (l) {
            return l.stage === si
          })
        )
          return
        var dot = document.createElement('i')
        dot.className = 'rm-dot rm-dot-' + s
        f.dotsEl.appendChild(dot)
      })
      // Opened outright rather than through the animation: a filter is a
      // change of view, not a gesture on one folder, and animating twenty of
      // them at once is the thing that would make typing feel slow.
      if (filtering() && f.visible) setOpen(f, true)
    })

    if (!filtering() && savedOpen) {
      folders.forEach(function (f) {
        setOpen(f, savedOpen.indexOf(f) !== -1)
      })
      savedOpen = null
    }

    emptyEl.classList.toggle('is-hidden', shown > 0)
    tree.classList.toggle('is-hidden', shown === 0)
    clearBtn.classList.toggle('is-hidden', !filtering())
    statusText.textContent = filtering()
      ? 'showing ' + shown + ' of ' + leaves.length
      : leaves.length + ' features across ' + tree.children.length + ' areas'
  }

  // Bypasses the height animation and any close it interrupts, so a folder
  // opened by the filter cannot be left mid-flight with `is-closing` on it.
  function setOpen(rec, open) {
    rec.details.classList.remove('is-closing')
    rec.details.open = open
  }

  // ── Sorting ─────────────────────────────────────────────────────────────
  var mode = 'order'
  var desc = false

  function compare(a, b) {
    var A = info.get(a)
    var B = info.get(b)
    // Folders above files, the way a file manager does it, and independent of
    // the direction toggle: reversing the sort should not turn the tree inside
    // out.
    if (A.folder !== B.folder) return A.folder ? -1 : 1

    var r = 0
    if (mode === 'order') r = A.order - B.order
    else if (mode === 'name') r = A.key < B.key ? -1 : A.key > B.key ? 1 : 0
    else r = A.stage - B.stage || (A.key < B.key ? -1 : A.key > B.key ? 1 : 0)

    return desc ? -r : r
  }

  function sortTree() {
    lists.forEach(function (list) {
      var items = [].slice.call(list.children)
      items.sort(compare)
      var frag = document.createDocumentFragment()
      items.forEach(function (li) {
        frag.appendChild(li)
      })
      list.appendChild(frag)
    })
  }

  // ── Controls ────────────────────────────────────────────────────────────
  // Search runs on a frame rather than on every input event: holding a key
  // down fires faster than the screen updates, and the work is wasted.
  var queued = false
  searchEl.addEventListener('input', function () {
    if (queued) return
    queued = true
    window.requestAnimationFrame(function () {
      queued = false
      query = searchEl.value.trim().toLowerCase()
      apply()
    })
  })

  searchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && searchEl.value !== '') {
      e.stopPropagation()
      searchEl.value = ''
      query = ''
      apply()
    }
  })

  document.querySelectorAll('.rm-stage-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var stage = card.getAttribute('data-stage')
      active[stage] = !active[stage]
      card.setAttribute('aria-pressed', active[stage] ? 'true' : 'false')
      apply()
    })
  })

  document.querySelectorAll('.rm-sort-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      mode = btn.getAttribute('data-sort')
      document.querySelectorAll('.rm-sort-btn').forEach(function (other) {
        other.setAttribute('aria-pressed', other === btn ? 'true' : 'false')
      })
      sortTree()
    })
  })

  dirBtn.addEventListener('click', function () {
    desc = !desc
    dirBtn.setAttribute('aria-pressed', desc ? 'true' : 'false')
    sortTree()
  })

  document.querySelectorAll('.rm-fold-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('data-fold') === 'expand'
      folders.forEach(function (f) {
        setOpen(f, open)
      })
      savedOpen = null
    })
  })

  clearBtn.addEventListener('click', function () {
    searchEl.value = ''
    query = ''
    STAGES.forEach(function (s) {
      active[s] = false
    })
    document.querySelectorAll('.rm-stage-card').forEach(function (card) {
      card.setAttribute('aria-pressed', 'false')
    })
    apply()
    searchEl.focus()
  })

  // ── Folder animation ────────────────────────────────────────────────────
  folders.forEach(function (f) {
    window.KonnektDisclose(f.details, FOLD_MS)
  })

  // ── Keyboard ────────────────────────────────────────────────────────────
  // Roving focus, the way a file tree behaves: Tab reaches the tree once, and
  // the arrows walk it from there. The rows are still <summary> elements, so
  // Enter and Space keep toggling a folder without anything here.
  var KEYS = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']

  tree.querySelectorAll('.rm-row').forEach(function (row, i) {
    row.setAttribute('tabindex', i === 0 ? '0' : '-1')
  })

  // Answered from the tree's own state rather than from layout: a closed
  // <details> no longer hides its contents with display:none in every engine —
  // Chrome uses content-visibility so the panel can be animated — and an
  // offsetParent test quietly reports every collapsed row as visible there.
  function onScreen(rec) {
    if (rec.el.classList.contains('is-filtered')) return false
    for (var p = rec.parent; p; p = p.parent) {
      if (p.el.classList.contains('is-filtered') || !p.details.open) return false
    }
    return true
  }

  function visibleRows() {
    return nodes
      .map(function (el) {
        return info.get(el)
      })
      .filter(onScreen)
      .map(function (rec) {
        return rec.row
      })
  }

  function focusRow(row) {
    if (!row) return
    tree.querySelectorAll('.rm-row[tabindex="0"]').forEach(function (old) {
      old.setAttribute('tabindex', '-1')
    })
    row.setAttribute('tabindex', '0')
    row.focus()
  }

  tree.addEventListener('keydown', function (e) {
    if (KEYS.indexOf(e.key) === -1) return
    var row = e.target.closest ? e.target.closest('.rm-row') : null
    if (!row) return

    var rec = info.get(row.closest('.rm-node'))
    var rows = visibleRows()
    var i = rows.indexOf(row)
    e.preventDefault()

    if (e.key === 'ArrowDown') focusRow(rows[i + 1])
    else if (e.key === 'ArrowUp') focusRow(rows[i - 1])
    else if (e.key === 'Home') focusRow(rows[0])
    else if (e.key === 'End') focusRow(rows[rows.length - 1])
    else if (e.key === 'ArrowRight') {
      // Clicked rather than opened directly, so the keyboard gets the same
      // animation the mouse does.
      if (rec.folder && !rec.details.open) row.click()
      else if (rec.folder) focusRow(rows[i + 1])
    } else if (e.key === 'ArrowLeft') {
      if (rec.folder && rec.details.open) row.click()
      else if (rec.parent) focusRow(rec.parent.row)
    }
  })

  // ── Deep links ──────────────────────────────────────────────────────────
  // #rm-file-explorer opens everything above it and marks it once. Nothing
  // here writes the hash back: a folder opening is not a page you navigated to.
  function revealHash() {
    var id = window.location.hash.slice(1)
    if (!id) return
    var el = document.getElementById(id)
    if (!el || !tree.contains(el)) return

    var node = el.closest('.rm-node')
    for (var p = info.get(node).parent; p; p = p.parent) setOpen(p, true)

    tree.querySelectorAll('.is-target').forEach(function (old) {
      old.classList.remove('is-target')
    })
    node.classList.add('is-target')
    window.setTimeout(function () {
      node.classList.remove('is-target')
    }, TARGET_MS)

    var target = info.get(node).row
    focusRow(target)
    target.scrollIntoView({
      behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth',
      block: 'center',
    })
  }

  window.addEventListener('hashchange', revealHash)
  revealHash()

  // Once, with nothing filtered, so the status line is counted from the tree
  // rather than left on the number the markup was written with.
  apply()

  // ── GitHub sync ─────────────────────────────────────────────────────────
  // The tree above is the editorial layer: its names, its one-line
  // descriptions and its structure are written for this page, and none of that
  // exists on an issue — the suite's label taxonomy stops at `area:ui`, so
  // there is no per-tile information to build a hierarchy from, and an issue
  // title reads like "Backups tile: manage all world-specific backups in the
  // 'World-specific' segment", which is not a line for a marketing page.
  //
  // What GitHub is authoritative about is the other half: whether a planned
  // thing is done, and what has been filed since this page was written. That is
  // all this reads back, and all of it is additive. The page is already the
  // whole roadmap before the request resolves, so a rate limit, an outage or an
  // offline visitor leaves it exactly as authored — no banner, no spinner, no
  // empty state. changelog.js swallows its snapshot failure the same way.
  var R = window.KonnektRelease
  if (!R || !R.fetchIssues) return

  var STAGE_LABEL = { alpha: 'ALPHA', beta: 'BETA', release: 'RELEASE', later: 'LATER' }

  // Both issue forms share a required "Which part of Konnekt?" dropdown, and
  // GitHub renders the answer into the body under that heading. It is the only
  // per-tile fact an issue carries, so it is what files a new one into the
  // right folder. The options are fixed by .github/ISSUE_TEMPLATE/*.yml, and
  // frontend/scripts/check-issue-templates.mjs already keeps the two forms
  // holding the same list. An answer this does not know lands in requested/,
  // which is also where "Something else, or not sure" goes.
  var AREA_FOLDERS = {
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
  // folder sitting at the bottom of the tree.
  var requestedRec = null

  function requested() {
    if (requestedRec) return requestedRec

    var li = mk('li', 'rm-node rm-node-folder')
    li.setAttribute('data-github', '')
    var details = mk('details', 'rm-folder')
    var row = mk('summary', 'rm-row rm-row-folder')
    row.setAttribute('tabindex', '-1')
    var label = mk('span', 'rm-label')
    label.appendChild(mk('span', 'rm-name', 'requested/'))
    var dots = mk('span', 'rm-dots')
    dots.setAttribute('aria-hidden', 'true')

    row.appendChild(label)
    row.appendChild(mk('span', 'rm-count'))
    row.appendChild(dots)
    details.appendChild(row)
    details.appendChild(mk('ul', 'rm-children'))
    li.appendChild(details)
    tree.appendChild(li)

    requestedRec = indexNode(li, nodes.length)
    linkNode(requestedRec)
    window.KonnektDisclose(details, FOLD_MS)
    return requestedRec
  }

  function folderFor(area) {
    var id = AREA_FOLDERS[area]
    var el = id ? document.getElementById(id) : null
    return el ? info.get(el.closest('.rm-node')) : requested()
  }

  // Same markup an authored row uses, so every style, the search highlight and
  // the row fade apply to it without a rule of its own. data-github is left on
  // it so it stays visible in the DOM which rows this page wrote and which the
  // tracker did.
  function buildLeaf(issue, stage) {
    var li = mk('li', 'rm-node rm-node-leaf')
    li.setAttribute('data-stage', stage)
    li.setAttribute('data-github', '')

    var row = mk('div', 'rm-row rm-row-leaf')
    row.setAttribute('tabindex', '-1')

    var label = mk('span', 'rm-label')
    // The form prefixes every request's title, which is noise in a column that
    // is nothing but features.
    label.appendChild(mk('span', 'rm-name', issue.title.replace(/^\[Feature\]:\s*/i, '')))

    var link = mk('a', 'rm-issue', '#' + issue.number)
    link.href = issue.html_url
    link.target = '_blank'
    link.rel = 'noopener'
    link.setAttribute('aria-label', 'Issue ' + issue.number + ' on GitHub')

    row.appendChild(label)
    row.appendChild(mk('span', 'rm-desc', 'Filed on GitHub'))
    row.appendChild(mk('span', 'tag tag-stage', STAGE_LABEL[stage]))
    row.appendChild(link)
    li.appendChild(row)
    return li
  }

  // A closed issue is merged, not released, so the stage chip is left alone and
  // the mark is not green: green now means a full release, which a merged beta
  // issue is not yet. The leaf's own marker fills in, the way a shipped one is.
  function markDone(rec) {
    if (rec.el.classList.contains('is-done')) return
    rec.el.classList.add('is-done')
    var mark = mk('span', 'rm-done', '✓')
    mark.title = 'Closed on GitHub'
    mark.appendChild(mk('span', 'sr-only', ' done'))
    rec.nameEl.parentNode.appendChild(mark)
  }

  R.fetchIssues()
    .then(function (res) {
      if (!res.ok || !res.data || !res.data.length) return

      var added = 0
      res.data.forEach(function (issue) {
        var known = referenced[issue.number]
        if (known) {
          if (issue.state === 'closed') markDone(known)
          return
        }
        if (issue.state !== 'open') return

        // Only planned work, and only once a person has looked at it. The form
        // stamps status:needs-triage on everything it files, so nothing reaches
        // the public roadmap unread — and clearing that one label is what puts
        // an item here, with no edit to this site at all. Bugs stay off by the
        // rule the note under the tree already states: they are fixed as they
        // surface rather than listed.
        var labels = labelsOf(issue)
        if (labels.indexOf('status:needs-triage') !== -1) return
        if (labels.indexOf('type:feature') === -1 && labels.indexOf('enhancement') === -1) return
        // A bug label wins over a feature label rather than tying: #53 carries
        // both, and it is a report that a column switcher is broken, which is
        // not a roadmap entry in either direction.
        if (labels.indexOf('type:bug') !== -1 || labels.indexOf('bug') !== -1) return

        // milestone:remote-access and no milestone at all are both Later, which
        // is what that card says: not scheduled, and not forgotten.
        var stage = labels.indexOf('milestone:beta') !== -1 ? 'beta' : 'later'
        var folder = folderFor(areaOf(issue.body))
        var li = buildLeaf(issue, stage)

        folder.el.querySelector('.rm-children').appendChild(li)
        linkNode(indexNode(li, nodes.length + added))
        added++
      })

      if (added) {
        // Document order is what the keyboard walks and what the roadmap sort
        // restores, so both caches are taken again rather than appended to.
        nodes = [].slice.call(tree.querySelectorAll('.rm-node'))
        lists = [tree].concat([].slice.call(tree.querySelectorAll('.rm-children')))
        recount()
        sortTree()
        apply()
      }

      var note = mk(
        'span',
        'rm-sync',
        added ? 'synced with GitHub · ' + added + ' filed since' : 'synced with GitHub',
      )
      document.getElementById('rm-status').appendChild(note)
    })
    .catch(function () {
      /* The page is the roadmap without this. */
    })
})()
