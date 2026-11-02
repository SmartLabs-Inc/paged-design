#!/usr/bin/env node
//
// One command from a Word manuscript to a print PDF and an EPUB.
//
//     manuscript.docx
//         │
//         ├─ restyle        one style per meaning        (optional, --restyle)
//         ├─ convert        docx-to-book.js → book HTML
//         │
//         ├─ EPUB           make-epub.js    ← the flat, semantic HTML
//         │
//         ├─ design         design-pass.js  → part openers, entries, keep boxes
//         ├─ CSS            build-css.js
//         ├─ PDF            render-pdf.js
//         └─ check          check-layout.js
//
// The order matters in exactly one place: the EPUB is built before the design
// pass, from the semantic HTML, because the print scaffolding the design pass
// adds is wrong for reflowing text. See the note at the top of make-epub.js.
//
// Every step is a script that can be run on its own, and this only sequences
// them. When something goes wrong, run the step that failed by hand.
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { requireRepoRoot, parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.src) {
  console.log([
    'Usage: node build-book.js --src <manuscript.docx> --slug <name> [options]',
    '',
    '  --src <file>      The manuscript. .docx or .md directory.',
    '  --slug <name>     Book directory under content/. Default: the file name.',
    '  --map <name>      Style map for the conversion. Default: the slug.',
    '  --theme <name>    Theme to render with. Default: beatrix.',
    '  --restyle         Run restyle-aet.py first, to put the manuscript on a',
    '                    closed style vocabulary. For manuscripts in the AET',
    '                    family; skip it for one already written to a template.',
    '  --out-dir <dir>   Where the PDF and EPUB go. Default: alongside content.',
    '  --no-pdf          Skip the print render.',
    '  --no-widows       Skip the widow pass. It paginates several times, so',
    '                    it is the slow step; the book still renders without it.',
    '  --rounds <n>      Widow-pass attempts. Default 6.',
    '  --no-epub         Skip the EPUB.',
    '  --no-check        Skip the layout check.',
    '',
    'Each stage prints what it did. Nothing is silent, because a book that',
    'stops paginating still writes a plausible-looking PDF.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const here = __dirname
const source = path.resolve(args.src)
if (!fs.existsSync(source)) {
  console.error('No such manuscript: ' + source)
  process.exit(1)
}

const slug = args.slug || path.basename(source).replace(/\.[^.]+$/, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const map = args.map || slug
const theme = args.theme || 'beatrix'
const contentDir = path.join(root, 'content', slug)
const outDir = args['out-dir'] ? path.resolve(args['out-dir']) : path.dirname(contentDir)

let step = 0
function stage (name) {
  step += 1
  console.log('\n[' + step + '] ' + name)
}

function run (command, commandArgs) {
  const output = execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' })
  process.stdout.write(output.replace(/^/gm, '    '))
  return output
}

// ---------------------------------------------------------------------------

let manuscript = source

if (args.restyle) {
  stage('Restyle — one style per meaning')
  const restyled = path.join(outDir, slug + '-styled.docx')
  fs.mkdirSync(outDir, { recursive: true })
  run('python3', [path.join(here, 'restyle-aet.py'), manuscript, restyled,
    path.join(outDir, '.' + slug + '-restyle-work')])
  manuscript = restyled
}

stage('Convert — manuscript to book HTML')
run('node', [path.join(here, 'docx-to-book.js'), '--src', manuscript,
  '--out', contentDir, '--map', map])

if (!args['no-epub']) {
  stage('EPUB — from the semantic HTML, before any print scaffolding')
  run('node', [path.join(here, 'make-epub.js'), '--content', contentDir,
    '--out', path.join(outDir, slug + '.epub')])
}

stage('Design — part openers, entry cards, keep boxes')
run('node', [path.join(here, 'design-pass.js'), '--content', contentDir])

if (!args['no-pdf']) {
  stage('CSS — compile the theme')
  run('node', [path.join(here, 'build-css.js'), theme])
}

// After the CSS, because it paginates: it has to measure the same book the
// renderer will print, not the one the last build compiled.
if (!args['no-pdf'] && !args['no-widows']) {
  stage('Widows — push what CSS cannot reach across a page break')
  run('node', [path.join(here, 'fix-widows.js'), '--content', contentDir,
    '--theme', theme, '--rounds', String(args.rounds || 6)])
}

if (!args['no-pdf']) {
  stage('Render — paginate and print')
  run('node', [path.join(here, 'render-pdf.js'), '--content', contentDir,
    '--theme', theme, '--out', path.join(outDir, slug + '.pdf'), '--no-build',
    '--timeout', '1800000'])
}

if (!args['no-check'] && !args['no-pdf']) {
  stage('Check — widows, orphans, overflow, stranded headings, dead links')
  try {
    run('node', [path.join(here, 'check-layout.js'), '--content', contentDir,
      '--theme', theme])
  } catch (error) {
    // The checker exits non-zero under --strict; here its findings are advice,
    // not a build failure. Its output has already been printed.
  }
}

console.log('\nDone. Book HTML in ' + path.relative(root, contentDir))
