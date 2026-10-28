#!/usr/bin/env node
//
// Look at one page in seconds instead of four minutes.
//
// Rendering the whole book to PDF to check one correction costs about four
// minutes, and most of it is paginating 700 pages that are not the page in
// question. That cost is why faults were being fixed in bulk and checked in
// bulk, which is how a pass came to report zero faults while creating them.
//
// A page component cut out of the book and paginated alone reproduces its
// layout faults exactly — that is how the real cause of the "breaks for no
// reason" pages was finally found, after two synthetic reproductions failed
// to show it. This makes that a first-class move rather than something done
// by hand under pressure.
//
// What it gives up: page NUMBERS. A slice starts at its own page one, so this
// answers "does the shaded panel sit under the title" and never "is it on
// page 23". Numbers come from the full render, at the end, once.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content || !(args.find || args.component)) {
  console.log([
    'Usage: node preview-page.js --content <dir> --find "<text>" [options]',
    '',
    '  --content <dir>    Book directory holding index.html. Never modified.',
    '  --find "<text>"    Any text on the page you want to look at.',
    '  --component <n>    Slice component n instead of searching.',
    '  --around <n>       Also include n components either side. Default 0.',
    '  --theme <name>     Default: aalai-textbook.',
    '  --out <dir>        Where the PNGs and the HTML go.',
    '  --scale <n>        PNG scale. Default 1.6.',
    '',
    'Cuts the page component holding that text out of the book, paginates it',
    'on its own, and writes a PNG of every page plus the sliced HTML.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const scale = Number(args.scale || 1.6)
const around = Number(args.around || 0)
const indexFile = path.join(path.resolve(args.content), 'index.html')
const outDir = path.resolve(args.out || path.join(root, 'content/scratch-preview'))
const sliceDir = path.join(root, 'content/scratch-preview')

const html = fs.readFileSync(indexFile, 'utf8')

// Top-level page components are the unit. Splitting anywhere else leaves
// unbalanced markup, and an unbalanced slice paginates to something that is
// not what the book does.
const head = html.slice(0, html.indexOf('<body') >= 0 ? html.indexOf('<body') : 0)
const bodyOpen = (/<body[^>]*>/.exec(html) || ['<body>'])[0]
const starts = []
const COMPONENT = /<div class="[^"]*\bchapter\b[^"]*"[^>]*>/g
let m
while ((m = COMPONENT.exec(html)) !== null) starts.push(m.index)
if (!starts.length) {
  console.error('No page components found in ' + indexFile)
  process.exit(1)
}
starts.push(html.lastIndexOf('</body>') >= 0 ? html.lastIndexOf('</body>') : html.length)

let pick = args.component !== undefined ? Number(args.component) : -1
if (pick < 0) {
  const at = html.indexOf(args.find)
  if (at < 0) {
    console.error('Not found in the book: ' + args.find)
    process.exit(1)
  }
  for (let i = 0; i < starts.length - 1; i += 1) {
    if (at >= starts[i] && at < starts[i + 1]) { pick = i; break }
  }
}
const from = Math.max(0, pick - around)
const to = Math.min(starts.length - 2, pick + around)
const slice = html.slice(starts[from], starts[to + 1])

fs.mkdirSync(sliceDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(sliceDir, 'index.html'),
  head + bodyOpen + '\n' + slice + '\n</body></html>')

// Images live beside the book, so the slice needs them beside it too, or
// every figure renders as a broken box and the page heights are wrong.
for (const file of fs.readdirSync(path.resolve(args.content))) {
  if (!/\.(png|jpe?g|svg|gif|webp)$/i.test(file)) continue
  fs.copyFileSync(path.join(path.resolve(args.content), file), path.join(sliceDir, file))
}

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  await watchForPagedJs(page)
  await blockRemoteResources(page, server.url)
  const started = Date.now()
  await page.goto(server.url + '/content/scratch-preview/index.html?theme=' + theme,
    { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 300000))

  const pages = await page.evaluate(function () {
    return Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
      .map(function (pg, i) {
        const area = pg.querySelector('.pagedjs_page_content')
        const box = area ? area.getBoundingClientRect() : null
        let lowest = 0
        if (area) {
          area.querySelectorAll('p,div,table,h1,h2,h3,h4,h5,li,img').forEach(function (el) {
            const r = el.getBoundingClientRect()
            if (r.height > 1) lowest = Math.max(lowest, r.bottom)
          })
        }
        return {
          page: i + 1,
          chars: (area ? area.textContent : '').replace(/\s+/g, ' ').trim().length,
          fill: box && lowest ? Math.round(100 * (lowest - box.top) / box.height) : 0
        }
      })
  })

  const handles = await page.$$('.pagedjs_page')
  for (let i = 0; i < handles.length; i += 1) {
    await handles[i].screenshot({
      path: path.join(outDir, 'slice-p' + String(i + 1).padStart(2, '0') + '.png'),
      scale: 'css'
    })
  }
  fs.writeFileSync(path.join(outDir, 'slice.html'), await page.content())

  await browser.close()
  server.close()

  console.log('Component ' + pick + (around ? ' (±' + around + ')' : '') +
    ' — ' + pages.length + ' pages in ' + Math.round((Date.now() - started) / 1000) + 's')
  pages.forEach(function (p) {
    console.log('  slice p' + String(p.page).padStart(2) + '  ' +
      String(p.fill).padStart(3) + '% full  ' + String(p.chars).padStart(5) + ' chars')
  })
  console.log('PNGs and slice.html in ' + outDir)
})()
