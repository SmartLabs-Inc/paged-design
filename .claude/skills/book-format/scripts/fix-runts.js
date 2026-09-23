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
    '                   as a runt. Default 0.30.',
    '  --loose <n>      Treat any other line whose natural width is under this',
    '                   fraction of the measure as loose — justification has to',
    '                   stretch it to fit. Default 0.86.',
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
const tail = Number(args.tail || 0.30)
const loose = Number(args.loose || 0.86)

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
    function lineRects (el) {
      const range = document.createRange()
      range.selectNodeContents(el)
      return Array.from(range.getClientRects())
        .filter(function (r) { return r.width > 0.5 && r.height > 0.5 })
    }
    // How short the worst line in a paragraph really is, ignoring the last one.
    //
    // Measured unjustified. Justified text fills the measure by definition, so
    // every line rect is the full width and a rect tells you nothing about how
    // hard the browser had to stretch it. Line breaking is identical either
    // way — only the distribution of space changes — so ranging the paragraph
    // left for the length of the measurement gives the true content width of
    // each line, and the shortest one is the line justification has to work
    // hardest on.
    function worstLine (el, rects) {
      const width = el.getBoundingClientRect().width
      if (!width || rects.length < 2) return 1
      const align = el.style.textAlign
      el.style.textAlign = 'left'
      const natural = lineRects(el)
      el.style.textAlign = align
      let worst = 1
      for (let i = 0; i < natural.length - 1; i += 1) {
        const ratio = natural[i].width / width
        if (ratio < worst) worst = ratio
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
    document.querySelectorAll('[data-runt]').forEach(function (el) {
      const id = el.getAttribute('data-runt')
      if (seen.has(id)) { split += 1; return }
      seen.add(id)
      const ref = el.getAttribute('data-ref')
      if (ref) { if (byRef.has(ref)) { split += 1; return } byRef.set(ref, id) }
      const rects = lineRects(el)
      if (rects.length < 2) return
      const width = el.getBoundingClientRect().width
      if (!width) return
      const isRunt = rects[rects.length - 1].width <= width * tail
      const worstBefore = worstLine(el, rects)
      const isLoose = worstBefore < input.loose
      if (!isRunt && !isLoose) return
      if (isRunt) runts += 1
      if (isLoose) looseCount += 1
      const before = rects.length
      const original = el.style.letterSpacing
      for (let i = 0; i < steps.length; i += 1) {
        el.style.letterSpacing = steps[i] + 'em'
        const now = lineRects(el)
        // A step is kept if it costs the paragraph a line, or if it pulls the
        // worst line up without costing one. Never if it makes the worst line
        // worse — tracking can move a word down as easily as up.
        if (now.length < before) { fixed[id] = steps[i]; break }
        if (isLoose && now.length === before &&
            worstLine(el, now) > worstBefore + 0.02) { fixed[id] = steps[i]; break }
      }
      // Whatever happened, put the element back: this pass reports, the file
      // is edited afterwards. A style left behind here would be measured by
      // the next paragraph as if it were the page's own.
      el.style.letterSpacing = original
    })
    return { runts: runts, loose: looseCount, split: split, fixed: fixed }
  }, { steps: steps, tail: tail, loose: loose })

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
  console.log('  carrying a loose line: ' + result.loose)
  console.log('  pulled back: ' + written +
    (written ? ' (' + steps.map(function (s) {
      return s + 'em: ' + (byStep[s] || 0)
    }).join(', ') + ')' : ''))
  console.log('  left alone: ' + (result.runts - written))
})()
