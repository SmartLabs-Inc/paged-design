#!/usr/bin/env node
//
// Repair Markdown that survived the conversion to book HTML.
//
// A link label containing square brackets of its own — `[Ac-SDKP (Goralatide
// / Tbeta4\[1-4\])](#…)` — defeated an earlier version of the converter's
// link pattern, which stopped at the first `]` it met. md-to-book.js handles
// it now, but a book converted before that fix carries the damage in its HTML
// and there is no way to re-run the conversion without the original Markdown.
//
// Two shapes, and the second is the one that matters:
//
//   * a whole link left as source, `[label](#target)`, printing its own
//     syntax in the index;
//   * the backslash escapes alone, left behind in text the converter did
//     reach — so entry 13's name and its running head printed
//     "Ac-SDKP (Goralatide / Tbeta4\[1-4\])" on every page of that entry.
//
// Nothing here guesses. A label is converted only when it sits where a link
// belongs, and the escapes are removed only in front of a bracket, which is
// the only place Markdown puts them.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node fix-escaped-links.js --content <dir>',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '',
    'Converts Markdown links the converter left as source, and removes the',
    'backslash escapes it left in front of square brackets.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const indexFile = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

// The label may hold escaped brackets OR a balanced literal pair of its own;
// it may not hold a tag, which is what stops this running away across the
// markup.
//
// The literal pair is not optional. A first version accepted only the escaped
// form and then stripped the escapes from the whole file afterwards, which
// turned every link it had failed to convert into one it could no longer
// recognise — `Tbeta4\[1-4\]` became `Tbeta4[1-4]` and the quick-reference
// table kept printing its link syntax. Order of operations, not pattern
// strength, was the fault; the pattern now covers both and the escapes come
// off last regardless.
// A label may also carry inline emphasis — the quick-reference tables set
// every term bold, so the third variant found was
// `[<strong>Ac-SDKP (Goralatide / Tbeta4[1-4])</strong>](#…)`. Those tags are
// named one by one rather than admitting `<` generally, because admitting it
// is what lets a pattern like this swallow half the document.
const INLINE = '</?(?:strong|em|b|i|sup|sub|span)[^<>]*>'
const LINK = new RegExp(
  '\\[((?:' + INLINE + '|[^[\\]<>]|\\\\\\[|\\\\\\]|\\[[^[\\]<>]*\\])+)\\]\\((#[^)\\s]+)\\)', 'g')

let links = 0
html = html.replace(LINK, function (all, label, target) {
  links += 1
  return '<a href="' + target + '">' + label.replace(/\\([[\]])/g, '$1') + '</a>'
})

const escapes = (html.match(/\\[[\]]/g) || []).length
html = html.replace(/\\([[\]])/g, '$1')

fs.writeFileSync(indexFile, html)
console.log('Markdown left over in ' + indexFile)
console.log('  links converted: ' + links)
console.log('  bracket escapes removed: ' + escapes)
