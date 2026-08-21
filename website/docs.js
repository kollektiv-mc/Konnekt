/* Docs page — the platform table's status tags, and the step demos.

   Both are enhancement. The table is authored with what is published today and
   is right without this file; the demos rest on their finished frame. */
;(function () {
  // ── Step demos ──────────────────────────────────────────────────────────
  // The animations live in styles.css and only exist under .is-playing, so
  // this decides which card is playing, not what it does.
  //
  // One at a time, in the order the steps are written: four looping mock-ups
  // running at once is noise, and the steps are a sequence, so playing them as
  // one reads the way the walkthrough is meant to be read. A card gets a turn
  // — wound back to empty, played once, held on the finished frame — and then
  // the next open card gets one.
  //
  // Hovering takes the turn rather than interrupting it. A card that is
  // already playing keeps the run it is in instead of starting over, and holds
  // the turn for as long as the pointer stays, repeating at the end of each
  // one. Letting go never cuts: the turn under way finishes, and the run picks
  // up from that card, so a pointer crossing the page on its way somewhere
  // else leaves a whole animation behind rather than half of one.
  //
  // The whole run is gated on being on screen, which is also what makes this
  // work on touch, where there is no hover to take over with.
  var steps = [].slice.call(document.querySelectorAll('.step[data-demo]'))
  var reduceMotion = document.documentElement.classList.contains('reduce-motion')

  if (steps.length && !reduceMotion) {
    // Read from the stylesheet rather than repeated here, so changing how fast
    // the demos play is one number in one file.
    var panel = document.querySelector('.demo')
    var css = getComputedStyle(panel)
    var DEMO_MS = parseFloat(css.getPropertyValue('--demo-ms')) || 4600
    // The wind-back the animations are delayed by. Part of the turn, not
    // something that happens before it starts.
    var REWIND_MS = parseFloat(css.getPropertyValue('--demo-rewind-ms')) || 420
    var HOLD_MS = 1400 // how long the finished frame stays before moving on
    var TURN_MS = REWIND_MS + DEMO_MS + HOLD_MS
    var timer = null
    var current = null // the card mid-turn, or null when nothing is playing
    var pinned = null // the card under the pointer or holding focus
    var onScreen = true

    // A folded step is not on screen even when its card is, so it takes no
    // turn until it is opened.
    function open(step) {
      var fold = step.querySelector('details')
      return !fold || fold.open
    }

    // The next open card after this one, in the order they are written, so the
    // install step slots into the sequence where it sits on the page rather
    // than being appended to the end of it. Null when nothing is open.
    function after(step) {
      var from = step ? steps.indexOf(step) : -1
      for (var i = 1; i <= steps.length; i++) {
        var next = steps[(from + i + steps.length) % steps.length]
        if (open(next)) return next
      }
      return null
    }

    function show(step) {
      steps.forEach(function (other) {
        other.classList.toggle('is-playing', other === step)
      })
    }

    // Losing a turn part-way through should read as the card settling onto its
    // finished frame, not cutting to it, and styles.css eases every property
    // any demo animates. That ease is not enough on its own: a transition
    // starts when an element's *underlying* value changes, not when the value
    // it is rendering does, and dropping .is-playing is only the first of those
    // for the parts whose empty frame and finished frame differ. The field
    // borders and the pointer are the same picture at both ends of their own
    // animation, so the class going away left them nothing to transition from
    // and they jumped while everything around them eased.
    //
    // Writing the frame the animation actually reached onto the element gives
    // all of them something to ease from, evenly. Handing that back a frame
    // later is the ease: the underlying value changes then, once, with the
    // animation already gone.
    var thawing = null // hands back the last frozen frame, if it has not run yet

    // Keyframes carry these alongside the properties they animate.
    var NOT_A_PROPERTY = { offset: 1, computedOffset: 1, easing: 1, composite: 1 }

    function settle(step) {
      if (thawing) thawing() // a second interrupt inside the same frame
      if (!step || !step.getAnimations) return

      // Read the whole card first and write to it after. Interleaving the two
      // makes the browser resolve style again on every element.
      var frozen = []
      ;[].slice.call(step.querySelectorAll('*')).forEach(function (el) {
        var props = {}
        el.getAnimations().forEach(function (anim) {
          // Animations only. The wind-back transitions are in this list too
          // when a card is interrupted early in its turn, and they are easing
          // towards the empty frame rather than sitting on a played one.
          if (!anim.animationName || anim.playState !== 'running' || !anim.effect) return
          anim.effect.getKeyframes().forEach(function (frame) {
            Object.keys(frame).forEach(function (key) {
              if (!NOT_A_PROPERTY[key]) props[key] = true
            })
          })
        })
        var names = Object.keys(props)
        if (!names.length) return
        var now = getComputedStyle(el)
        var hold = names
          .map(function (key) {
            return (
              key.replace(/[A-Z]/g, function (c) {
                return '-' + c.toLowerCase()
              }) +
              ':' +
              now[key]
            )
          })
          .join(';')
        // The frame goes on with transition:none beside it. Chrome does not
        // carry a cancelled animation's value into the style a transition
        // starts from, so writing the frame on its own reads as a change away
        // from the resting value: the card would ease towards the frozen
        // frame, backwards, and then back again when it is handed off.
        // Suppressing it here leaves exactly one ease, the hand-off's.
        frozen.push([el, el.getAttribute('style'), hold + ';transition:none'])
      })
      if (!frozen.length) return

      frozen.forEach(function (held) {
        held[0].setAttribute('style', held[1] ? held[1] + ';' + held[2] : held[2])
      })

      var release = function () {
        if (thawing !== release) return
        thawing = null
        frozen.forEach(function (held) {
          if (held[1] === null) held[0].removeAttribute('style')
          else held[0].setAttribute('style', held[1])
        })
      }
      thawing = release
      // The frame is what makes the hand-back a style change of its own, and
      // so what the transition eases over. The timer is only there because a
      // backgrounded tab never paints: it would otherwise leave a card frozen
      // on a half-finished frame for as long as the tab stayed hidden.
      window.requestAnimationFrame(release)
      window.setTimeout(release, 50)
    }

    // Taking the class off and putting it back is what replays a card, and the
    // reflow between is what makes that work on the card that already has it.
    // Passing null stops the run and leaves every card resting.
    function begin(step) {
      window.clearTimeout(timer)
      timer = null
      if (current && current !== step) settle(current)
      current = step
      show(null)
      if (!step) return
      void step.offsetWidth
      show(step)
      timer = window.setTimeout(advance, TURN_MS)
    }

    // Whoever is under the pointer keeps the turn — that is the loop — and
    // otherwise the run carries on from the card that just finished.
    function advance() {
      begin(onScreen ? pinned || after(current) : null)
    }

    steps.forEach(function (step) {
      var take = function () {
        if (pinned === step) return
        pinned = step
        // Already mid-turn: hovering a card that is playing must not start it
        // over. It keeps the turn it is in, and advance() repeats it for as
        // long as the pointer stays.
        if (current === step && timer) return
        begin(step)
      }
      var release = function () {
        if (pinned !== step) return
        pinned = null
        // Nothing is cut here. The turn under way finishes and advance() hands
        // the run on at the end of it; this only covers the case where there
        // was no turn under way to finish.
        if (!timer && onScreen) begin(after(current))
      }

      step.addEventListener('mouseenter', take)
      step.addEventListener('mouseleave', release)
      // Tabbing to the link inside a step should not leave you beside a still
      // picture of what it is describing.
      step.addEventListener('focusin', take)
      step.addEventListener('focusout', function () {
        if (!step.contains(document.activeElement)) release()
      })

      // Opening or closing the fold changes who is in the run.
      var fold = step.querySelector('details')
      if (fold) {
        fold.addEventListener('toggle', function () {
          if (!fold.open && (pinned === step || current === step)) {
            // It cannot hold a turn it is no longer showing.
            if (pinned === step) pinned = null
            advance()
          } else if (!timer && onScreen) {
            begin(after(current))
          }
        })
      }
    })

    // Started rather than waited for: the observer corrects it on its first
    // callback either way, and a run that depends on being told it is visible
    // before it will play is one bad observer away from a page of still
    // pictures.
    begin(after(null))

    if ('IntersectionObserver' in window) {
      var grid = document.querySelector('.step-grid')
      new IntersectionObserver(
        function (entries) {
          var visible = entries[0].isIntersecting
          if (visible === onScreen) return
          onScreen = visible
          // Leaving the screen clears the run rather than pausing it, so
          // coming back starts at step 1. The steps are numbered, and picking
          // them up at 3 reads as something having gone wrong.
          begin(onScreen ? pinned || after(null) : null)
        },
        { threshold: 0.1 },
      ).observe(grid)
    }
  }

  // ── Platform status ─────────────────────────────────────────────────────
  // What the table says about a platform is a fact about what is published, so
  // it is read from the releases rather than kept by hand: an asset in the
  // latest release makes that platform whatever channel the release is (alpha,
  // beta, or a plain release), an asset only in the rolling snapshot makes it
  // Snapshot, and nothing anywhere means it builds from source.
  //
  // The cells are authored with today's answer, so this corrects them rather
  // than filling them in — a rate limit or an outage leaves the table saying
  // what it said when the page was written, which is the honest fallback.
  var R = window.KonnektRelease
  var table = document.querySelector('.doc-table')
  if (!R || !table) return

  // A release tag names its own channel: v0.1.0-alpha.1 is alpha, v1.0.0 is a
  // release. Matched on the tag rather than the title, which is prose.
  function channelOf(tag) {
    var t = String(tag || '').toLowerCase()
    if (t.indexOf('alpha') !== -1) return { label: 'ALPHA', stage: 'alpha' }
    if (t.indexOf('beta') !== -1) return { label: 'BETA', stage: 'beta' }
    if (t.indexOf('rc') !== -1) return { label: 'RC', stage: 'beta' }
    return { label: 'RELEASE', stage: 'release' }
  }

  function paint(cell, label, cls, stage) {
    var tag = cell.querySelector('.tag')
    if (!tag) return
    tag.className = 'tag ' + cls
    tag.textContent = label
    if (stage) cell.setAttribute('data-stage', stage)
    else cell.removeAttribute('data-stage')
  }

  Promise.all([
    R.fetchLatest(),
    R.fetchSnapshot().catch(function () {
      return { ok: false, status: 0, data: null }
    }),
  ])
    .then(function (results) {
      var latest = results[0]
      var snapshot = results[1]
      if (!latest.ok && !snapshot.ok) return

      var channel = latest.ok ? channelOf(latest.data.tag_name) : null

      ;[].slice.call(table.querySelectorAll('tr[data-platform]')).forEach(function (row) {
        var platform = R.platformById(row.getAttribute('data-platform'))
        var cell = row.cells[row.cells.length - 1]
        if (!platform || !cell) return

        if (channel && R.matchAsset(platform, latest.data.assets)) {
          paint(cell, channel.label, 'tag-stage', channel.stage)
        } else if (snapshot.ok && snapshot.data && R.matchAsset(platform, snapshot.data.assets)) {
          paint(cell, 'SNAPSHOT', 'tag-wip', null)
        } else {
          paint(cell, 'SOURCE', 'tag-later', null)
        }
      })
    })
    .catch(function () {
      /* The table already says what was true when this page was written. */
    })
})()
