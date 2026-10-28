#!/usr/bin/env node
//
// Capture what a proofing console needs: for each page of interest, a picture
// of the page as it prints, and the list of blocks on it keyed to text that
// identifies them in the source.
//
// The key is text, never a page number. A correction anchored to page 23 is
// wrong the moment anything before page 23 changes, and something before it
// always changes. A correction anchored to "Peptide Identity and Evidence
// Transfer" survives every reflow.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content || !args.pages) {
  console.log([
    'Usage: node make-proof-pack.js --content <dir> --pages 23,156,295 [options]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --pages <list>   Page numbers to capture, comma separated.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --out <dir>      Where pack.json and the PNGs go.',
    '',
    'Writes one PNG per page and a pack.json listing each page\'s blocks with',
    'the text that anchors them.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const want = String(args.pages).split(',').map(function (n) { return Number(n.trim()) })
  .filter(function (n) { return n > 0 })
const outDir = path.resolve(args.out || path.join(root, 'content/scratch-pack'))
fs.mkdirSync(outDir, { recursive: true })

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
  console.log('  paginated in ' + Math.round((Date.now() - started) / 1000) + 's')

  const pack = await page.evaluate(function (want) {
    const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    const out = { total: pages.length, pages: [] }
    want.forEach(function (n) {
      const pg = pages[n - 1]
      if (!pg) return
      const area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      const box = area.getBoundingClientRect()
      const blocks = []
      area.querySelectorAll('p,li,h1,h2,h3,h4,h5,table,img,div.keep-lead,div.entry-lead')
        .forEach(function (el) {
          if (el.parentElement.closest('div.keep-lead, div.entry-lead')) return
          const r = el.getBoundingClientRect()
          if (r.height < 2 || r.width < 1) return
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
          if (!text && el.tagName !== 'IMG') return
          blocks.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').replace(/\s+/g, ' ').trim(),
            // Enough text to be unique in a 300,000-word book, and short
            // enough to read in a list.
            anchor: text.slice(0, 70),
            text: text.slice(0, 160),
            top: Math.round(r.top - box.top),
            height: Math.round(r.height),
            spans: window.getComputedStyle(el).columnSpan === 'all',
            split: el.hasAttribute('data-split-from') || el.hasAttribute('data-split-to')
          })
        })
      let lowest = 0
      blocks.forEach(function (b) { lowest = Math.max(lowest, b.top + b.height) })
      out.pages.push({
        page: n,
        areaHeight: Math.round(box.height),
        white: Math.round(box.height) - lowest,
        head: (pg.querySelector('.pagedjs_margin-top-left, .pagedjs_margin-top-right') || {}).textContent || '',
        blocks: blocks
      })
    })
    return out
  }, want)

  for (const entry of pack.pages) {
    const handle = (await page.$$('.pagedjs_page'))[entry.page - 1]
    if (!handle) continue
    const file = 'page-' + String(entry.page).padStart(4, '0') + '.png'
    await handle.screenshot({ path: path.join(outDir, file) })
    entry.image = file
  }

  fs.writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify(pack, null, 1))
  await browser.close()
  server.close()

  console.log('Captured ' + pack.pages.length + ' of ' + pack.total + ' pages')
  pack.pages.forEach(function (p) {
    console.log('  p' + String(p.page).padStart(4) + '  ' + p.blocks.length +
      ' blocks, ' + p.white + 'px white')
  })
  console.log('pack.json and PNGs in ' + outDir)
})()
