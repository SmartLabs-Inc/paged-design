#!/usr/bin/env node
//
// Put the hyphens in, because the browser will not.
//
// `hyphens: auto` does nothing in this Chromium. The hyphenation dictionary is
// a separate component that a bare build does not carry, so the property is
// accepted, computes to `auto`, and has no effect — measured: the same
// paragraph at the same width is exactly as tall with `hyphens: auto` as with
// `hyphens: none`.
//
// That is invisible in a log and almost invisible on a wide measure. On this
// book it is not: two columns of 63mm, justified, with no hyphenation, and
// every third line opens word gaps you could read a sentence through.
//
// So the hyphens are put into the text as soft hyphens, from Liang's patterns,
// before the book is paginated. They are inert characters until a line needs
// one, they travel into the EPUB, and they do not depend on what the renderer
// happens to have installed.
//
//   node hyphenate.js --content content/my-book
//
// What is left alone, and why:
//
//   * headings and display lines — a broken word in a heading is a mistake,
//     and these are set ragged anyway;
//   * anything inside an <a>, which is usually a URL here, and a soft hyphen
//     in a URL is indistinguishable from a real one;
//   * the reference entries, set ragged with `hyphens: none`, where a soft
//     hyphen would never be used;
//   * the invisible marker paragraphs that carry the running heads;
//   * anything with a digit in it — doses, identifiers, gene names.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')
const { hyphenateSync } = require('hyphen/en-us')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node hyphenate.js --content <dir> [--min <n>]',
    '',
    '  --content <dir>  Book directory holding index.html, rewritten in place.',
    '  --min <n>        Shortest word to hyphenate. Default: 7.',
    '',
    'Inserts soft hyphens into the running text, leaving headings, links,',
    'reference entries and anything containing a digit alone.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const SOFT = '­'
const minimum = Number(args.min) || 7
const indexFile = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

if (html.indexOf(SOFT) !== -1) {
  console.log('Already hyphenated — nothing to do.')
  process.exit(0)
}

// Elements whose text is never broken.
const CLOSED = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'code', 'pre', 'title', 'script', 'style']
const CLOSED_CLASSES = /\b(?:reference|run-head|topic-head|flag-code|label|chapter-eyebrow|part-title|part-name|index-letter|standfirst)\b/

let hyphenated = 0

function breakWords (text) {
  return text.replace(/[A-Za-z\u00c0-\u024f]{2,}/g, function (word, at, whole) {
    if (word.length < minimum) return word

    // `&hellip;` is not a word, and a soft hyphen inside a character
    // reference stops it being one.
    if (whole[at - 1] === '&' && whole[at + word.length] === ';') return word

    const marked = hyphenateSync(word)
    if (marked === word) return word

    // Liang's patterns will break ev-i-dence after two letters. A break that
    // leaves fewer than three characters on either side is one no compositor
    // would set, so it is dropped.
    const pieces = marked.split(SOFT)
    let rebuilt = pieces[0]
    for (let i = 1; i < pieces.length; i += 1) {
      const after = pieces.slice(i).join('')
      if (rebuilt.length >= 3 && after.length >= 3) rebuilt += SOFT
      rebuilt += pieces[i]
    }
    if (rebuilt.indexOf(SOFT) === -1) return word
    hyphenated += 1
    return rebuilt
  })
}

// A tag-aware walk. Anything between a closed element's tags is passed
// through untouched, including the tags of whatever is nested inside it.
const out = []
let index = 0
let depth = 0
let closedAt = null

while (index < html.length) {
  const next = html.indexOf('<', index)
  if (next === -1) {
    out.push(closedAt === null ? breakWords(html.slice(index)) : html.slice(index))
    break
  }

  const text = html.slice(index, next)
  out.push(closedAt === null ? breakWords(text) : text)

  const end = html.indexOf('>', next)
  if (end === -1) { out.push(html.slice(next)); break }

  const tag = html.slice(next, end + 1)
  out.push(tag)
  index = end + 1

  const parsed = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)
  if (!parsed) continue
  const name = parsed[2].toLowerCase()
  const closing = parsed[1] === '/'
  const selfClosing = /\/>$/.test(tag) || ['br', 'img', 'hr', 'meta', 'link', 'input'].indexOf(name) !== -1
  if (selfClosing) continue

  if (!closing) {
    depth += 1
    if (closedAt === null &&
        (CLOSED.indexOf(name) !== -1 || CLOSED_CLASSES.test((/class="([^"]*)"/.exec(tag) || [''])[1] || ''))) {
      closedAt = depth
    }
  } else {
    if (closedAt !== null && depth === closedAt) closedAt = null
    depth -= 1
  }
}

html = out.join('')
fs.writeFileSync(indexFile, html)

console.log('Hyphenated ' + path.relative(process.cwd(), indexFile))
console.log('  words given break points: ' + hyphenated)
console.log('  soft hyphens inserted: ' + (html.split(SOFT).length - 1))
