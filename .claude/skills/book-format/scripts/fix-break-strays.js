#!/usr/bin/env node
//
// Push the strays that are left at a page boundary.
//
// Three faults, all reported separately by the reader and all the same shape —
// something at a page seam that has been separated from what it belongs to.
// None of them can be fixed in CSS, because the lever CSS offers stops at the
// page break: Chromium honours `widows`, `orphans` and `break-after: avoid`
// inside a column set, but Paged.js fragments the node itself and starts a new
// page box, and none of those properties apply across that seam.
//
//   Stranded tail   — the last one or two lines of a paragraph at the top of a
//                     page. In two columns a two-line tail is balanced one
//                     line per column, so it reads as a single line stretched
//                     across the page before the title below it. p156, p278.
//
//   Stranded opener — a shaded section panel or an entry name as the last
//                     thing on a page, with the text it introduces overleaf.
//                     p161, p296. The box is unbreakable, so it is whole; it
//                     is simply in the wrong place.
//
// The only thing Paged.js does honour is `break-before: page`, which it
// re-implements rather than drops. So the repair is the same in both cases:
// mark the offending element `push-page` and let it start the next page with
// the material it belongs to. A tail moves whole and sets as a paragraph; a
// panel arrives at the head of a page with its text under it.
//
// Every fault found in a round is marked before the next pagination, rather
// than one per round. Pushing one element moves everything after it, so a
// round can create new strays further on, and the loop is what catches those.
// A mark that leaves its own fault in place is taken back off.
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
    'Usage: node fix-break-strays.js --content <dir> [--theme <name>] [--rounds <n>]',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '  --theme <name>    Theme to paginate with. Default: aalai-textbook.',
    '  --rounds <n>      Pagination rounds. Default 4.',
    '  --tail <n>        Lines at or below which a tail counts as stray. Default 2.',
    '  --timeout <ms>    Pagination timeout. Default 3600000.',
    '',
    'Finds paragraph tails stranded at the top of a page and opener boxes',
    'stranded at the foot of one, and gives each its own page break.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const rounds = Number(args.rounds || 4)
const tailLines = Number(args.tail || 2)
const indexFile = path.join(path.resolve(args.content), 'index.html')

// Number everything that can be a stray, so a fragment on a page can be traced
// back to the element it came from. Paged.js copies attributes onto fragments.
const OPENER = /<div\b([^>]*\bclass="[^"]*\b(?:entry-lead|keep-lead|section-group|keep-label)\b[^"]*"[^>]*)>/g
const PARA = /<(p|li)\b([^>]*)>/g

function mark (html) {
  let n = 0
  html = html.replace(OPENER, function (all, attrs) {
    if (/\bdata-stray=/.test(attrs)) return all
    n += 1
    return '<div' + attrs + ' data-stray="' + n + '">'
  })
  html = html.replace(PARA, function (all, name, attrs) {
    if (/\bdata-stray=/.test(attrs)) return all
    n += 1
    return '<' + name + attrs + ' data-stray="' + n + '">'
  })
  return html
}

function unmark (html) {
  return html.replace(/\s*data-stray="\d+"/g, '')
}

