/* Tiny, dependency-free Markdown → HTML renderer for GitHub release notes.
   The site has no bundler, and DEPENDENCIES.md prefers not adding libraries,
   so this covers the subset release notes actually use: headings, lists,
   bold/italic, inline + fenced code, links, rules and paragraphs.

   Security: release bodies are untrusted external text, so everything is
   HTML-escaped BEFORE any formatting is applied, and links are restricted to
   http/https/mailto. No raw HTML from the source is ever emitted.

   Placeholders use private-use code points (U+E000/U+E001) so they can't
   collide with real content (e.g. a bare number in prose). */
;(function () {
  var CODE = String.fromCharCode(0xe000) // inline-code span sentinel
  var FENCE = String.fromCharCode(0xe001) // fenced-code block sentinel

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function inline(text) {
    // Protect inline code spans from further formatting.
    var codes = []
    text = text.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c)
      return CODE + (codes.length - 1) + CODE
    })

    // Links: [text](url) — only safe schemes; otherwise drop to plain text.
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      var clean = url.replace(/&amp;/g, '&')
      if (!/^(https?:|mailto:)/i.test(clean)) return label
      var href = encodeURI(clean).replace(/"/g, '%22')
      return '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>'
    })

    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')

    text = text.replace(new RegExp(CODE + '(\\d+)' + CODE, 'g'), function (_, i) {
      return '<code>' + codes[+i] + '</code>'
    })
    return text
  }

  function render(src) {
    if (!src) return ''
    src = src.replace(/\r\n/g, '\n')

    // Pull fenced code blocks out first so their contents aren't touched.
    var blocks = []
    src = src.replace(/```[^\n]*\n([\s\S]*?)```/g, function (_, code) {
      blocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>')
      return FENCE + (blocks.length - 1) + FENCE
    })

    var fenceLine = new RegExp('^' + FENCE + '(\\d+)' + FENCE + '$')
    var lines = escapeHtml(src).split('\n')
    var html = []
    var listType = null
    var i = 0

    function closeList() {
      if (listType) {
        html.push('</' + listType + '>')
        listType = null
      }
    }

    function isSpecial(l) {
      return (
        /^\s*$/.test(l) ||
        /^(#{1,6})\s/.test(l) ||
        /^\s*[-*+]\s/.test(l) ||
        /^\s*\d+\.\s/.test(l) ||
        fenceLine.test(l) ||
        /^\s*([-*_])\1\1+\s*$/.test(l)
      )
    }

    while (i < lines.length) {
      var line = lines[i]

      var ph = line.match(fenceLine)
      if (ph) {
        closeList()
        html.push(blocks[+ph[1]])
        i++
        continue
      }
      if (/^\s*$/.test(line)) {
        closeList()
        i++
        continue
      }
      if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
        closeList()
        html.push('<hr>')
        i++
        continue
      }
      var h = line.match(/^(#{1,6})\s+(.*)$/)
      if (h) {
        closeList()
        var lvl = Math.min(h[1].length, 3)
        html.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>')
        i++
        continue
      }
      var ul = line.match(/^\s*[-*+]\s+(.*)$/)
      if (ul) {
        if (listType !== 'ul') {
          closeList()
          html.push('<ul>')
          listType = 'ul'
        }
        html.push('<li>' + inline(ul[1]) + '</li>')
        i++
        continue
      }
      var ol = line.match(/^\s*\d+\.\s+(.*)$/)
      if (ol) {
        if (listType !== 'ol') {
          closeList()
          html.push('<ol>')
          listType = 'ol'
        }
        html.push('<li>' + inline(ol[1]) + '</li>')
        i++
        continue
      }

      // Paragraph — gather consecutive plain lines.
      closeList()
      var para = [line]
      i++
      while (i < lines.length && !isSpecial(lines[i])) {
        para.push(lines[i])
        i++
      }
      html.push('<p>' + inline(para.join('<br>')) + '</p>')
    }

    closeList()
    return html.join('\n')
  }

  window.KonnektMarkdown = { render: render }
})()
