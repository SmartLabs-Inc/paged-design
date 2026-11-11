#!/usr/bin/env node
'use strict'
//
// Give each part an opening page of its own.
//
// A part used to open with a small "PART I", the title and a list of
// sections, and then the text began on the same page — which reads as just
// another page. This gathers those three things into one block the height of
// the page, with the part's emblem above them, and the theme sets that page
// in the part's colour with the type reversed.
//
// The block is a wrapper round what was already there, marked data-wrap, and
// the emblem is marked data-new. The correction editor numbers both apart
// from the rest, so every block of the book keeps the number a saved
// correction points at.
//
// Run twice, it changes nothing the second time.
//
// Usage: node make-part-openers.js --content <dir> [--out <dir>]

const fs = require('fs')
const path = require('path')
const emblem = require('./lib/part-emblems')

const args = {}
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args[a.slice(2)] = (all[i + 1] || '').startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]
})
if (args.help || !args.content) {
  console.log([
    'Usage: node make-part-openers.js --content <dir> [--out <dir>]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --out <dir>      Write here instead of in place.',
    '',
    'Wraps each part\'s eyebrow, title and section list as a full-page opener.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const file = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(file, 'utf8')

const OPENER = /(<div class="aet-md chapter part-(\d+)"[^>]*>\s*<div>\s*<div>\s*<h1 class="part-name">(?:(?!<\/h1>)[\s\S])*<\/h1>\s*)(<p class="chapter-eyebrow">(?:(?!<\/p>)[\s\S])*<\/p>\s*<h2 class="part-title"(?:(?!<\/h2>)[\s\S])*<\/h2>\s*<ol class="part-contents">(?:(?!<\/ol>)[\s\S])*<\/ol>)/g

let made = 0
html = html.replace(OPENER, function (whole, lead, part, body) {
  made += 1
  return lead + '<div class="part-opener part-opener-' + part + '" data-wrap="part-opener">\n' +
    emblem(Number(part)) + '\n' + body + '\n</div>'
})
const already = (html.match(/class="part-opener part-opener-\d+"/g) || []).length - made

const outDir = path.resolve(args.out || args.content)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'index.html'), html)
console.log(made + ' part opener' + (made === 1 ? '' : 's') + ' made' + (already ? ', ' + already + ' already in place' : ''))
