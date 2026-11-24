#!/usr/bin/env node
//
// Give a word its hyphenation back where taking it away opened a hole.
//
// fit-hyphenation.js breaks up a stack of hyphenated lines by making one word
// in it unbreakable. In a narrow justified column that is not free: a long
// word that can no longer break goes down whole, and the line it left is
// three words spread across the measure. "…who / met   the   product's /
// requirements for …". Three hyphens in a row is a blemish; that is a hole,
// and of the two a compositor keeps the hyphens.
//
// So, after the fitting:
//
//   1. the book is paginated and every justified line measured;
//   2. where a line's average word gap is at or over --hole (default 1.5 em)
//      and the word that starts the next line has no hyphenation points,
//      that word is the cause;
//   3. it is hyphenated again from the same patterns hyphenate.js uses, in
//      the file, and written to the exceptions list so that the next
//      fit-hyphenation.js --keep <list> leaves it alone.
//
// Names are not given back. A word with a capital was made unbreakable on
// purpose and stays that way whatever it does to the line above.
//
//   node relax-hyphenation.js --content <book> [--also <copy>] --keep <exceptions.json>
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')
const { hyphenateSync } = require('hyphen/en-us')

const args = parseArgs(process.argv)
const SOFT = '­'

if (args.help || !args.content || !args.keep) {
  console.log([
    'Usage: node relax-hyphenation.js --content <dir> --keep <exceptions.json> [--also <dir>] [--hole <em>] [--dry]',
    '',
    '  --content <dir>  Book directory holding index.html. MODIFIED in place unless --dry.',
    '  --also <dir>     A second copy of the book to change the same way.',
    '  --keep <file>    The exceptions list. Read if it exists, added to, written back.',
    '  --hole <em>      Average word gap that makes a line a hole. Default 1.5.',
    '  --min <n>        Shortest word to hyphenate. Default 7, as hyphenate.js.',
    '  --dry            Say what would change and write nothing.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const hole = Number(args.hole || 1.5)
const minimum = Number(args.min || 7)

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
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const found = await page.evaluate(function (opts) {
    var SOFT = '­'
    var BLOCKS = 'p, li, dd'
    var SKIP = 'h1, h2, h3, h4, h5, h6, .label, .entry-name, table, .figure, .references, .index, .toc-list, .contents-page, .title-page'
    function lastRect (node, offset) {
      var r = document.createRange()
      r.setStart(node, offset)
      r.setEnd(node, offset + 1)
      var list = r.getClientRects()
      for (var i = list.length - 1; i >= 0; i -= 1) if (list[i].width > 0 && list[i].height > 0) return list[i]
      return null
    }
    var out = []
    var holes = 0
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    pages.forEach(function (pg, index) {
      var area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      var box = area.getBoundingClientRect()
      area.querySelectorAll(BLOCKS).forEach(function (el) {
        if (el.querySelector(BLOCKS) || el.closest(SKIP)) return
        var style = window.getComputedStyle(el)
        if (style.textAlign !== 'justify' || !el.getClientRects().length) return
        var em = parseFloat(style.fontSize)
        var mid = el.getBoundingClientRect().width > box.width * 0.75 ? box.right + 10 : box.left + box.width / 2
        // Every word, in order, with where it starts and ends.
        var words = []
        var full = el.textContent
        var seen = 0
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        var node
        while ((node = walker.nextNode())) {
          var text = node.textContent
          var re = /\S+/g
          var m
          while ((m = re.exec(text))) {
            var first = m.index
            var last = m.index + m[0].length - 1
            while (first < last && text[first] === SOFT) first += 1
            while (last > first && text[last] === SOFT) last -= 1
            var a = lastRect(node, first)
            var b = lastRect(node, last)
            if (a && b) words.push({ text: m[0], at: seen + m.index, left: a.left, top: a.top, right: b.right, endTop: b.top, col: a.left >= mid ? 1 : 0, endCol: b.left >= mid ? 1 : 0 })
          }
          seen += text.length
        }
        // Lines: a run of words that start on the same line.
        var key = function (w) { return w.col + '|' + Math.round(w.top / 4) }
        var i = 0
        while (i < words.length) {
          var j = i
          var gaps = []
          while (j + 1 < words.length && key(words[j + 1]) === key(words[i])) {
            // a word carried over by a hyphen ends on the next line: no gap after it here
            if (words[j].endCol === words[j].col && Math.abs(words[j].endTop - words[j].top) < 4) {
              var gap = words[j + 1].left - words[j].right
              if (gap > 0.8) gaps.push(gap)
            }
            j += 1
          }
          var next = words[j + 1]
          if (next && gaps.length) {
            var mean = gaps.reduce(function (s, g) { return s + g }, 0) / gaps.length / em
            if (mean >= opts.hole) {
              holes += 1
              // The word that starts the next line — unless the line ended in
              // a hyphen, in which case what follows is the rest of a word.
              var lastOnLine = words[j]
              var carried = !(lastOnLine.endCol === lastOnLine.col && Math.abs(lastOnLine.endTop - lastOnLine.top) < 4)
              if (!carried && next.text.indexOf(SOFT) < 0) {
                out.push({
                  sheet: index + 1,
                  gap: Math.round(mean * 100) / 100,
                  word: next.text,
                  context: full.slice(Math.max(0, next.at - 30), next.at + next.text.length + 30),
                  contextAt: next.at - Math.max(0, next.at - 30),
                  line: words.slice(i, j + 1).map(function (w) { return w.text.split(SOFT).join('') }).join(' ')
                })
              }
            }
          }
          i = j + 1
        }
      })
    })
    return { holes: holes, causes: out }
  }, { hole: hole })

  await browser.close()
  await server.close()

  // Which of them can be hyphenated.
  const keepFile = path.resolve(args.keep)
  const keep = fs.existsSync(keepFile) ? JSON.parse(fs.readFileSync(keepFile, 'utf8')) : []
  const changes = []
  found.causes.forEach(c => {
    // The word proper: letters, with whatever punctuation is stuck to it left on.
    const m = /[A-Za-zÀ-ɏ]+/.exec(c.word)
    if (!m) return
    const core = m[0]
    if (core.length < minimum || /^[A-ZÀ-Þ]/.test(core) || /\d/.test(c.word)) return
    const broken = hyphenateSync(core, { hyphenChar: SOFT })
    if (broken.indexOf(SOFT) < 0) return
    changes.push({ context: c.context, at: c.contextAt + m.index, core: core, broken: broken, sheet: c.sheet, gap: c.gap, line: c.line })
  })

  console.log('')
  console.log(found.holes + ' lines with an average word gap of ' + hole + ' em or more; ' + found.causes.length +
    ' are followed by a word with no hyphenation points; ' + changes.length + ' of those words can be hyphenated')

  const files = [args.content].concat(args.also ? [args.also] : []).map(dir => path.join(path.resolve(dir), 'index.html'))
  files.forEach((file, n) => {
    let html = fs.readFileSync(file, 'utf8')
    const { text, at } = textOf(html)
    const edits = []
    let missing = 0
    changes.forEach(c => {
      const hit = text.indexOf(c.context)
      if (hit < 0 || text.indexOf(c.context, hit + 1) >= 0) { missing += 1; return }
      const start = hit + c.at
      if (text.slice(start, start + c.core.length) !== c.core) { missing += 1; return }
      // the word is plain letters in the file: put the soft hyphens in
      edits.push({ from: at[start], to: at[start + c.core.length - 1] + 1, core: c.core, broken: c.broken })
      if (n === 0) keep.push({ word: c.core, pre: c.context.slice(0, c.at).split(SOFT).join('').slice(-15) })
    })
    edits.sort((x, y) => y.from - x.from).forEach(e => {
      if (html.slice(e.from, e.to) === e.core) html = html.slice(0, e.from) + e.broken + html.slice(e.to)
    })
    if (!args.dry && edits.length) fs.writeFileSync(file, html)
    console.log(path.relative(process.cwd(), file) + ': ' + edits.length + ' words hyphenated again' +
      (missing ? ', ' + missing + ' not placed' : '') + (args.dry ? ' — dry run, nothing written' : ''))
  })
  changes.slice(0, Number(args.show || 12)).forEach(c => console.log('  sheet ' + c.sheet + '  ' + c.gap + ' em  “' + c.line + '” / ' + c.broken.split(SOFT).join('-')))
  if (!args.dry) fs.writeFileSync(keepFile, JSON.stringify(keep, null, 1))
})().catch(function (error) {
  console.error(error)
  process.exit(2)
})

// The file as running text, with the place in the file of every character.
function textOf (html) {
  const chars = []
  const at = []
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: SOFT }
  let i = Math.max(0, html.indexOf('<body'))
  const skipTo = (close) => { const end = html.indexOf(close, i); i = end < 0 ? html.length : end + close.length }
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<' && /[A-Za-z/!]/.test(html[i + 1] || '')) {
      if (html.startsWith('<!--', i)) { skipTo('-->'); continue }
      const lower = html.slice(i, i + 8).toLowerCase()
      if (lower.startsWith('<script')) { skipTo('</script>'); continue }
      if (lower.startsWith('<style')) { skipTo('</style>'); continue }
      skipTo('>')
      continue
    }
    if (ch === '&') {
      const m = /^&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/.exec(html.slice(i, i + 12))
      if (m) {
        let value = null
        if (m[1][0] === '#') {
          const code = m[1][1] === 'x' || m[1][1] === 'X' ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10)
          value = String.fromCodePoint(code)
        } else if (named[m[1]]) value = named[m[1]]
        if (value !== null) {
          for (const c of value) { chars.push(c); at.push(i) }
          i += m[0].length
          continue
        }
      }
    }
    chars.push(ch)
    at.push(i)
    i += 1
  }
  return { text: chars.join(''), at }
}
