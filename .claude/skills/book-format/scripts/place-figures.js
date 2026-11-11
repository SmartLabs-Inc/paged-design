#!/usr/bin/env node
'use strict'
//
// Put the drawn figures into the book, in place of their "Artwork to come"
// slots.
//
// The SVG is inlined rather than linked. An <img> is rendered in its own
// document and cannot reach the book's @font-face, so every label in a linked
// figure falls back to whatever sans the machine happens to have — which is
// the difference between a figure set in the book's face and a figure that
// merely sits in the book. Inlined, it also prints as vector, scales to any
// press resolution, and stays searchable text.
//
// A slot whose drawing does not exist yet is left exactly as it is, so this
// can run against a part-finished set without erasing the reminder of what is
// still missing.
//
// Usage: node place-figures.js --content <dir> --svg <dir> [--out <dir>]

const fs = require('fs')
const path = require('path')

const args = {}
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args[a.slice(2)] = (all[i + 1] || '').startsWith('--') ? true : all[i + 1]
})

if (args.help || !args.content || !args.svg) {
  console.log([
    'Usage: node place-figures.js --content <dir> --svg <dir> [--out <dir>]',
    '',
    '  --content <dir>  Book directory holding index.html.',
    '  --svg <dir>      Directory of <slot-name>.svg files.',
    '  --out <dir>      Write here instead of in place.',
    '',
    'Replaces each "Artwork to come" slot with its inline SVG. Slots with no',
    'drawing yet are left alone.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const contentDir = path.resolve(args.content)
const svgDir = path.resolve(args.svg)
const outDir = path.resolve(args.out || contentDir)
const file = path.join(contentDir, 'index.html')
let html = fs.readFileSync(file, 'utf8')

// The slot is one <span class="figure-slot"> carrying three spans: the label,
// the file it is waiting for, and the alt text. The filename identifies it;
// the alt text becomes the figure's accessible description.
const SLOT = /<span class="figure-slot">\s*<span class="figure-slot-label">[\s\S]*?<\/span>\s*<span class="figure-slot-file">([\s\S]*?)<\/span>\s*<span class="figure-slot-alt">([\s\S]*?)<\/span>\s*<\/span>/g

const strip = s => s.replace(/<[^>]+>/g, '').replace(/­/g, '').replace(/\s+/g, ' ').trim()
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

let placed = 0, waiting = []
html = html.replace(SLOT, function (whole, fileSpan, altSpan) {
  const name = strip(fileSpan).replace(/\.svg$/i, '')
  const svgFile = path.join(svgDir, name + '.svg')
  if (!fs.existsSync(svgFile)) { waiting.push(name); return whole }
  let svg = fs.readFileSync(svgFile, 'utf8').replace(/^[\s\S]*?(?=<svg)/, '')
  const alt = strip(altSpan)
  // Width in millimetres is what the figure was drawn at; letting it be 100%
  // of the column instead keeps it correct if the measure ever changes.
  svg = svg.replace(/<svg([^>]*)>/, function (m, attrs) {
    const a = attrs.replace(/\s(width|height)="[^"]*"/g, '')
    return '<svg' + a + ' class="figure-art" width="100%">' +
           (alt ? '<title>' + esc(alt) + '</title>' : '')
  })
  placed += 1
  return svg
})

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'index.html'), html)
console.log(placed + ' figure' + (placed === 1 ? '' : 's') + ' placed')
if (waiting.length) {
  console.log(waiting.length + ' still waiting on artwork:')
  waiting.forEach(w => console.log('  ' + w))
}
