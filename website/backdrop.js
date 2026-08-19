/* Landing-page backdrops: a very large sphere of stars behind the hero, with
   the occasional satellite passing across it, and a minimal warp field behind
   the download call to action.

   They are built two different ways, on purpose. The sphere is several
   thousand points that have to be transformed every frame, so it is canvas 2D
   and a requestAnimationFrame loop; nothing else would draw it. The warp field
   is a few dozen stars each travelling a fixed path, and it was the same kind
   of loop until it became the one animation on the page that could stall. A
   rAF loop runs on the main thread, so anything else competing for that thread
   freezes it outright, while every CSS animation on this site keeps going on
   the compositor. Now the field is CSS animations too: no per-frame JavaScript
   and no canvas raster, just a transform and an opacity per star.

   Either way the elements are created here rather than sitting in the markup:
   they are decorative, so a page without JS simply doesn't have them and needs
   no fallback. Both are pointer-transparent and aria-hidden, and both stop
   when their section is off screen or the tab is in the background. */
;(function () {
  if (!document.createElement('canvas').getContext) return

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var DPR = Math.min(window.devicePixelRatio || 1, 2)

  function token(name, fallback) {
    return (getComputedStyle(document.documentElement).getPropertyValue(name) || fallback).trim()
  }

  // Follow the token rather than hard-coding the green, so a palette change in
  // styles.css carries into the backdrops.
  var accent = token('--accent-rgb', '74 222 128')

  // One of these is drawn per satellite pass. Same rule as the accent above:
  // every colour is a token, so the palette stays one file's business. White
  // is in the list because it is what the rest of the sky already is, and a
  // pass that happens to be white reads as the plainest of the set rather than
  // as a colour missing.
  var SAT_COLORS = [
    '#ffffff',
    'rgb(' + accent + ')',
    'rgb(' + token('--sun-rgb', '255 216 77') + ')',
    'rgb(' + token('--warning-rgb', '245 158 11') + ')',
    'rgb(' + token('--danger-rgb', '248 113 113') + ')',
  ]

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v
  }

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo)
  }

  // ── When is a section properly in front of you? ──────────────────────────
  // A backdrop only shows once it is: a strip of stars sliding past during a
  // scroll reads as debris on the page, not as depth behind it. Both backdrops
  // ask the same question, so they ask it in the same place. onChange gets the
  // answer and the raw coverage, and is called only when the answer changes.
  function watch(host, onChange) {
    if (!('IntersectionObserver' in window)) {
      onChange(true, 1)
      return
    }

    var lit = false

    // Ratio alone is the wrong measure for a section taller than the viewport
    // — it can never reach 1 — so this is the share of the *view* the section
    // occupies once it is as large as the view can hold.
    var thresholds = []
    for (var s = 0; s <= 20; s++) thresholds.push(s / 20)

    new IntersectionObserver(
      function (entries) {
        var e = entries[entries.length - 1]
        var rootH = e.rootBounds ? e.rootBounds.height : window.innerHeight
        var reach = Math.min(e.boundingClientRect.height, rootH) || 1
        var covered = e.intersectionRect.height / reach

        // Hysteresis, and a deliberately lopsided pair of it. Lighting still
        // wants most of the section in front of you, but unlighting has to
        // wait until it is all but gone: the landing page snaps, so one wheel
        // notch moves the scroll twice — your own scroll, then the snap
        // pulling it back — and the old 0.45 floor sat close enough to the
        // top of the page for that round trip to cross it. Crossing it costs
        // a 700ms fade out and another back in, which is what read as the
        // backdrop blinking while you sat still.
        if (!lit && covered >= 0.6) lit = true
        else if (lit && covered < 0.08) lit = false
        onChange(lit, covered)
      },
      { threshold: thresholds },
    ).observe(host)
  }

  // ── Effect shell ─────────────────────────────────────────────────────────
  // Mounts a canvas into a section, keeps it sized in CSS pixels (the context
  // is pre-scaled by DPR, so every effect below can think in CSS pixels), and
  // reports whether it is worth drawing.
  function mount(host, effect) {
    var canvas = document.createElement('canvas')
    canvas.className = 'fx'
    canvas.setAttribute('aria-hidden', 'true')
    host.insertBefore(canvas, host.firstChild)

    var ctx = canvas.getContext('2d')
    var w = 0
    var h = 0

    function resize() {
      var rect = host.getBoundingClientRect()
      var nw = Math.round(rect.width)
      var nh = Math.round(rect.height)
      if (!nw || !nh || (nw === w && nh === h)) return
      w = nw
      h = nh
      canvas.width = Math.round(w * DPR)
      canvas.height = Math.round(h * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      effect.resize(ctx, w, h)
      // Setting canvas.width above wipes the bitmap, so without a frame here
      // the backdrop is blank until the loop next runs — a visible blink on
      // any resize, and the whole backdrop under reduced motion, where there
      // is no loop to wait for.
      effect.draw(ctx, w, h, 0, 0)
    }

    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(host)
    } else {
      window.addEventListener('resize', resize)
    }
    resize()

    var handle = {
      visible: !('IntersectionObserver' in window),
      draw: function (t, dt) {
        if (w && h) effect.draw(ctx, w, h, t, dt)
      },
    }

    watch(host, function (lit, covered) {
      canvas.classList.toggle('is-lit', lit)
      // Keep drawing a little either side of that, so the fade never reveals a
      // frame that stopped updating.
      handle.visible = covered > 0.05
      sync()
    })

    return handle
  }

  // ── Hero: a sphere of stars, far larger than the frame ───────────────────
  // Projected orthographically, which is both what a sphere this size actually
  // looks like (no perspective to speak of) and what gives the limb its clean
  // arc. Points are spread by the Fibonacci lattice, so they crowd toward the
  // limb the way a real surface does, without clustering at the poles.
  function heroSphere() {
    var SPIN = 0.028 // radians per second, about one turn every four minutes
    var TILT = 0.34 // lean of the spin axis, so motion reads near the limb

    var stars = []
    var ox = 0
    var oy = 0
    var radius = 0

    // ── One satellite at a time, passing ───────────────────────────────────
    // A single point crossing the right of the frame on a shallow arc, then
    // empty sky for a few seconds before the next one. It is drawn on this
    // canvas rather than run as a CSS animation, which is the opposite of the
    // call the warp field makes: main.js gates the hero's `intro-done` class
    // on every animation inside .hero finishing, and an infinite one would
    // never settle, leaving the headline on a composited layer for good. The
    // loop this effect already runs costs one more point a frame.
    var SAT_TRAVEL = [3, 4] // seconds for one pass
    var SAT_GAP = [2.5, 6] // seconds of empty sky between passes
    var SAT_FIRST = 2 // and before the first one, which is not left to chance
    var SAT_FADE = 0.22 // share of a pass spent fading in, and again out

    var sat = null
    // Fixed for the opening so the first pass is part of arriving on the page:
    // the hero's words are still settling in for the first second and a half,
    // and this comes in just behind them. Every gap after it is random, so the
    // rhythm is only ever set once. Counted in drawn time rather than wall
    // clock — the runner does not tick while the hero is off screen or the tab
    // is behind another, so this is two seconds of actually watching it.
    var satWait = SAT_FIRST

    // Everything is a fraction of the frame, so a resize mid-pass carries the
    // satellite with the canvas instead of stranding it on a stale pixel path.
    //
    // It starts in the strip of empty sky at the top left, between the nav and
    // the sphere's limb: the limb crosses the left of the frame at about 0.2h
    // whatever the aspect ratio (see resize below for where that comes from),
    // and .fx's mask is only fully open below 0.14h, so the band between those
    // two is the whole of the opening. It ends low and right, where the limb
    // has already dropped out of frame, and stays above the bottom 14% the
    // mask fades out — a pass that ended in there would dim rather than fade.
    function spawnSat() {
      return {
        x0: rand(0.1, 0.2),
        y0: rand(0.15, 0.19),
        x1: rand(0.8, 0.92),
        y1: rand(0.68, 0.78),
        // Lifted off the chord, and only ever upward. The straight line between
        // those two points runs just under the limb through the middle of the
        // frame; the arc is what carries the pass over the sphere rather than
        // into it, which is the whole read.
        bow: rand(0.1, 0.18),
        life: rand(SAT_TRAVEL[0], SAT_TRAVEL[1]),
        age: 0,
        color: SAT_COLORS[Math.floor(Math.random() * SAT_COLORS.length)],
      }
    }

    function build(w, h) {
      // The crowding toward the limb is the whole illusion, and it is confined
      // to a narrow band: points are spread uniformly in depth, so the ones
      // within 0.2 of the limb occupy only the outer 2% of the projected
      // radius. At a few thousand points that band is a scatter; it takes
      // several thousand before it reads as an edge, which is why the count is
      // this high. The per-frame cost is a transform each, and only the few
      // hundred that land in frame are ever drawn.
      var count = Math.round(clamp((w * h) / 200, 1800, 8000))
      stars = []

      var golden = Math.PI * (3 - Math.sqrt(5))
      for (var i = 0; i < count; i++) {
        var y = 1 - (i / (count - 1)) * 2
        var ring = Math.sqrt(Math.max(0, 1 - y * y))
        var theta = golden * i
        stars.push({
          x: Math.cos(theta) * ring,
          y: y,
          z: Math.sin(theta) * ring,
          // Twinkle, and a small minority tinted with the brand accent.
          ph: Math.random() * Math.PI * 2,
          sp: 0.5 + Math.random() * 0.9,
          hot: Math.random() < 0.12,
          sx: 0,
          sy: 0,
          d: 0,
          on: false,
        })
      }
    }

    return {
      resize: function (ctx, w, h) {
        // Centre well below and left of the frame, with a radius that puts the
        // limb through it: the arc enters at the left a fifth of the way down
        // and sweeps diagonally out through the bottom. What you see is a
        // slice of something much bigger than the window.
        ox = w * 0.05
        oy = h * 1.62
        radius = oy - h * 0.2
        build(w, h)
      },

      draw: function (ctx, w, h, t, dt) {
        ctx.clearRect(0, 0, w, h)

        var spin = t * SPIN
        var cs = Math.cos(spin)
        var sn = Math.sin(spin)
        var ct = Math.cos(TILT)
        var st = Math.sin(TILT)
        var i

        for (i = 0; i < stars.length; i++) {
          var p = stars[i]
          // Spin about the sphere's own axis, then lean that axis toward the
          // viewer. Base coordinates stay untouched; only the projection moves.
          var x = p.x * cs + p.z * sn
          var zr = p.z * cs - p.x * sn
          var y = p.y * ct - zr * st
          p.d = p.y * st + zr * ct
          p.sx = ox + x * radius
          p.sy = oy + y * radius
          p.on = p.d > 0.02 && p.sx > -12 && p.sx < w + 12 && p.sy > -12 && p.sy < h + 12
        }

        for (i = 0; i < stars.length; i++) {
          var s = stars[i]
          if (!s.on) continue
          var tw = 0.75 + 0.25 * Math.sin(t * s.sp + s.ph)
          // Only a mild depth cue. Stars on a real sphere are all as bright as
          // each other, and the limb is where they crowd — dimming it in
          // proportion to depth would hide the one edge that shows the shape.
          // The outer band gets a small lift on top of that, so the edge reads
          // at a glance instead of only once you look for it.
          var rim = s.d < 0.22 ? 1 + (0.22 - s.d) * 2.4 : 1
          ctx.globalAlpha = (0.26 + 0.3 * Math.pow(s.d, 0.6)) * tw * rim
          ctx.fillStyle = s.hot ? 'rgb(' + accent + ')' : '#ffffff'
          var size = 0.8 + 1 * s.d
          ctx.fillRect(s.sx, s.sy, size, size)
        }

        // Nothing else is painted out here. There was a field of drifting dust
        // over the whole canvas, on the argument that it made the space
        // outside the limb read as space rather than as a blank. At a
        // sub-pixel size and 0.04 to 0.22 alpha it did not: a dozen or so
        // points hung motionless above the planet and read as dirt on the
        // screen. The sky is the flat background colour, and the one thing
        // that crosses it is the satellite.

        // Advanced by dt rather than read off t, so a pass pauses with the loop
        // instead of carrying on unseen while the section is off screen. Under
        // reduced motion there is no loop at all — draw() is called once with a
        // dt of 0 — so nothing would spawn either way, but say so outright.
        if (!reduceMotion) {
          if (sat) {
            sat.age += dt
            if (sat.age >= sat.life) sat = null
          } else {
            satWait -= dt
            if (satWait <= 0) {
              sat = spawnSat()
              satWait = rand(SAT_GAP[0], SAT_GAP[1])
            }
          }
        }

        if (sat) {
          var pr = sat.age / sat.life
          // Zero at both ends and widest in the middle, so the arc leaves and
          // rejoins the chord exactly where the pass begins and ends.
          var lift = Math.sin(pr * Math.PI) * sat.bow
          var satX = (sat.x0 + (sat.x1 - sat.x0) * pr) * w
          var satY = (sat.y0 + (sat.y1 - sat.y0) * pr - lift) * h
          // It begins and ends inside the frame, so both ends have to be a
          // fade — appearing at full strength on a bare patch of sky is the
          // one thing that would read as a glitch rather than as distance.
          var fade = Math.min(1, pr / SAT_FADE, (1 - pr) / SAT_FADE)

          // A core and the faintest halo, both fillRect like everything else
          // here. A canvas shadow would light it far better and costs a blur
          // pass a frame for a single point.
          ctx.fillStyle = sat.color
          ctx.globalAlpha = 0.1 * fade
          ctx.fillRect(satX - 3, satY - 3, 6, 6)
          ctx.globalAlpha = 0.9 * fade
          ctx.fillRect(satX - 1, satY - 1, 2, 2)
        }

        ctx.globalAlpha = 1
      },
    }
  }

  // ── Download: stars drifting past ────────────────────────────────────────
  // Perspective this time, since the whole point is the approach. Kept thin on
  // purpose: a low count, short streaks and a slow drift, so it reads as depth
  // behind the panel rather than as travel. A faster version of this is
  // genuinely uncomfortable to sit under while reading.
  //
  // No canvas and no loop. Each star is one element on one CSS animation, so
  // the whole field runs on the compositor and keeps its timing through
  // anything that ties up the main thread. All this has to do is create the
  // elements, hand each one an angle, a radius and a start offset, and say when
  // the section is in front of you; styles.css (.wf) does the rest.
  //
  // The projection the keyframes there encode is the same one the canvas used:
  // a star sits at distance `focal * r / z` from the centre with z falling from
  // 1 to 0.06 at 0.14 a second, which is the ~6.7s a star lasts. focal follows
  // the section rather than the viewport, so it is published here in both the
  // px form the distances need and the bare number the streak lengths do.
  function warpStars(host) {
    var FOCAL = 0.22 // of the section's longer side, as the canvas had it
    var SPREAD = 3 // seconds between the first star arriving and the last
    var LIFE = 6.714 // seconds a star takes from spawn to the near plane

    var field = document.createElement('div')
    field.className = 'wf'
    field.setAttribute('aria-hidden', 'true')
    host.insertBefore(field, host.firstChild)

    var count = 0

    function build(n) {
      count = n
      field.textContent = ''
      var frag = document.createDocumentFragment()
      for (var i = 0; i < n; i++) {
        var star = document.createElement('span')
        star.className = 'wf-star'
        // Push the spawn ring away from the vanishing point: stars that appear
        // dead centre crawl outward for seconds before they read as motion.
        star.style.setProperty('--a', (Math.random() * 360).toFixed(1) + 'deg')
        star.style.setProperty('--r', (0.25 + Math.random() * 0.75).toFixed(3))
        // A negative delay starts the animation partway through, so the field
        // is already in flight on the first frame rather than arriving as one
        // wave — the same thing the canvas did by staggering initial depths.
        star.style.setProperty('--t', (-Math.random() * LIFE).toFixed(2) + 's')
        // And a delay of its own on the way in, which is the entrance: the
        // field assembles star by star instead of appearing as one layer.
        star.style.setProperty('--in', (Math.random() * SPREAD).toFixed(2) + 's')
        if (Math.random() < 0.14) star.className += ' wf-hot'
        star.appendChild(document.createElement('i'))
        frag.appendChild(star)
      }
      field.appendChild(frag)
    }

    function resize() {
      var rect = host.getBoundingClientRect()
      var w = Math.round(rect.width)
      var h = Math.round(rect.height)
      if (!w || !h) return

      // Short focal length on purpose. At a longer one a star crosses the frame
      // edge while it is still far away and dim, so the fast, bright part of
      // its approach happens off screen and the field reads as nothing much.
      var focal = Math.round(Math.max(w, h) * FOCAL)
      field.style.setProperty('--focal', focal + 'px')
      field.style.setProperty('--fn', String(focal))

      // Denser than the canvas count for the same area. There, a star that left
      // the frame respawned immediately; here it flies on to the end of its
      // cycle unseen, so the same number of elements puts fewer of them on
      // screen at any one time.
      var n = Math.round(clamp((w * h) / 15000, 24, 96))
      if (n !== count) build(n)
    }

    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(host)
    } else {
      window.addEventListener('resize', resize)
    }
    resize()

    watch(host, function (lit, covered) {
      field.classList.toggle('is-lit', lit)
      // Paused a little either side of lighting, so the fade never reveals a
      // field frozen mid-flight. Under reduced motion it stays paused for good,
      // which leaves every star stopped at its own offset: a still starfield,
      // which is the whole backdrop there.
      field.classList.toggle('is-running', !reduceMotion && covered > 0.05)
    })
  }

  // ── Runner ───────────────────────────────────────────────────────────────
  // One loop for both effects, and only while something is on screen and the
  // tab is in front. Under reduced motion nothing loops at all: each effect
  // paints one still frame when it is sized, and that is the whole backdrop.
  var effects = []
  var running = false
  var last = 0

  function tick(now) {
    if (!running) return
    var dt = Math.min((now - last) / 1000, 0.05)
    last = now
    for (var i = 0; i < effects.length; i++) {
      if (effects[i].visible) effects[i].draw(now / 1000, dt)
    }
    requestAnimationFrame(tick)
  }

  function sync() {
    if (reduceMotion) return
    var wanted = !document.hidden
    if (wanted) {
      wanted = false
      for (var i = 0; i < effects.length; i++) {
        if (effects[i].visible) wanted = true
      }
    }
    if (wanted === running) return
    running = wanted
    if (running) {
      last = performance.now()
      requestAnimationFrame(tick)
    }
  }

  var hero = document.querySelector('.hero')
  var cta = document.querySelector('.cta')
  if (hero) effects.push(mount(hero, heroSphere()))
  // Not part of the runner: it has no frame to draw. The browser pauses its
  // animations in a background tab on its own, so there is nothing here to do
  // for visibilitychange either.
  if (cta) warpStars(cta)
  if (!effects.length) return

  document.addEventListener('visibilitychange', sync)
  sync()
})()
