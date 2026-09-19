#!/usr/bin/env node
//
// The design layer for a book converted from Markdown.
//
// `design-pass.js` reads what the Word converter emits — `h5.entry-name`,
// `p.standfirst`, styles inferred from a Word template. Markdown gives plain
// heading levels instead, and for this book they mean:
//
//     h2   the component title — a part, or a front-matter section
//     h3   a section            I. Foundations
//     h4   a sub-section        Peptide Identity and Evidence Transfer
//     h5   an entry             B7-33
//     h6   a label inside it    Applications, Practical Considerations
//
// Everything this adds is the same design the Word route builds: part
// openers, section heads that span and break the page, sub-section panels,
// entry cards, and the running heads.
//
// The rule that decides whether the book paginates at all is unchanged, and
// it is the reason this file is careful about boxes: Paged.js cannot place a
// `break-inside: avoid` element taller than its column. It pushes, measures,
// pushes again, gives up with "Layout repeated at:" and silently stops
// paginating the rest of the document, having written a plausible PDF. So
// every keep box here is budgeted, and two spanners never sit next to each
// other.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node design-md.js --content <dir> [--report]',
    '',
    '  --content <dir>   Book directory holding index.html, rewritten in place.',
    '  --report          List what was capped.',
    '',
    'Adds part openers, section heads, sub-section panels, entry cards and the',
    'running heads to a book converted from Markdown.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'])

// Split a fragment into its top-level elements. Not a parser: the input is
// HTML this repo generated, so walking tags and counting depth is enough.
function blocks (html) {
  const out = []
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
  let depth = 0
  let start = 0
  let openName = null
  let textStart = 0
  let match
  while ((match = tag.exec(html)) !== null) {
    const closing = match[1] === '/'
    const name = match[2].toLowerCase()
    const selfClosing = VOID.has(name) || /\/\s*$/.test(match[3])
    if (!closing && depth === 0) {
      if (match.index > textStart && html.slice(textStart, match.index).trim()) {
        out.push({ name: null, html: html.slice(textStart, match.index) })
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

function idOf (element) {
  const match = /\bid="([^"]*)"/.exec(element.html)
  return match ? match[1] : ''
}

// ---------------------------------------------------------------------------
// How much is allowed inside a box that must not break
// ---------------------------------------------------------------------------
// Budgeted in characters rather than measured. Measuring needs the paginated
// page — a probe host disagrees with it — and was the most error-prone thing
// in the previous build. Three lines holds a heading to its opening sentences
// without ever approaching the column height.

const CHARS_PER_LINE = 62
const KEEP_BUDGET = CHARS_PER_LINE * 3
const SPAN_CHARS_PER_LINE = 128
const SPAN_BUDGET = SPAN_CHARS_PER_LINE * 5

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

// Split a paragraph's inner HTML at a word boundary near `budget` characters
// of visible text, without cutting inside a tag or an entity.
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
      const head = inner.slice(0, lastSpace)
      if (balanced(head)) return [head, inner.slice(lastSpace + 1)]
    }
  }
  return null
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

const tally = {
  parts: 0, sections: 0, subsections: 0, entries: 0, labels: 0,
  tables: 0, captions: 0, figures: 0, capped: 0
}
const capped = []

// The running heads. Two named strings, each set from exactly one selector,
// because Paged.js keeps one selector per string identifier and the last rule
// in the stylesheet wins globally. The markers are zero-height: they exist to
// be read by the margin boxes, not to be seen.
function sectionMark (text) {
  tally.sections += 1
  return '<p class="run-head">' + escapeAttr(text) + '</p>'
}

function topicMark (text) {
  return '<p class="topic-head">' + escapeAttr(text) + '</p>'
}

// ---------------------------------------------------------------------------

function designComponent (component) {
  const header = /data-header="([^"]*)"/.exec(component.html)
  const title = header ? header[1] : ''
  const isPart = /^Part\s+[IVXLC]+\b/i.test(title)
  const plain = !isPart

  const outer = blocks(innerOf(component))
  const outerDiv = outer.filter(function (b) { return b.name === 'div' })[0]
  if (!outerDiv) return component.html
  const innerBlocks = blocks(innerOf(outerDiv))
  const innerDiv = innerBlocks.filter(function (b) { return b.name === 'div' })[0]
  if (!innerDiv) return component.html

  const children = blocks(innerOf(innerDiv))
  let designed

  if (isPart) {
    tally.parts += 1
    designed = designPart(children, title)
  } else {
    designed = designBody(children, { plain: true })
  }

  let html = component.html
  if (isPart) {
    html = html.replace(/\bclass="([^"]*)"/, function (all, existing) {
      return existing.indexOf('part-') === -1
        ? 'class="' + existing + ' part-' + tally.parts + '"'
        : all
    })
  }
  return html.replace(innerOf(innerDiv), '\n' + designed + '\n            ')
}

