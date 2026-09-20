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
    '  --acknowledgement-from <text>',
    '                     Move the paragraph containing this text — wherever it',
    '                     is — onto the acknowledgements page.',
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
// The contents, the copyright notice and the abbreviations
// ---------------------------------------------------------------------------
// Three pages that each follow a convention of their own, and each needs
// markup the converter cannot infer from a heading and a list.

if (addClasses('Copyright', 'copyright-page')) done.push('Copyright page classed')
if (addClasses('Contents', 'contents-page')) done.push('Contents page classed')

// A contents is a list of links until it is told it is a contents. The class
// is what turns the page number on: the theme prints
// `target-counter(attr(href), page)` against the right margin, so the numbers
// come from the pagination itself rather than from a second pass over the
// book.
let tocLists = 0
{
  const contents = findComponent('Contents')
  if (contents) {
    const block = html.slice(contents.start, contents.end)
    let first = true
    const listed = block.replace(/<ul>/g, function () {
      tocLists += 1
      if (first) { first = false; return '<ul class="toc-list">' }
      return '<ul>'
    })
    html = html.slice(0, contents.start) + listed + html.slice(contents.end)
    if (tocLists) done.push('contents set as a list with page numbers')
  }
}

// The abbreviations arrive as a two-column table, which sets as a table: one
// pair to a row, the width of the page, sixty-five rows and four pages of it.
// As a definition list the same pairs flow in two columns and take one page,
// and the theme already knows how to set one — the Word route built this and
// the Markdown route never did, which is why it came back wrong.
{
  const abbreviations = findComponent('List of Abbreviations')
  if (abbreviations) {
    const block = html.slice(abbreviations.start, abbreviations.end)
    // A bare `<table>` at this stage: the design pass, which wraps tables in
    // `.table-figure`, has not run yet and must not find one here to wrap.
    const table = /(?:<div class="table-figure">\s*)?<table>[\s\S]*?<\/table>(?:\s*<\/div>)?/.exec(block)
    if (table) {
      const pairs = []
      const row = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g
      let found
      while ((found = row.exec(table[0])) !== null) {
        const term = found[1].replace(/<\/?strong>/g, '').trim()
        const expansion = found[2].replace(/<\/?strong>/g, '').trim()
        if (term) pairs.push('<div class="abbrev"><dt>' + term + '</dt><dd>' + expansion + '</dd></div>')
      }
      if (pairs.length) {
        const list = '<dl class="abbrev-list">\n' + pairs.join('\n') + '\n</dl>'
        const rebuilt = block.slice(0, table.index) + list + block.slice(table.index + table[0].length)
        html = html.slice(0, abbreviations.start) + rebuilt + html.slice(abbreviations.end)
        done.push(pairs.length + ' abbreviations set as a list rather than a table')
      }
    }
  }
}


// ---------------------------------------------------------------------------
// An anchor belongs to the section it names
// ---------------------------------------------------------------------------
// The converter leaves each section's anchors at the foot of the section
// before it — that is where they sit in the manuscript, ahead of the heading
// they introduce. In a scrolling document that is close enough. In a paginated
// one it is a page number that is simply wrong: every contents entry resolved
// to the last page of the preceding section, so the Disclaimer, which begins
// on page 5, printed as page 2.
//
// It is not only the contents. Every index locator in the book comes from the
// same anchors and was wrong the same way.
//
// So a run of empty anchors at the end of a component moves to the top of the
// next one, ahead of its heading, where the section it names actually starts.
//
// Before the dedication and the sponsor recto are inserted, not after. Run
// afterwards, "the next component" is whichever blank page was just put in,
// and the Disclaimer's anchors landed on the dedication — the contents said
// page 3 for a section that begins on page 5.

let carried = 0
{
  const opening = /<div class="[^"]*"[^>]*>\n\s*<div>\n\s*<div>/g
  const components = []
  let found
  while ((found = opening.exec(html)) !== null) {
    components.push({ start: found.index, contentAt: found.index + found[0].length })
  }

  const trailingAnchors = /((?:\s*<a id="[^"]*"><\/a>)+)\s*$/

  // Back to front, and within each step the later edit first, so no offset is
  // used after something before it has moved.
  for (let i = components.length - 2; i >= 0; i -= 1) {
    const bodyStart = components[i].contentAt
    const bodyEnd = html.lastIndexOf('</div>', html.lastIndexOf('</div>',
      html.lastIndexOf('</div>', components[i + 1].start)  - 1) - 1)
    const body = html.slice(bodyStart, bodyEnd)
    const match = trailingAnchors.exec(body)
    if (!match) continue

    const anchors = match[1].trim()
    carried += (anchors.match(/<a /g) || []).length

    const into = components[i + 1].contentAt
    html = html.slice(0, into) + '\n' + anchors + html.slice(into)
    html = html.slice(0, bodyStart + match.index) + html.slice(bodyStart + match.index + match[1].length)
  }
  if (carried) done.push(carried + ' anchors moved to the section they name')
}

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

