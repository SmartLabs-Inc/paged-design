#!/usr/bin/env node
//
// Turn converter output into designed book HTML.
//
// `docx-to-book.js` gives a faithful but flat document: headings, paragraphs,
// tables and lists in source order. A designed book needs more than that. It
// needs to know which chapter is front matter and which opens a part, which
// heading is a running head, where an entry begins and ends, and — the part
// that actually decides whether the book paginates at all — how much material
// is allowed inside a box that must not break.
//
// That last one is not a nicety. Paged.js has no way to place an element with
// `break-inside: avoid` that is taller than the column: it pushes it to the
// next column, measures again, pushes again, and after a few rounds gives up
// with "Layout repeated at:" and silently stops paginating the rest of the
// document. The last build died that way fifteen per cent from the end, and
// the PDF looked finished — 302 pages, no error, no index. So every keep box
// this pass creates is capped, and `--report` prints what it capped.
//
// The pass is idempotent: running it twice changes nothing, because every
// wrapper it adds is one it also recognises.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node design-pass.js --content <dir> [--report]',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '  --report          List what was wrapped, numbered and capped.',
    '',
    'Reads the flat HTML docx-to-book.js writes and adds the structure the',
    'theme styles: part openers, running heads, entry cards, keep-together',
    'boxes for a heading and its opening lines, and figure wrappers for tables.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

// ---------------------------------------------------------------------------
// A very small block scanner
// ---------------------------------------------------------------------------
// Not a parser. The input is HTML this repo generated, one element per line at
// a known depth, so all that is needed is to walk tags and count depth. It is
// deliberately not tolerant of arbitrary HTML: if the converter's output shape
// changes, this should fail loudly rather than quietly mis-wrap a chapter.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'])

// Split a fragment into its top-level elements, keeping the text between them.
function blocks (html) {
  const out = []
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
  let depth = 0
  let start = 0
  let openName = null
  let match
  let textStart = 0
  while ((match = tag.exec(html)) !== null) {
    const closing = match[1] === '/'
    const name = match[2].toLowerCase()
    const selfClosing = VOID.has(name) || /\/\s*$/.test(match[3])
    if (!closing && depth === 0) {
      if (match.index > textStart) {
        const between = html.slice(textStart, match.index)
        if (between.trim()) out.push({ name: null, html: between })
      }
      start = match.index
      openName = name
      if (selfClosing) {
        out.push({ name: name, html: html.slice(start, tag.lastIndex) })
        textStart = tag.lastIndex
        openName = null
        continue
      }
      depth = 1
      continue
    }
    if (openName === null) continue
    if (!closing && !selfClosing && name === openName) depth += 1
    else if (closing && name === openName) {
      depth -= 1
      if (depth === 0) {
        out.push({ name: name, html: html.slice(start, tag.lastIndex) })
        textStart = tag.lastIndex
        openName = null
      }
    }
  }
  if (html.length > textStart && html.slice(textStart).trim()) {
    out.push({ name: null, html: html.slice(textStart) })
  }
  return out
}

function classOf (element) {
  const match = /^<[a-zA-Z0-9]+[^>]*\bclass="([^"]*)"/.exec(element.html)
  return match ? match[1] : ''
}

function hasClass (element, name) {
  return classOf(element).split(/\s+/).indexOf(name) !== -1
}

function innerOf (element) {
  const open = /^<[a-zA-Z0-9]+[^>]*>/.exec(element.html)
  if (!open) return ''
  return element.html.slice(open[0].length, element.html.lastIndexOf('</'))
}

