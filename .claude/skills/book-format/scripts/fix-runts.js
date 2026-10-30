#!/usr/bin/env node
//
// Pull a runt line back into the paragraph above it.
//
// A paragraph whose last line carries one or two words wastes a line and
// leaves a ragged hole in a justified column. The fix compositors have used
// for a century is to track the paragraph a fraction tighter — not the page,
// not the book, that one paragraph — until the tail comes up.
//
// Three things make this safe to automate here, and all three are the reason
// it is done by measuring rather than by rule:
//
//   1. It is tried, not assumed. Each candidate gets the smallest tracking in
//      the ladder that actually removes a line, and a paragraph that does not
//      improve at any step keeps its original setting and is left alone.
//   2. The ladder stops at -0.018em. Past roughly -0.02em at this size the
//      letterforms start to touch and the paragraph reads as squeezed, which
//      is a worse fault than the runt it was fixing.
//   3. It measures in the paginated book. Whether a word wraps is a fact
//      about the real column, and a probe host disagrees with the page — the
//      same disagreement that made the character budgets in `design-md.js`
//      budgets rather than measurements.
//
// Ordering: after hyphenation, because a hyphen changes where a line ends;
// before `fix-lead-splits.js`, because tracking changes where a line ends and
// that pass exists to put each lead cut on one.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs, requirePlaywright, launchChromium, serveDirectory,
  requireRepoRoot, waitForPagedJs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node fix-runts.js --content <dir> --theme <name> [options]',
    '',
    '  --content <dir>  Book directory holding index.html, rewritten in place.',
    '  --theme <name>   Theme to paginate with.',
    '  --steps <list>   Tracking ladder in em, tightest last.',
    '                   Default "-0.006,-0.01".',
    '  --tail <n>       Treat a last line under this fraction of the measure',
    '                   as a runt. Default 0.18 — about two words.',
    '  --max-gap <n>    The widest word space a justified line may carry, in',
    '                   multiples of the space in the font. Default 3.',
    '  --timeout <ms>   Pagination timeout. Default 1800000.',
    '',
    'Tracks individual paragraphs a fraction tighter to pull a one- or two-word',
    'last line back into the paragraph. Measured in the paginated book; a',
    'paragraph that does not lose a line is left exactly as it was.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const dir = path.resolve(args.content)
const indexFile = path.join(dir, 'index.html')
const steps = String(args.steps || '-0.006,-0.01').split(',')
  .map(function (s) { return Number(s.trim()) }).filter(function (n) { return n < 0 })
const tail = Number(args.tail || 0.18)
const maxGap = Number(args['max-gap'] || 3)

// Tag the candidates before pagination so the measured element can be found
// again in the file afterwards. Body paragraphs only: an entry name, a running
// head, a reference or an index line is not prose and must not be tracked.
const SKIP = /\b(?:run-head|topic-head|reference|label|standfirst|lead-head|lead-rest|part-figure-credit|figure-slot-file|copyright-|references-url|index)\b/

let html = fs.readFileSync(indexFile, 'utf8')
let tagged = 0
html = html.replace(/<p(\s[^>]*)?>/g, function (open, attrs) {
  const cls = /\bclass="([^"]*)"/.exec(attrs || '')
  if (cls && SKIP.test(cls[1])) return open
  const mark = ' data-runt="' + tagged + '"'
  tagged += 1
  return '<p' + (attrs || '') + mark + '>'
})
fs.writeFileSync(indexFile, html)
console.log('  candidates tagged: ' + tagged)

