;(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    document.documentElement.classList.add('reduce-motion')
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
})()
