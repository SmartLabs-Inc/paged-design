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
    '  --dedication-from <file>',
    '                     Set that page with this copy. Without it the page is',
    '                     reserved and blank, which is still a counted recto.',
    '  --acknowledgements Add an acknowledgements page in the back matter.',
    '  --acknowledgement-from <text>',
    '                     Move the paragraph containing this text — wherever it',
    '                     is — onto the acknowledgements page.',
    '  --copyright-from <file>',
    '                     Replace the copyright page copy with this file.',
    '  --about-from <file>',
    '                     Replace the About the Author copy with this file.',
    '  --about-portrait <filename>',
    '                     Open that page with this image, named as the book',
    '                     asks for it — the figure pass supplies the file.',
    '  --drop-references  Lift the reference list out of the book, and its line',
    '                     out of the contents. The citation superscripts stay:',
    '                     they key into the list wherever it is published.',
    '  --references-at <url>',
    '                     Lift the list out but keep the section, replaced by a',
    '                     page telling the reader where to get it. Implies',
    '                     --drop-references and keeps the contents line.',
    '  --acknowledgements-front',
    '                     Put the acknowledgements after the dedication rather',
    '                     than in the back matter.',
    '  --about-last       Move the About the Author page to the end of the book.',
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

// The About page's title is the author's name. It was written out in full in
// three places in this file, which is three places to change for the next book
// and three chances to miss one — the page would simply stop being classed,
// and the only sign would be a biography set like a chapter. Read once from
// the document instead.
// Anchors, then the component's own heading, then the body. The heading is an
// `h2` here and an `h1` after the promotion pass below has run, and matching
// only `h1` meant this worked on a file that had already been through the
// script once and did nothing at all on a fresh build — the failure this
// pipeline keeps finding, in a new place.
const COMPONENT_BODY = /^([\s\S]*?<div>\s*<div>\s*(?:<a id="[^"]*"><\/a>\s*)*(?:<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)?)([\s\S]*?)(\n?\s*<\/div>\s*<\/div>\s*<\/div>\s*)$/

const ABOUT_PAGE = (/data-header="(About [^"]*)"/.exec(html) || [])[1] || 'About the Author'

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
if (addClasses(ABOUT_PAGE, 'endmatter about-page')) done.push('About classed')
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

