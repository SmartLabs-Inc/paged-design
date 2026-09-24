#!/usr/bin/env node
//
// Photograph pages of the paginated book.
//
// Every layout fault found in this project was found by looking at a page, and
// nothing in a build log shows a column set at the wrong size or a heading
// stranded at a foot. A PDF in a container cannot be opened, so the page is
// photographed where it is made: in the browser, after Paged.js has run,
// straight off the `.pagedjs_page` element.
//
//   node page-shots.js --content content/my-book --theme my-theme \
//        --pages 1,2,40,41 --out /tmp/shots
//
// Reports the page count and what it measured on each page it took, because
// the two questions a shot raises — how big is this type, how many columns —
// are quicker answered in numbers than in pixels.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, requirePlaywright, launchChromium, serveDirectory, waitForPagedJs, parseArgs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node page-shots.js --content <dir> [options]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --theme <name>   Theme. Default: aalai-textbook.',
    '  --pages <list>   1-based page numbers, comma separated. Default: 1,2,3.',
    '  --out <dir>      Where the .png files go. Default: the scratchpad.',
    '  --sample <sel>   Extra selector to measure on each page.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const outDir = path.resolve(args.out || '.')
const wanted = String(args.pages || '1,2,3').split(',').map(function (n) { return parseInt(n, 10) })

fs.mkdirSync(outDir, { recursive: true })

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } })
  page.on('pageerror', function (e) { console.log('[pageerror]', e.message.slice(0, 300)) })

  const url = server.url + '/' + args.content.replace(/^\.\//, '') + '/index.html?theme=' + theme
  console.log('Paginating ' + url + ' …')
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, 3600000)

  const total = await page.evaluate(function () {
    return document.querySelectorAll('.pagedjs_page').length
  })
  console.log('  ' + total + ' pages')

  for (const number of wanted) {
    if (!(number >= 1 && number <= total)) { console.log('  page ' + number + ' — out of range'); continue }
    const handle = await page.evaluateHandle(function (n) {
      return document.querySelectorAll('.pagedjs_page')[n - 1]
    }, number)
    const element = handle.asElement()
    const file = path.join(outDir, 'page-' + String(number).padStart(4, '0') + '.png')
    await element.scrollIntoViewIfNeeded()
    await element.screenshot({ path: file })

    const measured = await element.evaluate(function (box, sel) {
      const area = box.querySelector('.pagedjs_page_content')
      const first = area && area.firstElementChild
      const style = first ? getComputedStyle(first) : null
      const body = area ? area.querySelector('p') : null
      const extra = sel ? area && area.querySelector(sel) : null
      function size (el) { return el ? getComputedStyle(el).fontSize + '/' + getComputedStyle(el).lineHeight : '—' }
      return {
        columns: style ? style.columnCount : '—',
        firstParagraph: size(body),
        sample: size(extra),
        width: area ? Math.round(area.getBoundingClientRect().width) : 0,
        height: area ? Math.round(area.getBoundingClientRect().height) : 0
      }
    }, args.sample || null)

    console.log('  page ' + number + ' → ' + path.relative(process.cwd(), file) +
      '  columns ' + measured.columns +
      ', first p ' + measured.firstParagraph +
      (args.sample ? ', ' + args.sample + ' ' + measured.sample : '') +
      ', area ' + measured.width + '×' + measured.height)
  }

  await browser.close()
  server.close()
})().catch(function (error) { console.error(error); process.exit(1) })
