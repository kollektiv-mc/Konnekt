/* Docs home: the search. It narrows the home's page links to those whose
   title and summary hold every word typed, and hides a shelf left with none.
   With this file missing the home is a plain list of links. */
;(function () {
  var input = document.getElementById('doc-search')
  var empty = document.getElementById('doc-empty')
  if (!input || !empty) return

  function words(text) {
    return text.toLowerCase().split(/\s+/).filter(Boolean)
  }

  var links = [].slice.call(document.querySelectorAll('.page-link')).map(function (el) {
    return { el: el, text: el.textContent.toLowerCase() }
  })
  var shelves = [].slice.call(document.querySelectorAll('.shelf'))

  function apply() {
    var q = words(input.value)
    var found = 0
    links.forEach(function (link) {
      var hit = q.every(function (w) {
        return link.text.indexOf(w) !== -1
      })
      link.el.hidden = !hit
      if (hit) found++
    })
    // While searching, a shelf shows only for the pages it still holds.
    shelves.forEach(function (shelf) {
      shelf.hidden = q.length > 0 && !shelf.querySelector('.page-link:not([hidden])')
    })
    empty.hidden = found > 0
  }

  input.addEventListener('input', apply)
  apply()
})()