// The reference list is published separately for this edition. Lifting it here
// rather than cutting it out of the manuscript keeps one source of truth: the
// manuscript still carries every entry, and the decision about where the list
// is delivered stays a build option.
//
// The citation superscripts stay exactly where they are. They are the key into
// the list, and they are correct whether the list is bound in or handed over
// on its own.
if (args['references-at']) {
  // The list goes, the section stays. A reader who meets superscript 3,591 and
  // turns to the back needs to find something there; an absence is not an
  // answer, and the contents entry still has a real page to point at.
  const url = String(args['references-at'])
  const found = findComponent('References')
  if (!found) {
    done.push('WARNING: no reference list to replace')
  } else {
    const block = html.slice(found.start, found.end)
    const body = COMPONENT_BODY.exec(block)
    if (!body) {
      done.push('WARNING: could not find the reference list body to replace')
    } else {
      const shown = url.replace(/^https?:\/\//, '')
      const notice =
        '<p>The sources cited throughout this book are published as a separate ' +
        'reference list, so that it can be corrected and extended between ' +
        'printings without reissuing the volume.</p>\n' +
        '<p class="references-url"><a href="' + url + '">' + shown + '</a></p>\n' +
        '<p>The superscript numbers in the text are the keys into that list. ' +
        'They are stable: a number printed here will always name the same ' +
        'source.</p>'
      // Off with `references`, which sets this component two-column at eight
      // point. That is right for 3,750 entries and wrong for three sentences.
      const head = body[1].replace(/class="([^"]*)"/, function (all, cls) {
        return 'class="' + cls.replace(/\breferences\b/, 'references-notice') + '"'
      })
      html = html.slice(0, found.start) + head + '\n' + notice + body[3] +
        html.slice(found.end)
      done.push('reference list replaced by a pointer to ' + shown)
    }
  }
} else if (args['drop-references']) {
  const found = findComponent('References')
  if (!found) {
    done.push('WARNING: no reference list to drop')
  } else {
    html = html.slice(0, found.start) + html.slice(found.end)
    // And its line in the contents, which would otherwise print a page number
    // for a section that is not there. Only that line: an earlier attempt at
    // this matched on the word "reference" and took two real index entries
    // with it.
    const n = (html.match(/\n?\s*<li><a href="#references">[^<]*<\/a><\/li>/g) || []).length
    html = html.replace(/\n?\s*<li><a href="#references">[^<]*<\/a><\/li>/g, '')
    done.push('reference list lifted out (' + n + ' contents line' +
      (n === 1 ? '' : 's') + ' removed)')
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

// The copyright page is the publisher's, not the author's
// ---------------------------------------------------------------------------
// Imprint, edition, ISBN, the rights reservation and the text-and-data-mining
// notice all come from the publisher, arrive after the manuscript does, and
// change again between the proof and the press. The manuscript carries a short
// placeholder so the page is never empty; `--copyright-from` swaps the real
// copy in at build time. Editing it into the delivered manuscript instead
// would mean editing it back in on every redelivery, which is how the
// disclaimer went stale once already.
//
// The heading and the anchors above it stay exactly where they are. The h1 is
// hidden by the theme but it is what the verso footer reads, and the anchors
// are what the contents page counts a page number from — this replaces the
// body under them and nothing else.

// Markdown thin enough to be worth doing here: paragraphs, `**bold**`,
// `*italic*`, and — for the copyright page — a `#` title and `##` subtitle.
// `headings` decides what those two become, and a caller that passes nothing
// gets them as ordinary paragraphs rather than markup nobody has looked at on
// a page.
function bodyMarkup (source, headings) {
  function escapeText (text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // The rest of the book is set with typographic punctuation by the
      // converter. This text never passes through it, so it is done here or
      // the one page in the book with straight quotes is the legal one.
      .replace(/(^|[\s([])"/g, '$1“').replace(/"/g, '”')
      .replace(/(^|[\s([])'/g, '$1‘').replace(/'/g, '’')
  }
  function inline (text) {
    return escapeText(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  }
  return source.replace(/\r\n?/g, '\n').split(/\n{2,}/)
    .map(function (para) { return para.trim() })
    .filter(Boolean)
    .map(function (para) {
      // A single newline inside a paragraph is a line the publisher wants
      // kept — "All rights reserved." under the copyright line, the ISBN
      // under the edition — not a paragraph of its own, which would take the
      // paragraph spacing with it.
      const heading = /^(#{1,2})\s+(.*)$/.exec(para)
      if (heading) {
        const text = inline(heading[2].trim())
        return headings ? headings(heading[1].length, text) : '<p>' + text + '</p>'
      }
      return '<p>' + para.split('\n').map(function (line) {
        return inline(line.trim())
      }).join('<br />') + '</p>'
    }).join('\n')
}


function replaceCopy (what, found, option, headings, arrange) {
  if (!args[option]) return
  const file = path.resolve(args[option])
  if (!fs.existsSync(file)) {
    done.push('WARNING: no such ' + what + ' file: ' + file)
    return
  }
  if (!found) {
    done.push('WARNING: no ' + what + ' page to replace the copy on')
    return
  }
  const body = COMPONENT_BODY.exec(html.slice(found.start, found.end))
  if (!body) {
    done.push('WARNING: could not find the ' + what + ' body to replace')
    return
  }
  let markup = bodyMarkup(fs.readFileSync(file, 'utf8'), headings)
  if (arrange) markup = arrange(markup)
  html = html.slice(0, found.start) + body[1] + '\n' + markup +
    body[3] + html.slice(found.end)
  done.push(what + ' copy replaced from ' + path.basename(file) +
    ' (' + (markup.match(/<p[ >]/g) || []).length + ' paragraphs)')
}

replaceCopy('copyright', findComponent('Copyright'), 'copyright-from',
  function (level, text) {
    return '<p class="copyright-' + (level === 1 ? 'title' : 'subtitle') +
      '">' + text + '</p>'
  })

// The author's biography is the other page the manuscript cannot be the source
// of truth for. It is written for a different reader than the book — a
// programme committee, a conference chair — it is checked against a CV rather
// than against the text, and it goes stale on a schedule of its own. Same
// mechanism, same reason: the delivered manuscript is not edited.
//
// Found by prefix rather than by the author's name, which is hard-coded twice
// already in this file and should not be a third time.
{
  const about = findComponent(ABOUT_PAGE)

  // The portrait goes at the head of the first column, at the width of that
  // column. `src` is the bare filename, the same contract the part banners
  // work to: the figure pass copies whatever the book asks for out of the art
  // folder, and leaves a marked slot when it is not there yet.
  //
  // The alt text is the subject's name, read off the component's own title
  // rather than written here. A portrait is the one image on this page whose
  // alt text is not a judgement call.
  //
  // It goes first, at the head of the column, and the theme stops the opening
  // paragraph of this one page from spanning so that it can. Both orders were
  // tried on the page and both failed, in different ways.
  //
  // The theme spans a back-matter page's heading and its opening paragraph
  // across both columns. Between those two spanners the picture opens a
  // two-column region containing nothing else: it fills the first column and
  // the second stays empty for its whole height, which cost the page a third
  // of its capacity and ran the biography twelve lines onto a second page.
  // Moved below the standfirst instead, it became a keep box immediately
  // after a spanner, which Paged.js could not place at all — it pushed the
  // entire region to the next page and left the standfirst alone on an
  // otherwise empty leaf.
  //
  // With the standfirst not spanning there is one column region, and the
  // picture heads it with the whole biography to flow past it.
  let portrait = ''
  if (args['about-portrait'] && about) {
    const title = /data-header="About\s+([^"]*)"/.exec(about.openTag)
    portrait = '<div class="author-portrait"><img src="' +
      String(args['about-portrait']).replace(/"/g, '&quot;') + '" alt="' +
      (title ? title[1] : 'The author').replace(/"/g, '&quot;') + '" /></div>\n'
  }

  replaceCopy('about the author', about, 'about-from', null, function (markup) {
    return portrait + markup
  })
}

// ---------------------------------------------------------------------------
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
  // The copy is set here rather than replaced afterwards, because this page
  // does not exist until this line runs. Without a file the page is reserved
  // and blank — still a counted recto, so every folio after it stays put when
  // the wording finally arrives.
  //
  // `has-dedication` is what hides the word "Dedication" above the text. The
  // h1 stays in the document either way: it is what the PDF bookmarks and the
  // verso footer read. On a page that is still blank it is the only thing on
  // it, and a reserved page that says what it is reserved for is worth more
  // in a proof than an empty leaf.
  let classes = 'dedication-page frontmatter'
  let inner = '                <h1 class="heading-2">Dedication</h1>'
  let label = 'dedication page added'
  if (args['dedication-from']) {
    const file = path.resolve(args['dedication-from'])
    if (!fs.existsSync(file)) {
      done.push('WARNING: no such dedication file: ' + file)
    } else {
      classes += ' has-dedication'
      inner += '\n' + bodyMarkup(fs.readFileSync(file, 'utf8'), null)
      label += ' and set from ' + path.basename(file)
    }
  }
  insertAfter('Copyright', component(classes, 'Dedication', inner), label)
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
  // In the front, after the dedication, when asked. A thank-you the reader
  // meets on the way in reads as the author's; the same page at the back of a
  // reference book is never reached.
  if (args['acknowledgements-front']) {
    insertAfter('Dedication',
      component('acknowledgements-page frontmatter', 'Acknowledgements',
        '                <h1 class="heading-2">Acknowledgements</h1>' +
        (lifted ? '\n                <p>' + lifted + '</p>' : '')),
      'acknowledgements page added after the dedication')
  } else insertBefore(ABOUT_PAGE,
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

// ---------------------------------------------------------------------------
// The author goes last
// ---------------------------------------------------------------------------
// After every insertion above, so "last" means last. The component moves
// whole, with its classes and its anchors, and the index ends up ahead of it —
// which is the order a reference book wants: the reader finishes with the
// apparatus, then the person who wrote it.

if (args['about-last']) {
  const about = findComponent(ABOUT_PAGE)
  if (!about) {
    done.push('WARNING: no About page to move')
  } else {
    const block = html.slice(about.start, about.end)
    const rest = html.slice(0, about.start) + html.slice(about.end)
    const body = rest.lastIndexOf('</body>')
    if (body === -1) {
      done.push('WARNING: no </body> to move the About page before')
    } else {
      html = rest.slice(0, body) + '\n    ' + block.trim() + '\n\n' + rest.slice(body)
      done.push('About the Author moved to the last page')
    }
  }
}

fs.writeFileSync(indexFile, html)

console.log('Front and back matter in ' + path.relative(process.cwd(), indexFile))
done.forEach(function (line) { console.log('  ' + line) })
