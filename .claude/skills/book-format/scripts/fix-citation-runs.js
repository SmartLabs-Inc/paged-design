#!/usr/bin/env node
//
// Separate citation superscripts that run together into one number.
//
// Two citations set side by side with nothing between them —
// `<sup>6</sup><sup>7</sup>` — print as "67", and a reader has no way to see
// that it is references 6 and 7 rather than reference 67. In a book whose
// reference numbers run past 4,000 that is not a theoretical ambiguity.
//
// The fix is not CSS. Generated content on an ordinary element does not
// survive Paged.js's pagination, so a `::before { content: "," }` shows in the
// browser and vanishes from the PDF — the worst of both, because it looks
// fixed while it is proofed and is not fixed when it prints.
//
// So the adjacent superscripts are merged into one, with a comma and a thin
// space between the numbers. One superscript rather than several also stops
// the run being broken across a line at a point that looks like a decimal.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node fix-citation-runs.js --content <dir> [--long <n>]',
    '',
    '  --content <dir>  Book directory holding index.html, rewritten in place.',
    '  --long <n>       Mark a run of this many or more `cite-long`, so the',
    '                   theme may break it. Default 5.',
    '',
    'Merges adjacent citation superscripts into one, separated by a comma',
    'and a thin space.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const indexFile = path.join(path.resolve(args.content), 'index.html')
const LONG = Number(args.long || 5)
let html = fs.readFileSync(indexFile, 'utf8')

const THIN = ' '
// Two or more <sup class="cite"> with nothing at all between them.
const RUN = /(?:<sup class="cite">(?:(?!<\/sup>)[\s\S])*?<\/sup>){2,}/g
const ONE = /<sup class="cite">((?:(?!<\/sup>)[\s\S])*?)<\/sup>/g

let runs = 0
let joined = 0
let longRuns = 0

html = html.replace(RUN, function (block) {
  const parts = []
  let m
  ONE.lastIndex = 0
  while ((m = ONE.exec(block)) !== null) parts.push(m[1])
  if (parts.length < 2) return block
  runs += 1
  joined += parts.length
  const cls = parts.length >= LONG ? 'cite cite-long' : 'cite'
  if (parts.length >= LONG) longRuns += 1
  return '<sup class="' + cls + '">' + parts.join(',' + THIN) + '</sup>'
})

fs.writeFileSync(indexFile, html)
console.log('Citation runs in ' + indexFile)
console.log('  runs joined into one superscript: ' + runs)
console.log('  citations separated: ' + joined)
console.log('  runs of ' + LONG + ' or more marked cite-long: ' + longRuns)
