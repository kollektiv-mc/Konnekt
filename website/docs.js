/* Docs page — the platform table's status tags, and the step demos.

   Both are enhancement. The table is authored with what is published today and
   is right without this file; the demos hold their first frame. */
;(function () {
  // ── Step demos ──────────────────────────────────────────────────────────
  // The animations live in styles.css and only exist under .is-playing, so
  // this decides which card is playing, not what it does.
  //
  // One at a time, in order: four looping mock-ups running at once is noise,
  // and the steps are a sequence, so playing them as one reads the way the
  // walkthrough is meant to be read. Hovering takes over — that card plays and
  // the run stops where it was — and letting go hands it back after a beat,
  // long enough that crossing the page on the way somewhere else does not
  // restart anything.
  //
  // The whole run is gated on being on screen, which is also what makes this
  // work on touch, where there is no hover to take over with.
  var steps = [].slice.call(document.querySelectorAll('.step[data-demo]'))
  var reduceMotion = document.documentElement.classList.contains('reduce-motion')

  if (steps.length && !reduceMotion) {
    var STEP_MS = 8500 // one full loop of a demo, hold and fade included
    var RESUME_MS = 2000
    var at = 0
    var runTimer = null
    var resumeTimer = null
    var pinned = null
    var onScreen = true

    // A folded step is not on screen even when its card is, so it takes no turn
    // in the run until it is opened.
    function open(step) {
      var fold = step.querySelector('details')
      return !fold || fold.open
    }

    function playing() {
      return steps.filter(open)
    }

    function show(step) {
      steps.forEach(function (other) {
        other.classList.toggle('is-playing', other === step)
      })
    }

    function tick() {
      var list = playing()
      if (!list.length) {
        show(null)
        return
      }
      show(list[at % list.length])
      at = (at % list.length) + 1
      runTimer = window.setTimeout(tick, STEP_MS)
    }

    function stop() {
      window.clearTimeout(runTimer)
      runTimer = null
    }

    function run() {
      if (runTimer || pinned || !onScreen) return
      tick()
    }

    steps.forEach(function (step) {
      var take = function () {
        pinned = step
        window.clearTimeout(resumeTimer)
        stop()
        // Where the run picks up from, so it carries on past this card rather
        // than repeating it.
        at = playing().indexOf(step) + 1
        show(step)
      }
      var release = function () {
        if (pinned !== step) return
        pinned = null
        window.clearTimeout(resumeTimer)
        resumeTimer = window.setTimeout(run, RESUME_MS)
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
          if (!fold.open && pinned === step) pinned = null
          stop()
          run()
        })
      }
    })

    // Started rather than waited for: the observer corrects it on its first
    // callback either way, and a run that depends on being told it is visible
    // before it will play is one bad observer away from a page of still
    // pictures.
    run()

    if ('IntersectionObserver' in window) {
      var stage = document.querySelector('.step-grid')
      new IntersectionObserver(
        function (entries) {
          onScreen = entries[0].isIntersecting
          if (onScreen) run()
          else {
            stop()
            show(null)
          }
        },
        { threshold: 0.1 },
      ).observe(stage)
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
