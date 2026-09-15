#!/usr/bin/env node
//
// Everything worth knowing about a paginated book, from one pagination.
//
// A book this size takes twenty minutes to paginate, so asking it three
// separate questions costs an hour. This asks them together:
//
//   * how long the book is, and where the pages went — extent by region, which
//     is the number a printer quotes from and the one an estimate is wrong
//     about;
//   * how full the pages are, which is where a bad break or a mis-set column
//     shows up as a number before anyone notices it as a look;
//   * photographs of whichever pages you name, because the numbers never
//     settle an argument about how a page looks.
//
//   node book-report.js --content content/my-book --theme my-theme \
//        --pages 1,2,45,600 --out /tmp/shots
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, requirePlaywright, launchChromium, serveDirectory, waitForPagedJs, parseArgs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node book-report.js --content <dir> [options]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --theme <name>   Theme. Default: aalai-textbook.',
    '  --pages <list>   1-based page numbers to photograph, comma separated.',
    '  --out <dir>      Where the .png files go. Default: the working directory.',
    '  --json <file>    Also write the whole report as JSON.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const outDir = path.resolve(args.out || '.')
const wanted = args.pages
  ? String(args.pages).split(',').map(function (n) { return parseInt(n, 10) })
  : []

if (wanted.length) fs.mkdirSync(outDir, { recursive: true })

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } })
  page.on('pageerror', function (e) { console.log('[pageerror]', e.message.slice(0, 300)) })

  const url = server.url + '/' + args.content.replace(/^\.\//, '') + '/index.html?theme=' + theme
  console.log('Paginating ' + url + ' …')
  const started = Date.now()
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, 3600000)
  console.log('  paginated in ' + Math.round((Date.now() - started) / 1000) + 's')

  const report = await page.evaluate(function () {
    const pages = Array.from(document.querySelectorAll('.pagedjs_page'))

    // Where each component starts. A component is spread over many page
    // boxes, and each box keeps the component's own classes, so the first box
    // carrying a new data-header opens a new region.
    const regions = []
    const fills = []
    const short = []

    pages.forEach(function (box, index) {
      const area = box.querySelector('.pagedjs_page_content')
      if (!area) return
      const component = area.querySelector('[data-header]')
      const header = component ? component.getAttribute('data-header') : null
      if (header && (!regions.length || regions[regions.length - 1].title !== header)) {
        regions.push({ title: header, from: index + 1, to: index + 1 })
      } else if (regions.length) {
        regions[regions.length - 1].to = index + 1
      }

      const height = area.getBoundingClientRect().height
      const top = area.getBoundingClientRect().top
      let bottom = 0
      area.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, figure, dd, dt, img').forEach(function (el) {
        const rect = el.getBoundingClientRect()
        if (rect.height && rect.bottom - top > bottom) bottom = rect.bottom - top
      })
      const ratio = height ? Math.min(1, bottom / height) : 0
      fills.push(ratio)
      if (ratio < 0.7) {
        short.push({ page: index + 1, fill: Math.round(ratio * 100), header: header })
      }
    })

    const blank = pages.filter(function (p) { return p.classList.contains('pagedjs_blank_page') }).length
    const mean = fills.reduce(function (a, b) { return a + b }, 0) / (fills.length || 1)

    return {
      pages: pages.length,
      blank: blank,
      meanFill: Math.round(mean * 100),
      regions: regions,
      short: short,
      lastPageText: (function () {
        const area = pages[pages.length - 1].querySelector('.pagedjs_page_content')
        return area ? area.textContent.replace(/\s+/g, ' ').trim().slice(-160) : ''
      })()
    }
  })

  console.log('')
  console.log('  ' + report.pages + ' pages, ' + report.blank + ' of them blank, mean fill ' +
    report.meanFill + '%')
  console.log('')
  console.log('  Region                                                 pages    extent')
  report.regions.forEach(function (region) {
    const extent = region.to - region.from + 1
    console.log('  ' + region.title.slice(0, 48).padEnd(50) +
      String(region.from).padStart(5) + '–' + String(region.to).padEnd(5) +
      String(extent).padStart(6))
  })
  console.log('')
  console.log('  Pages under 70% full: ' + report.short.length)
  report.short.slice(0, 30).forEach(function (s) {
    console.log('    p' + s.page + ' ' + s.fill + '%  ' + (s.header || ''))
  })
  if (report.short.length > 30) console.log('    … and ' + (report.short.length - 30) + ' more')
  console.log('')
  // The one check worth making on every build: that the book got to the end.
  console.log('  Last page ends: …' + report.lastPageText)

  for (const number of wanted) {
    if (!(number >= 1 && number <= report.pages)) { console.log('  page ' + number + ' — out of range'); continue }
    const handle = await page.evaluateHandle(function (n) {
      return document.querySelectorAll('.pagedjs_page')[n - 1]
    }, number)
    const element = handle.asElement()
    const file = path.join(outDir, 'page-' + String(number).padStart(4, '0') + '.png')
    await element.scrollIntoViewIfNeeded()
    await element.screenshot({ path: file })
    console.log('  photographed page ' + number + ' → ' + path.relative(process.cwd(), file))
  }

  if (args.json) {
    fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2))
    console.log('  report written to ' + args.json)
  }

  await browser.close()
  server.close()
})().catch(function (error) { console.error(error); process.exit(1) })
