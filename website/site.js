/* Shared behaviour for the pages on site.css: the nav, the release line, and
   the group that lifts as it reaches the middle of the screen. All of it is
   enhancement; with this file missing every page still reads and links. */
;(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── Nav ────────────────────────────────────────────────────────────────
  // The nav is byte-identical on every page, so which page you are on is
  // marked here rather than in the markup.
  //
  // Pages serves /docs.html as /docs and /docs/index.html as /docs/, so the
  // extension and a trailing index are dropped before anything is compared.
  function normalisePath(path) {
    return path.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '') || '/'
  }

  var here = normalisePath(window.location.pathname)
  var nav = document.getElementById('nav')
  if (nav) {
    nav.querySelectorAll('a[href]').forEach(function (link) {
      // A section link (#features) points at the home page, but marking it
      // current wherever that page is open would light two links at once.
      if (link.hash || link.host !== window.location.host) return
      var path = normalisePath(link.pathname)
      // /docs is current on /docs/install too: the pages under a section are
      // that section's.
      if (path === here || (path !== '/' && here.indexOf(path + '/') === 0)) {
        link.setAttribute('aria-current', 'page')
      }
    })
  }

  // "/" jumps to the page's search field, as the glyph beside it says.
  var search = document.querySelector('.search input')
  if (search) {
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      var t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      search.focus()
    })
  }

  // A jump to one of the groups that lift (#features from the nav) puts it in
  // the middle of the screen, where the lift is, rather than against the top.
  // One taller than the screen starts a gap below the top instead, as every
  // other anchor does through scroll-margin-top. Measured through offsetTop,
  // which leaves out the lift's own transform.
  function scrollToTarget(target, behavior) {
    if (!target.hasAttribute('data-focus')) {
      target.scrollIntoView({ behavior: behavior, block: 'start' })
      return
    }
    var top = 0
    for (var n = target; n; n = n.offsetParent) top += n.offsetTop
    var gap = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
    var room = window.innerHeight - target.offsetHeight
    window.scrollTo({ top: room >= 2 * gap ? top - room / 2 : top - gap, behavior: behavior })
  }

  // Same-page anchors scroll rather than reload. Without this they are
  // ordinary links that land on the anchor, which is fine.
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href]') : null
    if (!link || link.target === '_blank' || !link.hash) return
    if (link.host !== window.location.host || normalisePath(link.pathname) !== here) return
    var target = document.getElementById(link.hash.slice(1))
    if (!target) return
    e.preventDefault()
    scrollToTarget(target, reduceMotion ? 'auto' : 'smooth')
    history.pushState(null, '', link.hash)
  })

  // Arriving from another page (/index.html#features from the docs), the
  // browser has already put the group at the top; this moves it to where a
  // click on this page would have. Again once everything has loaded, since
  // the browser's own jump to the anchor can land after this script runs,
  // unless the reader has started scrolling by then. A reload or a step back
  // through history restores where the reader was, which stays.
  var navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]
  var moved = !!navEntry && navEntry.type !== 'navigate'
  function arriveAtHash() {
    var target = window.location.hash && document.getElementById(window.location.hash.slice(1))
    if (target && target.hasAttribute('data-focus') && !moved) scrollToTarget(target, 'auto')
  }
  ;['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
    window.addEventListener(
      type,
      function () {
        moved = true
      },
      { once: true, passive: true },
    )
  })
  arriveAtHash()
  window.addEventListener('load', arriveAtHash)

  // ── Release line ───────────────────────────────────────────────────────
  // [data-release-tag] gains the latest tag and a separator, and
  // [data-release-line] the tag and its date. The markup reads correctly
  // without either, so a rate limit or an outage leaves it as written.
  var tagSlots = document.querySelectorAll('[data-release-tag]')
  var lineSlots = document.querySelectorAll('[data-release-line]')
  var R = window.KonnektRelease
  if (R && (tagSlots.length || lineSlots.length)) {
    R.fetchLatest()
      .then(function (res) {
        if (!res.ok || !res.data || !res.data.tag_name) return
        var tag = res.data.tag_name
        tagSlots.forEach(function (el) {
          el.textContent = tag + ' · '
        })
        var line = [tag, R.formatDate(res.data.published_at)].filter(Boolean).join(' · ')
        lineSlots.forEach(function (el) {
          el.textContent = line
          el.hidden = false
        })
      })
      .catch(function () {
        /* The markup already says what it says. */
      })
  }

  // ── Focus ──────────────────────────────────────────────────────────────
  // Of the [data-focus] groups, the one under the middle of the screen (or
  // nearest it) lifts and the others soften. Nothing is focused while the
  // whole page fits on screen, or under reduced motion.
  var groups = [].slice.call(document.querySelectorAll('[data-focus]'))
  if (!groups.length || reduceMotion) return

  var current = null
  var frame = 0

  function nearest() {
    var vh = window.innerHeight
    if (document.documentElement.scrollHeight <= vh + 4) return null
    var mid = vh / 2
    var best = null
    var bestDist = Infinity
    groups.forEach(function (el) {
      var r = el.getBoundingClientRect()
      var dist =
        r.top <= mid && r.bottom >= mid
          ? 0
          : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid))
      if (dist < bestDist) {
        best = el
        bestDist = dist
      }
    })
    return best
  }

  function update() {
    frame = 0
    var next = nearest()
    if (next === current) return
    current = next
    groups.forEach(function (el) {
      el.classList.toggle('is-focus', el === current)
      el.classList.toggle('is-dim', current !== null && el !== current)
    })
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(update)
  }

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  update()
})()
