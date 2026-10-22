/* Requirements and platforms: the platform table's status, read from the
   releases. The table is authored with what is published today and is right
   without this file. */
;(function () {
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
  var table = document.getElementById('platforms-table')
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

  // The cell's stage names its colour (site.css, docs.css), and its label is
  // the text after the marker.
  function paint(cell, label, stage) {
    var status = cell.querySelector('.status')
    if (!status) return
    status.lastChild.textContent = label
    cell.setAttribute('data-stage', stage)
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
      // Without the latest release there is no telling a released platform
      // from a snapshot-only one, so the table stays as written.
      if (!latest.ok || !latest.data) return

      var channel = channelOf(latest.data.tag_name)

      ;[].slice.call(table.querySelectorAll('tr[data-platform]')).forEach(function (row) {
        var platform = R.platformById(row.getAttribute('data-platform'))
        var cell = row.cells[row.cells.length - 1]
        if (!platform || !cell) return

        if (R.matchAsset(platform, latest.data.assets)) {
          paint(cell, channel.label, channel.stage)
        } else if (snapshot.ok && snapshot.data && R.matchAsset(platform, snapshot.data.assets)) {
          paint(cell, 'SNAPSHOT', 'snapshot')
        } else {
          paint(cell, 'SOURCE', 'source')
        }
      })
    })
    .catch(function () {
      /* The table already says what was true when this page was written. */
    })
})()
