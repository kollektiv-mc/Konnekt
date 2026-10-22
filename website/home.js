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

  // ── Hero console ───────────────────────────────────────────────────────
  // A server left running: players come and go, and every few seconds a
  // command is typed at the prompt and answered. The replies are vanilla
  // 1.21.1's own wording, from its en_us.json. The page's lines are the first
  // frame, with save-all already typed, and under reduced motion the only one.
  var LOG_LINES = 3
  var TYPE_MS = 75
  var SCRIPT = [
    { cmd: 'save-all', out: ['Saving the game (this may take a moment!)', 'Saved the game'] },
    { out: ['crocodealer420 joined the game'] },
    { cmd: 'whitelist add frogipogi', out: ['Added frogipogi to the whitelist'] },
    { out: ['<Snadrochka> anyone got spare diamonds'] },
    { cmd: 'time set day', out: ['Set the time to 1000'] },
    { out: ['frogipogi joined the game'] },
    { cmd: 'op Matzzz__', out: ['Made Matzzz__ a server operator'] },
    { out: ['ceramichello left the game'] },
    { cmd: 'weather clear', out: ['Set the weather to clear'] },
    { out: ['<trex007> who turned the rain off'] },
    { cmd: 'say restart at 18:00', out: ['[Server] restart at 18:00'] },
    { out: ['ascalon joined the game'] },
    {
      cmd: 'kick trex007',
      out: ['Kicked trex007: Kicked by an operator', 'trex007 left the game'],
    },
  ]

  var consoleEl = document.querySelector('.hero .console')
  var log = consoleEl && consoleEl.querySelector('.console-log')
  var input = consoleEl && consoleEl.querySelector('.console-input')

  if (log && input && !reduceMotion) {
    // The script flattened into one list of timed actions, so pausing is a
    // cleared timer and resuming runs the same action again.
    var actions = []
    SCRIPT.forEach(function (step) {
      if (step.cmd) {
        for (var c = 1; c <= step.cmd.length; c++) {
          actions.push({ wait: c === 1 ? 900 : TYPE_MS, input: step.cmd.slice(0, c) })
        }
        actions.push({ wait: 600, input: '' })
      }
      step.out.forEach(function (line, k) {
        actions.push({ wait: k ? 160 : 240, line: line })
      })
      actions.push({ wait: 2400 })
    })

    // The first step's command is the one the page already shows typed.
    var at = SCRIPT[0].cmd.length
    // Seconds past 14:03:40, the page's last line, as the log's own clock.
    var elapsed = 0
    var consoleTimer = 0

    var stamp = function () {
      var t = 14 * 3600 + 3 * 60 + 40 + Math.floor(elapsed / 1000)
      return [Math.floor(t / 3600) % 24, Math.floor(t / 60) % 60, t % 60]
        .map(function (n) {
          return (n < 10 ? '0' : '') + n
        })
        .join(':')
    }

    // The page's first frame holds a moment before save-all is entered.
    var firstWait = 1800

    var run = function () {
      var action = actions[at]
      var wait = firstWait || action.wait
      firstWait = 0
      consoleTimer = window.setTimeout(function () {
        elapsed += wait
        if (action.input !== undefined) input.textContent = action.input
        if (action.line) {
          var row = document.createElement('div')
          row.className = 'is-new'
          row.textContent = '[' + stamp() + '] ' + action.line
          log.appendChild(row)
          while (log.children.length > LOG_LINES) log.removeChild(log.firstElementChild)
        }
        at = (at + 1) % actions.length
        run()
      }, wait)
    }

    var pauseConsole = function () {
      window.clearTimeout(consoleTimer)
      consoleTimer = 0
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        pauseConsole()
        if (entries[0].isIntersecting) run()
      }).observe(consoleEl)
    } else {
      run()
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
