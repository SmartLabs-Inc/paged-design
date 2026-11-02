#!/usr/bin/env node
//
// Build the book as one HTML file you open in Chrome and edit by hand.
//
// Everything else here renders a PDF and hands it over. A PDF cannot be
// clicked on, and the corrections it provokes come back as page numbers,
// which are wrong by the time anything upstream of them moves. This writes a
// single self-contained file instead: the book's own markup, the theme, the
// fonts and Paged.js, with an editing layer over the top. Open it, click the
// thing that is wrong, say what should happen to it, watch the page reflow.
//
// It is self-contained because it has to work from a file:// URL on someone
// else's machine, with no server, no network and no npm. That is why the
// fonts are inlined rather than linked — about 5.5MB of base64, and the
// reason the file is large.
//
// Pagination is per section, not per book. Paged.js takes about three minutes
// over 700 pages in this browser and would take longer in a cold one; a
// section is a few seconds, which is the difference between a tool someone
// uses and one they abandon. Each section still knows its real book page
// numbers, from the map made by make-page-map.js, so "page 23" means page 23.
'use strict'

const fs = require('fs')
const path = require('path')
const { requireRepoRoot, parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node make-editor.js --content <dir> [options]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --theme <name>   Theme whose compiled CSS is inlined. Default: aalai-textbook.',
    '  --map <file>     page-map.json from make-page-map.js, for real page numbers.',
    '  --out <file>     Where to write the editor. Default: <content>/editor.html',
    '',
    'Writes one self-contained HTML file: the book, the theme, the fonts and',
    'Paged.js, with an editing layer. Open it in Chrome.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'aalai-textbook'
const contentDir = path.resolve(args.content)
const outFile = path.resolve(args.out || path.join(contentDir, 'editor.html'))

const book = fs.readFileSync(path.join(contentDir, 'index.html'), 'utf8')
const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(book)
if (!bodyMatch) {
  console.error('No <body> in ' + path.join(contentDir, 'index.html'))
  process.exit(1)
}
const bookBody = bodyMatch[1]

let css = fs.readFileSync(path.join(root, 'themes', theme, 'main.css'), 'utf8')
let inlined = 0
css = css.replace(/url\("\.\.\/\.\.\/fonts\/([^"]+)"\)/g, function (all, file) {
  const fontPath = path.join(root, 'fonts', file)
  if (!fs.existsSync(fontPath)) return all
  inlined += 1
  return 'url("data:font/ttf;base64,' + fs.readFileSync(fontPath).toString('base64') + '")'
})

// Images referenced by the book have to travel too, or every figure is a
// broken box and every page after one is a different height.
let images = 0
const bodyWithImages = bookBody.replace(/src="([^"]+\.(?:png|jpe?g|gif|webp|svg))"/gi,
  function (all, src) {
    const file = path.join(contentDir, path.basename(src))
    if (!fs.existsSync(file)) return all
    images += 1
    const ext = path.extname(file).slice(1).toLowerCase()
    const mime = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' ? 'image/jpeg' : 'image/' + ext)
    return 'src="data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64') + '"'
  })

const paged = fs.readFileSync(path.join(root, 'js/vendor/paged.polyfill.js'), 'utf8')
const pageMap = args.map && fs.existsSync(path.resolve(args.map))
  ? fs.readFileSync(path.resolve(args.map), 'utf8')
  : '{"total":0,"blocks":{}}'

const shell = fs.readFileSync(path.join(__dirname, 'lib/editor-shell.html'), 'utf8')

const out = shell
  .replace('/*THEME_CSS*/', function () { return css })
  .replace('/*PAGED_JS*/', function () { return paged })
  .replace('/*PAGE_MAP*/', function () { return pageMap })
  .replace('<!--BOOK_BODY-->', function () { return bodyWithImages })

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, out)

console.log('Editor written to ' + outFile)
console.log('  ' + Math.round(fs.statSync(outFile).size / 1024 / 1024 * 10) / 10 + ' MB · ' +
  inlined + ' fonts inlined · ' + images + ' images inlined')
console.log('  open it in Chrome — Paged.js only paginates correctly there')