function textOf (html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeAttr (text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// ---------------------------------------------------------------------------
// How much fits
// ---------------------------------------------------------------------------
// A keep box may not be taller than the column it sits in, or pagination dies
// (see the note at the top). Rather than measure — which needs the paginated
// page, not a probe, and was the single most error-prone thing in the last
// build — this pass budgets in characters and keeps well inside the limit.
//
// The 7x10in textbook sets two 242px columns of 9.5px type: about 62
// characters to the line, and 44 lines to the column. A keep box is allowed
// three lines of the opening paragraph, which is what holds an entry name to
// its first sentences without ever approaching the column height.

const CHARS_PER_LINE = 62
const KEEP_LINES = 3
const KEEP_BUDGET = CHARS_PER_LINE * KEEP_LINES
// A standfirst under a section heading is set across both columns, so it gets
// the full measure, but the same three-line rule and a hard ceiling well under
// the page.
const SPAN_CHARS_PER_LINE = 128
const SPAN_BUDGET = SPAN_CHARS_PER_LINE * 6

// Cut text at a word boundary at or before `budget` characters. Returns null
// when the whole thing already fits, so callers can skip the split.
function cut (text, budget) {
  if (text.length <= budget) return null
  let at = text.lastIndexOf(' ', budget)
  if (at < budget * 0.5) at = budget
  return at
}

// Split a paragraph's inner HTML at roughly `budget` characters of visible
// text, at a word boundary, without cutting inside a tag or an entity.
function splitParagraph (inner, budget) {
  let visible = 0
  let index = 0
  let lastSpace = -1
  while (index < inner.length) {
    const ch = inner[index]
    if (ch === '<') {
      const close = inner.indexOf('>', index)
      if (close === -1) break
      index = close + 1
      continue
    }
    if (ch === '&') {
      const semi = inner.indexOf(';', index)
      if (semi !== -1 && semi - index <= 8) {
        visible += 1
        index = semi + 1
        continue
      }
    }
    if (ch === ' ') lastSpace = index
    visible += 1
    index += 1
    if (visible >= budget && lastSpace > 0) {
      // Do not leave an open tag on the wrong side of the cut.
      const head = inner.slice(0, lastSpace)
      if (balanced(head)) return [head, inner.slice(lastSpace + 1)]
    }
  }
  return null
}

// True when every element opened in the fragment is also closed in it.
function balanced (fragment) {
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g
  const stack = []
  let match
  while ((match = tag.exec(fragment)) !== null) {
    const name = match[2].toLowerCase()
    if (VOID.has(name)) continue
    if (match[1] === '/') {
      if (stack.pop() !== name) return false
    } else if (!/\/\s*>$/.test(match[0])) stack.push(name)
  }
  return stack.length === 0
}

function slug (text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}


// ---------------------------------------------------------------------------
// Things that must not break
// ---------------------------------------------------------------------------

// A person's name is one word as far as a line break is concerned. This ran
// as "…AND THOMA S / GRINBERG" across the foot of the title page, which is the
// sort of thing that gets a proof sent back.
//
// Only display type is treated this way. Doing it in running text would fight
// justification for no benefit — a name broken across two lines of a
// justified column is ordinary, a name broken in a title is a fault.
function protectNames (html) {
  return outsideTags(html, function (text) {
    return text
      // An honorific or a degree stays with the name it belongs to.
      .replace(/,\s+(M\.\s?D\.|Ph\.\s?D\.|D\.O\.|M\.S\.|R\.N\.|M\.B\.A\.)/g, ',\u00A0$1')
      // Given name and surname, with any middle initials.
      .replace(/\b([A-Z][a-z]{2,})\s+((?:[A-Z]\.\s*)*)([A-Z][a-z]{2,})\b/g,
        function (all, first, initials, last) {
          return first + '\u00A0' + initials.replace(/\s+/g, '\u00A0') + last
        })
  })
}

// Apply a text transform to everything that is not inside a tag.
function outsideTags (html, transform) {
  let out = ''
  let index = 0
  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) { out += transform(html.slice(index)); break }
    out += transform(html.slice(index, next))
    const close = html.indexOf('>', next)
    if (close === -1) { out += html.slice(next); break }
    out += html.slice(next, close + 1)
    index = close + 1
  }
  return out
}

// An entry name's parenthetical is a unit. Where it fits on a line of its own
// it moves there whole rather than wrapping mid-phrase; where it is too long
// for that it wraps normally, because a 60-character parenthetical held
// together would leave half a line white above it.
const PAREN_HOLDS = 34

function holdParenthetical (inner) {
  return inner.replace(/\s*\(([^()]{1,200})\)/g, function (all, body) {
    if (body.length > PAREN_HOLDS) return all
    return ' <span class="entry-paren">(' + body + ')</span>'
  })
}

