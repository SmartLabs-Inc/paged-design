#!/usr/bin/env node
//
// Record which book page every block lands on.
//
// A slice or an editor pane starts at its own page one, which is no use to
// someone working from "page 23". Paginating the whole book once and writing
// down where each block fell lets any later view say which book page it is
// looking at, without paginating 700 pages again.
//
// The key is the block's own text. Page numbers move; the words do not.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node make-page-map.js --content <dir> [--theme <name>] [--out <file>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --out <file>     Default: <content>/page-map.json',
    '',
    'Writes the book page number of every block, keyed by its opening text.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const contentDir = path.resolve(args.content)
const outFile = path.resolve(args.out || path.join(contentDir, 'page-map.json'))

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  await watchForPagedJs(page)
  await blockRemoteResources(page, server.url)
  const url = server.url + '/' +
    path.relative(root, contentDir).split(path.sep).join('/') +
    '/index.html?theme=' + theme
  console.log('Paginating ' + url + ' …')
  const started = Date.now()
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const map = await page.evaluate(function () {
    const out = { total: 0, blocks: {} }
    const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    out.total = pages.length
    pages.forEach(function (pg, index) {
      const area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      area.querySelectorAll('p,li,h1,h2,h3,h4,h5,table,img').forEach(function (el) {
        const r = el.getBoundingClientRect()
        if (r.height < 2) return
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
        if (text.length < 8) return
        const key = text.slice(0, 60)
        // First page a block appears on; a split block belongs to where it starts.
        if (out.blocks[key] === undefined) out.blocks[key] = index + 1
      })
    })
    return out
  })

  await browser.close()
  server.close()
  fs.writeFileSync(outFile, JSON.stringify(map))
  console.log('Mapped ' + Object.keys(map.blocks).length + ' blocks across ' +
    map.total + ' pages in ' + Math.round((Date.now() - started) / 1000) + 's')
  console.log('Wrote ' + outFile + ' (' + Math.round(fs.statSync(outFile).size / 1024) + ' KB)')
})()
