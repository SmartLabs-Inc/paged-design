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

// Artwork usually arrives in a folder of its own rather than already in the
// book directory. Anything in there whose name the book asks for is copied in
// before the check runs, so a delivery of figures needs no other step.
let copied = 0
if (args.art) {
  const artDir = path.resolve(args.art)
  if (fs.existsSync(artDir)) {
    for (const file of fs.readdirSync(artDir)) {
      const target = path.join(dir, file)
      if (fs.existsSync(target)) continue
      if (!html.includes('"' + file + '"')) continue
      fs.copyFileSync(path.join(artDir, file), target)
      copied += 1
    }
  } else {
    console.log('  no such art directory: ' + artDir)
  }
}

const missing = []
const present = []

html = html.replace(/<img\b[^>]*>/g, function (tag) {
  const src = attribute(tag, 'src')
  if (!src || /^(?:https?:|data:)/.test(src)) return tag
  if (fs.existsSync(path.join(dir, src))) { present.push(src); return tag }

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
console.log('  images present: ' + present.length)
console.log('  images missing: ' + missing.length)
missing.forEach(function (file) { console.log('    ' + file) })
