#!/usr/bin/env node
//
// Look at one page in seconds instead of four minutes.
//
// Rendering 700 pages to check one correction costs about four minutes, and
// nearly all of it paginates pages that are not the one in question. That
// cost is why faults were being fixed in bulk and checked in bulk, which is
// how a pass came to report zero faults while creating them.
//
// A region cut out of the book and paginated alone reproduces its layout
// faults exactly. That is how the real cause of the "breaks for no reason"
// pages was finally found, after two synthetic reproductions failed to show
// it. This makes the move a tool rather than something done by hand.
//
// The unit is the entry or the section, not the page component: a component
// here is a whole Part, three hundred pages, two minutes — no better than
// rendering the book. Cutting at entry boundaries gives ten to thirty pages
// and a few seconds.
//
// What it gives up is page NUMBERS. A slice starts at its own page one, so it
// answers "does the shaded panel sit under the title" and never "is it on
// page 23". Numbers come from the full render, once, at the end.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content || !args.find) {
  console.log([
    'Usage: node preview-page.js --content <dir> --find "<text>" [options]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --find "<text>"  Any text on the page you want to look at.',
    '  --back <n>       Blocks to keep before the match. Default 2.',
    '  --fwd <n>        Blocks to keep after it. Default 6.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --out <dir>      Where the PNGs go. Default: the slice directory.',
    '',
    'Cuts the region around that text out of the book, paginates it alone,',
    'and writes a PNG of every page in the slice.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const back = Number(args.back === undefined ? 2 : args.back)
const fwd = Number(args.fwd === undefined ? 6 : args.fwd)
const contentDir = path.resolve(args.content)
const indexFile = path.join(contentDir, 'index.html')
const sliceDir = path.join(root, 'content/scratch-preview')
const outDir = path.resolve(args.out || sliceDir)

const html = fs.readFileSync(indexFile, 'utf8')
const head = html.slice(0, html.indexOf('<body') >= 0 ? html.indexOf('<body') : 0)
const bodyOpen = (/<body[^>]*>/.exec(html) || ['<body>'])[0]

const at = html.indexOf(args.find)
if (at < 0) {
  console.error('Not found in the book: ' + args.find)
  process.exit(1)
}

// A part opener is a boundary too, or a fault that involves the part title
// cannot be sliced to — the title block is not an entry and not a panel.
const BOUNDARY = /<div class="entry">|<div class="keep-lead\b|<div class="[^"]*\bchapter\b/g
const bounds = []
let b
while ((b = BOUNDARY.exec(html)) !== null) bounds.push(b.index)
let here = 0
while (here < bounds.length && bounds[here] <= at) here += 1
here -= 1

const start = here - back >= 0 ? bounds[here - back] : bounds[0]
const afterIdx = here + fwd + 1
const end = afterIdx < bounds.length ? bounds[afterIdx] : html.length

let slice = html.slice(start, end)

// Cutting mid-document leaves the div count unbalanced, and an unbalanced
// slice paginates to something the book never does. Close what is open and
// open what is closed before anything is measured.

// Only wrap when the cut starts inside a component. When it starts AT one,
// wrapping nests the real component inside a second column set — the
// component then sits in column one of the outer set, nothing inside it can
// span, and every width measured off that slice is wrong. The shaded panels
// came out as narrow in-column boxes and the part title at 242px, which is
// nothing the book does.
if (!/^<div class="[^"]*\bchapter\b/.test(slice.trim())) {
  slice = '<div class="scratch-preview chapter" data-header="Preview"><div><div>\n' +
    slice + '\n</div></div></div>'
}

const opened = (slice.match(/<div\b/g) || []).length
const closed = (slice.match(/<\/div>/g) || []).length
if (opened > closed) slice += '</div>'.repeat(opened - closed)
else if (closed > opened) slice = slice.replace(/<\/div>\s*$/, '').trim()


fs.mkdirSync(sliceDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(sliceDir, 'index.html'),
  head + bodyOpen + '\n' + slice + '\n</body></html>')

// The artwork lives beside the book, so the slice needs it beside the slice
// too: a missing figure is a different height and every page after it moves.
for (const file of fs.readdirSync(contentDir)) {
  if (!/\.(png|jpe?g|svg|gif|webp)$/i.test(file)) continue
  fs.copyFileSync(path.join(contentDir, file), path.join(sliceDir, file))
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

  // Measured on leaves, never on the wrapper divs — those are as tall as the
  // page whatever is in them, so including them reports every page 100% full.
  const pages = await page.evaluate(function () {
    return Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
      .map(function (pg, i) {
        const area = pg.querySelector('.pagedjs_page_content')
        const box = area ? area.getBoundingClientRect() : null
        let lowest = 0
        if (area) {
          area.querySelectorAll('p,td,th,h1,h2,h3,h4,h5,li,img').forEach(function (el) {
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
      path: path.join(outDir, 'slice-p' + String(i + 1).padStart(2, '0') + '.png')
    })
  }

  await browser.close()
  server.close()

  console.log('Slice around "' + args.find.slice(0, 40) + '" — ' + pages.length +
    ' pages in ' + Math.round((Date.now() - started) / 1000) + 's')
  pages.forEach(function (p) {
    console.log('  p' + String(p.page).padStart(2) + '  ' +
      String(p.fill).padStart(3) + '% full  ' + String(p.chars).padStart(5) + ' chars')
  })
  console.log('PNGs in ' + outDir)
})()