// The abbreviations glossary arrives from Word as a two-column table, which
// sets it full width, one term to a line, over four pages with a third of each
// page white. The theme sets it as a flowing two-column list instead; this is
// the markup that rule wants. The wrapping div inside the dl is not optional:
// `break-inside` on a dt/dd pair does not hold the two together.
function abbreviationList (table) {
  const rows = table.html.match(/<tr\b[\s\S]*?<\/tr>/g) || []
  const pairs = []
  rows.forEach(function (row) {
    if (/<th\b/.test(row)) return
    const cells = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/g) || []
    if (cells.length !== 2) return
    const values = cells.map(function (cell) {
      return cell.replace(/^<td\b[^>]*>/, '').replace(/<\/td>$/, '').trim()
    })
    if (!values[0]) return
    pairs.push('<div class="abbrev"><dt>' + values[0] + '</dt><dd>' + values[1] + '</dd></div>')
  })
  if (pairs.length < 4) return null
  tally.abbreviations = pairs.length
  return '<dl class="abbrev-list">\n' + pairs.join('\n') + '\n</dl>'
}

// Is this the abbreviations table rather than a table of data?
function isAbbreviationTable (table) {
  const head = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/.exec(table.html)
  if (!head) return false
  return /abbreviation|acronym/i.test(textOf(head[1]))
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV']

const tally = {
  parts: 0, frontmatter: 0, endmatter: 0, runHeads: 0,
  entries: 0, leadsSplit: 0, keepLeads: 0, spanCapped: 0, tables: 0, citations: 0, abbreviations: 0, stubsDropped: 0, numeralsStripped: 0
}
const capped = []

function designChapter (component, state) {
  const header = /data-header="([^"]*)"/.exec(component.html)
  const title = header ? header[1] : ''
  const isPart = /^Part\s+[IVXLC]+\b/i.test(title)
  const isIndex = /^alphabetical index/i.test(title)
  const isAbout = /^about\b/i.test(title)

  // The converter wraps every component's content in two plain divs; the theme
  // and Paged.js both rely on that shape, so reach through it rather than
  // rebuilding it.
  const outer = blocks(innerOf(component))
  const outerDiv = outer.filter(function (b) { return b.name === 'div' })[0]
  if (!outerDiv) return component.html
  const innerBlocks = blocks(innerOf(outerDiv))
  const innerDiv = innerBlocks.filter(function (b) { return b.name === 'div' })[0]
  if (!innerDiv) return component.html

  const children = blocks(innerOf(innerDiv))
  let designed
  state.inIndex = isIndex

  if (isPart) {
    state.part += 1
    tally.parts += 1
    designed = designPart(children, title, state)
  } else {
    if (state.part === 0) tally.frontmatter += 1
    else tally.endmatter += 1
    designed = designBody(children, state, { plain: true })
  }
  if (!isIndex) designed = superscriptCitations(designed)

  let classes = 'chapter'
  if (isPart) classes += ' part-' + state.part
  else if (isIndex) classes += ' index endmatter'
  else if (isAbout) classes += ' endmatter'
  else if (state.part === 0) classes += ' frontmatter'

  let html = component.html.replace(/\bclass="([^"]*)"/, function (all, existing) {
    const kept = existing.split(/\s+/).filter(function (c) {
      return c && c !== 'chapter' && !/^part-\d+$/.test(c) &&
        c !== 'index' && c !== 'frontmatter' && c !== 'endmatter'
    })
    return 'class="' + kept.concat(classes.split(' ')).join(' ') + '"'
  })
  html = html.replace(innerOf(innerDiv), '\n' + designed + '\n            ')
  return html
}

function designPart (children, title, state) {
  const match = /^Part\s+([IVXLC]+)\.?\s*(.*)$/i.exec(title)
  const numeral = match ? match[1] : ROMAN[state.part]
  const name = match && match[2] ? match[2] : title

  // The first heading is the part's own title. Replace it with the opener the
  // theme draws: the name large, the numeral as an eyebrow above it.
  const rest = children.slice()
  let opener = ''
  const alreadyOpened = rest.some(function (b) { return hasClass(b, 'part-title') })
  for (let i = 0; i < rest.length && !alreadyOpened; i += 1) {
    if (rest[i].name === 'h2') {
      const id = /\bid="([^"]*)"/.exec(rest[i].html)
      opener = '<h1 class="part-name">' + escapeAttr(name) + '</h1>\n' +
        '<p class="chapter-eyebrow">Part ' + numeral + '</p>\n' +
        '<h2 class="part-title" id="' + (id ? id[1] : slug(title)) +
        '" title="' + escapeAttr(name) + '">' + escapeAttr(name) + '</h2>'
      rest.splice(i, 1)
      break
    }
  }
  const body = designBody(rest, state, { plain: false })
  return opener ? opener + '\n' + body : body
}


