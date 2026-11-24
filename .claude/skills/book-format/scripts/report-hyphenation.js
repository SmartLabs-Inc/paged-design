#!/usr/bin/env node
//
// Where does the book break words, and where does it do it too often?
//
// This REPORTS. It changes nothing. `fit-hyphenation.js` reads what this
// writes and makes the changes; the two are separate so the list can be read
// before anything is done about it.
//
// The book carries its own hyphenation as soft hyphens in the source, so a
// broken word is a soft hyphen the browser chose to use. Each one is found by
// asking the browser where it drew it: a soft hyphen that was not used has no
// width, and one that was used is as wide as the hyphen at the end of the line.
//
// Reported:
//
//   stacks   three or more lines in a row ending in a hyphen (the press
//            standard is two). Two hyphens are "in a row" when the text
//            between them is a single line.
//   short    a broken word with fewer than --min letters (default 7), or one
//            that leaves fewer than three letters on either line
//   names    a broken word with a capital in mid-sentence: a name or a title.
//            A capital after a full stop or in a bold lead-in is not counted.
//   heads    any break inside a heading, a label or a title
//
// Every break is written to the JSON with the block it is in and the text
// around it, which is what the fitting pass needs to find it in the source.
'use strict'

const path = require('path')
const fs = require('fs')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node report-hyphenation.js --content <dir> [--theme <name>] [--json <file>]',
    '',
    '  --content <dir>  Book directory holding index.html. Never modified.',
    '  --theme <name>   Default: aalai-textbook.',
    '  --max <n>        Hyphenated lines allowed in a row. Default 2.',
    '  --min <n>        Shortest word that may break. Default 7.',
    '  --json <file>    Write every break, and the stacks, as JSON.',
    '',
    'Lists stacked hyphens, short broken words, broken names and broken headings.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const maxRun = Number(args.max || 2)
