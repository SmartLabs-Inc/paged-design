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
console.log('  images present: ' + present.length)
console.log('  images missing: ' + missing.length)
missing.forEach(function (file) { console.log('    ' + file) })