function designPart (children, title) {
  const match = /^Part\s+([IVXLC]+)\.?\s*(.*)$/i.exec(title)
  const numeral = match ? match[1] : ROMAN[tally.parts]
  const name = match && match[2] ? match[2] : title

  const rest = children.slice()
  let opener = ''
  const already = rest.some(function (b) { return hasClass(b, 'part-title') })
  for (let i = 0; i < rest.length && !already; i += 1) {
    if (rest[i].name === 'h2') {
      opener = '<h1 class="part-name">' + escapeAttr(name) + '</h1>\n' +
        '<p class="chapter-eyebrow">Part ' + numeral + '</p>\n' +
        '<h2 class="part-title" id="' + (idOf(rest[i]) || 'part-' + tally.parts) +
        '" title="' + escapeAttr(name) + '">' + escapeAttr(name) + '</h2>'
      rest.splice(i, 1)
      break
    }
  }
  const body = designBody(rest, { plain: false })
  return opener ? opener + '\n' + body : body
}

// A sub-section heading and the opening of the paragraph under it, held
// together across both columns in a tinted panel.
function subsection (heading, following) {
  const text = textOf(heading.html)
  const mark = sectionMark(text)
  tally.subsections += 1
  if (!following || following.name !== 'p' || hasClass(following, 'run-head')) {
    return { box: heading.html + mark, rest: '', consumed: 1 }
  }
  const split = splitParagraph(innerOf(following), SPAN_BUDGET)
  if (!split) {
    return { box: heading.html + mark + following.html, rest: '', consumed: 2 }
  }
  capped.push(text + ' — held to ' + split[0].length + ' characters')
  tally.capped += 1
  return {
    box: heading.html + mark + '<p class="standfirst">' + split[0] + '</p>',
    rest: '<p class="standfirst lead-rest">' + split[1] + '</p>',
    consumed: 2
  }
}

function designBody (allChildren, options) {
  // Clean the headings before anything looks at them: a numbered stub is
  // Word's outline showing through, and the paragraph under it belongs to the
  // section above.
  const children = []
  allChildren.forEach(function (child) {
    if (/^h[2-6]$/.test(child.name)) {
      const text = textOf(child.html)
      if (/^(\d+\.\s*)?introductions?$/i.test(text)) return
      if (/^\d+\.\s+\S/.test(text)) {
        children.push({ name: child.name,
          html: child.html.replace(/(<[^>]*>)\s*\d+\.\s+/, '$1') })
        return
      }
    }
    children.push(child)
  })

  const out = []
  let index = 0
  let entryNumber = 0

  while (index < children.length) {
    const node = children[index]

    if (node.name === 'div' && (hasClass(node, 'entry') || hasClass(node, 'keep-lead') ||
        hasClass(node, 'table-figure') || hasClass(node, 'figure'))) {
      out.push(node.html)
      index += 1
      continue
    }

    // h3 — a section. Spans the columns and opens a page. A sub-section
    // directly below is folded into the same box: two spanners in a row
    // cannot both open a page, and the second gets pushed, leaving the
    // opener four per cent full.
    if (node.name === 'h3' && !options.plain) {
      const text = textOf(node.html)
      entryNumber = 0
      const head = '<h3 class="section-head" ' +
        (idOf(node) ? 'id="' + idOf(node) + '" ' : '') +
        'title="' + escapeAttr(text) + '">' + innerOf(node) + '</h3>' + sectionMark(text)
      const below = children[index + 1]
      if (below && below.name === 'h4') {
        const group = subsection(below, children[index + 2])
        out.push('<div class="keep-lead lead-section section-opener">' + head + group.box + '</div>')
        if (group.rest) out.push(group.rest)
        index += group.consumed + 1
        continue
      }
      out.push('<div class="keep-lead section-opener">' + head + '</div>')
      index += 1
      continue
    }

    if (node.name === 'h4' && !options.plain) {
      const group = subsection(node, children[index + 1])
      out.push('<div class="keep-lead lead-section">' + group.box + '</div>')
      if (group.rest) out.push(group.rest)
      index += group.consumed
      continue
    }

    // h5 — an entry. The unit the reader looks things up by, and the name
    // that rides in the running head on the recto.
    if (node.name === 'h5') {
      entryNumber += 1
      const text = textOf(node.html)
      const body = []
      let scan = index + 1
      while (scan < children.length) {
        const following = children[scan]
        if (following.name === null) { scan += 1; continue }
        if (/^h[2-5]$/.test(following.name)) break
        body.push(following)
        scan += 1
      }
      out.push(buildEntry(node, text, body, entryNumber))
      tally.entries += 1
      index = scan
      continue
    }

    // h6 — a label inside an entry: Applications, Practical Considerations.
    if (node.name === 'h6') {
      tally.labels += 1
      out.push('<p class="label">' + innerOf(node) + '</p>')
      index += 1
      continue
    }

    if (node.name === 'table') {
      tally.tables += 1
      // A caption belongs inside the block it names. Left as the paragraph
      // before it, it is free to end a column with its table starting the
      // next one — which is how a table comes to be introduced on the page
      // after the one that introduces it.
      const caption = out.length && /^<p><strong>(?:Table|TABLE)\b/.test(out[out.length - 1])
        ? out.pop().replace(/^<p>/, '<p class="table-caption">')
        : ''
      if (caption) tally.captions += 1
      out.push('<div class="table-figure">' + caption + node.html + '</div>')
      index += 1
      continue
    }

    if (node.name === 'figure' || (node.name === 'p' && /<img\b/.test(node.html))) {
      const figure = buildFigure(node, children[index + 1])
      out.push(figure.html)
      index += figure.consumed
      continue
    }

    out.push(node.html)
    index += 1
  }
  return out.join('\n')
}