const minWord = Number(args.min || 7)

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

  const report = await page.evaluate(function (opts) {
    var SOFT = '­'
    var LEAF = 'p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, dt, dd, caption'
    var HEAD = 'h1, h2, h3, h4, h5, h6, .label, .entry-name, .title, .subtitle, caption'
    var polyfill = window.PagedPolyfill
    var source = polyfill && polyfill.chunker && polyfill.chunker.source
    var letter = /[A-Za-zÀ-ɏ]/

    function rectAt (node, offset) {
      if (offset < 0 || offset >= node.textContent.length) return null
      var r = document.createRange()
      r.setStart(node, offset)
      r.setEnd(node, offset + 1)
      var list = r.getClientRects()
      // The letter after a hyphen that was used answers twice: once where the
      // hyphen was drawn, at the end of the line above, and once where the
      // letter itself is. The last is the letter.
      for (var i = list.length - 1; i >= 0; i -= 1) if (list[i].width > 0 && list[i].height > 0) return list[i]
      return null
    }

    // A soft hyphen the browser used is one it drew: it has a width.
    function used (node, offset) {
      var r = document.createRange()
      r.setStart(node, offset)
      r.setEnd(node, offset + 1)
      var list = r.getClientRects()
      for (var i = 0; i < list.length; i += 1) if (list[i].width > 0.5) return true
      return false
    }

    // The drawn letter before / after a place in a block's text, stepping over
    // soft hyphens and from one text node to the next.
    function drawn (texts, t, offset, step) {
      var hops = 0
      while (t >= 0 && t < texts.length && hops < 60) {
        var node = texts[t]
        while (offset >= 0 && offset < node.textContent.length) {
          var ch = node.textContent[offset]
          if (ch !== SOFT) {
            var r = rectAt(node, offset)
            if (r) return { rect: r, ch: ch }
          }
          offset += step
          hops += 1
        }
        t += step
        if (t >= 0 && t < texts.length) offset = step > 0 ? 0 : texts[t].textContent.length - 1
      }
      return null
    }

    var breaks = []
    var lines = 0
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
    pages.forEach(function (pg, index) {
      var area = pg.querySelector('.pagedjs_page_content')
      if (!area) return
      area.querySelectorAll(LEAF).forEach(function (el) {
        if (el.querySelector(LEAF)) return
        if (el.textContent.indexOf(SOFT) < 0 && !el.matches(HEAD)) return
        if (!el.getClientRects().length) return
        var texts = []
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        var n
        while ((n = walker.nextNode())) texts.push(n)

        // Where this piece starts in the whole block, when the block was
        // divided between pages.
        var ref = el.getAttribute('data-ref')
        var base = 0
        var lead = el.textContent.slice(0, 60)
        if (el.hasAttribute('data-split-from') && source) {
          var whole = source.querySelector('[data-ref="' + ref + '"]')
          if (whole) {
            var opening = el.textContent.slice(0, 40)
            var found = whole.textContent.indexOf(opening)
            if (found > 0) base = found
            lead = whole.textContent.slice(0, 60)
          }
        }

        var seen = 0
        var mine = []
        texts.forEach(function (node, t) {
          var text = node.textContent
          var at = text.indexOf(SOFT)
          while (at >= 0) {
            var before = used(node, at) ? drawn(texts, t, at - 1, -1) : null
            var after = before ? drawn(texts, t, at + 1, 1) : null
            // And the next letter is on another line. Width alone is not
            // enough: inside an "ff" or "fi" ligature the soft hyphen is given
            // a share of the ligature's width without any line ending there.
            var wrapped = before && after && (after.rect.top > before.rect.top + 3 ||
              (after.rect.top < before.rect.top - 3 && after.rect.left > before.rect.left))
            if (wrapped) {
              // The word: letters and soft hyphens either side.
              var full = el.textContent
              var pos = seen + at
              var a = pos
              while (a > 0 && (letter.test(full[a - 1]) || full[a - 1] === SOFT)) a -= 1
              var b = pos
              while (b < full.length - 1 && (letter.test(full[b + 1]) || full[b + 1] === SOFT)) b += 1
              var word = full.slice(a, b + 1)
              var left = full.slice(a, pos).split(SOFT).join('').length
              var right = full.slice(pos + 1, b + 1).split(SOFT).join('').length
              mine.push({
                sheet: index + 1,
                ref: ref,
                offset: base + pos,
                start: base + a,
                word: word.split(SOFT).join('-'),
                plain: word.split(SOFT).join(''),
                left: left,
                right: right,
                head: el.matches(HEAD) || !!el.closest(HEAD),
                // A capital in mid-sentence is a name or a title; a capital
                // after a full stop, or in a bold lead-in, is just a capital.
                bold: !!(node.parentNode && node.parentNode.closest && node.parentNode.closest('strong, b')),
                mid: /[A-Za-z0-9,;)\u2019\u201D]\s+$/.test(full.slice(Math.max(0, a - 6), a).split(SOFT).join('')),
                overPage: false,
                tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(/\s+/).join('.') : ''),
                context: full.slice(Math.max(0, a - 30), Math.min(full.length, b + 31)),
                contextAt: a - Math.max(0, a - 30),
                lead: lead,
                afterTop: after.rect.top,
                afterLeft: after.rect.left,
                beforeTop: before.rect.top,
                beforeLeft: before.rect.left,
                node: t,
                at: at
              })
            }
            at = text.indexOf(SOFT, at + 1)
          }
          seen += text.length
        })

        // In a row: the letter after one break and the letter before the next
        // are on the same line.
        mine.forEach(function (b, i) {
          b.follows = false
          if (i === 0) return
          var prev = mine[i - 1]
          b.follows = Math.abs(prev.afterTop - b.beforeTop) < 3 && b.beforeLeft >= prev.afterLeft - 2
        })
        mine.forEach(function (b) {
          delete b.node; delete b.at
          breaks.push(b)
        })
      })
    })

    // A word divided between two pages. Paged.js marks the piece and adds a
    // hyphen of its own; it is right when the letters before it end at one of
    // the word's hyphenation points.
    var overPage = []
    pages.forEach(function (pg, index) {
      pg.querySelectorAll('.pagedjs_page_content .pagedjs_hyphen').forEach(function (el) {
        var text = el.textContent
        if (text[text.length - 1] !== '\u2011') return
        overPage.push({ sheet: index + 1, right: text[text.length - 2] === SOFT, tail: text.slice(-34).split(SOFT).join('') })
      })
    })

    // Stacks.
    var stacks = []
    var run = []
    var close = function () { if (run.length > opts.maxRun) stacks.push(run.slice()); run = [] }
    breaks.forEach(function (b, i) {
      if (!b.follows || !run.length || run[run.length - 1] !== i - 1) close()
      run.push(i)
    })
    close()

    return { pages: pages.length, breaks: breaks, stacks: stacks, overPage: overPage }
  }, { maxRun: maxRun })

  await browser.close()
  await server.close()

  const breaks = report.breaks
  const seconds = Math.round((Date.now() - started) / 1000)
  const short = breaks.filter(b => !b.head && b.tag.indexOf('pagedjs_hyphen') < 0 && (b.plain.length < minWord || b.left < 2 || b.right < 3))
  const names = breaks.filter(b => !b.head && /^[A-Z]/.test(b.plain) && b.mid && !b.bold)
  const heads = breaks.filter(b => b.head)
  const sizes = {}
  report.stacks.forEach(s => { sizes[s.length] = (sizes[s.length] || 0) + 1 })

  console.log('')
  console.log(report.pages + ' pages, ' + breaks.length + ' words broken at a line end (' + seconds + ' s)')
  console.log('')
  console.log('Stacks of more than ' + maxRun + ' hyphenated lines: ' + report.stacks.length +
    '  ' + Object.keys(sizes).sort().map(k => sizes[k] + ' of ' + k).join(', '))
  report.stacks.slice(0, Number(args.show || 15)).forEach(s => {
    console.log('  sheet ' + breaks[s[0]].sheet + '  ' + s.map(i => breaks[i].word).join(' / '))
  })
  if (report.stacks.length > Number(args.show || 15)) console.log('  …')
  const list = (title, items) => {
    console.log('')
    console.log(title + ': ' + items.length)
    items.slice(0, Number(args.show || 15)).forEach(b => console.log('  sheet ' + b.sheet + '  ' + b.word + '  (' + b.tag + ')'))
    if (items.length > Number(args.show || 15)) console.log('  …')
  }
  list('Short words or short pieces (under ' + minWord + ' letters, or under 2 before / 3 after the break)', short)
  list('Broken names and titles (a capital in mid-sentence, outside a bold lead-in)', names)
  list('Breaks inside headings, labels and titles', heads)
  const wrong = report.overPage.filter(o => !o.right)
  console.log('')
  console.log('Words divided between two pages: ' + report.overPage.length + '; not at a hyphenation point: ' + wrong.length)
  wrong.forEach(o => console.log('  sheet ' + o.sheet + '  “…' + o.tail + '”'))

  if (args.json) {
    fs.writeFileSync(path.resolve(args.json), JSON.stringify({
      pages: report.pages, maxRun: maxRun, minWord: minWord, breaks: breaks, stacks: report.stacks, overPage: report.overPage
    }))
    console.log('')
    console.log('Every break written to ' + args.json)
  }
})().catch(function (error) {
  console.error(error)
  process.exit(2)
})
