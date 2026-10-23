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

  // ── Resize ─────────────────────────────────────────────────────────────
  // What opens, closes or refilters takes its box from the old height to the
  // new one over a panel's duration rather than jumping, and what it reveals
  // fades in. A page script hands its change to KonnektMotion.resize and the
  // motion is the same everywhere. Under reduced motion the change just
  // happens.
  //
  // `leaving` lists elements the change hides: they stay drawn, fading, while
  // the box closes over them, and take their hidden attribute when it has.
  // `done` runs then too. A resize started on a box mid-animation starts from
  // where the box is, so a quick second click reverses rather than jumps.
  var rootStyle = getComputedStyle(document.documentElement)
  var PANEL_MS = parseFloat(rootStyle.getPropertyValue('--duration-panel')) || 280
  var EASE = rootStyle.getPropertyValue('--ease-standard').trim() || 'ease'
  var running = typeof WeakMap === 'function' ? new WeakMap() : null

  function fade(el, show) {
    var frames = [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ]
    return el.animate(show ? frames : frames.reverse(), {
      duration: PANEL_MS,
      easing: EASE,
      fill: show ? 'none' : 'forwards',
    })
  }

  function resize(box, change, leaving, done) {
    leaving = leaving || []
    if (reduceMotion || !running || typeof box.animate !== 'function') {
      if (change) change()
      leaving.forEach(function (el) {
        el.hidden = true
      })
      if (done) done()
      return
    }

    var from = box.getBoundingClientRect().height
    var prev = running.get(box)
    if (prev) prev.cancel()

    var before = [].slice.call(box.querySelectorAll('[hidden]'))
    if (change) change()
    leaving.forEach(function (el) {
      el.hidden = true
    })
    var to = box.getBoundingClientRect().height
    leaving.forEach(function (el) {
      el.hidden = false
    })

    // Only the outermost of what appeared fades, so a group and its rows do
    // not both start from nothing.
    var shown = before.filter(function (el) {
      return !el.hidden
    })
    shown.forEach(function (el) {
      var nested = shown.some(function (other) {
        return other !== el && other.contains(el)
      })
      if (!nested) fade(el, true)
    })
    var fades = leaving.map(function (el) {
      return fade(el, false)
    })

    // Held at the end height until settle has hidden what was leaving, so no
    // frame shows the box at its full height in between.
    var anim = box.animate(
      { height: [from + 'px', to + 'px'] },
      { duration: Math.abs(from - to) < 1 ? 0 : PANEL_MS, easing: EASE, fill: 'forwards' },
    )
    box.classList.add('is-resizing')
    running.set(box, anim)

    function settle(finished) {
      anim.onfinish = anim.oncancel = null
      if (running.get(box) === anim) running.delete(box)
      leaving.forEach(function (el) {
        el.hidden = true
      })
      fades.forEach(function (f) {
        f.cancel()
      })
      if (finished && done) done()
      anim.cancel()
      box.classList.remove('is-resizing')
    }
    anim.onfinish = function () {
      settle(true)
    }
    anim.oncancel = function () {
      settle(false)
    }
  }

  window.KonnektMotion = { resize: resize }

  // Every <details> on the site opens and closes through resize. Closing, its
  // content stays until the box has shut over it; the open attribute, and with
  // it the summary's + or −, goes last.
  document.addEventListener('click', function (e) {
    var summary = e.target.closest ? e.target.closest('summary') : null
    var details = summary && summary.parentElement
    if (!details || details.tagName !== 'DETAILS' || details.firstElementChild !== summary) return
    if (reduceMotion || !running) return
    e.preventDefault()
    var content = [].slice.call(details.children).filter(function (el) {
      return el !== summary
    })
    var closing = details.open && !details.hasAttribute('data-closing')
    if (closing) {
      details.setAttribute('data-closing', '')
      resize(details, null, content, function () {
        details.open = false
        details.removeAttribute('data-closing')
        content.forEach(function (el) {
          el.hidden = false
        })
      })
    } else {
      details.removeAttribute('data-closing')
      resize(details, function () {
        details.open = true
        content.forEach(function (el) {
          el.hidden = false
        })
      })
    }
  })

  // ── Glow ───────────────────────────────────────────────────────────────
  // The edge of every outermost block lights up nearest the cursor, brighter
  // the closer it is, as the scheduler's nodes do in the app. One listener for
  // the page, coalesced to a frame, writes --mx/--my on each block within
  // reach and clears a block once it falls out of it. Mouse and pen only: a
  // touch has no hover, and the light would stick where it last landed.
  var GLOW_REACH = 320
  if (!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var html = document.documentElement
    var pointer = null
    var glowFrame = 0
    var lit = []

    var paintGlow = function () {
      glowFrame = 0
      if (!pointer) return
      var blocks = [].slice.call(document.querySelectorAll('.block:not(.block .block)'))
      // Every read before any write, so the writes force no layout per block.
      var measured = blocks.map(function (el) {
        var r = el.getBoundingClientRect()
        var near =
          pointer.x > r.left - GLOW_REACH &&
          pointer.x < r.right + GLOW_REACH &&
          pointer.y > r.top - GLOW_REACH &&
          pointer.y < r.bottom + GLOW_REACH
        return { el: el, x: pointer.x - r.left, y: pointer.y - r.top, near: near }
      })
      var nowLit = []
      measured.forEach(function (m) {
        if (m.near) {
          m.el.style.setProperty('--mx', Math.round(m.x) + 'px')
          m.el.style.setProperty('--my', Math.round(m.y) + 'px')
          nowLit.push(m.el)
        } else if (lit.indexOf(m.el) !== -1) {
          m.el.style.removeProperty('--mx')
          m.el.style.removeProperty('--my')
        }
      })
      lit = nowLit
    }

    var scheduleGlow = function () {
      if (!glowFrame) glowFrame = window.requestAnimationFrame(paintGlow)
    }

    document.addEventListener(
      'pointermove',
      function (e) {
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
        pointer = { x: e.clientX, y: e.clientY }
        html.removeAttribute('data-glow-idle')
        scheduleGlow()
      },
      { passive: true },
    )
    // Scrolling and the focus lift move blocks under a still cursor.
    window.addEventListener('scroll', scheduleGlow, { passive: true })
    html.addEventListener('pointerleave', function () {
      html.setAttribute('data-glow-idle', '')
    })
  }

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