// A thank-you the author wrote into the Preface, lifted out and set where it
// belongs. It is done here rather than in the manuscript because the
// manuscript is the file the author delivered and the book is rebuilt from it
// on every run: an edit made in the delivered file is an edit that disappears
// the next time he sends a new one, and an edit made only in the built HTML
// is an edit that disappears on the next build.
//
// The paragraph is found by a fragment of its own text rather than by
// position, so it still moves if the Preface is rewritten around it, and the
// run says plainly whether it found it.

let lifted = ''
if (args['acknowledgement-from']) {
  const fragment = String(args['acknowledgement-from'])
  const paragraph = new RegExp('<p>([^<]*' +
    fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^<]*)</p>\\s*')
  const found = paragraph.exec(html)
  if (found) {
    lifted = found[1]
    html = html.slice(0, found.index) + html.slice(found.index + found[0].length)
    done.push('moved to the acknowledgements: "' + lifted.slice(0, 60) + '…"')
  } else {
    done.push('WARNING: nothing containing "' + fragment + '" to move to the acknowledgements')
  }
}

if (args.acknowledgements && !/\backnowledgements-page\b/.test(html)) {
  insertBefore('About Alexander Grinberg, M.D.',
    component('acknowledgements-page endmatter', 'Acknowledgements',
      '                <h1 class="heading-2">Acknowledgements</h1>' +
      (lifted ? '\n                <p>' + lifted + '</p>' : '')),
    'acknowledgements page added')
}

// ---------------------------------------------------------------------------
// A component with no h1 leaves the last one showing
// ---------------------------------------------------------------------------
// The verso footer prints `string(h1-text, first)`, and the converter gives a
// component from a top-level heading an `h2`. So the reference section, which
// has no h1 anywhere in it, printed ACKNOWLEDGEMENTS at the foot of all 238
// of its pages — the last h1 before it — and so did the index.
//
// The heading is promoted rather than a hidden marker added, because that is
// what the dedication and acknowledgements pages already are: an h1 wearing
// `.heading-2`, which is the size an opening heading is set at here.

// Front and back matter only. A part opener's heading is not a heading yet —
// the design pass reads that `h2` and builds the opener out of it, the part
// name in the display face over a tracked-out "Part III" — and promoting it
// here left the pass nothing to find. Five part openers came out as a plain
// line of text on a four-per-cent page, which is what "the section title
// pages have lost their format" turned out to mean.
let promoted = 0
html = html.replace(/<div class="([^"]*)"[^>]*data-header="[^"]*"[^>]*>[\s\S]*?(?=\n    <div class=|<\/body>)/g,
  function (block, classes) {
    if (!/\b(?:frontmatter|endmatter|contents-page)\b/.test(classes)) return block
    if (/<h1[\s>]/.test(block)) return block
    return block.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/, function (all, attrs, text) {
      promoted += 1
      return '<h1 class="heading-2"' + attrs + '>' + text + '</h1>'
    })
  })
if (promoted) done.push(promoted + ' component heading' + (promoted === 1 ? '' : 's') +
  ' promoted so the footer names the section')


// ---------------------------------------------------------------------------
// One id, one place
// ---------------------------------------------------------------------------
// The converter leaves an empty anchor at the foot of each component for the
// component that follows it, so a section's id can exist twice: once on that
// anchor and once on the heading itself. In one HTML file the first one wins,
// which is the anchor — so the contents entry for "References" resolves to the
// foot of the index, and prints the index's page number.

const holders = {}
let ids = /\bid="([^"]+)"/g
let found
while ((found = ids.exec(html)) !== null) holders[found[1]] = (holders[found[1]] || 0) + 1

let duplicates = 0
html = html.replace(/<a id="([^"]+)"><\/a>\s*/g, function (all, target) {
  if ((holders[target] || 0) < 2) return all
  holders[target] -= 1
  duplicates += 1
  return ''
})
if (duplicates) done.push(duplicates + ' duplicate id' + (duplicates === 1 ? '' : 's') +
  ' removed from empty anchors')

fs.writeFileSync(indexFile, html)

console.log('Front and back matter in ' + path.relative(process.cwd(), indexFile))
done.forEach(function (line) { console.log('  ' + line) })
