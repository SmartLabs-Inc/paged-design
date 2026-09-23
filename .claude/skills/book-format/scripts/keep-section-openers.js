#!/usr/bin/env node
//
// Keep a section title with the shaded panel that belongs to it.
//
// A section starts with two sibling boxes: the group title — "IV.
// Neuroprotection, Cognition, and Immune Modulation" — and the shaded opener
// panel under it that names the section and carries its standfirst. Each box
// is `break-inside: avoid` on its own, and nothing holds the two together, so
// a page break falls between them: the title alone at the foot of p161, the
// panel at the head of p162.
//
// CSS cannot fix this pair. `break-after: avoid` on the title is dropped by
// Paged.js at a page break, and `break-before: avoid` on the panel — which
// Paged.js does normally honour — is ignored here because both boxes are
// `column-span: all`, and a spanner is fragmented on Paged.js's own terms
// rather than the stylesheet's. The only thing that holds across a page break
// is one unbreakable box, which is what the skill's own rule says: do not
// chain keep-with-next, wrap the group instead.
//
// So this wraps each title/panel pair in a `.section-group` div that the theme
// makes a single `break-inside: avoid` spanner. Title and panel together are
// about 300px of an 815px column, well under the height at which an
// unbreakable box stalls pagination.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node keep-section-openers.js --content <dir>',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '',
    'Wraps each section title and the shaded opener panel below it in one',
    'unbreakable box, so a page break cannot fall between them.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const indexFile = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

// The anchors between the two boxes name the section the panel introduces, so
// they belong inside the wrapper with it — leaving them outside would put the
// link target on the previous page.
const PAIR = /<div class="keep-lead section-opener">[\s\S]*?<\/div>\s*(?:<a id="[^"]*"><\/a>\s*)*<div class="keep-lead lead-section">[\s\S]*?<\/div>/g

let wrapped = 0
html = html.replace(PAIR, function (block) {
  wrapped += 1
  return '<div class="section-group">' + block + '</div>'
})

// The same fault, one level down. An entry whose first block is a label rather
// than a paragraph gets an `.entry-lead` holding nothing but the heading —
// there is no opening sentence to put in it — so the entry name sits alone in
// its unbreakable box and the label and text below it are free to move. That
// is p258's "20 Adiponectin-Receptor Signaling as a Metabolic Target" at the
// foot of column one with its body in column two, and p262's entry 22 at the
// foot of the page with its body overleaf. 136 entries in the book are built
// this way, so every reflow puts a different handful of them on a break.
//
// Here the two boxes merge rather than nest. `.keep-label` and `.entry-lead`
// zero their children's margins with the same two declarations, and every
// other rule that reaches these elements is written on a class or on
// `.entry-lead > h5`, so pouring the label and the lead paragraph into the
// entry-lead changes no styling and keeps `.entry-lead` a direct child of
// `.entry` — which a wrapper would not have done, and `.entry > *` and
// `.entry > p:last-child` both depend on it.
//
// The anchor between the two moves above the merged box so the section link
// still lands on the entry name rather than inside it.
const HEADING_ALONE = /<div class="entry-lead">((?:(?!lead-head)[\s\S])*?)<\/div>\s*((?:<a id="[^"]*"><\/a>\s*)*)<div class="keep-label">([\s\S]*?)<\/div>/g

let merged = 0
html = html.replace(HEADING_ALONE, function (all, lead, anchors, label) {
  merged += 1
  return anchors + '<div class="entry-lead">' + lead + label + '</div>'
})

// Two entries open with a bare label paragraph instead of a `.keep-label` box.
// They are left alone: the paragraph after them is a whole one rather than the
// three-line lead the build cuts, and a keep box that swallows it could end up
// taller than the column — which does not overflow, it stalls pagination.
const BARE = /<div class="entry-lead">(?:(?!lead-head)[\s\S])*?<\/div>\s*(?:<a id="[^"]*"><\/a>\s*)*<p class="label">/g
const bare = (html.match(BARE) || []).length

fs.writeFileSync(indexFile, html)
console.log('Section openers in ' + indexFile)
console.log('  title and panel held together: ' + wrapped)
console.log('  entry name merged into its label box: ' + merged)
if (bare) console.log('  entry name left alone (bare label follows): ' + bare)
