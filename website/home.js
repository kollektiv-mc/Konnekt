/* The home page: the feature strips and the scheduler's running graph. */
;(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── Feature strips ─────────────────────────────────────────────────────
  // Nine strips, one open. The clips come from the demo's own build
  // (demo/record.mjs) and live beside it, so this only ever asks for
  // <demo>/scenes/<id>.webm|mp4|webp.
  //
  // The origin and the scenes are constants here rather than attributes read
  // back off the page: a URL assembled from DOM text is what CodeQL reports as
  // text reinterpreted as HTML. scripts/check-website-scenes.mjs holds this
  // table to the strips' data-scene order and to demo/scenes/, so the three
  // cannot drift apart.
  //
  // Only the open strip's clip plays, and only while it is on screen. Reduced
  // motion plays nothing: the poster and the points still change, and the demo
  // link is the way to see it move.
  // aislop-ignore-next-line ai-slop/hardcoded-url -- the demo site's canonical address, see agent_docs/CLAUDE.md
  var DEMO = 'https://konnekt-demo.pages.dev'
  var SCENES = [
    { id: 'dashboard', tile: '' },
    { id: 'console', tile: 'console' },
    { id: 'players', tile: 'players' },
    { id: 'performance', tile: 'performance' },
    { id: 'worlds', tile: 'worlds' },
    { id: 'backups', tile: 'backups' },
    { id: 'config', tile: 'server-config' },
    { id: 'mods', tile: 'mods' },
    { id: 'servers', tile: '' },
  ]
  // How long a closing panel stays over its strip: the strip's width
  // transition, so the two finish together.
  var CLOSE_MS = 560

  var archive = document.querySelector('.archive')
  var strips = archive ? [].slice.call(archive.querySelectorAll('.strip')) : []
  var demoLink = document.getElementById('demo-link')

  // A strip count that is not the table's means the page and this script have
  // drifted; the check would have said so, but nothing below may guess.
  if (strips.length === SCENES.length) {
    var current = Math.max(
      0,
      strips.findIndex(function (s) {
        return s.classList.contains('is-open')
      }),
    )
    var onScreen = false
    var closeTimer = 0

    var videoOf = function (i) {
      return strips[i].querySelector('video')
    }

    var load = function (i) {
      var video = videoOf(i)
      if (!video || video.getAttribute('poster')) return
      var scene = SCENES[i]
      video.poster = DEMO + '/scenes/' + scene.id + '.webp'
      ;[
        ['webm', 'video/webm'],
        ['mp4', 'video/mp4'],
      ].forEach(function (kind) {
        var source = document.createElement('source')
        source.src = DEMO + '/scenes/' + scene.id + '.' + kind[0]
        source.type = kind[1]
        video.appendChild(source)
      })
      video.preload = 'metadata'
      video.load()
    }

    var play = function () {
      var video = videoOf(current)
      if (!onScreen || reduceMotion || !video || typeof video.play !== 'function') return
      var p = video.play()
      if (p && p.catch) {
        p.catch(function () {
          /* Autoplay refused, or the clip is unreachable: the poster stays. */
        })
      }
    }

    var open = function (i) {
      if (i === current) return
      var prev = current
      current = i
      var prevVideo = videoOf(prev)
      if (prevVideo && prevVideo.pause) prevVideo.pause()

      window.clearTimeout(closeTimer)
      strips.forEach(function (s) {
        s.classList.remove('is-closing')
      })
      strips[prev].classList.add('is-closing')
      closeTimer = window.setTimeout(function () {
        strips[prev].classList.remove('is-closing')
      }, CLOSE_MS)

      strips.forEach(function (s, k) {
        var on = k === current
        s.classList.toggle('is-open', on)
        s.querySelector('.strip-btn').setAttribute('aria-expanded', on ? 'true' : 'false')
      })
      if (demoLink) {
        var tile = SCENES[current].tile
        demoLink.href = DEMO + '/' + (tile ? '?tile=' + tile : '')
      }
      load(current)
      play()
      // The button that was pressed is gone, so focus goes to what it opened.
      strips[current].querySelector('h3').focus({ preventScroll: true })
    }

    strips.forEach(function (strip, i) {
      strip.querySelector('.strip-btn').addEventListener('click', function () {
        open(i)
      })
    })

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          var visible = entries[0].isIntersecting
          if (visible === onScreen) return
          onScreen = visible
          var video = videoOf(current)
          if (visible) play()
          else if (video && video.pause) video.pause()
        },
        { threshold: 0.4 },
      ).observe(archive)
    } else {
      onScreen = true
      play()
    }
  }

  // ── Settle ─────────────────────────────────────────────────────────────
  // Once a scroll comes to rest a little short of a section, the page eases
  // the rest of the way: the hero to the very top of the page, the rest to
  // the middle of the screen. Only within SETTLE_PX and a share of the
  // screen, so a scroll that stops anywhere else stays exactly where it
  // stopped. CSS scroll snapping was tried first and pulled too far, with no
  // way to set how far.
  //
  // Only this page, only with a mouse or trackpad on a wide screen, never
  // under reduced motion, and never toward a section the page cannot scroll
  // to: one past the end of the page would hold the reader short of the
  // footer.
  var SETTLE_PX = 120
  var SETTLE_SHARE = 0.12
  var SETTLE_IDLE_MS = 160
  var settleTargets = [].slice.call(document.querySelectorAll('[data-settle]'))
  var settleMedia = window.matchMedia('(min-width: 861px) and (pointer: fine)')

  // From layout rather than getBoundingClientRect, which would include the
  // focused group's lift and land it a few pixels off.
  function settleTo(el) {
    if (el.getAttribute('data-settle') === 'top') return 0
    if (el.offsetHeight > window.innerHeight) return null
    var top = 0
    for (var n = el; n; n = n.offsetParent) top += n.offsetTop
    return top + el.offsetHeight / 2 - window.innerHeight / 2
  }

  function settle() {
    if (!settleMedia.matches) return
    var y = window.scrollY
    var max = document.documentElement.scrollHeight - window.innerHeight
    var reach = Math.min(SETTLE_PX, window.innerHeight * SETTLE_SHARE)
    var best = null
    settleTargets.forEach(function (el) {
      var to = settleTo(el)
      if (to === null || to < 0 || to > max) return
      var off = Math.abs(to - y)
      if (off > 1 && off <= reach && (best === null || off < Math.abs(best - y))) best = to
    })
    if (best !== null) window.scrollTo({ top: best, behavior: 'smooth' })
  }

  if (settleTargets.length && !reduceMotion) {
    // scrollend waits out momentum and smooth scrolls; without it, a short
    // quiet spell stands in.
    if ('onscrollend' in window) {
      window.addEventListener('scrollend', settle)
    } else {
      var settleTimer = 0
      window.addEventListener(
        'scroll',
        function () {
          window.clearTimeout(settleTimer)
          settleTimer = window.setTimeout(settle, SETTLE_IDLE_MS)
        },
        { passive: true },
      )
    }
  }

  // ── Scheduler graph ────────────────────────────────────────────────────
  // The trigger lights, then its wire fills, then the next block, and so on,
  // one step every STEP_MS; the graph holds lit for two steps and starts
  // again.
  // Under reduced motion it is drawn lit and still.
  var STEP_MS = 900
  var flow = document.getElementById('flow')
  if (!flow) return
  var parts = [].slice.call(flow.children)
  var steps = parts.length + 3

  if (reduceMotion) {
    parts.forEach(function (el) {
      el.classList.add('is-lit')
    })
    return
  }

  var step = 0
  var timer = 0
  var tick = function () {
    step = (step + 1) % steps
    parts.forEach(function (el, k) {
      el.classList.toggle('is-lit', step > k)
    })
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      window.clearInterval(timer)
      timer = entries[0].isIntersecting ? window.setInterval(tick, STEP_MS) : 0
    }).observe(flow)
  } else {
    timer = window.setInterval(tick, STEP_MS)
  }
})()
