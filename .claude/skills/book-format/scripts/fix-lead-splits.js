#!/usr/bin/env node
//
// Move every lead-paragraph cut onto the line it actually falls on.
//
// An entry's heading is kept with the opening of its paragraph by cutting the
// paragraph in two and holding the first half in a box with the heading. The
// join is meant to be invisible: the theme justifies the first half's last
// line, because it is a mid-paragraph line and would otherwise set ragged and
// give the cut away.
//
// That only works if the cut lands at the end of a rendered line. The design
// pass cuts by counting characters — sixty-two to a line — and a character
// count cannot know where a line ends. It was close enough until the book was
// hyphenated, which changed how much fits on a line, and then cuts began
// landing early: a line with two words on it stretched across the whole
// measure, with the rest of the sentence on the line below.
//
//   node fix-lead-splits.js --content content/my-book --theme my-theme
//
// This measures in the paginated book, which costs a pagination and is the
// only place the answer is right. Measuring the same paragraph in a host at
// the same width, in the same face, with every computed value agreeing, gives
// three lines where the page gives four — that is written up in
// references/troubleshooting.md and it is not worth rediscovering.
//
// One pagination is enough, and this is why: line breaking is greedy and runs
// left to right, so removing text from the end of a paragraph cannot change
// where its earlier lines break. Measure once, cut at the start of the last
// line, and the lines above it stay exactly where they were.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, requirePlaywright, launchChromium, serveDirectory, waitForPagedJs, parseArgs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node fix-lead-splits.js --content <dir> [options]',
    '',
    '  --content <dir>  Book directory holding index.html, rewritten in place.',
    '  --theme <name>   Theme. Default: aalai-textbook.',
    '  --short <ratio>  A last line narrower than this much of the measure is a',
    '                   cut in the wrong place. Default: 0.94.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const indexFile = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

// Each pair, as it stands: the half in the box, and the half after it.
const PAIR = /<p class="([^"]*\blead-head\b[^"]*)">([\s\S]*?)<\/p>([\s\S]{0,40}?)<p class="([^"]*\blead-rest\b[^"]*)">([\s\S]*?)<\/p>/g

const pairs = []
let match
while ((match = PAIR.exec(html)) !== null) {
  pairs.push({
    start: match.index,
    end: match.index + match[0].length,
    headClass: match[1],
    head: match[2],
    between: match[3],
    restClass: match[4],
    rest: match[5]
  })
}

if (!pairs.length) { console.log('No lead splits to move.'); process.exit(0) }

// The same walk the design pass uses, so a cut lands on a word and never
// inside a tag or a character reference. `budget` is in visible characters.
function cutAt (inner, budget) {
  let visible = 0
  let index = 0
  let lastSpace = -1
  let depth = 0
  while (index < inner.length) {
    const ch = inner[index]
    if (ch === '<') {
      const close = inner.indexOf('>', index)
      if (close === -1) break
      if (inner[index + 1] === '/') depth -= 1
      else if (inner[close - 1] !== '/') depth += 1
      index = close + 1
      continue
    }
    if (ch === '&') {
      const semi = inner.indexOf(';', index)
      if (semi !== -1 && semi - index <= 8) { visible += 1; index = semi + 1; continue }
    }
    if (ch === ' ' && depth === 0) lastSpace = index
    visible += 1
    index += 1
    if (visible >= budget && lastSpace > 0) {
      return [inner.slice(0, lastSpace), inner.slice(lastSpace + 1)]
    }
  }
  return null
}

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } })

  const url = server.url + '/' + args.content.replace(/^\.\//, '') + '/index.html?theme=' + theme
  console.log('Paginating ' + url + ' …')
  const started = Date.now()
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, 3600000)
  console.log('  paginated in ' + Math.round((Date.now() - started) / 1000) + 's')

  const measured = await page.evaluate(function (shortRatio) {
    return Array.prototype.map.call(document.querySelectorAll('.lead-head'), function (el) {
      // With the last line justified, every last line is the full measure and
      // a short one cannot be told from a full one. Un-justify it to look.
      const was = el.style.textAlignLast
      el.style.textAlignLast = 'auto'

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      let visible = 0
      let lineTop = null
      let lastLineStart = 0
      let lastRect = null
      let node
      while ((node = walker.nextNode()) !== null) {
        for (let i = 0; i < node.data.length; i += 1) {
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const rect = range.getBoundingClientRect()
          if (rect.width || rect.height) {
            if (lineTop === null || rect.top > lineTop + 1) {
              lineTop = rect.top
              lastLineStart = visible
            }
            lastRect = rect
          }
          visible += 1
        }
      }
      el.style.textAlignLast = was

      const box = el.getBoundingClientRect()
      const leading = parseFloat(getComputedStyle(el).lineHeight) || 1
      const lines = Math.round(box.height / leading)
      const lastWidth = lastRect ? (lastRect.right - box.left) : 0
      return {
        lines: lines,
        total: visible,
        lastLineStart: lastLineStart,
        short: lines > 1 && lastWidth < box.width * shortRatio
      }
    })
  }, Number(args.short) || 0.94)

  await browser.close()
  server.close()

  if (measured.length !== pairs.length) {
    console.error('Found ' + measured.length + ' lead heads in the page but ' + pairs.length +
      ' in the file. Not touching anything.')
    process.exit(1)
  }

  let moved = 0
  let already = 0
  // Back to front, so an edit never shifts the offset of the next one.
  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    const pair = pairs[i]
    const info = measured[i]
    if (!info.short || !info.lastLineStart) { already += 1; continue }

    const joined = pair.head + ' ' + pair.rest
    const cut = cutAt(joined, info.lastLineStart)
    if (!cut || !cut[0].trim() || !cut[1].trim()) { already += 1; continue }

    moved += 1
    html = html.slice(0, pair.start) +
      '<p class="' + pair.headClass + '">' + cut[0] + '</p>' +
      pair.between +
      '<p class="' + pair.restClass + '">' + cut[1] + '</p>' +
      html.slice(pair.end)
  }

  fs.writeFileSync(indexFile, html)

  console.log('Lead cuts measured in ' + path.relative(process.cwd(), indexFile))
  console.log('  cuts moved back to a line end: ' + moved)
  console.log('  already landing on one: ' + already)
})().catch(function (error) { console.error(error); process.exit(1) })