// A sub-section heading, its running head, and as much of its opening
// paragraph as fits in a box that must not break. Whatever is left of the
// paragraph comes back as `rest`, to be set normally below the box.
function subsection (heading, following, state) {
  const text = textOf(heading.html)
  const runHead = '<h6 class="run-head">' + escapeAttr(text) + '</h6>'
  tally.runHeads += 1
  tally.keepLeads += 1
  if (!following || following.name !== 'p' || !hasClass(following, 'standfirst')) {
    return { box: heading.html + runHead, rest: '', consumed: 1 }
  }
  const split = splitParagraph(innerOf(following), SPAN_BUDGET)
  if (!split) {
    return { box: heading.html + runHead + following.html, rest: '', consumed: 2 }
  }
  capped.push(text + ' — standfirst held to ' + split[0].length + ' characters')
  tally.spanCapped += 1
  return {
    box: heading.html + runHead + '<p class="standfirst">' + split[0] + '</p>',
    rest: '<p class="standfirst lead-rest">' + split[1] + '</p>',
    consumed: 2
  }
}


// Citations arrive from Word as bracketed numbers in the running text —
// "...development questions.[2]" — 1,772 of them. Set as superscripts they
// stop interrupting the sentence, which is the whole point of a reference
// mark. Runs of adjacent marks merge: [84][85] is one mark reading 84,85.
function superscriptCitations (html) {
  let out = ''
  let index = 0
  while (index < html.length) {
    const next = html.indexOf('<', index)
    const text = next === -1 ? html.slice(index) : html.slice(index, next)
    out += text.replace(/(?:\[\d+(?:[-–,]\s?\d+)*\])+/g, function (run) {
      const numbers = run.slice(1, -1).split(/\]\[/).join(',')
      tally.citations += 1
      return '<sup class="cite">' + numbers + '</sup>'
    })
    if (next === -1) break
    const close = html.indexOf('>', next)
    if (close === -1) { out += html.slice(next); break }
    out += html.slice(next, close + 1)
    index = close + 1
  }
  return out
}

