#!/usr/bin/env node
//
// Act on what report-hyphenation.js found: stop particular words breaking.
//
// The book's hyphenation is soft hyphens in its source, put there once by
// hyphenate.js. A word with none cannot break. So the cure for a stack of
// hyphenated lines is to take the soft hyphens out of one word in it, and the
// cure for a broken name is to take them out of the name. No letter of the
// text is touched, and nothing is added: this only ever deletes U+00AD.
//
// What it will do, each on request:
//
//   --stacks   in every run of more than the allowed number of hyphenated
//              lines, the word that makes the run too long (the third, the
//              sixth …) is made unbreakable
//   --names    every broken name or title is made unbreakable
//   --short    every broken word that is too short, or leaves too little on
//              a line, is made unbreakable
//
// One pass does not finish the job. Taking a word off the end of a line
// re-sets the rest of its paragraph, and a new stack can form further down;
// so: report, fit, report again, until the count stops falling. Three passes
// took the textbook from several hundred stacks to none worth the name.
//
// Finding the word. The report was made from the paginated book, the change
// is made in the file, and Paged.js's own numbering of blocks does not exist
// in the file. Each break is therefore found by its text: the word with the
// thirty characters either side of it, soft hyphens and all, which is exact
// enough to be unique almost everywhere. Where it is not — boilerplate that
// recurs word for word — the opening of the block is used to choose, and if
// that does not settle it the break is left alone and counted.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)
const SOFT = '­'

