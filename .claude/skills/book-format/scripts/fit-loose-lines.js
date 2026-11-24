#!/usr/bin/env node
//
// Close the worst gaps in justified text by tracking the paragraph they are in.
//
// A justified line is filled by stretching its word spaces. In narrow columns
// a line that could not take the next word, or the next piece of it, is left
// with a few long words and all the slack between them: a hole. What a
// compositor does about one is re-set the paragraph a hair tighter or looser
// so that its lines break somewhere else — tracking, in thousandths of an em,
// too little to see as a change of colour and enough to bring a syllable up
// or send a word down.
//
// This does that, one paragraph at a time, and only where it is measured to
// help:
//
//   1. the book is paginated as it stands;
//   2. every justified paragraph is measured: for each line, the average gap
//      between its words, in ems;
//   3. a paragraph whose worst line is at or over --hole (default 1 em) is
//      tried at each tracking from --tight (default -20) to --loose (default
//      +20) in steps of 5, live, in the page, and measured again each time;
//   4. the tracking that gives the smallest worst line is kept if it is a
//      real gain (--gain, default 20 per cent better) and breaks nothing:
//      no run of more than two hyphenated lines that was not there before,
//      and no more than one line's change in the paragraph's length;
//   5. the choice is written into the book as `letter-spacing` on that
//      paragraph, and to a log.
//
// A paragraph that already carries a letter-spacing of its own — one somebody
// tracked by hand in the editor — is left exactly as it is. So is the first
// half of a paragraph the build cut in two (`.lead-head`): its cut has to stay
// at the end of a line. So is a paragraph divided between two pages: only half of it is in front of the measure, and
// the next pass will find it whole or not at all.
//
// It is a fit, not a cure. The measure is narrow and the words are long;
// most holes have no tracking within reason that closes them, and those are
// reported and left. `report-loose-lines.py` on the finished PDF says what
// remains.
//
//   node fit-loose-lines.js --content content/my-book [--also <copy>] [--dry]
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)
const SOFT = '­'

