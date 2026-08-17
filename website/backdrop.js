/* Landing-page backdrops: a very large sphere of stars behind the hero, and a
   minimal warp field behind the download call to action. Canvas 2D and no
   dependencies — the site has no build step, and neither effect is worth
   pulling a WebGL library onto a marketing page.

   The canvases are created here rather than sitting in the markup: they are
   decorative, so a page without JS simply doesn't have them and needs no
   fallback. Both are pointer-transparent and aria-hidden, and both stop
   drawing whenever their section is off screen or the tab is in the
   background. */
;(function () {
  if (!document.createElement('canvas').getContext) return

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var DPR = Math.min(window.devicePixelRatio || 1, 2)

  // Follow the token rather than hard-coding the green, so a palette change in
  // styles.css carries into the backdrops.
  var accent = (
    getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb') || '74 222 128'
  ).trim()

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v
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

    // A backdrop only shows once its section is properly in front of you: a
    // strip of stars sliding past during a scroll reads as debris on the page,
    // not as depth behind it. CSS fades the canvas; this decides when.
    if ('IntersectionObserver' in window) {
      var lit = false

      // Ratio alone is the wrong measure for a section taller than the
      // viewport — it can never reach 1 — so this is the share of the *view*
      // the section occupies once it is as large as the view can hold.
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
          canvas.classList.toggle('is-lit', lit)

          // Keep drawing a little either side of that, so the fade never
          // reveals a frame that stopped updating.
          handle.visible = covered > 0.05
          sync()
        },
        { threshold: thresholds },
      ).observe(host)
    } else {
      canvas.classList.add('is-lit')
    }

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
    var dust = []
    var ox = 0
    var oy = 0
    var radius = 0

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

      // A little free-floating dust for the empty space outside the sphere.
      dust = []
      var dustCount = Math.round(clamp((w * h) / 26000, 12, 60))
      for (var d = 0; d < dustCount; d++) {
        dust.push({
          x: Math.random(),
          y: Math.random(),
          r: 0.4 + Math.random() * 0.7,
          ph: Math.random() * Math.PI * 2,
          sp: 0.3 + Math.random() * 0.7,
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
          p.on =
            p.d > 0.02 && p.sx > -12 && p.sx < w + 12 && p.sy > -12 && p.sy < h + 12
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

        ctx.fillStyle = '#ffffff'
        for (i = 0; i < dust.length; i++) {
          var g = dust[i]
          g.y -= 0.0015 * dt
          if (g.y < -0.02) {
            g.y = 1.02
            g.x = Math.random()
          }
          // Kept dimmer than the sphere's own stars: dust is what makes the
          // space outside the limb read as space rather than as a blank, but
          // too much of it blurs the edge between the two.
          ctx.globalAlpha = 0.13 + 0.09 * Math.sin(t * g.sp + g.ph)
          ctx.fillRect(g.x * w, g.y * h, g.r, g.r)
        }

        ctx.globalAlpha = 1
      },
    }
  }

  // ── Download: stars drifting past ────────────────────────────────────────
  // Perspective this time, since the whole point is the approach. Kept thin on
  // purpose: a low count, short streaks and a slow drift, so it reads as depth
  // behind the panel rather than as travel. A faster version of this is
  // genuinely uncomfortable to sit under while reading — which is why the
  // brightness below is the only dial that has been opened up. At the original
  // alpha the field was invisible on anything but a dark room and a good
  // panel, so it was paying its frame cost for nothing.
  function warpField() {
    var SPEED = 0.14 // depth units per second, roughly seven seconds a star
    var MAX_STREAK = 16 // px, so nothing ever smears into a line
    var stars = []
    var cx = 0
    var cy = 0
    var focal = 0

    function place(s, z) {
      // Push the spawn ring away from the vanishing point: stars that appear
      // dead centre crawl outward for seconds before they read as motion.
      var angle = Math.random() * Math.PI * 2
      var r = 0.25 + Math.random() * 0.75
      s.x = Math.cos(angle) * r
      s.y = Math.sin(angle) * r
      s.z = z
      s.hot = Math.random() < 0.14
    }

    return {
      resize: function (ctx, w, h) {
        cx = w / 2
        cy = h / 2
        // Short focal length on purpose. At a longer one a star crosses the
        // frame edge while it is still far away and dim, so the fast, bright
        // part of its approach happens off screen and the field reads as
        // nothing much; this keeps most of each star's life in view.
        focal = Math.max(w, h) * 0.22
        var count = Math.round(clamp((w * h) / 21000, 18, 70))
        stars = []
        for (var i = 0; i < count; i++) {
          var s = {}
          // Stagger the initial depths so the field is already in flight on
          // the first frame rather than arriving as one wave.
          place(s, 0.08 + Math.random() * 0.92)
          stars.push(s)
        }
      },

      draw: function (ctx, w, h, t, dt) {
        ctx.clearRect(0, 0, w, h)
        ctx.lineCap = 'round'

        for (var i = 0; i < stars.length; i++) {
          var s = stars[i]
          var was = s.z
          s.z -= SPEED * dt
          if (s.z <= 0.06) {
            place(s, 1)
            continue
          }

          var k = focal / s.z
          var pk = focal / was
          var x2 = cx + s.x * k
          var y2 = cy + s.y * k
          if (x2 < -40 || x2 > w + 40 || y2 < -40 || y2 > h + 40) {
            place(s, 1)
            continue
          }

          var x1 = cx + s.x * pk
          var y1 = cy + s.y * pk
          var dx = x2 - x1
          var dy = y2 - y1
          var len = Math.sqrt(dx * dx + dy * dy)
          if (len > MAX_STREAK) {
            x1 = x2 - (dx / len) * MAX_STREAK
            y1 = y2 - (dy / len) * MAX_STREAK
          }

          var near = 1 - s.z
          ctx.globalAlpha = clamp(near * 0.9, 0, 0.66)
          ctx.strokeStyle = s.hot ? 'rgb(' + accent + ')' : '#ffffff'
          ctx.lineWidth = 0.9 + near * 0.7
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }

        ctx.globalAlpha = 1
      },
    }
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
  if (cta) effects.push(mount(cta, warpField()))
  if (!effects.length) return

  document.addEventListener('visibilitychange', sync)
  sync()
})()