function setPush (html, id, on) {
  const pattern = new RegExp('<(div|p|li)([^>]*\\bdata-stray="' + id + '"[^>]*)>')
  return html.replace(pattern, function (all, name, attrs) {
    const cleaned = attrs.replace(/\s*\bpush-page\b/g, '')
    if (!on) return '<' + name + cleaned.replace(/\s*class="\s*"/, '') + '>'
    if (/\bclass="/.test(cleaned)) {
      return '<' + name + cleaned.replace(/class="/, 'class="push-page ') + '>'
    }
    return '<' + name + cleaned + ' class="push-page">'
  })
}

function findStrays (tailLines) {
  const out = []

  // One rect per inline box, not per line — so count distinct row tops. In two
  // columns the two halves of a line sit at the same top, which is what makes
  // a two-line tail balanced one-per-column count as two and not as one.
  function lineCount (el) {
    const range = document.createRange()
    range.selectNodeContents(el)
    const tops = {}
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i += 1) {
      if (rects[i].height < 2 || rects[i].width < 1) continue
      tops[Math.round(rects[i].top)] = true
    }
    return Object.keys(tops).length
  }

  function drawn (el) {
    const r = el.getBoundingClientRect()
    return r.height > 1 && r.width > 1
  }

  document.querySelectorAll('.pagedjs_page').forEach(function (page, index) {
    const area = page.querySelector('.pagedjs_page_content')
    if (!area) return
    const blocks = Array.prototype.slice.call(area.querySelectorAll('[data-stray]'))
      .filter(function (el) {
        // Only the outermost marked element — a paragraph inside a marked
        // opener box is not itself a stray.
        return !el.parentElement.closest('[data-stray]') && drawn(el)
      })
    if (!blocks.length) return

    const first = blocks[0]
    const last = blocks[blocks.length - 1]

    // A tail: the page opens with the back half of something split, and that
    // half is one or two lines.
    if (first.hasAttribute('data-split-from') && lineCount(first) <= tailLines &&
        !first.classList.contains('push-page')) {
      out.push({
        kind: 'tail',
        id: first.getAttribute('data-stray'),
        page: index + 1,
        text: (first.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 55)
      })
    }

    // An opener: the page ends on a box that exists to introduce what comes
    // after it, and nothing after it is on this page. A box that was split is
    // not this fault — it is a box too tall for the space, and pushing it
    // would only move the split.
    if (last !== first &&
        /\b(entry-lead|keep-lead|section-group)\b/.test(last.className) &&
        !last.hasAttribute('data-split-from') && !last.hasAttribute('data-split-to') &&
        !last.classList.contains('push-page')) {
      out.push({
        kind: 'opener',
        id: last.getAttribute('data-stray'),
        page: index + 1,
        text: (last.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 55)
      })
    }
  })
  return out
}

;(async function () {
  let html = fs.readFileSync(indexFile, 'utf8')
  const hadMarks = /\bdata-stray="/.test(html)
  if (!hadMarks) html = mark(html)
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
    const strays = await page.evaluate(findStrays, tailLines)
    const pages = await page.evaluate(function () {
      return document.querySelectorAll('.pagedjs_page').length
    })
    await page.close()
    return { strays: strays, pages: pages }
  }

  console.log('Paginating ' + url + ' …')
  let state = await paginate()
  const report = function (s) {
    const byKind = {}
    s.strays.forEach(function (f) { byKind[f.kind] = (byKind[f.kind] || 0) + 1 })
    return (byKind.tail || 0) + ' stranded tail(s), ' +
      (byKind.opener || 0) + ' stranded opener(s) in ' + s.pages + ' pages'
  }
  console.log('Round 0: ' + report(state))
  state.strays.forEach(function (f) {
    console.log('  ' + f.kind + ' p' + f.page + '  ' + f.text)
  })

  const given = {}
  for (let round = 1; round <= rounds; round += 1) {
    const targets = state.strays.filter(function (f) { return !given[f.id] })
    if (!targets.length) break

    targets.forEach(function (f) {
      given[f.id] = f
      html = setPush(html, f.id, true)
    })
    fs.writeFileSync(indexFile, html)
    const after = await paginate()

    // Any target whose own fault survived the push is not helped by it, so the
    // mark comes back off rather than being left to cost a page for nothing.
    const survived = targets.filter(function (t) {
      return after.strays.some(function (f) { return f.id === t.id })
    })
    survived.forEach(function (t) { html = setPush(html, t.id, false) })
    if (survived.length) fs.writeFileSync(indexFile, html)

    state = survived.length ? await paginate() : after
    console.log('Round ' + round + ': pushed ' + (targets.length - survived.length) +
      ' of ' + targets.length + ' · ' + report(state))
  }

  if (!hadMarks) {
    html = unmark(html)
    fs.writeFileSync(indexFile, html)
  }

  await browser.close()
  server.close()

  console.log('\nLeft: ' + report(state))
  state.strays.forEach(function (f) {
    console.log('  still ' + f.kind + ' p' + f.page + '  ' + f.text)
  })
})()
