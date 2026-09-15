#!/usr/bin/env node
//
// Cut the reference list into page-sized blocks before it is paginated.
//
// Why this exists, measured rather than guessed:
//
// Paged.js finds a page's break by walking the rendered content for the first
// thing below the foot of the page. That walk assumes one column. In a
// balanced two-column block the foot of the page falls at the bottom of
// *column one*, so everything from there on — the whole of column two — is
// pushed to the next page. What is left then re-balances into two columns of
// half the height, and the page is committed at 53% full.
//
// The result is a reference section that alternates: a full page, a half-full
// page, a full page. Measured over 280 pages: 132 full, 144 at a little over
// half, and about seventy pages of white paper.
//
// So the columns are not left to Paged.js. Each block here is measured to
// hold exactly one page of entries at the column width, balances into two
// full columns by itself, and ends with a page break. Paged.js never has to
// find an overflow inside one.
//
//   node chunk-references.js --content content/my-book [--height 816]
//
// The measurement is done in a host div at the real column width, with the
// real stylesheet. That is safe *here* and would not be everywhere: these
// entries are set ragged with hyphenation off, so line breaking is
// deterministic and the host agrees with the page. A justified, hyphenated
// paragraph does not — see references/troubleshooting.md.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, requirePlaywright, launchChromium, serveDirectory, parseArgs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node chunk-references.js --content <dir> [options]',
    '',
    '  --content <dir>  Book directory holding index.html, rewritten in place.',
    '  --theme <name>   Theme whose CSS sets the column. Default: aalai-textbook.',
    '  --height <px>    Height of one column. Default: 816 (a 10in page at this',
    '                   theme\'s margins). Measure it, do not assume it.',
    '  --width <px>     Column width. Default: measured from the theme.',
    '  --first <px>     Content height available on the first block\'s page,',
    '                   which carries the section title. Default: height - 120.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const indexFile = path.join(path.resolve(args.content), 'index.html')
const columnHeight = Number(args.height) || 816

let html = fs.readFileSync(indexFile, 'utf8')

// The reference component, and the entries inside it.
const componentPattern = /<div class="[^"]*\breferences\b[^"]*"[^>]*>/
const open = componentPattern.exec(html)
if (!open) { console.error('No component classed "references" in ' + indexFile); process.exit(1) }

function matchingClose (from) {
  const tag = /<(\/?)div\b[^>]*>/g
  tag.lastIndex = from
  let depth = 0
  let match
  while ((match = tag.exec(html)) !== null) {
    if (match[1] === '/') { depth -= 1; if (depth === 0) return tag.lastIndex } else depth += 1
  }
  return -1
}

const close = matchingClose(open.index)
const component = html.slice(open.index, close)

if (/\bref-page\b/.test(component)) {
  console.log('Already chunked — nothing to do.')
  process.exit(0)
}

const entryPattern = /<p class="reference">[\s\S]*?<\/p>/g
const entries = component.match(entryPattern) || []
if (!entries.length) { console.error('No reference entries found.'); process.exit(1) }

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })

  // A host that is one column of the real book: same stylesheet, same
  // ancestor classes, same width. Nothing is paginated — this only needs the
  // height of each entry.
  const slug = (/<div class="([a-z0-9-]+) /.exec(html) || [])[1] || 'book'
  await page.setContent(
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="' + server.url + '/themes/' + theme + '/main.css">' +
    '</head><body><div class="' + slug + ' chapter references endmatter"><div><div id="flow">' +
    entries.join('\n') +
    '</div></div></div></body></html>', { waitUntil: 'load' })

  const width = Number(args.width) || await page.evaluate(function () {
    const flow = document.getElementById('flow')
    const style = getComputedStyle(flow)
    const count = parseInt(style.columnCount, 10) || 1
    const gap = parseFloat(style.columnGap) || 0
    return (flow.getBoundingClientRect().width - gap * (count - 1)) / count
  })

  const heights = await page.evaluate(function (columnWidth) {
    const flow = document.getElementById('flow')
    flow.style.columnCount = '1'
    flow.style.width = columnWidth + 'px'
    return Array.prototype.map.call(flow.children, function (el) {
      const style = getComputedStyle(el)
      return el.getBoundingClientRect().height + parseFloat(style.marginBottom || 0)
    })
  }, width)

  await browser.close()
  server.close()

  // Fill blocks to two columns' worth. The first block shares its page with
  // the section title, so it gets less.
  const firstBudget = Number(args.first) || (columnHeight - 120)
  const blocks = []
  let current = []
  let used = 0
  let budget = firstBudget + columnHeight

  entries.forEach(function (entry, index) {
    const height = heights[index]
    // An entry taller than a whole page cannot be helped; it goes on its own
    // block and Paged.js splits it as it must.
    if (current.length && used + height > budget) {
      blocks.push(current)
      current = []
      used = 0
      budget = columnHeight * 2
    }
    current.push(entry)
    used += height
  })
  if (current.length) blocks.push(current)

  // Rebuild the component with the entries wrapped, in order, and nothing
  // else touched.
  let rebuilt = component
  const firstAt = rebuilt.indexOf(entries[0])
  const lastEntry = entries[entries.length - 1]
  const lastAt = rebuilt.indexOf(lastEntry) + lastEntry.length
  const wrapped = blocks.map(function (block) {
    return '<div class="ref-page">\n' + block.join('\n') + '\n</div>'
  }).join('\n')
  rebuilt = rebuilt.slice(0, firstAt) + wrapped + rebuilt.slice(lastAt)

  // The component itself stops being the column: each block is its own.
  rebuilt = rebuilt.replace(/class="([^"]*\breferences\b[^"]*)"/, 'class="$1 chunked"')

  html = html.slice(0, open.index) + rebuilt + html.slice(close)
  fs.writeFileSync(indexFile, html)

  const total = heights.reduce(function (a, b) { return a + b }, 0)
  console.log('Chunked ' + path.relative(process.cwd(), indexFile))
  console.log('  entries ' + entries.length + ' measured at ' + Math.round(width) + 'px')
  console.log('  blocks ' + blocks.length + ' (a page each)')
  console.log('  content ' + Math.round(total) + 'px = ' + (total / (columnHeight * 2)).toFixed(1) +
    ' pages of two full columns')
})().catch(function (error) { console.error(error); process.exit(1) })