if (args.help || !args.content) {
  console.log([
    'Usage: node fit-loose-lines.js --content <dir> [--also <dir>] [--theme <name>] [--dry]',
    '',
    '  --content <dir>  Book directory holding index.html. MODIFIED in place unless --dry.',
    '  --also <dir>     A second copy of the book to change the same way.',
    '  --hole <em>      Average word gap on a line that makes it a hole. Default 1.',
    '  --tight <n>      Tightest tracking to try, thousandths of an em. Default -20.',
    '  --loose <n>      Loosest tracking to try. Default 20.',
    '  --gain <pct>     How much better the worst line must get. Default 20.',
    '  --seams          Also close the seams: where the first half of a cut',
    '                   paragraph no longer ends at a line end, track it until',
    '                   it does. --seams-only does nothing else.',
    '  --json <file>    Write every paragraph tried and what was chosen.',
    '  --dry            Measure and choose, write nothing.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const options = {
  seams: !!args.seams || !!args['seams-only'],
  seamsOnly: !!args['seams-only'],
  seamFull: Number(args['seam-full'] || 82) / 100,
  hole: Number(args.hole || 1),
  tight: Number(args.tight || -20),
  loose: Number(args.loose || 20),
  gain: Number(args.gain || 20) / 100
}

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  await watchForPagedJs(page)
  await blockRemoteResources(page, server.url)
  const url = server.url + '/' +
    path.relative(root, path.resolve(args.content)).split(path.sep).join('/') +
    '/index.html?theme=' + theme
  console.log('Paginating ' + url + ' …')
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const result = await page.evaluate(function (opts) {
    var SOFT = '­'
    var BLOCKS = 'p, li, dd'
    var SKIP = 'h1, h2, h3, h4, h5, h6, .label, .entry-name, table, .figure, .references, .index, .toc-list, .contents-page, .title-page'

    function lastRect (node, offset) {
      var r = document.createRange()
      r.setStart(node, offset)
      r.setEnd(node, offset + 1)
      var list = r.getClientRects()
      for (var i = list.length - 1; i >= 0; i -= 1) if (list[i].width > 0 && list[i].height > 0) return list[i]
      return null
    }
    function hyphenDrawn (node, offset) {
      var r = document.createRange()
      r.setStart(node, offset)
      r.setEnd(node, offset + 1)
      var list = r.getClientRects()
      for (var i = 0; i < list.length; i += 1) if (list[i].width > 0.5) return list[i]
      return null
    }

    // The lines of a paragraph: for each, the gaps between its words and
    // whether it ends in a hyphen.
    function measure (el, em, mid) {
      var words = []
      var hyphens = []
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      var node
      while ((node = walker.nextNode())) {
        var text = node.textContent
        var re = /\S+/g
        var m
        while ((m = re.exec(text))) {
          var first = m.index
          var last = m.index + m[0].length - 1
          while (first < last && text[first] === SOFT) first += 1
          while (last > first && text[last] === SOFT) last -= 1
          var a = lastRect(node, first)
          var b = lastRect(node, last)
          if (a && b) words.push({ left: a.left, top: a.top, right: b.right, endTop: b.top, col: a.left >= mid ? 1 : 0, endCol: b.left >= mid ? 1 : 0 })
          var at = m[0].indexOf(SOFT)
          while (at >= 0) {
            var drawn = hyphenDrawn(node, m.index + at)
            if (drawn) {
              var next = m.index + at + 1 < text.length ? lastRect(node, m.index + at + 1) : null
              if (next && (next.top > drawn.top + 3 || next.left > drawn.left + 60 && next.top < drawn.top - 3)) {
                hyphens.push({ top: drawn.top, col: drawn.left >= mid ? 1 : 0 })
              }
            }
            at = m[0].indexOf(SOFT, at + 1)
          }
        }
      }
      var lines = {}
      var order = []
      var key = function (col, top) { return col + '|' + Math.round(top / 4) }
      words.forEach(function (w) {
        var k = key(w.col, w.top)
        if (!lines[k]) { lines[k] = { col: w.col, top: w.top, gaps: [], hyphen: false, last: null }; order.push(k) }
        var line = lines[k]
        if (line.last !== null) {
          var gap = w.left - line.last
          if (gap > 0.8) line.gaps.push(gap)
        }
        // A word carried over by a hyphen ends on the next line.
        if (key(w.endCol, w.endTop) === k) line.last = w.right
        else {
          line.last = null
          var k2 = key(w.endCol, w.endTop)
          if (!lines[k2]) { lines[k2] = { col: w.endCol, top: w.endTop, gaps: [], hyphen: false, last: null }; order.push(k2) }
          lines[k2].last = w.right
        }
      })
      hyphens.forEach(function (h) { var line = lines[key(h.col, h.top)]; if (line) line.hyphen = true })
      var list = order.map(function (k) { return lines[k] }).sort(function (x, y) { return x.col - y.col || x.top - y.top })
      var worst = 0
      var sum = 0
      // The last line is not stretched.
      for (var i = 0; i < list.length - 1; i += 1) {
        var gaps = list[i].gaps
        if (!gaps.length) continue
        var mean = gaps.reduce(function (s, g) { return s + g }, 0) / gaps.length / em
        if (mean > worst) worst = mean
        sum += mean * mean
      }
      var run = 0
      var stack = 0
      list.forEach(function (line) { run = line.hyphen ? run + 1 : 0; if (run > stack) stack = run })
      return { lines: list.length, worst: worst, sum: sum, stack: stack }
    }

    var steps = []
    for (var t = opts.tight; t <= opts.loose; t += 5) if (t !== 0) steps.push(t)
    steps.sort(function (x, y) { return Math.abs(x) - Math.abs(y) })

    // How full the last line of a block is, set naturally: the block is
    // asked to stop spreading its last line for the moment of the measure.
    function lastLineFull (el, box, mid, across) {
      var was = el.style.textAlignLast
      el.style.textAlignLast = 'left'
      var words = []
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      var node
      while ((node = walker.nextNode())) {
        var text = node.textContent
        var re = /\S+/g
        var m
        while ((m = re.exec(text))) {
          var end = m.index + m[0].length - 1
          while (end > m.index && text[end] === SOFT) end -= 1
          var b = lastRect(node, end)
          if (b) words.push(b)
        }
      }
      el.style.textAlignLast = was
      if (!el.getAttribute('style')) el.removeAttribute('style')
      if (!words.length) return null
      var last = words[words.length - 1]
      var left = box.left
      var column = across ? box.width : el.getBoundingClientRect().width
      // the column this line is in: the block's own box in that column
      var rects = el.getClientRects()
      for (var i = 0; i < rects.length; i += 1) {
        if (last.top >= rects[i].top - 2 && last.bottom <= rects[i].bottom + 2 && last.left >= rects[i].left - 2 && last.right <= rects[i].right + 2) {
          left = rects[i].left
          column = rects[i].width
        }
      }
      var tops = {}
      words.forEach(function (w) { tops[Math.round(w.left >= mid && !across ? 1e5 + w.top / 4 : w.top / 4)] = 1 })
      return { full: (last.right - left) / column, lines: Object.keys(tops).length }
    }

    var out = { judged: 0, holes: 0, fitted: [], left: 0, skipped: { tracked: 0, divided: 0 }, bands: {}, seams: { judged: 0, showing: 0, closed: 0, open: 0 } }
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    pages.forEach(function (pg, index) {
      var area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      var box = area.getBoundingClientRect()
      var mid = box.left + box.width / 2
      area.querySelectorAll(BLOCKS).forEach(function (el) {
        if (el.querySelector(BLOCKS) || el.closest(SKIP)) return
        // The first half of a paragraph the build cut in two ends where a
        // line ended when it was cut. Track it and its lines break somewhere
        // else, the cut is left in mid-line, and that line — justified, so
        // the cut cannot be seen — becomes three words across the measure.
        // Tracked here, such halves made the fourteen worst lines in the book.
        if (el.classList.contains('lead-head') && !el.classList.contains('lead-whole')) {
          // What can be done for one is the opposite job: where its cut has
          // come to rest in mid-line, find the tracking that brings the end
          // of its text back to the end of a line.
          if (!opts.seams || el.style.letterSpacing || el.hasAttribute('data-split-from') || el.hasAttribute('data-split-to')) return
          var seamBox = el.getBoundingClientRect().width > box.width * 0.75
          var now = lastLineFull(el, box, mid, seamBox)
          if (!now) return
          out.seams.judged += 1
          if (now.full >= opts.seamFull) return
          out.seams.showing += 1
          var chosen = null
          steps.forEach(function (step) {
            if (chosen && chosen.got.full >= 0.93) return
            el.style.letterSpacing = (step / 1000) + 'em'
            var got = lastLineFull(el, box, mid, seamBox)
            if (got && got.lines === now.lines && got.full > now.full + 0.05 && (!chosen || got.full > chosen.got.full)) chosen = { step: step, got: got }
          })
          el.style.letterSpacing = ''
          if (!el.getAttribute('style')) el.removeAttribute('style')
          if (!chosen || chosen.got.full < opts.seamFull) { out.seams.open += 1; return }
          out.seams.closed += 1
          out.fitted.push({
            sheet: index + 1, tracking: chosen.step, seam: true,
            before: Math.round(now.full * 100) / 100, after: Math.round(chosen.got.full * 100) / 100,
            lines: [now.lines, chosen.got.lines], tag: el.tagName.toLowerCase(),
            lead: el.textContent.slice(0, 90), tail: el.textContent.slice(-40), length: el.textContent.length
          })
          return
        }
        if (opts.seamsOnly) return
        var style = window.getComputedStyle(el)
        if (style.textAlign !== 'justify' || !el.getClientRects().length) return
        if (el.textContent.length < 80) return
        var em = parseFloat(style.fontSize)
        // A paragraph set across both columns has no middle to split at.
        var across = el.getBoundingClientRect().width > box.width * 0.75
        var base = measure(el, em, across ? box.right + 10 : mid)
        if (base.lines < 3) return
        out.judged += 1
        if (base.worst < opts.hole) return
        out.holes += 1
        var band = base.worst >= 2 ? '2 em or more' : base.worst >= 1.5 ? '1.5 to 2 em' : base.worst >= 1.25 ? '1.25 to 1.5 em' : 'under 1.25 em'
        out.bands[band] = (out.bands[band] || 0) + 1
        if (el.style.letterSpacing) { out.skipped.tracked += 1; return }
        if (el.hasAttribute('data-split-from') || el.hasAttribute('data-split-to')) { out.skipped.divided += 1; return }

        var best = null
        steps.forEach(function (step) {
          el.style.letterSpacing = (step / 1000) + 'em'
          var got = measure(el, em, across ? box.right + 10 : mid)
          if (got.stack > 2 && got.stack > base.stack) return
          if (Math.abs(got.lines - base.lines) > 1) return
          if (got.worst > base.worst * (1 - opts.gain)) return
          // Smallest worst line; a smaller tracking wins unless a larger one
          // is clearly better.
          if (!best || got.worst < best.got.worst * 0.95) best = { step: step, got: got }
        })
        el.style.letterSpacing = ''
        if (!el.getAttribute('style')) el.removeAttribute('style')
        if (!best) { out.left += 1; return }
        out.fitted.push({
          sheet: index + 1,
          tracking: best.step,
          before: Math.round(base.worst * 100) / 100,
          after: Math.round(best.got.worst * 100) / 100,
          lines: [base.lines, best.got.lines],
          tag: el.tagName.toLowerCase(),
          lead: el.textContent.slice(0, 90),
          tail: el.textContent.slice(-40),
          length: el.textContent.length
        })
      })
    })
    return out
  }, options)

  await browser.close()
  await server.close()

  console.log('')
  console.log(result.judged + ' justified paragraphs measured; ' + result.holes + ' have a line whose average word gap is ' + options.hole + ' em or more')
  Object.keys(result.bands).sort().forEach(k => console.log('  ' + result.bands[k] + '  worst line ' + k))
  console.log(result.fitted.length + ' can be improved by tracking; ' + result.left + ' cannot within ' + options.tight + ' to +' + options.loose +
    '; ' + result.skipped.tracked + ' already tracked by hand, ' + result.skipped.divided + ' divided between pages (left alone)')
  if (options.seams) {
    console.log(result.seams.judged + ' cut paragraphs measured; ' + result.seams.showing + ' end short of a line end (under ' +
      Math.round(options.seamFull * 100) + '% full); ' + result.seams.closed + ' closed by tracking, ' + result.seams.open + ' not')
  }
  const by = {}
  result.fitted.forEach(f => { by[f.tracking] = (by[f.tracking] || 0) + 1 })
  console.log('  tracking chosen: ' + Object.keys(by).map(Number).sort((a, b) => a - b).map(k => (k > 0 ? '+' : '') + k + ': ' + by[k]).join(', '))
  const mean = list => list.length ? (list.reduce((s, x) => s + x, 0) / list.length).toFixed(2) : '0'
  const holes = result.fitted.filter(f => !f.seam)
  console.log('  their worst line, on average: ' + mean(holes.map(f => f.before)) + ' em before, ' + mean(holes.map(f => f.after)) + ' em after')
  if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(result, null, 1))

  // --- write it into the book ------------------------------------------------
  const files = [args.content].concat(args.also ? [args.also] : []).map(dir => path.join(path.resolve(dir), 'index.html'))
  files.forEach(file => {
    let html = fs.readFileSync(file, 'utf8')
    const { text, at } = textOf(html)
    const edits = []
    let missing = 0
    let unsure = 0
    result.fitted.forEach(f => {
      const hits = []
      let from = text.indexOf(f.lead)
      while (from >= 0) { hits.push(from); from = text.indexOf(f.lead, from + 1) }
      const fits = hits.filter(h => text.slice(h + f.length - f.tail.length, h + f.length) === f.tail)
      if (!hits.length) { missing += 1; return }
      if (fits.length !== 1) { unsure += 1; return }
      // The block's own opening tag: the nearest one before its text.
      const textStart = at[fits[0]]
      let open = html.lastIndexOf('<' + f.tag, textStart)
      while (open >= 0 && !/[\s>]/.test(html[open + f.tag.length + 1])) open = html.lastIndexOf('<' + f.tag, open - 1)
      if (open < 0) { missing += 1; return }
      const close = html.indexOf('>', open)
      const tag = html.slice(open, close + 1)
      if (/letter-spacing/.test(tag)) return
      const value = 'letter-spacing: ' + (f.tracking / 1000) + 'em'
      let fresh = /\sstyle="/.test(tag)
        ? tag.replace(/\sstyle="([^"]*)"/, (m, existing) => ' style="' + existing.replace(/;?\s*$/, '') + '; ' + value + '"')
        : tag.replace(/>$/, ' style="' + value + '">')
      // Marked, so a tracking this pass chose can be told from one set by hand.
      fresh = fresh.replace(/>$/, ' data-fit="' + (f.seam ? 'seam' : 'loose') + '">')
      edits.push({ open, close, fresh })
    })
    edits.sort((x, y) => y.open - x.open).forEach(e => { html = html.slice(0, e.open) + e.fresh + html.slice(e.close + 1) })
    if (!args.dry && edits.length) fs.writeFileSync(file, html)
    console.log(path.relative(process.cwd(), file) + ': ' + edits.length + ' paragraphs tracked' +
      (missing ? ', ' + missing + ' not found' : '') + (unsure ? ', ' + unsure + ' ambiguous and left' : '') + (args.dry ? ' — dry run, nothing written' : ''))
  })
})().catch(function (error) {
  console.error(error)
  process.exit(2)
})