// A figure arrives as <figure> wrapping the image, with its caption in the
// italic paragraph after it — "Figure 1. Distinct TGF-beta Intervention
// Points." The two belong in one block that does not break, with the caption
// set as a caption rather than as body text in italics.
function isCaption (node) {
  return node && node.name === 'p' && /^<p><em>\s*(Figure|Table)\b/i.test(node.html)
}

function buildFigure (node, following) {
  tally.figures += 1
  const caption = isCaption(following)
    ? '<p class="figure-caption">' + innerOf(following) + '</p>'
    : ''
  return {
    html: '<div class="figure">' + innerOf(node) + caption + '</div>',
    consumed: caption ? 2 : 1
  }
}

// Everything inside an entry gets the same treatment as everything outside
// it. The entry collector swallows the labels, tables and figures that belong
// to the entry, so without this they arrive in the book unstyled: 928 labels
// and every table inside an entry passed straight through.
function dressEntryBody (nodes) {
  const out = []
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.name === 'figure' || (node.name === 'p' && /<img\b/.test(node.html))) {
      const figure = buildFigure(node, nodes[i + 1])
      out.push(figure.html)
      i += figure.consumed - 1
      continue
    }
    out.push(dressOne(node))
  }
  return out
}

function dressOne (node) {
  return [node].map(function (node) {
    if (node.name === 'h6') {
      tally.labels += 1
      return '<p class="label">' + innerOf(node) + '</p>'
    }
    if (node.name === 'table') {
      tally.tables += 1
      return '<div class="table-figure">' + node.html + '</div>'
    }
    return node.html
  })[0]
}

function buildEntry (heading, text, body, number) {
  const id = idOf(heading)
  const head = '<h5 class="entry-name"' + (id ? ' id="' + id + '"' : '') + '>' +
    '<span class="entry-number">' + number + '</span>' + innerOf(heading) + '</h5>' +
    topicMark(text)

  if (!body.length) {
    return '<div class="entry">\n<div class="entry-lead">' + head + '</div>\n</div>'
  }

  const first = body[0]
  const rest = dressEntryBody(body.slice(1))

  if (first.name !== 'p' || /<img\b/.test(first.html)) {
    return '<div class="entry">\n<div class="entry-lead">' + head + '</div>\n' +
      dressEntryBody([first]).concat(rest).join('\n') + '\n</div>'
  }

  const split = splitParagraph(innerOf(first), KEEP_BUDGET)
  if (!split) {
    return '<div class="entry">\n<div class="entry-lead">' + head + '\n' +
      first.html + '</div>\n' + rest.join('\n') + '\n</div>'
  }
  return '<div class="entry">\n<div class="entry-lead">' + head + '\n' +
    '<p class="lead-head">' + split[0] + '</p></div>\n' +
    '<p class="lead-rest">' + split[1] + '</p>\n' + rest.join('\n') + '\n</div>'
}

// ---------------------------------------------------------------------------

const contentDir = path.resolve(args.content)
const indexFile = path.join(contentDir, 'index.html')
const html = fs.readFileSync(indexFile, 'utf8')
const bodyOpen = html.indexOf('<body>')
const bodyClose = html.lastIndexOf('</body>')

const head = html.slice(0, bodyOpen + '<body>'.length)
const tail = html.slice(bodyClose)
const components = blocks(html.slice(bodyOpen + '<body>'.length, bodyClose))

const rebuilt = components.map(function (component) {
  if (component.name !== 'div') return component.html
  // The reference list and the index have their own settings; the legend and
  // the reserved pages have nothing to design.
  if (hasClass(component, 'references') || hasClass(component, 'index') ||
      hasClass(component, 'legend-page') || hasClass(component, 'sponsor-page')) {
    return component.html
  }
  if (hasClass(component, 'chapter')) return designComponent(component)
  return component.html
})

fs.writeFileSync(indexFile, head + '\n    ' + rebuilt.join('\n\n    ') + '\n' + tail)

console.log('Designed ' + path.relative(process.cwd(), indexFile))
console.log('  parts ' + tally.parts + ' · sections ' + tally.sections +
  ' · sub-sections ' + tally.subsections)
console.log('  entries ' + tally.entries + ' · labels ' + tally.labels +
  ' · tables ' + tally.tables + ' (' + tally.captions + ' captioned)' +
  ' · figures ' + tally.figures)
console.log('  keep boxes capped ' + tally.capped)
if (args.report) capped.slice(0, 30).forEach(function (l) { console.log('    ' + l) })
