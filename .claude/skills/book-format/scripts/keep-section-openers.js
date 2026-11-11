#!/usr/bin/env node
//
// Keep an entry's name with the label and text it introduces.
//
// An entry whose first block is a label rather than a paragraph gets an
// `.entry-lead` holding nothing but the heading — there is no opening sentence
// to put in it — so the entry name sits alone in its unbreakable box and the
// label and text below it are free to move away at a break. That is p258's
// "20 Adiponectin-Receptor Signaling as a Metabolic Target" at the foot of
// column one with its body in column two, and p262's entry 22 at the foot of
// the page with its body overleaf. 136 entries in the book are built this way,
// so every reflow strands a different handful of them; fixing the ones that
// show would only move the fault.
//
// The two boxes merge rather than nest. `.keep-label` and `.entry-lead` zero
// their children's margins with the same two declarations, and every other
// rule that reaches these elements is written on a class or on
// `.entry-lead > h5`, so pouring the label and the lead paragraph into the
// entry-lead changes no styling — and it keeps `.entry-lead` a direct child of
// `.entry`, which `.entry > *` and `.entry > p:last-child` both depend on. A
// wrapper would have broken that. Measured after the merge: every one of them
// is 109px in an 816px column, so none of them is near the height at which an
// unbreakable box stalls pagination.
//
// --- Section titles are NOT handled here, and the attempt is worth recording.
//
// The same fault one level up — a section title at the foot of a page with its
// shaded panel overleaf, p161 — looks like it wants the same treatment, and a
// first version wrapped the title and the panel in one `break-inside: avoid`
// spanner. It stalled pagination at 82 pages of 713.
//
// Two mistakes, and the second is the one to remember. The first: a title is
// not always followed by its panel — "I. Foundations" has a section
// introduction between them. The second: the regex that was supposed to match
// only an adjacent pair was written non-greedily at each step, which does not
// mean it stops at the first `</div>`. The engine happily extends an earlier
// `[\s\S]*?` until the rest of the pattern matches, so wherever the pair was
// not adjacent it swallowed everything in between — an 811px box in an 816px
// column, which can never fit anywhere and so is pushed forever. The count it
// reported, 26 pairs, was wrong for the same reason and looked plausible.
//
// A pattern that must not cross a tag has to say so — `(?:(?!</div>)[\s\S])*`
// — rather than rely on `*?`. And a box that is held whole has to be measured
// after it is built, not estimated before.
//
// Stranded section titles are left to fix-break-strays, which pushes them to
// the next page once pagination says which ones actually strand. Nothing is
// held whole, so nothing can stall.
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
    'Merges the label box into the entry name above it, so the two cannot be',
    'separated by a page or column break.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const indexFile = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

// Neither half may cross a `</div>`, so both are spelled out rather than left
// to `*?`. The entry-lead half must also contain no `lead-head`: one that
// already has its opening paragraph is not this fault and must not absorb a
// second paragraph on top of it.
const LEAD = '<div class="entry-lead">((?:(?!</div>|lead-head)[\\s\\S])*)</div>'
const GAP = '\\s*((?:<a id="[^"]*"></a>\\s*)*)'
const LABEL = '<div class="keep-label">((?:(?!</div>)[\\s\\S])*)</div>'
const HEADING_ALONE = new RegExp(LEAD + GAP + LABEL, 'g')

// The anchor between the two moves above the merged box so the section link
// still lands on the entry name rather than inside it.
let merged = 0
html = html.replace(HEADING_ALONE, function (all, lead, anchors, label) {
  merged += 1
  return anchors + '<div class="entry-lead">' + lead + label + '</div>'
})

// Two entries open with a bare label paragraph instead of a `.keep-label` box.
// They are left alone: the paragraph after them is a whole one rather than the
// three-line lead the build cuts, and a keep box that swallowed it could end
// up taller than the column — which does not overflow, it stalls pagination.
const BARE = new RegExp(LEAD + GAP + '<p class="label">', 'g')
const bare = (html.match(BARE) || []).length

fs.writeFileSync(indexFile, html)
console.log('Entry openers in ' + indexFile)
console.log('  entry name merged into its label box: ' + merged)
if (bare) console.log('  entry name left alone (bare label follows): ' + bare)