;(async () => {
  const { chromium } = requirePlaywright()
  const root = requireRepoRoot()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  const url = server.url + '/' + path.relative(root, indexFile).split(path.sep).join('/') +
    '?theme=' + encodeURIComponent(args.theme || 'aalai-textbook')
  console.log('Paginating ' + url + ' …')
  const started = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))
  console.log('  paginated in ' + Math.round((Date.now() - started) / 1000) + 's')

  const result = await page.evaluate(function (input) {
    const steps = input.steps
    const tail = input.tail
    // Everything is measured from the words themselves.
    //
    // `Range.getClientRects()` was the obvious source and is the wrong one: it
    // returns a rect per inline box, not per line. Every `sup` citation, `em`
    // and `a` splits a line into several, so its length is not a line count
    // and its final entry is usually a superscript a few pixels wide — which
    // reported nine paragraphs in ten as ending in a runt.
    function spaceWidth (el) {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
      probe.textContent = '\u00a0'
      el.appendChild(probe)
      const w = probe.getBoundingClientRect().width
      probe.remove()
      return w || 3
    }

    // Word boxes in document order. Ranges over the text nodes rather than
    // spans wrapped round the words: these paragraphs carry markup, and
    // rewriting innerHTML to wrap words corrupts it.
    function wordBoxes (el) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
      const boxes = []
      const range = document.createRange()
      let node
      while ((node = walk.nextNode())) {
        const text = node.nodeValue
        let i = 0
        while (i < text.length) {
          while (i < text.length && /\s/.test(text[i])) i += 1
          if (i >= text.length) break
          let j = i
          while (j < text.length && !/\s/.test(text[j])) j += 1
          range.setStart(node, i)
          range.setEnd(node, j)
          const r = range.getBoundingClientRect()
          if (r.width > 0) boxes.push({ x: r.left, r: r.right, y: Math.round(r.top) })
          i = j
        }
      }
      return boxes
    }

    // A line is a maximal run of consecutive words sharing a row. Document
    // order keeps the two columns apart without having to know the gutter:
    // the last word of one column and the first of the next are consecutive
    // but sit at different heights, so they never join.
    function linesOf (boxes) {
      const lines = []
      let run = null
      for (let i = 0; i < boxes.length; i += 1) {
        if (run && boxes[i].y === run.y) {
          run.right = boxes[i].r
          run.words.push(boxes[i])
        } else {
          if (run) lines.push(run)
          run = { y: boxes[i].y, left: boxes[i].x, right: boxes[i].r, words: [boxes[i]] }
        }
      }
      if (run) lines.push(run)
      lines.forEach(function (l) { l.width = l.right - l.left })
      return lines
    }

    // `count` is true only on a paragraph's first measurement. This runs again
    // for every rung of the tracking ladder, and counting each time made the
    // book's line total depend on how many paragraphs happened to qualify —
    // so the same book measured 46,543 lines at one threshold and 37,805 at
    // another, and the two rates could not be compared.
    //
    // The tally is a histogram rather than a single threshold, so one run
    // answers the question at every ceiling instead of one.
    function worstGap (lines, space, count) {
      let worst = 0
      for (let i = 0; i < lines.length - 1; i += 1) {
        const ws = lines[i].words
        let lineWorst = 0
        for (let j = 0; j < ws.length - 1; j += 1) {
          const g = (ws[j + 1].x - ws[j].r) / space
          if (g > lineWorst) lineWorst = g
        }
        if (count) {
          totalLines += 1
          const bucket = Math.min(Math.floor(lineWorst), 9)
          hist[bucket] = (hist[bucket] || 0) + 1
        }
        if (lineWorst > worst) worst = lineWorst
      }
      for (let i = 0; i < lines.length - 1; i += 1) {
        const ws = lines[i].words
        for (let j = 0; j < ws.length - 1; j += 1) {
          const gap = (ws[j + 1].x - ws[j].r) / space
          if (gap > worst) worst = gap
        }
      }
      return worst
    }

    // Paged.js clones classes and attributes onto every fragment of a split
    // element, and the fragments share a data-ref. A paragraph broken over a
    // column is two boxes; measuring it as two paragraphs invents runts that
    // are not there.
    const byRef = new Map()
    const seen = new Set()
    const fixed = {}
    let runts = 0
    let looseCount = 0
    let split = 0
    const samples = []
    let totalLines = 0
    const hist = {}
    document.querySelectorAll('[data-runt]').forEach(function (el) {
      const id = el.getAttribute('data-runt')
      if (seen.has(id)) { split += 1; return }
      seen.add(id)
      const ref = el.getAttribute('data-ref')
      if (ref) { if (byRef.has(ref)) { split += 1; return } byRef.set(ref, id) }
      const space = spaceWidth(el)
      let lines = linesOf(wordBoxes(el))
      if (lines.length < 2) return
      // The measure is the widest line the paragraph has — a full line by
      // definition. Not the element's own width: in a two-column flow that is
      // both columns and the gutter.
      let width = 0
      lines.forEach(function (l) { if (l.width > width) width = l.width })
      if (!width) return
      const isRunt = lines[lines.length - 1].width <= width * tail
      const worstBefore = worstGap(lines, space, true)
      const isLoose = worstBefore > input.maxGap
      if (!isRunt && !isLoose) return
      if (isRunt) runts += 1
      if (isLoose) looseCount += 1
      if (samples.length < 6) {
        samples.push({ lines: lines.length, last: Math.round(100 * lines[lines.length - 1].width / width),
          gap: Math.round(worstBefore * 10) / 10, text: el.textContent.slice(0, 44) })
      }
      const before = lines.length
      const original = el.style.letterSpacing
      for (let i = 0; i < steps.length; i += 1) {
        el.style.letterSpacing = steps[i] + 'em'
        const now = linesOf(wordBoxes(el))
        if (now.length < before) { fixed[id] = steps[i]; break }
        if (isLoose && now.length === before &&
            worstGap(now, space, false) < worstBefore - 0.15) { fixed[id] = steps[i]; break }
      }
      // Whatever happened, put the element back: this pass reports, the file
      // is edited afterwards. A style left behind here would be measured by
      // the next paragraph as if it were the page's own.
      el.style.letterSpacing = original
    })
    return { runts: runts, loose: looseCount, split: split, fixed: fixed, samples: samples, totalLines: totalLines, hist: hist }
  }, { steps: steps, tail: tail, maxGap: maxGap })

  await browser.close()
  await server.close()

  const fixed = result.fixed
  const ids = Object.keys(fixed)
  let written = 0
  html = fs.readFileSync(indexFile, 'utf8')
  html = html.replace(/<p([^>]*?)\sdata-runt="(\d+)"([^>]*)>/g, function (all, before, id, after) {
    const value = fixed[id]
    if (value === undefined) return '<p' + before + after + '>'
    written += 1
    const style = 'letter-spacing:' + value + 'em'
    const attrs = (before + after)
    if (/\sstyle="/.test(attrs)) {
      return '<p' + attrs.replace(/\sstyle="([^"]*)"/, ' style="$1;' + style + '"') + '>'
    }
    return '<p' + attrs + ' style="' + style + '">'
  })
  fs.writeFileSync(indexFile, html)

  const byStep = {}
  ids.forEach(function (id) { byStep[fixed[id]] = (byStep[fixed[id]] || 0) + 1 })
  console.log('Runts in ' + path.relative(process.cwd(), indexFile))
  console.log('  paragraphs measured: ' + (tagged - result.split))
  console.log('  ending in a runt: ' + result.runts)
  console.log('  with a word gap over ' + maxGap + ' spaces: ' + result.loose)
  // Every ceiling from one run, so two rates are never compared across two.
  const total = Math.max(result.totalLines, 1)
  console.log('  lines measured: ' + result.totalLines)
  for (let g = 2; g <= 5; g += 1) {
    let over = 0
    Object.keys(result.hist).forEach(function (k) { if (Number(k) >= g) over += result.hist[k] })
    console.log('    over ' + g + ' spaces: ' + over + ' (' +
      Math.round(1000 * over / total) / 10 + '%)')
  }
  console.log('  pulled back: ' + written +
    (written ? ' (' + steps.map(function (s) {
      return s + 'em: ' + (byStep[s] || 0)
    }).join(', ') + ')' : ''))
  console.log('  left alone: ' + (result.runts - written))
  // A few of what it found, so the numbers can be disbelieved on sight.
  result.samples.forEach(function (s) {
    console.log('    ' + s.lines + ' lines, last ' + s.last + '% of measure, worst gap ' +
      s.gap + ' spaces — ' + JSON.stringify(s.text))
  })
})()
