#!/usr/bin/env node
//
// Is everything in the book's source actually on a page?
//
// This REPORTS. It changes nothing.
//
// Pagination can drop text without saying so. A break handler that sends the
// break to the wrong side of a block, or a block that Paged.js lays out past
// the foot of the last column, leaves a page that looks finished and a
// sentence, an index entry or a heading that is in the source and nowhere in
// the PDF. Nothing else in the checks would notice: there is no overflow to
// measure, no widow, no blank page. The index of the textbook lost a letter
// heading and four entries this way, one at each of three page breaks, and it
// was the author who found the first of them.
//
// The check is exact, not a text search. Paged.js numbers every element of the
// source (data-ref) and every piece it lays out carries the same number, so
// each block of the source can be asked for by number:
//
//   lost     no piece of it was laid out at all
//   short    pieces were laid out, but they hold less text than the source
//   clipped  it was laid out, and none of it falls inside the page's text area
//
// Blocks the stylesheet hides on purpose (display: none) are counted and named
// by class, so a hidden running-head line is not mistaken for a loss, and a
// class that should not be hidden shows up in the list.
'use strict'

const path = require('path')
const fs = require('fs')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node report-lost-content.js --content <dir> [--theme <name>] [--json <file>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --json <file>    Also write the full report as JSON.',
    '  --strict         Exit non-zero when anything is lost, short or clipped.',
    '',
    'Lists every block of the source that did not reach a page whole.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'

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
  const started = Date.now()
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const report = await page.evaluate(function () {
    var polyfill = window.PagedPolyfill
    var source = polyfill && polyfill.chunker && polyfill.chunker.source
    if (!source || !source.querySelectorAll) return { error: 'The source Paged.js worked from is not reachable (PagedPolyfill.chunker.source).' }

    var squash = function (s) { return (s || '').split('­').join('').replace(/\s+/g, '') }
    var show = function (s) { return (s || '').split('­').join('').replace(/\s+/g, ' ').trim().slice(0, 110) }
    var LEAF = 'p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, dt, dd, caption'

    // Every laid-out piece, by the number of the source element it came from.
    var pieces = {}
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    pages.forEach(function (pg, index) {
      var area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      var box = area.getBoundingClientRect()
      area.querySelectorAll('[data-ref]').forEach(function (el) {
        var ref = el.getAttribute('data-ref')
        ;(pieces[ref] = pieces[ref] || []).push({ el: el, sheet: index + 1, box: box })
      })
    })

    var out = { blocks: 0, lost: [], short: [], clipped: [], hidden: {}, pages: pages.length }
    var previousSheet = 0
    source.querySelectorAll(LEAF).forEach(function (el) {
      // A cell or item that only holds other blocks is checked through them.
      if (el.querySelector(LEAF)) return
      var want = squash(el.textContent)
      if (!want) return
      out.blocks += 1
      var ref = el.getAttribute('data-ref')
      var got = pieces[ref] || []
      var name = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(/\s+/).join('.') : '')
      if (!got.length) {
        out.lost.push({ what: name, after: previousSheet, text: show(el.textContent) })
        return
      }
      previousSheet = got[got.length - 1].sheet

      var have = got.map(function (g) { return squash(g.el.textContent) }).join('')
      if (have.length < want.length) {
        out.short.push({ what: name, sheet: got[0].sheet, missing: want.length - have.length, text: show(el.textContent) })
      }

      var shown = got.filter(function (g) { return window.getComputedStyle(g.el).display !== 'none' && g.el.getClientRects().length })
      if (!shown.length) {
        var key = name
        out.hidden[key] = (out.hidden[key] || 0) + 1
        return
      }
      // Inside the text area: any line of it, by a line's own middle.
      var inside = shown.some(function (g) {
        var range = document.createRange()
        range.selectNodeContents(g.el)
        return Array.prototype.some.call(range.getClientRects(), function (r) {
          if (r.width < 1 || r.height < 1) return false
          var x = r.left + Math.min(r.width, 8) / 2
          var y = r.top + r.height / 2
          return x >= g.box.left - 2 && x <= g.box.right + 2 && y >= g.box.top - 2 && y <= g.box.bottom + 2
        })
      })
      if (!inside) out.clipped.push({ what: name, sheet: shown[0].sheet, text: show(el.textContent) })
    })
    return out
  })

  await browser.close()
  await server.close()

  if (report.error) { console.error(report.error); process.exit(2) }

  const seconds = Math.round((Date.now() - started) / 1000)
  console.log('')
  console.log(report.pages + ' pages, ' + report.blocks + ' blocks of text in the source (' + seconds + ' s)')
  const section = function (title, list, line) {
    console.log('')
    console.log(title + ': ' + list.length)
    list.forEach(function (item) { console.log('  ' + line(item)) })
  }
  section('Lost (in the source, on no page)', report.lost, function (i) {
    return 'after sheet ' + i.after + '  ' + i.what + '  “' + i.text + '”'
  })
  section('Short (laid out with text missing)', report.short, function (i) {
    return 'sheet ' + i.sheet + '  ' + i.what + '  ' + i.missing + ' characters short  “' + i.text + '”'
  })
  section('Clipped (laid out outside the text area)', report.clipped, function (i) {
    return 'sheet ' + i.sheet + '  ' + i.what + '  “' + i.text + '”'
  })
  const hidden = Object.keys(report.hidden)
  console.log('')
  console.log('Hidden by the stylesheet: ' + hidden.reduce(function (n, k) { return n + report.hidden[k] }, 0))
  hidden.forEach(function (k) { console.log('  ' + report.hidden[k] + ' × ' + k) })

  if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2))
  const faults = report.lost.length + report.short.length + report.clipped.length
  process.exit(args.strict && faults ? 1 : 0)
})().catch(function (error) {
  console.error(error)
  process.exit(2)
})
