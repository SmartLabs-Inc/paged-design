#!/usr/bin/env node
//
// Put the book's front and back matter in order.
//
// The converter turns the manuscript into components in the order the author
// wrote them. A book needs more than that order: a dedication, an
// acknowledgements page, a reserved recto for a sponsor's notice, and the
// classes that tell the theme which component is the reference list and which
// is the index.
//
// Every insertion is a real page in the PDF. A page reserved for something to
// be dropped in later still has to be there, still has to fall on the right
// side of the spread, and still has to be counted — otherwise every folio
// after it is wrong in the printed book.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node front-matter.js --content <dir> [options]',
    '',
    '  --content <dir>    Book directory holding index.html, rewritten in place.',
    '  --sponsor-page     Reserve a blank recto before the contents.',
    '  --dedication       Add a dedication page after the copyright page.',
    '  --acknowledgements Add an acknowledgements page in the back matter.',
    '  --drop-generated-contents',
    '                     Remove the contents page the converter generated,',
    '                     keeping the author\'s own.',
    '',
    'Also classes the reference list, the index and the front matter so the',
    'theme can set each the way it should be set.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const indexFile = path.join(path.resolve(args.content), 'index.html')
let html = fs.readFileSync(indexFile, 'utf8')

// ---------------------------------------------------------------------------
// Finding components
// ---------------------------------------------------------------------------
// Each is a top-level div carrying the title in data-header, so a component
// can be found by name without parsing the whole document.

function findComponent (title) {
  const pattern = new RegExp('<div class="[^"]*"[^>]*data-header="' +
    title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>')
  const open = pattern.exec(html)
  if (!open) return null
  const end = matchingClose(open.index)
  if (end === -1) return null
  return { start: open.index, end: end, openTag: open[0] }
}

function matchingClose (from) {
  const tag = /<(\/?)div\b[^>]*>/g
  tag.lastIndex = from
  let depth = 0
  let match
  while ((match = tag.exec(html)) !== null) {
    if (match[1] === '/') {
      depth -= 1
      if (depth === 0) return tag.lastIndex
    } else depth += 1
  }
  return -1
}

const slug = (/<div class="([a-z0-9-]+) /.exec(html) || [])[1] || 'book'
const done = []

function component (classes, header, inner) {
  return '<div class="' + slug + ' ' + classes + '"' +
    (header ? ' data-header="' + header + '"' : '') + '>\n        <div>\n' +
    '            <div>\n' + inner + '\n            </div>\n        </div>\n    </div>'
}

// ---------------------------------------------------------------------------
// Give the components their classes
// ---------------------------------------------------------------------------
// The theme sets the reference list small and the index tight; both need to
// know which component they are looking at.

function addClasses (title, classes) {
  const found = findComponent(title)
  if (!found) return false
  const updated = found.openTag.replace(/class="([^"]*)"/, function (all, existing) {
    const already = existing.split(/\s+/)
    const added = classes.split(' ').filter(function (c) { return already.indexOf(c) === -1 })
    return 'class="' + existing + (added.length ? ' ' + added.join(' ') : '') + '"'
  })
  html = html.slice(0, found.start) + updated + html.slice(found.start + found.openTag.length)
  return true
}

// ---------------------------------------------------------------------------
// The book has to open on a title page
// ---------------------------------------------------------------------------
// The converter makes one component per top-level heading and classes them all
// `chapter`, so the book's own title page arrives as chapter zero: an h2 and
// two paragraphs. That is not only a design problem. The theme hangs the
// `book-title` named string off the title page, and the recto footer prints
// that string — so with no title page, every right-hand footer in the book is
// blank. It has been blank once before, for a different reason, and was found
// by looking at a proof rather than by anything in a log.
//
// Anything before that heading is the anchors the manuscript carries for its
// own cross-references. They belong on the title page, not on a page of their
// own, which is what they were getting: one blank leaf at the front of the
// book.

