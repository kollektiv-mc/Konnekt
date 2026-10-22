/* Shared behaviour for the pages on site.css: the nav, the release line, and
   the group that lifts as it reaches the middle of the screen. All of it is
   enhancement; with this file missing every page still reads and links. */
;(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── Nav ────────────────────────────────────────────────────────────────
  // The nav is byte-identical on every page, so which page you are on is
  // marked here rather than in the markup.
  function normalisePath(path) {
    return path.replace(/\/index\.html$/, '/').replace(/\/+$/, '/') || '/'
  }

  var here = normalisePath(window.location.pathname)
  var nav = document.getElementById('nav')
  if (nav) {
    nav.querySelectorAll('a[href]').forEach(function (link) {
      // A section link (#features) points at the home page, but marking it
      // current wherever that page is open would light two links at once.
      if (
        !link.hash &&
        link.host === window.location.host &&
        normalisePath(link.pathname) === here
      ) {
        link.setAttribute('aria-current', 'page')
      }
    })
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
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    history.pushState(null, '', link.hash)
  })

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
