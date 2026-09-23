#!/usr/bin/env node
//
// Repair the blank page — and the duplicated text either side of it — that
// Paged.js leaves when a full-width element will not fit.
//
// The fault looks like a stray blank page and is reported as one. It is worse
// than that. A `column-span: all` box that also carries `break-inside: avoid`
// cannot be split and cannot be set in a column, so when it arrives partway
// down a page with too little room left, Paged.js starts the page again on a
// new sheet — but it does not take back what it has already laid out. The
// result is three pages: the original with its trailing content, an empty one,
// and a third that repeats that trailing content word for word.
//
// In the AET proof this happened three times in 713 pages, and each time the
// reader saw an entry heading and its opening paragraph twice:
//
//   p80  ...34 Klotho 1 Peptide (KP1) / KP1 is a 30-residue fragment...
//   p81  (empty)
//   p82  34 Klotho 1 Peptide (KP1) / KP1 is a 30-residue fragment...  Table 3
//
// Page 82's spanner is the cause every time: Table 3 there, Figure 2 at p335,
// Figure 6 at p571.
//
// The fix is to stop the spanner being pushed at all. `break-before: page` is
// one of the handful of values Paged.js re-implements rather than drops (see
// the note on `.push-column` in the theme), so the `.push-page` class makes
// the spanner start its own page, the text before it stays put, and there is
// nothing to re-lay-out. It costs no pages: the blank sheet it replaces was
// already being spent.
//
// Only the spanners that actually fault are marked. Putting `break-before:
// page` on all thirty-nine of them would open a new page for every table and
// figure in the book and waste most of a signature.
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
    'Usage: node fix-spanner-blanks.js --content <dir> [--theme <name>] [--rounds <n>]',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '  --theme <name>    Theme to paginate with. Default: aalai-textbook.',
    '  --rounds <n>      Pagination passes to attempt. Default 4.',
    '  --timeout <ms>    Pagination timeout. Default 3600000.',
    '',
    'Finds the blank pages Paged.js leaves when a full-width table or figure',
    'will not fit, and starts that spanner on its own page instead.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const rounds = Number(args.rounds || 4)
const indexFile = path.join(path.resolve(args.content), 'index.html')

// Number every element that could span the columns, so one found on a
// paginated page can be traced back to the source. Paged.js copies the
// attribute onto the fragment along with the classes.
const SPANNERS = /<div\b([^>]*\bclass="[^"]*\b(?:table-figure|figure)\b[^"]*"[^>]*)>/g

function markSpanners (html) {
  let counter = 0
  return html.replace(SPANNERS, function (all, attrs) {
    if (/\bdata-span=/.test(attrs)) return all
    counter += 1
    return '<div' + attrs + ' data-span="' + counter + '">'
  })
}

function unmarkSpanners (html) {
  return html.replace(/\s*data-span="\d+"/g, '')
}

function setPush (html, mark, on) {
  const pattern = new RegExp('<div([^>]*\\bdata-span="' + mark + '"[^>]*)>')
  return html.replace(pattern, function (all, attrs) {
    const cleaned = attrs.replace(/\s*\bpush-page\b/g, '')
    if (!on) return '<div' + cleaned + '>'
    return '<div' + cleaned.replace(/class="/, 'class="push-page ') + '>'
  })
}

// A page is blank when its content area holds no text and nothing drawn. The
// versos Paged.js inserts on purpose carry `pagedjs_blank_page` and print the
// "intentionally blank" notice, so they are excluded by class rather than by
// guessing from the text.
//
// The spanner to blame is the first one on the page *after* the blank — that
// is the box that would not fit, and everything above it on that page is the
// duplicate.
function findBlanks () {
  const pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
  const out = []

  function isEmpty (page) {
    if (page.classList.contains('pagedjs_blank_page')) return false
    const area = page.querySelector('.pagedjs_page_content')
    if (!area) return false
    if ((area.textContent || '').trim().length) return false
    return !area.querySelector('img, svg, canvas, table')
  }

  pages.forEach(function (page, index) {
    if (!isEmpty(page)) return
    const next = pages[index + 1]
    let mark = null
    let what = null
    if (next) {
      const area = next.querySelector('.pagedjs_page_content')
      const all = area ? area.querySelectorAll('[data-span]') : []
      for (let i = 0; i < all.length; i += 1) {
        if (window.getComputedStyle(all[i]).columnSpan !== 'all') continue
        mark = all[i].getAttribute('data-span')
        what = (all[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)
        break
      }
    }
    out.push({ page: index + 1, mark: mark, what: what })
  })
  return out
}

;(async function () {
  let html = fs.readFileSync(indexFile, 'utf8')
  const hadMarks = /\bdata-span="/.test(html)
  if (!hadMarks) html = markSpanners(html)
  fs.writeFileSync(indexFile, html)

  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const url = server.url + '/' +
    path.relative(root, path.resolve(args.content)).split(path.sep).join('/') +
    '/index.html?theme=' + theme

  async function paginate () {
    const page = await browser.newPage()
    await watchForPagedJs(page)
    await blockRemoteResources(page, server.url)
    await page.goto(url, { waitUntil: 'load' })
    await waitForPagedJs(page, Number(args.timeout || 3600000))
    const blanks = await page.evaluate(findBlanks)
    const pages = await page.evaluate(function () {
      return document.querySelectorAll('.pagedjs_page').length
    })
    await page.close()
    return { blanks: blanks, pages: pages }
  }

  console.log('Paginating ' + url + ' …')
  let state = await paginate()
  console.log('Pass 0: ' + state.blanks.length + ' blank page(s) in ' + state.pages)
  state.blanks.forEach(function (b) {
    console.log('  p' + b.page + (b.mark
      ? ' ← spanner ' + b.mark + ' "' + b.what + '"'
      : ' — no spanner after it; left alone'))
  })

  const pushed = []
  const giveUp = {}
  for (let round = 1; round <= rounds; round += 1) {
    const target = state.blanks.find(function (b) {
      return b.mark && !giveUp[b.mark]
    })
    if (!target) break

    const before = state.blanks.length
    html = setPush(html, target.mark, true)
    fs.writeFileSync(indexFile, html)
    const after = await paginate()

    // Fewer blanks overall is not the test — a blank moved somewhere else
    // leaves the count alone. The test is that this spanner stopped causing
    // one and nothing new was bought with it.
    const stillFaulting = after.blanks.some(function (b) { return b.mark === target.mark })
    if (!stillFaulting && after.blanks.length < before) {
      pushed.push(target)
      state = after
      console.log('Pass ' + round + ': spanner ' + target.mark + ' "' + target.what +
        '" set on its own page — ' + before + ' → ' + after.blanks.length +
        ' blank(s), ' + after.pages + ' pages')
    } else {
      giveUp[target.mark] = true
      html = setPush(html, target.mark, false)
      fs.writeFileSync(indexFile, html)
      console.log('Pass ' + round + ': pushing spanner ' + target.mark +
        ' did not clear p' + target.page + ' — taken back off')
    }
  }

  if (!hadMarks) {
    html = unmarkSpanners(html)
    fs.writeFileSync(indexFile, html)
  }

  await browser.close()
  server.close()

  console.log('\n' + pushed.length + ' spanner(s) given their own page · ' +
    state.blanks.length + ' blank page(s) left in ' + state.pages)
  state.blanks.forEach(function (b) {
    console.log('  still blank: p' + b.page)
  })
})()
