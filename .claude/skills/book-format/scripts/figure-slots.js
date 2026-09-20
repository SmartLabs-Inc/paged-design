#!/usr/bin/env node
//
// Make a missing figure visible.
//
// An `<img>` whose file is not there prints as nothing. In a 972-page proof
// that is twelve holes nobody will find, and the person who has to find them
// is the author, who is the only one who can supply the artwork.
//
// So every image the book asks for and does not have becomes a ruled slot on
// the page, at the size the figure will occupy, carrying the filename the book
// expects and the description already written for it. The author can see what
// is missing while turning the pages, and whoever draws it has the brief
// printed in place.
//
//   node figure-slots.js --content content/my-book
//
// Images that are present are left alone. The run lists what it could not
// find, which is the list to send back to the author.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node figure-slots.js --content <dir>',
    '',
    '  --content <dir>  Book directory holding index.html, rewritten in place.',
    '  --art <dir>      Look for the artwork here and copy in whatever matches',
    '                   the filename the book is asking for.',
    '',
    'Replaces every <img> whose file is missing with a ruled slot carrying the',
    'filename and the description, and lists what it could not find.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const dir = path.resolve(args.content)
const indexFile = path.join(dir, 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

function attribute (tag, name) {
  const found = new RegExp(name + '="([^"]*)"').exec(tag)
  return found ? found[1] : ''
}

// Artwork arrives in a folder of its own, and rarely under the name the
// manuscript uses for it. The book asks for `Humanin_BAX_20260908.svg`; what
// turns up is `Humanin_BAX_20260908_PRINT.png`, the same drawing exported for
// print. Matching on the exact filename finds nothing and leaves twelve slots
// empty for no better reason than a file extension.
//
// So the match is on the stem, and the `src` is rewritten to whatever was
// actually supplied. Renaming a PNG to .svg would not do: the server types a
// file by its extension, and a PNG served as image/svg+xml does not draw.

const IMAGE = /\.(?:svg|png|jpg|jpeg|webp|gif|pdf)$/i

function stemOf (file) {
  return file.replace(IMAGE, '').replace(/[-_](?:print|final|web|rgb|cmyk)$/i, '').toLowerCase()
}

let copied = 0
const supplied = new Map()
if (args.art) {
  const artDir = path.resolve(args.art)
  if (fs.existsSync(artDir)) {
    const walk = function (here) {
      for (const entry of fs.readdirSync(here, { withFileTypes: true })) {
        const full = path.join(here, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!IMAGE.test(entry.name)) continue
        if (!supplied.has(stemOf(entry.name))) supplied.set(stemOf(entry.name), full)
      }
    }
    walk(artDir)
  } else {
    console.log('  no such art directory: ' + artDir)
  }
}

const missing = []
const present = []
const renamed = []

// A slot goes back to being an image when the artwork turns up. Without this
// the pass is one-way — the first run replaces the `<img>` with a slot, and
// the second has nothing left to fill — and a late delivery of figures costs
// a rebuild of the whole book rather than one pass over it.
let filled = 0
html = html.replace(
  /<span class="figure-slot">[\s\S]*?<span class="figure-slot-file">([^<]*)<\/span>(?:<span class="figure-slot-alt">([\s\S]*?)<\/span>)?<\/span>/g,
  function (all, wanted, alt) {
    const match = supplied.get(stemOf(wanted))
    if (!match) return all
    const name = path.basename(match)
    if (!fs.existsSync(path.join(dir, name))) { fs.copyFileSync(match, path.join(dir, name)); copied += 1 }
    filled += 1
    if (name !== wanted) renamed.push(wanted + ' → ' + name)
    return '<img src="' + name + '" alt="' + (alt || '').replace(/"/g, '&quot;') + '" />'
  })

html = html.replace(/<img\b[^>]*>/g, function (tag) {
  const src = attribute(tag, 'src')
  if (!src || /^(?:https?:|data:)/.test(src)) return tag
  if (fs.existsSync(path.join(dir, src))) { present.push(src); return tag }

  // Supplied under another name or in another format.
  const match = supplied.get(stemOf(src))
  if (match) {
    const name = path.basename(match)
    if (!fs.existsSync(path.join(dir, name))) { fs.copyFileSync(match, path.join(dir, name)); copied += 1 }
    present.push(name)
    if (name !== src) renamed.push(src + ' → ' + name)
    return tag.replace(/src="[^"]*"/, 'src="' + name + '"')
  }

  missing.push(src)
  const alt = attribute(tag, 'alt')
  return '<span class="figure-slot">' +
    '<span class="figure-slot-label">Artwork to come</span>' +
    '<span class="figure-slot-file">' + src + '</span>' +
    (alt ? '<span class="figure-slot-alt">' + alt + '</span>' : '') +
    '</span>'
})

fs.writeFileSync(indexFile, html)

console.log('Figure slots in ' + path.relative(process.cwd(), indexFile))
if (copied) console.log('  artwork copied in from --art: ' + copied)
if (filled) console.log('  slots filled with artwork that has since arrived: ' + filled)
renamed.forEach(function (line) { console.log('    ' + line) })
console.log('  images present: ' + present.length)
console.log('  images missing: ' + missing.length)
missing.forEach(function (file) { console.log('    ' + file) })
