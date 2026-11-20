#!/usr/bin/env node
//
// Find the short, lopsided runs of text that sit above a heading.
//
// This REPORTS. It changes nothing.
//
// A two-column page is cut into rows by whatever spans the columns: a section
// title, a shaded box, a figure, a table. The text between two of those is
// set in two columns and is meant to come out level. Two things go wrong, and
// the three-line rule made the second one common:
//
//   a stub     A paragraph ends overleaf, and its last few lines open the
//              next page above a heading. Four lines carried over is within
//              the rule and still reads as a scrap.
//
//   lopsided   Those lines cannot be shared out. A paragraph may not leave
//              fewer than three lines on either side of a break, so four
//              lines go 3 and 1, five go 3 and 2, and only six can go 3 and 3.
//
// Every row that ends at something spanning the columns, or at the end of a
// chapter, is measured: lines in the left column, lines in the right. A row
// that runs to the foot of the page is not measured — it is not balanced, it
// is full.
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
    'Usage: node report-column-rows.js --content <dir> [--theme <name>] [--out <file>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --out <file>     Write every measured row as JSON.',
    '',
    'Lists the rows of text above a heading that are short or uneven.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'

function measure () {
  const out = []
  const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
  // One line of body text, taken from the book rather than assumed.
  const sample = document.querySelector('.pagedjs_page_content .lead-rest, .pagedjs_page_content .entry p')
  const LINE = sample ? parseFloat(window.getComputedStyle(sample).lineHeight) || 14 : 14
  const bodyStart = pages.findIndex(function (pg) { return /pagedjs_part\d+_page/.test(pg.className) })

  // The lines of text in a set of nodes, as the reader counts them: one per
  // baseline in each column. Superscripts and the like ride on a line and do
  // not make one.
  function linesOf (nodes, mid) {
    const left = []; const right = []
    nodes.forEach(function (node) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let text
      while ((text = walker.nextNode())) {
        if (!text.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(text)
        Array.prototype.forEach.call(range.getClientRects(), function (r) {
          if (r.height < 9 || r.width < 1) return
          ;(r.left < mid ? left : right).push(r.bottom)
        })
      }
    })
    function count (bottoms) {
      bottoms.sort(function (a, b) { return a - b })
      let n = 0; let last = -1e9
      bottoms.forEach(function (b) { if (b - last > 7) { n += 1; last = b } })
      return n
    }
    const top = Math.min.apply(null, left.concat(right))
    return {
      left: count(left),
      right: count(right),
      top: top,
      bottom: Math.max.apply(null, left.concat(right)),
      // Where each column stops. An empty column stops where the row starts.
      leftFoot: left.length ? Math.max.apply(null, left) : top,
      rightFoot: right.length ? Math.max.apply(null, right) : top
    }
  }

  pages.forEach(function (pg, index) {
    const area = pg.querySelector('.pagedjs_page_content')
    if (!area) return
    const box = area.getBoundingClientRect()
    // The two-column block on this page: the nearest thing that sets columns.
    const holders = Array.prototype.filter.call(area.querySelectorAll('div'), function (d) {
      return window.getComputedStyle(d).columnCount === '2'
    })
    holders.forEach(function (holder) {
      // Flatten wrappers that do not span: an entry is a wrapper, its figure spans.
      const flat = []
      ;(function walk (parent) {
        Array.prototype.forEach.call(parent.children, function (el) {
          const span = window.getComputedStyle(el).columnSpan === 'all'
          if (span) { flat.push({ el: el, span: true }); return }
          if (el.querySelector && Array.prototype.some.call(el.querySelectorAll('*'), function (k) {
            return window.getComputedStyle(k).columnSpan === 'all'
          })) { walk(el); return }
          flat.push({ el: el, span: false })
        })
      })(holder)

      let run = []
      let rowIndex = 0
      function close (endsAt) {
        const nodes = run.filter(function (el) { return el.getBoundingClientRect().height > 0 })
        run = []
        if (!nodes.length) return
        const m = linesOf(nodes, box.left + box.width / 2)
        if (!m.left && !m.right) return
        rowIndex += 1
        // A row that reaches the foot of the page is full, not balanced. So
        // is one that stops a few lines short of it: that is a block that
        // would not divide, and the white under it is the rule working.
        const white = box.bottom - m.bottom
        if (endsAt === 'foot' && white < 110) return
        out.push({
          sheet: index + 1,
          page: bodyStart >= 0 && index >= bodyStart ? String(index - bodyStart + 1) : 'front',
          left: m.left,
          right: m.right,
          // How far apart the two columns stop, in lines of text.
          apart: Math.round(Math.abs(m.leftFoot - m.rightFoot) / LINE * 10) / 10,
          atTop: m.top - box.top < 30,
          endsAt: endsAt,
          text: nodes[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 46)
        })
      }
      flat.forEach(function (item) {
        if (item.span) {
          close(item.el.matches('.keep-lead') ? 'heading' : 'artwork')
        } else {
          run.push(item.el)
        }
      })
      close('foot')
    })
  })
  return { sheets: pages.length, rows: out }
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
  const found = await page.evaluate(measure)
  await browser.close()
  server.close()

  const rows = found.rows.filter(function (r) { return r.page !== 'front' })
  const stub = rows.filter(function (r) { return r.atTop && r.left + r.right <= 5 })
  const lopsided = rows.filter(function (r) { return r.apart >= 1.6 })
  const short = rows.filter(function (r) { return Math.min(r.left, r.right) < 3 })

  console.log(found.sheets + ' sheets; ' + rows.length + ' rows of text that end above a heading, a figure, a table or white\n')
  console.log('  stubs      — five lines or fewer opening a page:        ' + stub.length)
  console.log('  lopsided   — columns stop more than a line and a half apart: ' + lopsided.length)
  console.log('  thin       — a column of one or two lines (or none):   ' + short.length + '\n')

  const listed = rows.filter(function (r) {
    return (r.atTop && r.left + r.right <= 5) || r.apart >= 1.6 || Math.min(r.left, r.right) < 3
  })
  listed.forEach(function (r) {
    console.log('  page ' + String(r.page).padStart(4) + '  ' + String(r.left).padStart(2) + ' | ' + String(r.right).padEnd(2) +
      '  ' + String(r.apart).padStart(4) + ' lines apart' +
      (r.atTop ? '  top of page ' : '  mid-page    ') + ('above ' + (r.endsAt === 'foot' ? 'white' : r.endsAt)).padEnd(14) + '  ' + r.text)
  })
  if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(found, null, 1))
})()
