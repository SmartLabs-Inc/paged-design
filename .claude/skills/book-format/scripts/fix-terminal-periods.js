#!/usr/bin/env node
'use strict'
//
// Put back the full stop at the end of a paragraph.
//
// In this book a sentence inside a paragraph ends properly — "…in that cell
// system.¹ The construct is…" — and the last sentence of the paragraph does
// not: "…retained cardiac function³", "…the combination's performance". It is
// the same in the oldest build input that survives, so it was lost at or
// before conversion, and it is lost only at the end of a block, which is the
// signature of something trimming a trailing character rather than of an
// author's habit. 2,852 of 3,493 body paragraphs.
//
// The stop goes where the book already puts it mid-paragraph: before a
// closing reference mark, not after it. A paragraph with no mark gets it at
// the end.
//
// What is left alone, because a full stop there would be a new error: labels
// and headings, the first half of a split lead line (it stops mid-sentence on
// purpose), table cells, and anything already ending in punctuation of its
// own. Report-only with --dry.
//
// Usage: node fix-terminal-periods.js --content <dir> [--out <dir>] [--dry]

const fs = require('fs')
const path = require('path')

const args = {}
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args[a.slice(2)] = (all[i + 1] || '').startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]
})
if (args.help || !args.content) {
  console.log([
    'Usage: node fix-terminal-periods.js --content <dir> [--out <dir>] [--dry]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --out <dir>      Write here instead of in place.',
    '  --dry            Count and list, change nothing.',
    '',
    'Adds the missing full stop at the end of body paragraphs and captions.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const file = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(file, 'utf8')

const SKIP = /\b(label|topic-head|lead-head|chapter-eyebrow|run-head|toc-entry|entry-name)\b/
const CITE_TAIL = /((?:\s*<sup class="cite[^"]*">(?:(?!<\/sup>)[\s\S])*<\/sup>)+)((?:\s|<\/(?:em|strong|span|i|b)>)*)$/
const CLOSERS = /((?:\s|<\/(?:em|strong|span|i|b)>)*)$/

const plain = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/­/g, '').replace(/\s+/g, ' ').trim()

let fixed = 0, beforeCite = 0, left = 0
const samples = []

// Tables are cut out of the pass whole: a cell is a fragment by design.
const tables = []
html = html.replace(/<table[\s\S]*?<\/table>/g, function (t) { tables.push(t); return '\u0000T' + (tables.length - 1) + '\u0000' })

// Display pages are not prose: a subtitle, an imprint line and a dedication
// end where they end. Neither are the lists a reader looks things up in.
const DISPLAY = /\b(title-page|copyright-page|dedication-page|sponsor-page|contents-page|index|references-notice)\b/

function fixComponent (part) {
  const cls = (/^<div class="([^"]*)"/.exec(part) || [])[1] || ''
  if (DISPLAY.test(cls)) return part
  return part.replace(/<p((?:\s[^>]*)?)>((?:(?!<\/p>)[\s\S])*)<\/p>/g, fixParagraph)
}

function fixParagraph (whole, attrs, inner) {
  if (SKIP.test(attrs)) return whole
  // A paragraph holding a drawing is a frame, and its "text" is the labels.
  if (/<svg\b|figure-slot/.test(inner)) return whole
  const m = CITE_TAIL.exec(inner)
  const head = m ? inner.slice(0, m.index) : inner.replace(CLOSERS, '')
  const text = plain(head)
  // A sentence, not a fragment: long enough, with words in it.
  if (text.length < 40 || !/[a-z]{3,} [a-z]{2,}/.test(text)) return whole
  if (!/[A-Za-z0-9%)\]’”"']$/.test(text)) { left += 1; return whole }
  fixed += 1
  let out
  if (m) {
    beforeCite += 1
    const lead = head.replace(CLOSERS, '')
    out = lead + '.' + head.slice(lead.length) + m[1] + m[2]
  } else {
    const tail = CLOSERS.exec(inner)[1]
    out = head + '.' + tail
  }
  if (samples.length < 6) samples.push('…' + plain(out).slice(-58))
  return '<p' + attrs + '>' + out + '</p>'
}

html = html.split(/(?=<div class="aet-md )/).map(fixComponent).join('')

html = html.replace(/\u0000T(\d+)\u0000/g, function (_, i) { return tables[Number(i)] })

console.log(fixed + ' paragraphs given a full stop (' + beforeCite + ' before a closing reference mark)')
console.log(left + ' already end in punctuation of their own and were left alone')
samples.forEach(s => console.log('  ' + s))
if (!args.dry) {
  const outDir = path.resolve(args.out || args.content)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), html)
  console.log('Wrote ' + path.join(outDir, 'index.html'))
}