// Everything below a part or chapter title.
function designBody (allChildren, state, options) {
  // Clean the headings before anything looks at them. Doing it inline missed
  // the ones a section opener swallows in its look-ahead, which was all three
  // of the "1. Introduction" stubs.
  //
  // "1. Introduction" is not a heading — it is Word's outline showing through,
  // and the paragraph under it belongs to the section above. A heading that
  // arrives numbered carries a numeral the design does not use.
  const children = []
  allChildren.forEach(function (child) {
    if (!/^h[2-6]$/.test(child.name) || hasClass(child, 'section-head')) {
      children.push(child)
      return
    }
    const text = textOf(child.html)
    if (/^\d+\.\s*introductions?$/i.test(text) || /^introductions?$/i.test(text)) {
      tally.stubsDropped += 1
      return
    }
    if (/^\d+\.\s+\S/.test(text)) {
      tally.numeralsStripped += 1
      children.push({
        name: child.name,
        html: child.html.replace(/(<[^>]*>)\s*\d+\.\s+/, '$1')
      })
      return
    }
    children.push(child)
  })

  const out = []
  let index = 0
  let entryNumber = 0

  while (index < children.length) {
    const node = children[index]

    // Already designed: leave it exactly as it is (idempotence).
    if (node.name === 'div' && (hasClass(node, 'entry') || hasClass(node, 'keep-lead') ||
        hasClass(node, 'table-figure'))) {
      out.push(node.html)
      index += 1
      continue
    }

    // A section heading, set across the columns, with a running head that
    // carries its full name into the top margin.
    if (node.name === 'h2' && !options.plain) {
      const text = textOf(node.html)
      entryNumber = 0
      if (hasClass(node, 'section-head') || hasClass(node, 'part-title')) {
        out.push(node.html)
        index += 1
        continue
      }
      const id = /\bid="([^"]*)"/.exec(node.html)
      const head = '<h2 class="section-head"' + (id ? ' id="' + id[1] + '"' : '') +
        ' title="' + escapeAttr(text) + '">' + innerOf(node) + '</h2>' +
        '<h6 class="run-head">' + escapeAttr(text) + '</h6>'
      tally.runHeads += 1
      // A sub-section box directly below is folded into the same spanner, or
      // the two of them fight over the top of the page and neither wins.
      const below = children[index + 1]
      if (below && (below.name === 'h3' || below.name === 'h4')) {
        const group = subsection(below, children[index + 2], state)
        out.push('<div class="keep-lead lead-section section-opener">' + protectNames(head) +
          protectNames(group.box) + '</div>')
        if (group.rest) out.push(group.rest)
        index += group.consumed + 1
        continue
      }
      out.push('<div class="keep-lead section-opener">' + head + '</div>')
      index += 1
      continue
    }

    // A sub-section heading and the paragraph that introduces it belong
    // together, across both columns, in a tinted panel.
    if ((node.name === 'h3' || node.name === 'h4') && !options.plain) {
      const text = textOf(node.html)
      // On a second run the heading arrives with the running head this pass
      // gave it last time, immediately before it. Anything else in that slot —
      // the group built for the heading above, say — is not that.
      const previous = (out[out.length - 1] || '').trim()
      if (/^<h6 class="run-head">.*<\/h6>$/.test(previous) && textOf(previous) === text) {
        out.push(node.html)
        index += 1
        continue
      }
      entryNumber = 0
      const group = subsection(node, children[index + 1], state)
      out.push('<div class="keep-lead lead-section">' + protectNames(group.box) + '</div>')
      if (group.rest) out.push(group.rest)
      index += group.consumed
      continue
    }

    // An entry: the name, and every paragraph up to the next heading.
    if (node.name === 'h5' && hasClass(node, 'entry-name')) {
      entryNumber += 1
      // An entry runs through its own paragraphs and stops at anything else.
      // Stopping only at headings is not enough: when the references label
      // stopped being an <h6> and became the paragraph it always was, every
      // reference list in the book was swallowed into the entry above it,
      // and pagination died on page 44.
      const body = []
      let scan = index + 1
      while (scan < children.length) {
        const following = children[scan]
        if (following.name === null) { scan += 1; continue }
        if (following.name !== 'p') break
        if (hasClass(following, 'reference-section') || hasClass(following, 'standfirst')) break
        body.push(following)
        scan += 1
      }
      out.push(buildEntry(node, body, entryNumber))
      tally.entries += 1
      index = scan
      continue
    }

    if (node.name === 'table') {
      if (isAbbreviationTable(node)) {
        const list = abbreviationList(node)
        if (list) { out.push(list); index += 1; continue }
      }
      out.push('<div class="table-figure">' + node.html + '</div>')
      tally.tables += 1
      index += 1
      continue
    }

    out.push(node.html)
    index += 1
  }
  return out.join('\n')
}

// The entry card. The name and the opening lines are held together so a name
// never sits alone at the foot of a column; everything past that is free to
// break, which is what keeps the keep box under the column height.
function buildEntry (heading, body, number) {
  const text = textOf(heading.html)
  const id = 'e-' + slug(text)
  const name = protectNames(holdParenthetical(innerOf(heading)))
  const head = '<h5 id="' + id + '"><span class="entry-number">' + number +
    '</span>' + name + '</h5>'

  if (!body.length) return '<div class="entry">\n<div class="entry-lead">' + head + '</div>\n</div>'

  const first = body[0]
  const rest = body.slice(1).map(function (b) { return b.html })

  if (first.name !== 'p') {
    return '<div class="entry">\n<div class="entry-lead">' + head + '</div>\n' +
      [first.html].concat(rest).join('\n') + '\n</div>'
  }

  const inner = innerOf(first)
  const split = splitParagraph(inner, KEEP_BUDGET)
  if (!split) {
    return '<div class="entry">\n<div class="entry-lead">' + head + '\n' +
      first.html + '</div>\n' + rest.join('\n') + '\n</div>'
  }
  tally.leadsSplit += 1
  return '<div class="entry">\n<div class="entry-lead">' + head + '\n' +
    '<p class="lead-head">' + split[0] + '</p></div>\n' +
    '<p class="lead-rest">' + split[1] + '</p>\n' + rest.join('\n') + '\n</div>'
}

