#!/usr/bin/env node
'use strict'
//
// Count how paragraphs break across columns and pages.
//
// For every paragraph that is split, this counts the lines left behind at the
// foot of a column and the lines carried to the top of the next, and tallies
// the short ones. It is the measure behind the question "what happens if the
// minimum goes from two lines to three": run it on the book and on a copy
// with the rule changed, and compare.
//
// It changes nothing.
//
// Usage: node report-paragraph-breaks.js --content <dir> [--theme <name>] [--out <file>]

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)
if (args.help || !args.content) {
  console.log([
    'Usage: node report-paragraph-breaks.js --content <dir> [--theme <name>] [--out <file>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --out <file>     Write the tallies and the page of every block as JSON.',
    '',
    'Tallies the lines left at the foot and carried to the top where a paragraph breaks.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const contentDir = path.resolve(args.content)

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  await watchForPagedJs(page)
  await blockRemoteResources(page, server.url)
  const url = server.url + '/' + path.relative(root, contentDir).split(path.sep).join('/') + '/index.html?theme=' + theme
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const report = await page.evaluate(function () {
    const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    const foot = {}, top = {}, where = {}
    let splits = 0
    const bump = function (tally, n) { const k = n >= 5 ? '5+' : String(n); tally[k] = (tally[k] || 0) + 1 }
    pages.forEach(function (pg, index) {
      const area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      const mid = area.getBoundingClientRect().left + area.getBoundingClientRect().width / 2
      area.querySelectorAll('p').forEach(function (el) {
        if (el.closest('table, .figure, .part-opener')) return
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
        if (text.length < 8) return
        const key = text.slice(0, 60)
        if (where[key] === undefined) where[key] = index + 1
        const range = document.createRange()
        range.selectNodeContents(el)
        // Lines per column. A raised reference mark has a box of its own,
        // smaller and higher than the words beside it, and would be counted
        // as a line; only boxes the height of running text are read, and two
        // boxes are the same line unless one sits most of a line below.
        const cols = [[], []]
        Array.prototype.forEach.call(range.getClientRects(), function (r) {
          if (r.width < 2 || r.height < 15) return
          cols[r.left + r.width / 2 < mid ? 0 : 1].push(r.bottom)
        })
        const count = function (bottoms) {
          bottoms.sort(function (a, b) { return a - b })
          let n = 0, last = -1e9
          bottoms.forEach(function (b) { if (b - last > 9) { n += 1; last = b } })
          return n
        }
        const wide = el.getBoundingClientRect().width > area.getBoundingClientRect().width * 0.7
        const pieces = wide ? [count(cols[0].concat(cols[1]))]
          : cols.map(count).filter(Boolean)
        if (!pieces.length) return
        const from = el.hasAttribute('data-split-from'), to = el.hasAttribute('data-split-to')
        if (pieces.length > 1) splits += 1
        if (to) splits += 1
        // A piece with more of the paragraph after it leaves lines at a foot;
        // a piece with more before it carries lines to a top.
        pieces.forEach(function (n, i) {
          if (i < pieces.length - 1 || to) bump(foot, n)
          if (i > 0 || from) bump(top, n)
        })
      })
    })
    return { sheets: pages.length, splits: splits, foot: foot, top: top, where: where }
  })
  await browser.close()
  await server.close()

  const row = function (t) { return ['1', '2', '3', '4', '5+'].map(function (k) { return k + ' line' + (k === '1' ? '' : 's') + ': ' + (t[k] || 0) }).join('   ') }
  console.log(report.sheets + ' sheets; ' + report.splits + ' paragraph breaks')
  console.log('left at the foot of a column   ' + row(report.foot))
  console.log('carried to the top of the next ' + row(report.top))
  if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(report))
})().catch(function (e) { console.error(e); process.exit(1) })