if (args.help || !args.content || (!args.report && !args['all-names'])) {
  console.log([
    'Usage: node fit-hyphenation.js --content <dir> --report <json> [--stacks] [--names] [--short] [--also <dir>] [--dry]',
    '',
    '  --content <dir>  Book directory holding index.html. MODIFIED in place.',
    '  --report <json>  Written by report-hyphenation.js --json, from this book.',
    '  --stacks         Break up runs of hyphenated lines.',
    '  --names          Make broken names and titles unbreakable.',
    '  --short          Make short broken words unbreakable.',
    '  --all-names      No report needed: make every name and title in the',
    '                   running text unbreakable, broken at present or not.',
    '  --also <dir>     A second copy of the book to change the same way.',
    '  --log <file>     Append the words changed, one per line.',
    '  --dry            Say what would change and write nothing.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

// --- Every name, whether or not it is broken today --------------------------
//
// --names cures the names that are broken in the build that was measured.
// Any later change to a paragraph — a tracking, a correction — can break a
// different one. The rule is that a name never breaks, so this takes the soft
// hyphens out of all of them once, in the file, by the same test the report
// uses: a word with a capital that follows a letter, a figure, a comma, a
// semicolon or a closing bracket or quote, outside a bold lead-in and outside
// a heading. A capital after a full stop or a colon is the start of a
// sentence and is left to break like any other word.
function allNames (file) {
  const html = fs.readFileSync(file, 'utf8')
  const out = []
  let i = Math.max(0, html.indexOf('<body'))
  out.push(html.slice(0, i))
  let bold = 0
  let quiet = 0          // inside a heading, a script, a style
  let previous = ''      // the last character of running text that is not a space
  let spaced = false     // white space since then
  let words = 0
  let removed = 0
  const BLOCK = /^(p|li|td|th|dd|dt|div|h[1-6]|figcaption|caption|ul|ol|table|tr|section|blockquote)$/
  const letter = /[A-Za-z\u00C0-\u024F]/
  while (i < html.length) {
    if (html[i] === '<' && /[A-Za-z\/!]/.test(html[i + 1] || '')) {
      const end = html.indexOf('>', i)
      const tag = html.slice(i, end + 1)
      const m = /^<(\/?)([A-Za-z][A-Za-z0-9]*)/.exec(tag)
      if (m) {
        const name = m[2].toLowerCase()
        const closing = m[1] === '/'
        if (name === 'strong' || name === 'b') bold += closing ? -1 : 1
        if (/^(h[1-6]|script|style|svg)$/.test(name)) quiet += closing ? -1 : 1
        if (BLOCK.test(name)) { previous = ''; spaced = false }
      }
      out.push(tag)
      i = end + 1
      continue
    }
    if (letter.test(html[i]) && !quiet) {
      let j = i
      while (j < html.length && (letter.test(html[j]) || html[j] === SOFT)) j += 1
      let word = html.slice(i, j)
      const name = /^[A-Z\u00C0-\u00DE]/.test(word) && spaced && /[A-Za-z0-9,;)\u2019\u201D]/.test(previous) && bold <= 0
      if (name && word.indexOf(SOFT) >= 0) {
        removed += word.split(SOFT).length - 1
        word = word.split(SOFT).join('')
        words += 1
      }
      out.push(word)
      previous = word[word.length - 1]
      spaced = false
      i = j
      continue
    }
    if (/\s/.test(html[i])) spaced = true
    else if (html[i] !== SOFT) { previous = html[i]; spaced = false }
    out.push(html[i])
    i += 1
  }
  if (!args.dry && removed) fs.writeFileSync(file, out.join(''))
  return { words, removed }
}

if (args['all-names']) {
  [args.content].concat(args.also ? [args.also] : []).forEach(dir => {
    const file = path.join(path.resolve(dir), 'index.html')
    const result = allNames(file)
    console.log(path.relative(process.cwd(), file) + ': ' + result.words + ' names and titles made unbreakable; ' +
      result.removed + ' soft hyphens removed' + (args.dry ? ' — dry run, nothing written' : ''))
  })
  if (!args.report) process.exit(0)
}

const report = JSON.parse(fs.readFileSync(path.resolve(args.report), 'utf8'))
const breaks = report.breaks

// Which breaks to remove.
const chosen = new Map()
const choose = (index, why) => { if (!chosen.has(index)) chosen.set(index, why) }
if (args.stacks) {
  report.stacks.forEach(run => {
    for (let k = report.maxRun; k < run.length; k += report.maxRun + 1) choose(run[k], 'stack')
  })
}
breaks.forEach((b, index) => {
  if (args.names && !b.head && /^[A-Z]/.test(b.plain) && b.mid && !b.bold) choose(index, 'name')
  if (args.short && !b.head && (b.plain.length < report.minWord || b.left < 2 || b.right < 3)) choose(index, 'short')
})

// The file as running text, with the place in the file of every character.
function textOf (html) {
  const chars = []
  const at = []
  const bodyStart = Math.max(0, html.indexOf('<body'))
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: SOFT }
  let i = bodyStart
  const skipTo = (close) => { const end = html.indexOf(close, i); i = end < 0 ? html.length : end + close.length }
  while (i < html.length) {
    const ch = html[i]
    // A "<" opens a tag only before a letter, "/" or "!". The text has
    // "(p<0.001)" in it, unescaped, and a browser reads that as text.
    if (ch === '<' && /[A-Za-z\/!]/.test(html[i + 1] || '')) {
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

const squash = s => s.replace(/\s+/g, ' ')

function fit (file) {
  let html = fs.readFileSync(file, 'utf8')
  const { text, at } = textOf(html)
  const cuts = []            // places in the file of soft hyphens to delete
  const done = []
  let missing = 0
  let unsure = 0
  chosen.forEach((why, index) => {
    const b = breaks[index]
    const hits = []
    let from = text.indexOf(b.context)
    while (from >= 0) { hits.push(from); from = text.indexOf(b.context, from + 1) }
    let hit = hits[0]
    if (!hits.length) { missing += 1; return }
    if (hits.length > 1) {
      // The same words more than once. The one whose block opens the same way
      // and has the word the same distance in.
      const fits = hits.filter(h => {
        const blockStart = h + b.contextAt - b.start
        if (blockStart < 0 || !b.lead) return false
        return squash(text.slice(blockStart, blockStart + b.lead.length)) === squash(b.lead)
      })
      if (fits.length !== 1) { unsure += 1; return }
      hit = fits[0]
    }
    const wordStart = hit + b.contextAt
    const wordEnd = wordStart + b.word.length   // word, as reported, shows each soft hyphen as "-": same length
    let removed = 0
    for (let k = wordStart; k < wordEnd; k += 1) {
      if (text[k] === SOFT && html[at[k]] === SOFT) { cuts.push(at[k]); removed += 1 }
    }
    if (removed) done.push({ why, word: b.plain, sheet: b.sheet })
  })
  const unique = Array.from(new Set(cuts)).sort((x, y) => y - x)
  unique.forEach(position => { html = html.slice(0, position) + html.slice(position + 1) })
  if (!args.dry && unique.length) fs.writeFileSync(file, html)
  return { done, missing, unsure, removed: unique.length }
}

const files = [args.content].concat(args.also ? [args.also] : []).map(dir => path.join(path.resolve(dir), 'index.html'))
files.forEach((file, n) => {
  const result = fit(file)
  const by = {}
  result.done.forEach(d => { by[d.why] = (by[d.why] || 0) + 1 })
  console.log(path.relative(process.cwd(), file))
  console.log('  ' + chosen.size + ' breaks chosen; ' + result.done.length + ' words made unbreakable (' +
    Object.keys(by).map(k => by[k] + ' ' + k).join(', ') + '); ' + result.removed + ' soft hyphens removed' +
    (args.dry ? ' — dry run, nothing written' : ''))
  if (result.missing) console.log('  ' + result.missing + ' not found in this file (already changed, or the report is from another build)')
  if (result.unsure) console.log('  ' + result.unsure + ' left alone: the same words occur more than once and the block could not be told apart')
  if (n === 0 && args.log && !args.dry) {
    fs.appendFileSync(path.resolve(args.log), result.done.map(d => d.why + '\t' + d.sheet + '\t' + d.word).join('\n') + '\n')
  }
})