// The file as running text, with the place in the file of every character.
function textOf (html) {
  const chars = []
  const at = []
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: SOFT }
  let i = Math.max(0, html.indexOf('<body'))
  const skipTo = (close) => { const end = html.indexOf(close, i); i = end < 0 ? html.length : end + close.length }
  while (i < html.length) {
    const ch = html[i]
    // A "<" opens a tag only before a letter, "/" or "!". The text has
    // "(p<0.001)" in it, unescaped, and a browser reads that as text.
    if (ch === '<' && /[A-Za-z\/!]/.test(html[i + 1] || '')) {
      if (html.startsWith('<!--', i)) { skipTo('-->'); continue }
      const lower = html.slice(i, i + 8).toLowerCase()
      if (lower.startsWith('<script')) { skipTo('</script>'); continue }
      if (lower.startsWith('<style')) { skipTo('</style>'); continue }
      skipTo('>')
      continue
    }
    if (ch === '&') {
      const m = /^&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/.exec(html.slice(i, i + 12))
      if (m) {
        let value = null
        if (m[1][0] === '#') {
          const code = m[1][1] === 'x' || m[1][1] === 'X' ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10)
          value = String.fromCodePoint(code)
        } else if (named[m[1]]) value = named[m[1]]
        if (value !== null) {
          for (const c of value) { chars.push(c); at.push(i) }
          i += m[0].length
          continue
        }
      }
    }
    chars.push(ch)
    at.push(i)
    i += 1
  }
  return { text: chars.join(''), at }
}
