;(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    document.documentElement.classList.add('reduce-motion')
  }

  // ── Hero intro teardown ────────────────────────────────────────────────
  // Once the intro finishes, mark the hero so CSS can drop the animations.
  // A finished `forwards` animation still holds its last keyframe, and a
  // filter or transform value — even an identity one — keeps the element on
  // its own composited layer, which renders the text slightly soft. The
  // keyframes end on `none` for this reason too; this is the guarantee.
  var hero = document.querySelector('.hero')
  if (hero) {
    var heroAnims = hero.getAnimations ? hero.getAnimations({ subtree: true }) : []
    if (heroAnims.length) {
      Promise.allSettled(
        heroAnims.map(function (a) {
          return a.finished
        }),
      ).then(function () {
        hero.classList.add('intro-done')
      })
    } else {
      // No animations to wait on (reduced motion, or an engine without the
      // Web Animations API) — the resting state is already correct.
      hero.classList.add('intro-done')
    }
  }

  // ── Nav ────────────────────────────────────────────────────────────────
  // The nav markup is byte-identical on every page — including the link hrefs,
  // which are all fully qualified (./index.html#features) so they cannot drift
  // apart again. That costs two things, both restored here: knowing which page
  // you're on, and same-page anchors scrolling instead of reloading.

  var nav = document.getElementById('nav')
  // Includes the action buttons so the download page is marked too; only
  // .nav-links carries the visual underline for it.
  var navLinks = nav ? nav.querySelectorAll('.nav-links a, .nav-actions a') : []

  // Trailing "index.html" and a trailing slash are the same page to a server
  // but different strings to us; normalise before comparing.
  function normalisePath(path) {
    return path.replace(/\/index\.html$/, '/').replace(/\/+$/, '/') || '/'
  }

  var here = normalisePath(window.location.pathname)

  for (var i = 0; i < navLinks.length; i++) {
    // Skip in-page section links (#features) — they point at the home page but
    // marking them "current" everywhere you can scroll to a section is noise.
    if (!navLinks[i].hash && normalisePath(navLinks[i].pathname) === here) {
      navLinks[i].setAttribute('aria-current', 'page')
    }
  }

  // Same-page anchors: scroll rather than navigate. Without JS these stay
  // ordinary links that reload and land on the anchor, which is fine.
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href]') : null
    if (!link || link.target === '_blank') return
    if (!link.hash || normalisePath(link.pathname) !== here) return

    var target = document.querySelector(link.hash)
    if (!target) return

    e.preventDefault()
    target.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
    history.pushState(null, '', link.hash)
  })

  // ── Mobile disclosure menu ─────────────────────────────────────────────
  var toggle = document.getElementById('nav-toggle')
  var menu = document.getElementById('nav-menu')

  if (toggle && menu) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      menu.classList.toggle('is-open', open)
      toggle.textContent = open ? '✕' : '≡'
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation()
      setOpen(toggle.getAttribute('aria-expanded') !== 'true')
    })

    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false)
    })

    document.addEventListener('click', function (e) {
      if (menu.classList.contains('is-open') && !nav.contains(e.target)) setOpen(false)
    })

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        setOpen(false)
        toggle.focus()
      }
    })

    // Leaving the mobile breakpoint with the menu open would strand `.is-open`
    // on a menu that's `display: contents` again.
    window.matchMedia('(min-width: 861px)').addEventListener('change', function (e) {
      if (e.matches) setOpen(false)
    })
  }

  // ── Reveal-on-scroll for anything marked .reveal ────────────────────────
  var revealEls = document.querySelectorAll('.reveal')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) {
      el.classList.add('in-view')
    })
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    )
    revealEls.forEach(function (el) {
      observer.observe(el)
    })
  }

  // ── Section rail ────────────────────────────────────────────────────────
  // The indicator for the desktop scroll snapping (styles.css, .section-full).
  // Sections opt in with data-nav="<label>", which only the landing page
  // carries, so no sub-page grows a rail for sections it doesn't have. CSS
  // hides it below 861px, where the sections stop being viewport panels and
  // snapping is off.
  //
  // The dots are ordinary #hash links, so the delegated handler above already
  // gives them smooth scrolling and a history entry — nothing to duplicate.
  var sections = document.querySelectorAll('[data-nav][id]')

  if (sections.length > 1) {
    var rail = document.createElement('nav')
    rail.className = 'rail'
    rail.setAttribute('aria-label', 'Sections')

    var dots = []
    for (var s = 0; s < sections.length; s++) {
      var dot = document.createElement('a')
      dot.className = 'rail-dot'
      dot.href = '#' + sections[s].id
      var label = document.createElement('span')
      label.className = 'rail-label'
      label.textContent = sections[s].getAttribute('data-nav')
      dot.appendChild(label)
      rail.appendChild(dot)
      dots.push(dot)
    }

    document.body.appendChild(rail)

    var activeSection = null
    var railTracking = false

    var setActive = function (el) {
      if (el === activeSection) return
      activeSection = el
      for (var i = 0; i < dots.length; i++) {
        if (sections[i] === el) {
          dots[i].setAttribute('aria-current', 'true')
          // Where the rail's travelling mark should be (styles.css, .rail::after).
          // Measured off the dot rather than worked out from its index, so the
          // rail's spacing stays a fact of one stylesheet rather than a number
          // this file also has to know.
          rail.style.setProperty('--rail-y', dots[i].offsetTop + dots[i].offsetHeight / 2 + 'px')
        } else {
          dots[i].removeAttribute('aria-current')
        }
      }

      // The mark's transition is switched on a frame after it is first placed,
      // so loading straight onto a section further down puts it there rather
      // than sliding it the length of the rail to get there.
      if (!railTracking) {
        railTracking = true
        window.requestAnimationFrame(function () {
          rail.classList.add('is-tracking')
        })
      }
    }

    // Whichever section covers the middle of the viewport is the one you're
    // looking at. Falling back to the nearest edge covers the gaps a snapped
    // layout doesn't normally produce — a short last section above the footer,
    // or the moment mid-scroll where no section spans the midpoint.
    var currentSection = function () {
      var mid = window.innerHeight / 2
      var best = null
      var bestDist = Infinity
      for (var i = 0; i < sections.length; i++) {
        var r = sections[i].getBoundingClientRect()
        if (r.top <= mid && r.bottom >= mid) return sections[i]
        var dist = Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid))
        if (dist < bestDist) {
          bestDist = dist
          best = sections[i]
        }
      }
      return best
    }

    var railQueued = false

    var updateRail = function () {
      railQueued = false
      setActive(currentSection())
    }

    var requestRail = function () {
      if (railQueued) return
      railQueued = true
      window.requestAnimationFrame(updateRail)
    }

    // An observer on the same middle band as currentSection() wakes us only
    // when a section crosses it, rather than on every scroll frame.
    if ('IntersectionObserver' in window) {
      var railObserver = new IntersectionObserver(requestRail, {
        rootMargin: '-45% 0px -45% 0px',
        threshold: 0,
      })
      for (var o = 0; o < sections.length; o++) {
        railObserver.observe(sections[o])
      }
    } else {
      window.addEventListener('scroll', requestRail, { passive: true })
    }

    window.addEventListener('resize', requestRail)
    updateRail()
  }

  // ── Footer height, published to the stylesheet ──────────────────────────
  // The last landing-page section is sized to leave exactly enough room for
  // the footer (styles.css, `.cta` in the snapping media query), so that
  // section's snap point and the document end land on the same scroll
  // position. Left to themselves they sit a footer's height apart — two snap
  // points too close together, which is what made resting on the download
  // section feel unreliable and kept sliding it up under the fixed nav.
  var pageFooter = document.querySelector('body > footer')
  if (pageFooter) {
    var publishFooterHeight = function () {
      document.documentElement.style.setProperty(
        '--footer-h',
        Math.round(pageFooter.getBoundingClientRect().height) + 'px',
      )
    }
    if ('ResizeObserver' in window) {
      new ResizeObserver(publishFooterHeight).observe(pageFooter)
    } else {
      window.addEventListener('resize', publishFooterHeight)
    }
    publishFooterHeight()
  }

  // ── Animated disclosures ────────────────────────────────────────────────
  // <details> opens in one frame: the panel is simply there, and everything
  // under it jumps down by its full height. This animates the element's own
  // height between the two states instead, so the reveal reads as an opening
  // and the content below slides rather than teleports.
  //
  // The element's height is animated rather than an inner wrapper's, which is
  // what lets this work on the FAQ, the changelog's snapshot entry and the
  // roadmap's folder tree without any of them gaining a box to animate.
  // `open` is driven by hand — the native toggle is what we are replacing —
  // and stays true for the whole of a close, so there is something to animate
  // down from.
  //
  // Exposed as a global so a page can bind its own disclosures at its own
  // duration: roadmap.js takes the tree's folders at 140ms, because browsing a
  // tree is several clicks deep and the panel duration is what you feel on
  // each one. A no-op under reduced motion, so callers never test for it.
  window.KonnektDisclose = function (details, duration) {
    if (reduceMotion || !document.body.animate) return
    // Scoped, so a folder that contains folders binds its own summary rather
    // than the first one anywhere beneath it.
    var summary = details.querySelector(':scope > summary')
    if (!summary) return

    var ms = duration || 220
    var anim = null

    summary.addEventListener('click', function (e) {
      e.preventDefault()

      // A click mid-flight measures from wherever the last one got to, so
      // the reverse starts at the height actually on screen.
      if (anim) anim.cancel()

      var opening = !details.open
      var from = details.getBoundingClientRect().height
      var to

      // `open` cannot say which way this is going: it is forced true for the
      // whole of a close, below, so there is a height to animate down from.
      // The marker in styles.css needs the answer at click time — keyed on
      // [open] alone it would hold the minus for the full duration and snap
      // back at the end — so the close direction gets a class of its own.
      details.classList.toggle('is-closing', !opening)

      if (opening) {
        details.open = true
        to = details.getBoundingClientRect().height
      } else {
        // Both measurements happen in this one task, so the closed frame is
        // never painted — the layout is read twice, the screen once.
        details.open = false
        to = details.getBoundingClientRect().height
        details.open = true
      }

      details.style.overflow = 'hidden'
      anim = details.animate(
        { height: [from + 'px', to + 'px'] },
        { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      )

      anim.onfinish = function () {
        anim = null
        details.style.overflow = ''
        if (!opening) {
          details.open = false
          details.classList.remove('is-closing')
        }
      }
    })
  }

  document
    .querySelectorAll(
      '.faq details, details.release-pending, details.doc-collapse, .step-fold details',
    )
    .forEach(function (details) {
      window.KonnektDisclose(details, 220)
    })

  // ── Cursor glow on tiles ────────────────────────────────────────────────
  // Feeds --mx/--my (tile-relative pixels) to the radial gradient in
  // styles.css. One delegated listener rather than one per tile, so the cards
  // download.js and changelog.js render later are covered without either
  // script knowing about this. Mouse and pen only: on touch there is no hover
  // to follow, and the glow would stick to whatever you last tapped.
  var GLOW_SELECTOR =
    '.feat, .doc-section, .dl-card, .download-primary, .release, .cta-panel, ' +
    '.spotlight-media, .spotlight-points li, .rm-stage-card'

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var glowTile = null
    var glowX = 0
    var glowY = 0
    var glowQueued = false

    var paintGlow = function () {
      glowQueued = false
      if (!glowTile) return
      var rect = glowTile.getBoundingClientRect()
      glowTile.style.setProperty('--mx', Math.round(glowX - rect.left) + 'px')
      glowTile.style.setProperty('--my', Math.round(glowY - rect.top) + 'px')
    }

    document.addEventListener(
      'pointermove',
      function (e) {
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return

        // Left values stay put on the tile you leave, so the glow fades out
        // from where the cursor was instead of jumping to the tile's centre.
        glowTile = e.target.closest ? e.target.closest(GLOW_SELECTOR) : null
        if (!glowTile) return

        glowX = e.clientX
        glowY = e.clientY
        if (!glowQueued) {
          glowQueued = true
          window.requestAnimationFrame(paintGlow)
        }
      },
      { passive: true },
    )

    // A scroll moves the tile out from under a stationary cursor, and no
    // pointermove follows. Recomputing from the same viewport coordinates
    // keeps the light where the cursor actually is; it costs a frame only
    // while a tile is hovered.
    window.addEventListener(
      'scroll',
      function () {
        if (!glowTile || glowQueued) return
        glowQueued = true
        window.requestAnimationFrame(paintGlow)
      },
      { passive: true },
    )
  }
})()
