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
// The fix is to give the spanner room, so it is never pushed. What it may NOT
// be is marked `break-before: page` itself. That does not push a
// `column-span: all` element — it stalls pagination outright: the spanner is
// moved to a fresh page, meets the same rule there, and is moved again, for
// ever. Paged.js does not error, it writes a short book. Marking these same
// three figures and tables took 713 pages down to 82, twice, and the theme's
// note saying a spanner which always starts a page "is never pushed and never
// trips the loop" is simply wrong.
//
// So the mark goes on an ordinary in-column block, where `break-before: page`
// behaves. That block starts a fresh page, the spanner below it finds the room
// it could not find before, and there is nothing to re-lay-out. It costs no
// pages: the blank sheet it replaces was already being spent.
//
// Which block matters. The first version marked the entry that owns the
// spanner — the first block of the duplicated run — and that works, but it
// moves everything between the entry name and the table. Page 80 came out
// ending halfway down both columns, because entry 34's name and its whole
// opening paragraph went to the next page when only Table 3 needed to. The
// mark belongs on the LAST in-column block before the spanner instead: the
// least text that still gives the spanner a page with room in it.
//
// That is also why paragraphs are numbered here and not only the boxes. With
// only the boxes marked, the nearest thing above a table was the entry lead,
// which is exactly the too-early cut.
//
// Only the spanners that actually fault are marked.
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
const SPANNERS = /<div\b([^>]*\bclass="[^"]*\b(?:table-figure|figure|entry-lead|keep-lead)\b[^"]*"[^>]*)>/g
const PARA = /<(p|li)\b([^>]*)>/g

function markSpanners (html) {
  let counter = 0
  html = html.replace(SPANNERS, function (all, attrs) {
    if (/\bdata-span=/.test(attrs)) return all
    counter += 1
    return '<div' + attrs + ' data-span="' + counter + '">'
  })
  return html.replace(PARA, function (all, name, attrs) {
    if (/\bdata-span=/.test(attrs)) return all
    counter += 1
    return '<' + name + attrs + ' data-span="' + counter + '">'
  })
}

function unmarkSpanners (html) {
  return html.replace(/\s*data-span="\d+"/g, '')
}

function setPush (html, mark, on) {
  const pattern = new RegExp('<(div|p|li)([^>]*\\bdata-span="' + mark + '"[^>]*)>')
  return html.replace(pattern, function (all, name, attrs) {
    const cleaned = attrs.replace(/\s*\bpush-page\b/g, '')
    if (!on) return '<' + name + cleaned.replace(/\s*class="\s*"/, '') + '>'
    if (/\bclass="/.test(cleaned)) {
      return '<' + name + cleaned.replace(/class="/, 'class="push-page ') + '>'
    }
    return '<' + name + cleaned + ' class="push-page">'
  })
}

// A page is blank when its content area holds no text and nothing drawn. The
// versos Paged.js inserts on purpose carry `pagedjs_blank_page` and print the
// "intentionally blank" notice, so they are excluded by class rather than by
// guessing from the text.
//
// The spanner to blame is the first one on the page *after* the blank — that
// is the box that would not fit. Everything above it on that page is the
// duplicate, and the first block of that duplicate is what gets the mark.
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
      // The first spanner on the page is the cause. The block to mark is the
      // LAST one in a column above it — the least text that still hands the
      // spanner a page with room. Marking the first one instead empties half
      // the page before it.
      for (let i = 0; i < all.length; i += 1) {
        const el = all[i]
        if (el.parentElement.closest('[data-span]')) continue
        const r = el.getBoundingClientRect()
        if (r.height < 2 || r.width < 1) continue
        if (window.getComputedStyle(el).columnSpan === 'all') break
        if (el.classList.contains('push-page')) continue
        mark = el.getAttribute('data-span')
        what = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)
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