// The legal wording the author keeps on the title page belongs on the page
// after it, so the title page can be a title page.
function splitTitlePage (component) {
  const outer = blocks(innerOf(component))
  const outerDiv = outer.filter(function (b) { return b.name === 'div' })[0]
  if (!outerDiv) return null
  const innerBlocks = blocks(innerOf(outerDiv))
  const innerDiv = innerBlocks.filter(function (b) { return b.name === 'div' })[0]
  if (!innerDiv) return null
  const children = blocks(innerOf(innerDiv))

  const keep = []
  const move = []
  for (const child of children) {
    const isTitleMatter = child.name === 'h1' ||
      hasClass(child, 'title-page-subtitle') || hasClass(child, 'title-page-author')
    if (isTitleMatter && move.length === 0) keep.push(protectNames(child.html))
    else move.push(child.html)
  }
  if (!move.length) return null

  const title = component.html.replace(innerOf(innerDiv), '\n' + keep.join('\n') + '\n            ')
  const classes = /class="([^"]*)"/.exec(component.html)[1]
    .replace(/\btitle-page\b/, 'copyright-page').replace(/\bpage-1\b/, '').trim()
  const copyright = '<div class="' + classes + '">\n        <div>\n            <div>\n' +
    move.join('\n') + '\n            </div>\n        </div>\n    </div>'
  return title + '\n\n    ' + copyright
}

// ---------------------------------------------------------------------------

const contentDir = path.resolve(args.content)
const indexFile = path.join(contentDir, 'index.html')
if (!fs.existsSync(indexFile)) {
  console.error('No index.html in ' + contentDir)
  process.exit(1)
}

const html = fs.readFileSync(indexFile, 'utf8')
const bodyOpen = html.indexOf('<body>')
const bodyClose = html.lastIndexOf('</body>')
if (bodyOpen === -1 || bodyClose === -1) {
  console.error('index.html has no <body>')
  process.exit(1)
}

const head = html.slice(0, bodyOpen + '<body>'.length)
const tail = html.slice(bodyClose)
const components = blocks(html.slice(bodyOpen + '<body>'.length, bodyClose))

const state = { part: 0 }
const rebuilt = components.map(function (component) {
  if (component.name !== 'div') return component.html
  if (hasClass(component, 'title-page')) {
    return splitTitlePage(component) || component.html
  }
  if (hasClass(component, 'chapter')) return designChapter(component, state)
  return component.html
})

fs.writeFileSync(indexFile, head + '\n    ' + rebuilt.join('\n\n    ') + '\n' + tail)

console.log('Designed ' + path.relative(process.cwd(), indexFile))
console.log('  parts ' + tally.parts + ' · front matter ' + tally.frontmatter +
  ' · end matter ' + tally.endmatter)
console.log('  entries ' + tally.entries + ' (' + tally.leadsSplit + ' leads split)' +
  ' · keep boxes ' + tally.keepLeads + ' (' + tally.spanCapped + ' capped)' +
  ' · running heads ' + tally.runHeads + ' · tables ' + tally.tables +
  ' · citation marks ' + tally.citations +
  (tally.abbreviations ? ' · abbreviations set as a list ' + tally.abbreviations : ''))
if (tally.stubsDropped || tally.numeralsStripped) {
  console.log('  dropped ' + tally.stubsDropped + ' "N. Introduction" stubs · ' +
    'stripped ' + tally.numeralsStripped + ' heading numerals')
}

if (args.report && capped.length) {
  console.log('\nCapped so the keep box cannot outgrow its column:')
  for (const line of capped.slice(0, 40)) console.log('  ' + line)
  if (capped.length > 40) console.log('  … and ' + (capped.length - 40) + ' more')
}
