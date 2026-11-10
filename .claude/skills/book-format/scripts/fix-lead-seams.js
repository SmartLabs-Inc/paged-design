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
// Where the stray line begins mid-word, the front of that word has to go down
// with it and the line above is left that much short. So there is a second
// repair — pull words up from the second half until the stray line is full —
// and the pass takes whichever leaves the fuller line, and neither unless it
// is a real gain. `--dry` is the report: it measures and lists and changes
// nothing.
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
  let stamped = source.replace(/<p class="lead-head">/g, function () { n += 1; return '<p class="lead-head" data-seam="' + n + '">' })
  let r = 0
  stamped = stamped.replace(/<p class="([^"]*\blead-rest\b[^"]*)">/g, function (m, cls) { r += 1; return '<p class="' + cls + '" data-seam-rest="' + r + '">' })
  if (r !== n) { console.error('First and second halves do not pair up: ' + n + ' against ' + r); process.exit(1) }
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

  const seams = await page.evaluate(require('./lib/seam-measure'), limit)
  await browser.close()
  await server.close()
  fs.rmSync(scratch, { recursive: true, force: true })

  const want = new Map(seams.map(function (s) { return [s.seam, s] }))
  let index = 0, movedDown = 0, pulledUp = 0
  const skipped = [], after = []
  const result = source.replace(PAIR, function (whole, head, between, rest) {
    index += 1
    const s = want.get(index)
    if (!s) return whole
    // Whichever leaves the fuller line; pulling up on a tie, because it
    // leaves the first half the height it was and so moves less of the book.
    // And only when it is a real gain. Where the stray line begins mid-word
    // the line above loses the front of that word, and a seam at 80% can
    // come out at 70%: a repair that leaves the line emptier is not one.
    const gain = function (o) { return o && (o.fill >= limit * 100 || o.fill >= s.fill + 5) ? o : null }
    const down = gain(s.down), up = gain(s.up)
    const useUp = up && (!down || up.fill >= down.fill - 2)
    if (useUp) {
      const lead = /^([^<]*)/.exec(rest)[1]
      let at = 0, count = 0, inToken = false
      for (let i = 0; i < lead.length; i += 1) {
        if (WS.test(lead[i])) { if (inToken) { count += 1; inToken = false; if (count === up.words) { at = i; break } } }
        else inToken = true
      }
      if (at > 0) {
        pulledUp += 1; after.push(up.fill)
        return '<p class="lead-head">' + head.replace(/\s+$/, '') + ' ' + lead.slice(0, at).replace(/^\s+/, '') + '</p>' +
               between + lead.slice(at).replace(/^\s+/, '') + rest.slice(lead.length) + '</p>'
      }
    }
    if (down) {
      const at = cutPoint(head, down.words)
      const tail = at > 0 ? head.slice(at) : ''
      if (at > 0 && !/<\/?[a-zA-Z]/.test(tail)) {
        movedDown += 1; after.push(down.fill)
        return '<p class="lead-head">' + head.slice(0, at).replace(/\s+$/, '') + '</p>' + between +
               tail.replace(/^\s+|\s+$/g, '') + ' ' + rest.replace(/^\s+/, '') + '</p>'
      }
    }
    skipped.push(s)
    return whole
  })
  const moved = movedDown + pulledUp

  console.log(seams.length + ' seams show (last line under ' + Math.round(limit * 100) + '% full)')
  console.log(moved + ' re-cut (' + pulledUp + ' by pulling words up, ' + movedDown + ' by moving the stray line down); ' +
    skipped.length + ' left alone')
  const loose = after.filter(function (f) { return f < limit * 100 }).length
  console.log('of those, ' + (after.length - loose) + ' end on a full line; ' + loose +
    ' end on a line fuller than before but still loose')
  skipped.slice(0, 8).forEach(function (k) { console.log('  left: …' + k.tail + ' (' + k.fill + '%)') })
  if (args.report) fs.writeFileSync(path.resolve(args.report), JSON.stringify({ seams: seams, skipped: skipped }, null, 1))
  if (!args.dry) {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'index.html'), result)
    console.log('Wrote ' + path.join(outDir, 'index.html'))
  }
})().catch(function (e) { console.error(e); process.exit(1) })
