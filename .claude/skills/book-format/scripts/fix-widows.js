#!/usr/bin/env node
//
// Remove the widows and orphans that CSS cannot.
//
// Chromium honours `widows` and `orphans` inside a column set, and the theme
// sets both — but Paged.js does not break pages the way the engine does. It
// splits the node itself and starts a new page box, and the property never
// applies across that seam. So a paragraph can still leave one line at the top
// of a page, which is the fault the author sees first and the one the brief
// says never to allow.
//
// The only way to know where the lines fall is to paginate. So this does:
// paginate the real book, find every one-line fragment, mark the paragraph it
// belongs to so the whole thing moves to the next column or page, and
// paginate again to check it worked. A mark that does not help is taken back
// off, because pushing a paragraph that was not the problem just moves the
// hole somewhere else.
'use strict'

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node fix-widows.js --content <dir> [--theme <name>] [--rounds <n>]',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '  --theme <name>    Theme to paginate with. Default: beatrix.',
    '  --rounds <n>      Passes to attempt. Default 3.',
    '',
    'Paginates, finds one-line fragments left at a page or column break, and',
    'pushes the paragraph they belong to so the break falls somewhere else.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'beatrix'
const rounds = Number(args.rounds || 3)
const indexFile = path.join(path.resolve(args.content), 'index.html')

// Find the widows and orphans, and say which source paragraph each belongs to.
// The mark is an index into the document's paragraphs, because the paginated
// element is a copy and its position in the source is not otherwise knowable.
function findFaults () {
  const faults = []

  function lineCount (element) {
    const range = document.createRange()
    range.selectNodeContents(element)
    const tops = {}
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i += 1) {
      if (rects[i].height < 2 || rects[i].width < 1) continue
      tops[Math.round(rects[i].top)] = true
    }
    return Object.keys(tops).length
  }

  document.querySelectorAll('.pagedjs_page').forEach(function (page, pageIndex) {
    page.querySelectorAll('p[data-mark], li[data-mark]').forEach(function (block) {
      const from = block.hasAttribute('data-split-from')
      const to = block.hasAttribute('data-split-to')
      if (!from && !to) return
      if (lineCount(block) !== 1) return
      faults.push({
        mark: block.getAttribute('data-mark'),
        kind: from ? 'widow' : 'orphan',
        page: pageIndex + 1,
        text: (block.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      })
    })
  })
  return faults
}

// Number every paragraph in the source so a fragment on a page can be traced
// back to the element it came from.
function markParagraphs (html) {
  let counter = 0
  return html.replace(/<(p|li)\b([^>]*)>/g, function (all, name, attrs) {
    if (/\bdata-mark=/.test(attrs)) return all
    counter += 1
    return '<' + name + attrs + ' data-mark="' + counter + '">'
  })
}

function unmarkParagraphs (html) {
  return html.replace(/\s*data-mark="\d+"/g, '')
}

// Add or remove the push class on the paragraph carrying a given mark.
//
// It has to be `push-page`, not `push-column`. Paged.js re-implements
// `break-before` only for the page-level values — always, page, left, right,
// recto, verso — and drops everything else, so `break-before: column` has
// never done anything at all. Three rounds of pushing a widow with it moved
// nothing, which is what sent me to the polyfill source to check.
function setPush (html, mark, on) {
  const pattern = new RegExp('<(p|li)([^>]*\\bdata-mark="' + mark + '"[^>]*)>')
  return html.replace(pattern, function (all, name, attrs) {
    let cleaned = attrs.replace(/\s*\bpush-page\b/g, '')
    if (!on) {
      return '<' + name + cleaned.replace(/\s*class="\s*"/, '') + '>'
    }
    if (/\bclass="/.test(cleaned)) {
      return '<' + name + cleaned.replace(/class="/, 'class="push-page ') + '>'
    }
    return '<' + name + cleaned + ' class="push-page">'
  })
}

;(async function () {
  let html = fs.readFileSync(indexFile, 'utf8')
  const hadMarks = /\bdata-mark="/.test(html)
  if (!hadMarks) html = markParagraphs(html)
  fs.writeFileSync(indexFile, html)

  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const url = server.url + '/' + args.content.replace(/^\.\//, '').replace(/\/$/, '') +
    '/index.html?theme=' + theme

  async function paginate () {
    const page = await browser.newPage()
    // Paged.js waits for every stylesheet and font it is told about, so one
    // unreachable host hangs pagination for as long as the timeout allows —
    // silently, with no error and no partial result. render-pdf.js has always
    // blocked remote resources; this did not, and burned a thirty-minute
    // timeout mid-build to find out.
    await blockRemoteResources(page, server.url)
    await page.goto(url, { waitUntil: 'load' })
    await waitForPagedJs(page, Number(args.timeout || 300000))
    const faults = await page.evaluate(findFaults)
    const pages = await page.evaluate(function () {
      return document.querySelectorAll('.pagedjs_page').length
    })
    await page.close()
    return { faults: faults, pages: pages }
  }

  let state = await paginate()
  console.log('Pass 0: ' + state.faults.length + ' widows and orphans in ' + state.pages + ' pages')
  state.faults.forEach(function (f) {
    console.log('  ' + f.kind + ' p' + f.page + '  ' + f.text)
  })

  const pushed = []
  const giveUp = {}
  for (let round = 1; round <= rounds; round += 1) {
    const outstanding = state.faults.filter(function (f) { return !giveUp[f.mark] })
    if (!outstanding.length) break
    const before = state.faults.length
    const target = outstanding[0]

    // Pushing the paragraph itself is the obvious move, and it fails when the
    // paragraph is taller than a column: it splits again and leaves the same
    // single line. Then the thing to move is the paragraph above, which
    // changes where the column breaks without moving the offender at all.
    const candidates = [target.mark, String(Number(target.mark) - 1),
      String(Number(target.mark) - 2)]
    let fixed = false

    for (const mark of candidates) {
      if (Number(mark) < 1) continue
      html = setPush(html, mark, true)
      fs.writeFileSync(indexFile, html)
      const after = await paginate()
      // "Fewer faults overall" cannot tell a fix from a fault moved somewhere
      // else — both leave the count where it was. The test is whether this
      // fault is gone and no new one was bought with it.
      const stillThere = after.faults.some(function (f) { return f.mark === target.mark })
      if (!stillThere && after.faults.length <= before) {
        pushed.push({ mark: mark, text: target.text })
        state = after
        fixed = true
        console.log('Pass ' + round + ': moved "' + target.text.slice(0, 40) +
          '" by pushing paragraph ' + mark + ' — ' + before + ' → ' + after.faults.length)
        break
      }
      html = setPush(html, mark, false)
      fs.writeFileSync(indexFile, html)
    }

    if (!fixed) {
      giveUp[target.mark] = true
      console.log('Pass ' + round + ': nothing moved "' + target.text.slice(0, 40) +
        '" — leaving it')
    }
  }

  if (!hadMarks) {
    html = unmarkParagraphs(html)
    fs.writeFileSync(indexFile, html)
  }

  await browser.close()
  server.close()

  const remaining = state.faults
  console.log('\n' + pushed.length + ' paragraph(s) pushed · ' + remaining.length +
    ' widow' + (remaining.length === 1 ? '' : 's') + ' and orphans left')
  remaining.forEach(function (f) {
    console.log('  still ' + f.kind + ' p' + f.page + '  ' + f.text)
  })
})()
