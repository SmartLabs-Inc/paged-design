#!/usr/bin/env node
'use strict'
//
// Give every heading block the room its content needs.
//
// A section title, or the shaded box under one, must not sit at the foot of a
// page with its content overleaf. The theme can make a heading need room (see
// "A heading keeps its content" in the theme) but not say how much, because
// that depends on what follows it: another heading block, an entry's opening
// box that cannot break, a table, or a paragraph that may leave three lines.
//
// So the book is laid out once and each heading is given the height of what
// follows it, down to the first thing that puts real content on the page.
// The figure is written on the block as --keep. It comes from the heights of
// elements, not from where the page breaks happen to fall, so it does not go
// stale when the pagination moves, and nothing here needs running twice.
//
// Usage: node keep-headings.js --content <dir> [--out <dir>] [--report <file>]
//        node keep-headings.js --content <dir> --apply-from <file>

const fs = require('fs')
const path = require('path')
const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)
if (args.help || !args.content) {
  console.log([
    'Usage: node keep-headings.js --content <dir> [--out <dir>] [--report <file>]',
    '       node keep-headings.js --content <dir> --apply-from <file>',
    '',
    '  --content <dir>      Book directory holding index.html.',
    '  --out <dir>          Write here instead of in place.',
    '  --report <file>      Save the measured figures as JSON.',
    '  --apply-from <file>  Apply figures measured earlier, without measuring.',
    '',
    'Writes on each heading block the room its following content needs.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const contentDir = path.resolve(args.content)
const outDir = path.resolve(args.out || args.content)
const scratch = path.join(root, 'content', 'scratch-keep')
const HEAD = /<div class="(keep-lead[^"]*)"(?: style="--keep: \d+px")?>/g

function apply (source, keeps) {
  let i = 0, set = 0
  const out = source.replace(HEAD, function (whole, cls) {
    const k = keeps[i]; i += 1
    if (!k) return '<div class="' + cls + '">'
    set += 1
    return '<div class="' + cls + '" style="--keep: ' + k + 'px">'
  })
  return { html: out, blocks: i, set: set }
}

;(async function () {
  const source = fs.readFileSync(path.join(contentDir, 'index.html'), 'utf8')
  let keeps

  if (args['apply-from']) {
    keeps = JSON.parse(fs.readFileSync(path.resolve(args['apply-from']), 'utf8')).keeps
  } else {
    // A copy with every block numbered in order, and every heading block
    // numbered among the headings, so what follows a heading can be found
    // after Paged.js has dealt the book out into pages.
    let seq = 0, head = 0
    let stamped = source.replace(HEAD, function (whole, cls) { head += 1; return '<div class="' + cls + '" data-keep="' + head + '">' })
    stamped = stamped.replace(/<(div|p|table|ol|ul|li|dl|dd|blockquote|h[1-6])(?=[\s>])/g, function (whole, tag) { seq += 1; return '<' + tag + ' data-seq="' + seq + '"' })
    fs.mkdirSync(scratch, { recursive: true })
    fs.writeFileSync(path.join(scratch, 'index.html'), stamped)

    const { chromium } = requirePlaywright()
    const server = await serveDirectory(root)
    const browser = await launchChromium(chromium)
    const page = await browser.newPage()
    await watchForPagedJs(page)
    await blockRemoteResources(page, server.url)
    console.log('Laying out a numbered copy with ' + head + ' heading blocks …')
    await page.goto(server.url + '/content/scratch-keep/index.html?theme=' + theme, { waitUntil: 'load' })
    await waitForPagedJs(page, Number(args.timeout || 1800000))

    keeps = await page.evaluate(function (count) {
      const LINE = 17, CAP = 300
      const first = function (n) { return document.querySelector('.pagedjs_page [data-seq="' + n + '"]:not([data-split-from])') }
      const px = function (v) { return parseFloat(v) || 0 }
      const out = []
      for (let i = 1; i <= count; i += 1) {
        const H = document.querySelector('.pagedjs_page [data-keep="' + i + '"]:not([data-split-from])')
        if (!H) { out.push(0); continue }
        let next = Number(H.getAttribute('data-seq')) + H.querySelectorAll('[data-seq]').length + 1
        let need = 0, found = false
        for (let guard = 0; guard < 60; guard += 1) {
          const E = first(next)
          if (!E) break
          const cs = window.getComputedStyle(E), r = E.getBoundingClientRect()
          const inside = E.querySelectorAll('[data-seq]').length
          if (r.height < 1 || cs.display === 'none') { next += inside + 1; continue }
          // Another heading block: it goes with this one, and so does
          // whatever it in turn is waiting for.
          if (E.classList.contains('keep-lead')) {
            need += r.height + px(cs.marginTop) + Math.max(0, px(cs.marginBottom)); next += inside + 1; continue
          }
          // The first page of a part: nothing shares a page with it.
          if (E.classList.contains('part-opener')) break
          if (cs.breakInside === 'avoid' || E.tagName === 'TABLE' || E.matches('.figure, .table-figure, .entry-lead, .keep-label')) {
            need += Math.min(CAP, r.height + px(cs.marginTop)); found = true; break
          }
          if (E.matches('p, li, dd, h1, h2, h3, h4, h5, h6')) {
            const lines = E.hasAttribute('data-split-to') ? 3 : Math.min(3, Math.max(1, Math.round(r.height / LINE)))
            need += lines * LINE + px(cs.marginTop); found = true; break
          }
          next += 1                                 // a wrapper: look inside it
        }
        out.push(found ? Math.min(420, Math.ceil(need + 6)) : 0)
      }
      return out
    }, head)
    await browser.close()
    await server.close()
    fs.rmSync(scratch, { recursive: true, force: true })
    if (args.report) fs.writeFileSync(path.resolve(args.report), JSON.stringify({ keeps: keeps }))
  }

  const done = apply(source, keeps)
  if (done.blocks !== keeps.length) {
    console.error('The book has ' + done.blocks + ' heading blocks and the figures cover ' + keeps.length + '. Nothing written.')
    process.exit(1)
  }
  const sorted = keeps.filter(Boolean).sort(function (a, b) { return a - b })
  console.log(done.set + ' of ' + done.blocks + ' heading blocks given room: from ' + sorted[0] + 'px to ' +
    sorted[sorted.length - 1] + 'px, typically ' + sorted[Math.floor(sorted.length / 2)] + 'px')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), done.html)
  console.log('Wrote ' + path.join(outDir, 'index.html'))
})().catch(function (e) { console.error(e); process.exit(1) })
