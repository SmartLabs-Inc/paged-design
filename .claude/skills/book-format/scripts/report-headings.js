#!/usr/bin/env node
//
// Find every heading that has been separated from the content it introduces.
//
// This REPORTS. It changes nothing. That separation is deliberate: the passes
// that found a fault and fixed it in the same breath are the ones that took
// the book from 8 nearly-empty pages to 24 while announcing zero faults. A
// list a person reads and decides on is slower and does not do that.
//
// A heading is separated when it is the last thing of substance on its page:
// the section title, or the shaded panel, sits at the foot and the text it
// introduces is overleaf. The measure is the white left under it — a heading
// with two lines beneath it has not been separated, it has just landed low.
'use strict'

const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node report-headings.js --content <dir> [--theme <name>] [--white <px>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --white <px>     White under the heading that counts as separated.',
    '                   Default 120, about three lines.',
    '',
    'Lists every heading left at the foot of a page without its content.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const minWhite = Number(args.white || 120)

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

  const found = await page.evaluate(function (minWhite) {
    const out = []
    const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    pages.forEach(function (pg, index) {
      const area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      const box = area.getBoundingClientRect()
      // Every drawn leaf on the page, in visual order down the page.
      const leaves = []
      area.querySelectorAll('p,li,td,th,h1,h2,h3,h4,h5,img,table').forEach(function (el) {
        const r = el.getBoundingClientRect()
        if (r.height > 1 && r.width > 1) leaves.push({ el: el, bottom: r.bottom, top: r.top })
      })
      if (!leaves.length) return
      let lowest = leaves[0]
      leaves.forEach(function (l) { if (l.bottom > lowest.bottom) lowest = l })

      const white = box.bottom - lowest.bottom
      if (white < minWhite) return

      // Is the last thing on the page a heading, or inside one of the boxes
      // whose whole job is to introduce what follows?
      const el = lowest.el
      const heading = el.closest('.keep-lead, .entry-lead') ||
        (/^H[1-5]$/.test(el.tagName) ? el : null)
      if (!heading) return
      // A heading that was split across the break is a different fault.
      if (heading.hasAttribute('data-split-from') ||
          heading.hasAttribute('data-split-to')) return

      out.push({
        page: index + 1,
        white: Math.round(white),
        kind: heading.className
          ? String(heading.className).replace(/\s+/g, ' ').trim()
          : heading.tagName.toLowerCase(),
        text: (heading.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 58)
      })
    })
    return out
  }, minWhite)

  const total = await page.evaluate(function () {
    return document.querySelectorAll('.pagedjs_page').length
  })
  await browser.close()
  server.close()

  console.log('Paginated ' + total + ' pages in ' +
    Math.round((Date.now() - started) / 1000) + 's\n')
  console.log(found.length + ' heading(s) left without their content ' +
    '(more than ' + minWhite + 'px of white beneath):\n')
  found.forEach(function (f) {
    console.log('  p' + String(f.page).padStart(4) + '  ' +
      String(f.white).padStart(3) + 'px  ' + f.kind.padEnd(26) + '  ' + f.text)
  })
})()
