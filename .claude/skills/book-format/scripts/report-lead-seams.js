#!/usr/bin/env node
'use strict'
//
// Find the split paragraphs whose seam shows.
//
// The build cuts the opening of an entry in two so its label can be locked to
// the first lines: the first half goes in the label's box, the rest follows,
// and the first half's last line is justified so the cut cannot be seen. That
// only holds while the cut falls where a line ends. Anything that moves a
// line break in the first half — a retyped word, a wider reference mark, a
// full stop — leaves a last line of two or three words spread across the
// whole measure with the sentence carrying on underneath.
//
// This measures every seam in the finished pagination and lists the ones
// that show. It changes nothing.
//
// Usage: node report-lead-seams.js --content <dir> [--theme <name>] [--out <file>]

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)
if (args.help || !args.content) {
  console.log([
    'Usage: node report-lead-seams.js --content <dir> [--theme <name>] [--out <file>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --out <file>     Write the list as JSON as well.',
    '',
    'Lists split paragraphs whose first half ends on a short, stretched line.'
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
  const url = server.url + '/' +
    path.relative(root, contentDir).split(path.sep).join('/') +
    '/index.html?theme=' + theme
  console.log('Paginating ' + url + ' …')
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const report = await page.evaluate(function () {
    const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    let bodyStart = 0
    for (let k = 0; k < pages.length; k += 1) {
      if (/pagedjs_part\d+_page/.test(pages[k].className)) { bodyStart = k + 1; break }
    }
    const out = { seams: 0, showing: [], bodyStart: bodyStart }
    pages.forEach(function (pg, index) {
      pg.querySelectorAll('p.lead-head').forEach(function (el) {
        // A first half that itself runs on to another column is not at its
        // seam on this fragment.
        if (el.hasAttribute('data-split-to')) return
        out.seams += 1
        // The last line's natural width: how wide its words are when nothing
        // is stretching them.
        const probe = el.cloneNode(true)
        probe.style.textAlignLast = 'left'
        probe.style.textAlign = 'left'
        probe.style.visibility = 'hidden'
        el.parentNode.insertBefore(probe, el.nextSibling)
        const range = document.createRange()
        range.selectNodeContents(probe)
        const rects = Array.prototype.slice.call(range.getClientRects()).filter(function (r) { return r.width > 1 })
        let fill = 1
        if (rects.length) {
          const lastTop = rects[rects.length - 1].top
          const line = rects.filter(function (r) { return Math.abs(r.top - lastTop) < 3 })
          const left = Math.min.apply(null, line.map(function (r) { return r.left }))
          const right = Math.max.apply(null, line.map(function (r) { return r.right }))
          fill = (right - left) / probe.getBoundingClientRect().width
        }
        probe.remove()
        if (fill < 0.82) {
          const words = (el.textContent || '').replace(/­/g, '').trim().split(/\s+/)
          out.showing.push({
            sheet: index + 1,
            fill: Math.round(fill * 100),
            opens: words.slice(0, 6).join(' '),
            lastLine: words.slice(-4).join(' ')
          })
        }
      })
    })
    return out
  })

  await browser.close()
  await server.close()

  const folio = function (sheet) {
    return report.bodyStart && sheet >= report.bodyStart ? String(sheet - report.bodyStart + 1) : 'fm ' + sheet
  }
  console.log(report.seams + ' split paragraphs; ' + report.showing.length + ' show their seam')
  report.showing.slice(0, 12).forEach(function (s) {
    console.log('  p' + folio(s.sheet) + '  ' + s.fill + '% full  …' + s.lastLine + '  (' + s.opens + ')')
  })
  if (report.showing.length > 12) console.log('  … and ' + (report.showing.length - 12) + ' more')
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 1))
    console.log('Wrote ' + path.resolve(args.out))
  }
})().catch(function (e) { console.error(e); process.exit(1) })
