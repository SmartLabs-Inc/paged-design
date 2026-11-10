#!/usr/bin/env node
'use strict'
//
// Move the cut in a split paragraph back to where a line ends.
//
// The opening of an entry is cut in two so its label can be locked to the
// first lines, and the first half's last line is justified so the cut cannot
// be seen. That holds only while the cut falls at the end of a line. Where it
// no longer does, the last line is two or three words spread across the
// measure with the sentence carrying on beneath (report-lead-seams.js counts
// them).
//
// The repair is to move the words on that stray last line down into the
// second half. The first half then ends on what was already a full line, and
// nothing above the cut moves, because a line break depends only on the words
// before it. Same words, same order, no paragraph merged, the label still
// locked — only the place the paragraph is cut.
//
// The answer cannot be worked out from the text. Where a line ends is the
// renderer's decision, so the book is paginated and each seam is read off the
// page. A copy with every first half numbered is paginated rather than the
// book itself, which is never served modified.
//
// A seam is left alone, and listed, when moving the words would also move an
// element — a reference mark, a run of bold. Elements are numbered in order
// by the correction editor, and moving one past the paragraph that follows it
// renumbers that paragraph, which would silently re-aim a saved correction.
//
// Usage: node fix-lead-seams.js --content <dir> [--out <dir>] [--dry]

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)
if (args.help || !args.content) {
  console.log([
    'Usage: node fix-lead-seams.js --content <dir> [--out <dir>] [--dry]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --out <dir>      Write here instead of in place.',
    '  --dry            Measure and list, change nothing.',
    '  --below <n>      Fix seams whose last line is under n% full. Default 82.',
    '',
    'Re-cuts split paragraphs so the first half ends where a line ends.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const contentDir = path.resolve(args.content)
const outDir = path.resolve(args.out || args.content)
const limit = Number(args.below || 82) / 100
const scratch = path.join(root, 'content', 'scratch-seams')

const PAIR = /<p class="lead-head">((?:(?!<\/p>)[\s\S])*)<\/p>(\s*<\/div>\s*(?:<a id="[^"]*"><\/a>\s*)*<p class="[^"]*\blead-rest\b[^"]*">)((?:(?!<\/p>)[\s\S])*)<\/p>/g
// Space as the renderer and the source both see it. A no-break space joins
// its neighbours on the page and is spelled two ways in a file, so it is not
// a separator on either side.
const WS = /[ \t\r\n ]/
const TAG = /<\/?[a-zA-Z][^>]*>/g

function cutPoint (inner, words) {
  // Every character of text with its place in the markup; tags are skipped.
  const chars = []
  let last = 0, m
  TAG.lastIndex = 0
  while ((m = TAG.exec(inner))) {
    for (let i = last; i < m.index; i += 1) chars.push(i)
    last = m.index + m[0].length
  }
  for (let i = last; i < inner.length; i += 1) chars.push(i)
  let inToken = false, count = 0
  for (let c = chars.length - 1; c >= 0; c -= 1) {
    if (WS.test(inner[chars[c]])) {
      if (inToken) { count += 1; inToken = false; if (count === words) return chars[c] + 1 }
    } else inToken = true
  }
  return -1                                   // the whole first half is one line
}

;(async function () {
  const source = fs.readFileSync(path.join(contentDir, 'index.html'), 'utf8')
  let n = 0
  const stamped = source.replace(/<p class="lead-head">/g, function () { n += 1; return '<p class="lead-head" data-seam="' + n + '">' })
  fs.mkdirSync(scratch, { recursive: true })
  fs.writeFileSync(path.join(scratch, 'index.html'), stamped)

  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  await watchForPagedJs(page)
  await blockRemoteResources(page, server.url)
  console.log('Paginating a numbered copy of ' + n + ' split paragraphs …')
  await page.goto(server.url + '/content/scratch-seams/index.html?theme=' + theme, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const seams = await page.evaluate(function (limit) {
    const out = []
    const WSX = /[ \t\r\n ]/
    document.querySelectorAll('.pagedjs_page p.lead-head').forEach(function (el) {
      if (el.hasAttribute('data-split-to')) return        // the seam is on its last fragment
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      const range = document.createRange()
      let lastTop = null, startNode = null, startOff = 0, lines = 1
      scan: for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const t = nodes[i].data
        for (let j = t.length - 1; j >= 0; j -= 1) {
          if (WSX.test(t[j]) || t[j] === '­') continue
          range.setStart(nodes[i], j); range.setEnd(nodes[i], j + 1)
          const r = range.getClientRects()[0]
          if (!r) continue
          if (lastTop === null) lastTop = r.top
          if (Math.abs(r.top - lastTop) > 3) { lines = 2; break scan }
          startNode = nodes[i]; startOff = j
        }
      }
      if (!startNode) return
      range.setStart(startNode, startOff); range.setEnd(el, el.childNodes.length)
      const rects = Array.prototype.slice.call(range.getClientRects()).filter(function (r) { return r.width > 1 })
      const text = range.toString().replace(/­/g, '')
      const words = text.split(/[ \t\r\n ]+/).filter(Boolean).length
      // Natural width of those words against the measure.
      let natural = 0
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'
      probe.appendChild(range.cloneContents())
      el.appendChild(probe); natural = probe.getBoundingClientRect().width; probe.remove()
      const fill = natural / el.getBoundingClientRect().width
      if (fill < limit) {
        out.push({ seam: Number(el.getAttribute('data-seam')), fill: Math.round(fill * 100),
                   words: words, oneLine: lines === 1 && !el.hasAttribute('data-split-from'),
                   tail: text.trim().slice(-40) })
      }
    })
    return out
  }, limit)
  await browser.close()
  await server.close()
  fs.rmSync(scratch, { recursive: true, force: true })

  const want = new Map(seams.map(function (s) { return [s.seam, s] }))
  let index = 0, moved = 0
  const skipped = []
  const result = source.replace(PAIR, function (whole, head, between, rest) {
    index += 1
    const s = want.get(index)
    if (!s) return whole
    if (s.oneLine) { skipped.push({ why: 'the first half is a single line', s: s }); return whole }
    const at = cutPoint(head, s.words)
    if (at <= 0) { skipped.push({ why: 'no place to cut', s: s }); return whole }
    const tail = head.slice(at)
    if (/<\/?[a-zA-Z]/.test(tail)) { skipped.push({ why: 'the stray line carries a reference mark or styled text', s: s }); return whole }
    moved += 1
    return '<p class="lead-head">' + head.slice(0, at).replace(/\s+$/, '') + '</p>' + between +
           tail.replace(/^\s+|\s+$/g, '') + ' ' + rest.replace(/^\s+/, '') + '</p>'
  })

  console.log(seams.length + ' seams show (last line under ' + Math.round(limit * 100) + '% full)')
  console.log(moved + ' re-cut; ' + skipped.length + ' left alone')
  const why = {}
  skipped.forEach(function (k) { why[k.why] = (why[k.why] || 0) + 1 })
  Object.keys(why).forEach(function (k) { console.log('  ' + why[k] + '  ' + k) })
  if (args.report) fs.writeFileSync(path.resolve(args.report), JSON.stringify({ seams: seams, skipped: skipped }, null, 1))
  if (!args.dry) {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'index.html'), result)
    console.log('Wrote ' + path.join(outDir, 'index.html'))
  }
})().catch(function (e) { console.error(e); process.exit(1) })