function makeTitlePage () {
  const first = /<div class="([^"]*)"[^>]*data-header="([^"]*)"[^>]*>/.exec(html)
  if (!first) return false
  if (/\btitle-page\b|\bcontents-page\b/.test(first[1])) return false

  // The empty component ahead of it holds the manuscript's own anchors. They
  // are link targets, so they move onto the title page rather than being
  // dropped, and the blank leaf they were getting goes away.
  let carried = ''
  const stray = /<div class="[^"]*"(?![^>]*data-header)[^>]*>/.exec(html.slice(0, first.index))
  if (stray) {
    const strayEnd = matchingClose(stray.index)
    const inner = strayEnd === -1 ? '' : html.slice(stray.index, strayEnd)
    if (strayEnd !== -1 && strayEnd <= first.index && !/<(?:p|h[1-6]|table|ul|ol)[ >]/.test(inner)) {
      carried = (inner.match(/<a id="[^"]*"><\/a>/g) || []).join('\n')
      html = html.slice(0, stray.index) + html.slice(strayEnd)
      done.push('empty opening component folded into the title page')
    }
  }

  const open = /<div class="([^"]*)"[^>]*data-header="([^"]*)"[^>]*>/.exec(html)
  const end = matchingClose(open.index)
  if (end === -1) return false
  let block = html.slice(open.index, end)

  block = block.replace(/class="([^"]*)"/, function (all, existing) {
    return 'class="' + existing.replace(/\bchapter\b/, 'title-page') + ' frontmatter"'
  })

  // The heading becomes the h1 the theme's `$title-page-title` selector wants,
  // and the two paragraphs under it are the subtitle and the author.
  //
  // It also carries `title-page-title`, which is not decoration: the parent
  // theme hangs `string-set: book-title` off that class, and the recto footer
  // prints that string on every right-hand page of the book. Without the
  // class the string is never set and the footer is blank — the same fault,
  // from the same cause, that the Word route had.
  block = block.replace(/<h[1-6]([^>]*)>([\s\S]*?)<\/h[1-6]>/,
    '<h1 class="title-page-title"$1>$2</h1>')
  let seen = 0
  block = block.replace(/<p>/g, function () {
    seen += 1
    if (seen === 1) return '<p class="title-page-subtitle">'
    if (seen === 2) return '<p class="title-page-author">'
    return '<p>'
  })
  if (carried) block = block.replace(/<\/h1>/, '</h1>\n' + carried)

  html = html.slice(0, open.index) + block + html.slice(end)
  done.push('title page made from "' + open[2] + '"')
  return true
}


if (addClasses('References', 'references endmatter')) done.push('References classed')
if (addClasses('Index', 'index endmatter')) done.push('Index classed')
if (addClasses('About Alexander Grinberg, M.D.', 'endmatter')) done.push('About classed')
;['Copyright', 'Medical and Legal Disclaimer', 'Methodology and Sources',
  'How to Read This Book', 'Preface', 'List of Abbreviations'].forEach(function (title) {
  if (addClasses(title, 'frontmatter')) done.push(title + ' classed')
})

// ---------------------------------------------------------------------------
// The converter's contents page duplicates the author's
// ---------------------------------------------------------------------------
// The manuscript carries its own contents, with the full hierarchy and a link
// on every line. The converter builds one too, from the component titles
// alone. Keeping both puts two tables of contents in the book, and the
// shallower one first.

if (args['drop-generated-contents']) {
  const generated = /<div class="[^"]*\bcontents-page\b[^"]*"[^>]*>/.exec(html)
  if (generated) {
    const end = matchingClose(generated.index)
    if (end !== -1) {
      html = html.slice(0, generated.index) + html.slice(end)
      done.push('generated contents page removed')
    }
  }
}

// After the generated contents page is gone, not before. The converter puts
// that page at the top of the document, so it is the first component with a
// title — and the title-page pass, run any earlier, dressed *it* as the title
// page and then watched the removal above take it away again. The book came
// out with no title page and no sign in the log that anything had gone wrong,
// twice, because running the pass a second time on the finished file works.
makeTitlePage()

// ---------------------------------------------------------------------------
// Insert the reserved and new pages
// ---------------------------------------------------------------------------

function insertBefore (title, markup, label) {
  const found = findComponent(title)
  if (!found) return false
  html = html.slice(0, found.start) + markup + '\n\n    ' + html.slice(found.start)
  done.push(label)
  return true
}

function insertAfter (title, markup, label) {
  const found = findComponent(title)
  if (!found) return false
  html = html.slice(0, found.end) + '\n\n    ' + markup + html.slice(found.end)
  done.push(label)
  return true
}

if (args['sponsor-page'] && !/\bsponsor-page\b/.test(html)) {
  // Reserved for a printing sponsor's notice, dropped into the PDF later. It
  // carries no text of its own, but it is a numbered recto so that everything
  // after it falls where the finished book expects.
  insertBefore('Contents', component('sponsor-page frontmatter', '', ''),
    'sponsor recto reserved before the contents')
}

if (args.dedication && !/\bdedication-page\b/.test(html)) {
  insertAfter('Copyright',
    component('dedication-page frontmatter', 'Dedication',
      '                <h1 class="heading-2">Dedication</h1>'),
    'dedication page added')
}

if (args.acknowledgements && !/\backnowledgements-page\b/.test(html)) {
  insertBefore('About Alexander Grinberg, M.D.',
    component('acknowledgements-page endmatter', 'Acknowledgements',
      '                <h1 class="heading-2">Acknowledgements</h1>'),
    'acknowledgements page added')
}

fs.writeFileSync(indexFile, html)

console.log('Front and back matter in ' + path.relative(process.cwd(), indexFile))
done.forEach(function (line) { console.log('  ' + line) })
