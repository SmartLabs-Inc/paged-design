'use strict'
//
// Read every split-paragraph seam off the paginated page.
//
// Runs in the browser, after Paged.js. Expects each first half to carry
// data-seam="n" and each second half data-seam-rest="n".
//
// For a seam it reports how full the first half's last line would be if
// nothing were stretching it, and what moving that stray line down into the
// second half would leave: the line above — a full line, unless the stray
// line began mid-word, in which case the front of that word goes down too
// and the line above is left that much short.
//
// Pulling words up from the second half to fill the stray line was tried and
// taken out. A word measured as fitting at 97% was hyphenated by the renderer
// anyway, leaving its last syllable alone on a new line — seven seams went
// from loose to absurd. Moving a line down cannot do that: the words left
// behind were already set on one line.
//
// Widths are measured by setting the words on one unbroken line in the
// paragraph's own type, not estimated, and a first half that runs on into
// another column is measured where it ends.

module.exports = function measureSeams (limit) {
  const WS = /[ \t\r\n ]/
  const SPLIT = /[ \t\r\n ]+/
  const out = []

  function naturalWidth (host, text) {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font-weight:400;font-style:normal;letter-spacing:normal;word-spacing:normal'
    probe.textContent = text
    host.appendChild(probe)
    const w = probe.getBoundingClientRect().width
    probe.remove()
    return w
  }

  document.querySelectorAll('.pagedjs_page p.lead-head[data-seam]').forEach(function (el) {
    if (el.hasAttribute('data-split-to')) return
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    const range = document.createRange()

    // Characters grouped into lines by their baseline edge. A raised
    // reference mark sits higher than the words beside it, so lines are told
    // apart by a jump of most of a line, not by any difference at all.
    const lineH = parseFloat(window.getComputedStyle(el).lineHeight) || 17
    const lines = []
    let cur = null
    nodes.forEach(function (node) {
      for (let j = 0; j < node.data.length; j += 1) {
        const ch = node.data[j]
        range.setStart(node, j); range.setEnd(node, j + 1)
        const r = range.getClientRects()[0]
        if (!r || r.width === 0) { if (cur) cur.text += ch; continue }
        if (!cur || r.bottom - cur.bottom > lineH * 0.6) {
          cur = { bottom: r.bottom, text: '', bare: true }
          lines.push(cur)
        }
        cur.text += ch
        if (node.parentNode !== el) cur.bare = false      // inside a mark or a styled run
      }
    })
    if (!lines.length) return
    const width = el.getBoundingClientRect().width
    const last = lines[lines.length - 1]
    const lastText = last.text.replace(/­/g, '')
    const fill = naturalWidth(el, lastText.trim()) / width
    if (fill >= limit) return

    const seam = Number(el.getAttribute('data-seam'))
    const entry = { seam: seam, fill: Math.round(fill * 100), tail: lastText.trim().slice(-40), down: null }

    // --- down ---------------------------------------------------------
    if (lines.length > 1 && last.bare) {
      const above = lines[lines.length - 2].text.replace(/­/g, '')
      const midWord = !WS.test(above[above.length - 1] || ' ') && !WS.test(last.text[0] || ' ')
      const kept = midWord ? above.replace(/[^ \t\r\n ]*$/, '') : above
      entry.down = {
        words: lastText.split(SPLIT).filter(Boolean).length,
        fill: Math.round(100 * Math.min(1, naturalWidth(el, kept.trim()) / width))
      }
    }

    out.push(entry)
  })
  return out
}
