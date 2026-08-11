#!/usr/bin/env node

// Convert a Word manuscript into paged-design book HTML, driven by a style map.
//
//   node docx-to-book.js --src book.docx --out content/my-book --map aalai
//   node docx-to-book.js --src book.docx --dump-styles
//
// Authors write and lightly format in Word using named paragraph styles; the
// style map says what each style becomes in the book. Nothing is guessed from
// how the text looks, so the same manuscript always lands the same way.

const fs = require('fs')
const path = require('path')
const { parseArgs, slugify } = require('./common')
const docx = require('./lib/docx')
const book = require('./lib/book')

const args = parseArgs(process.argv)

if (args.help || !args.src || (!args.out && !args['dump-styles'])) {
  console.log([
    'Usage: node docx-to-book.js --src <file.docx> --out <dir> [options]',
    '',
    '  --src <file>     The Word manuscript (.docx).',
    '  --out <dir>      Output directory, e.g. content/my-book.',
    '  --map <name>     Style map: a name in style-maps/ or a path to a JSON',
    '                   file. Default: default.',
    '  --meta <file>    JSON of book metadata (same keys as md-to-book.js).',
    '  --slug <name>    Book class added to every component. Default: from --out.',
    '  --dump-styles    List the styles this document actually uses, with',
    '                   counts and sample text, then exit. Use this to build',
    '                   or check a style map.',
    '  --smart          Apply book typography (curly quotes, en/em dashes).',
    '                   Off by default, since Word already autocorrects.',
    '  --standalone     Link the theme CSS directly instead of pager.js.',
    '  --theme <name>   Theme for --standalone output. Default: beatrix.',
    '',
    'A style map is JSON:',
    '  {',
    '    "defaults": { "component": "chapter" },',
    '    "styles": {',
    '      "AALAI Chapter Title": { "component": "chapter", "role": "title" },',
    '      "AALAI Label":         { "element": "p", "class": "label" },',
    '      "Quote":               { "element": "blockquote" }',
    '    },',
    '    "fills": { "EAF3F3": "callout" }',
    '  }',
    '',
    'Styles match on the display name authors see in Word ("Heading 1") or on',
    'the internal style id ("Heading1"), case-insensitively.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const smart = args.smart === true || args.smart === 'true'

// ---------------------------------------------------------------------------
// Style map
// ---------------------------------------------------------------------------

function loadStyleMap (nameOrPath) {
  const name = nameOrPath || 'default'
  const candidates = [
    path.resolve(name),
    path.join(__dirname, '..', 'style-maps', name),
    path.join(__dirname, '..', 'style-maps', name + '.json')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return JSON.parse(fs.readFileSync(candidate, 'utf-8'))
    }
  }
  console.error('No such style map: ' + name)
  console.error('Available: ' + fs.readdirSync(path.join(__dirname, '..', 'style-maps'))
    .filter(function (file) { return file.endsWith('.json') })
    .map(function (file) { return file.replace(/\.json$/, '') })
    .join(', '))
  process.exit(1)
}

// Look a paragraph's style up by display name, then by style id, then by the
// id with spaces stripped — authors and the XML disagree about which is which.
function createStyleLookup (styleMap, documentStyles) {
  const entries = {}
  Object.keys(styleMap.styles || {}).forEach(function (key) {
    entries[key.toLowerCase().replace(/\s+/g, '')] = styleMap.styles[key]
  })

  return function lookup (styleId) {
    if (!styleId) return null
    const style = documentStyles.styles[styleId]
    const keys = [styleId]
    if (style) keys.push(style.name)
    for (const key of keys) {
      const entry = entries[String(key).toLowerCase().replace(/\s+/g, '')]
      if (entry) return entry
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Inline runs
// ---------------------------------------------------------------------------

function escapeHtml (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function typographise (text) {
  if (!smart) return text
  return text
    .replace(/---/g, '—')
    .replace(/(^|[^-])--([^-]|$)/g, '$1–$2')
    .replace(/\.\.\./g, '…')
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|[\s([{–—])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s([{–—])'/g, '$1‘')
    .replace(/'/g, '’')
}

// Wrap a run's text in the elements its formatting calls for.
function renderRun (run, context) {
  const properties = docx.child(run, 'w:rPr')
  const pieces = []

  run.children.forEach(function (node) {
    if (node.name === 'w:t') {
      pieces.push(typographise(escapeHtml(docx.textOf(node))))
    } else if (node.name === 'w:tab') {
      pieces.push(' ')
    } else if (node.name === 'w:br') {
      pieces.push('<br />')
    } else if (node.name === 'w:noBreakHyphen') {
      pieces.push('‑')
    } else if (node.name === 'w:sym') {
      const char = node.attributes['w:char']
      if (char) pieces.push('&#x' + char + ';')
    } else if (node.name === 'w:footnoteReference') {
      pieces.push(context.noteReference(node.attributes['w:id'], 'footnote'))
    } else if (node.name === 'w:endnoteReference') {
      pieces.push(context.noteReference(node.attributes['w:id'], 'endnote'))
    } else if (node.name === 'w:drawing' || node.name === 'w:pict') {
      const image = context.renderImage(node)
      if (image) pieces.push(image)
    }
  })

  let html = pieces.join('')
  if (html === '') return ''

  if (properties) {
    const vertAlign = docx.value(properties, 'w:vertAlign')
    if (vertAlign === 'superscript') html = '<sup>' + html + '</sup>'
    if (vertAlign === 'subscript') html = '<sub>' + html + '</sub>'
    if (docx.toggle(properties, 'w:i')) html = '<em>' + html + '</em>'
    if (docx.toggle(properties, 'w:b')) html = '<strong>' + html + '</strong>'
    if (docx.toggle(properties, 'w:strike')) html = '<del>' + html + '</del>'
    if (docx.value(properties, 'w:u')) html = '<u>' + html + '</u>'
    if (docx.toggle(properties, 'w:smallCaps')) {
      html = '<span class="small-caps">' + html + '</span>'
    }

    // A character style, or a run colour, can carry meaning the author
    // applied deliberately — let the map turn it into a class.
    const runStyle = docx.value(properties, 'w:rStyle')
    const runClass = runStyle && context.runStyles[runStyle.toLowerCase()]
    if (runClass) html = '<span class="' + runClass + '">' + html + '</span>'

    const colour = docx.value(properties, 'w:color')
    const colourClass = colour && context.runColours[colour.toUpperCase()]
    if (colourClass) html = '<span class="' + colourClass + '">' + html + '</span>'
  }

  return html
}

// Render every run in a paragraph, following hyperlinks.
function renderRuns (node, context) {
  const pieces = []
  node.children.forEach(function (entry) {
    if (entry.name === 'w:r') {
      pieces.push(renderRun(entry, context))
    } else if (entry.name === 'w:hyperlink') {
      const relationshipId = entry.attributes['r:id']
      const relationship = relationshipId && context.relationships[relationshipId]
      const anchor = entry.attributes['w:anchor']
      const href = relationship
        ? relationship.target
        : (anchor ? '#' + slugify(anchor) : null)
      const inner = renderRuns(entry, context)
      pieces.push(href ? '<a href="' + href + '">' + inner + '</a>' : inner)
    } else if (entry.name === 'w:smartTag' || entry.name === 'w:ins') {
      pieces.push(renderRuns(entry, context))
    } else if (entry.name === 'w:del') {
      // Tracked deletions are not content.
    }
  })
  return pieces.join('')
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function paragraphStyleId (paragraph) {
  return docx.value(docx.child(paragraph, 'w:pPr'), 'w:pStyle')
}

function listInfo (paragraph, numbering) {
  const properties = docx.child(paragraph, 'w:pPr')
  const numberingProperties = properties && docx.child(properties, 'w:numPr')
  if (!numberingProperties) return null
  const numId = docx.value(numberingProperties, 'w:numId')
  const level = docx.value(numberingProperties, 'w:ilvl') || '0'
  const format = (numbering[numId] || {})[level] || 'decimal'
  return { numId, level: Number(level), ordered: format !== 'bullet' }
}

// The shading fill on a cell or paragraph, uppercased, or null.
function fillOf (node) {
  const shading = docx.find(node, 'w:shd')
  if (!shading) return null
  const fill = shading.attributes['w:fill']
  if (!fill || fill === 'auto' || fill === 'FFFFFF') return null
  return fill.toUpperCase()
}

function cellIsBold (cell) {
  const runs = docx.findAll(cell, 'w:r').filter(function (run) {
    return docx.textOf(run).trim() !== ''
  })
  if (runs.length === 0) return false
  return runs.every(function (run) {
    const properties = docx.child(run, 'w:rPr')
    return properties && docx.toggle(properties, 'w:b')
  })
}

// Inside a box, a leading all-bold paragraph is the box's label.
function promoteCalloutLabel (html) {
  return html.replace(
    /^<p>(<span[^>]*>)?<strong>([\s\S]*?)<\/strong>(<\/span>)?<\/p>/,
    '<p class="callout-label">$2</p>'
  )
}

// Turn a table into a real table, a callout, or a row of columns, depending
// on its shape. Word authors use one-cell tables as boxes and single-row
// tables as side-by-side panels, so both need to survive the trip.
function renderTable (table, context, depth) {
  const rows = docx.children(table, 'w:tr')
  if (rows.length === 0) return ''

  const firstCells = docx.children(rows[0], 'w:tc')

  // A single cell is a box. Its fill decides which kind.
  if (rows.length === 1 && firstCells.length === 1) {
    const fill = fillOf(firstCells[0]) || fillOf(table)
    const className = (fill && context.fills[fill]) || context.fills.default || 'box'
    const inner = promoteCalloutLabel(renderBlocks(firstCells[0], context, depth + 1))
    return '<div class="' + className + '">\n' + book.indentBlock(inner) + '\n</div>'
  }

  const headerRow = docx.child(rows[0], 'w:trPr')
  const declaredHeader = headerRow && docx.child(headerRow, 'w:tblHeader')
  const looksLikeHeader = rows.length > 1 &&
    firstCells.length > 1 &&
    firstCells.every(cellIsBold)
  const hasHeader = Boolean(declaredHeader || looksLikeHeader)

  // A single row of several cells is a layout, not data.
  if (rows.length === 1 && firstCells.length > 1) {
    const columns = firstCells.map(function (cell) {
      const fill = fillOf(cell)
      const className = (fill && context.fills[fill]) || 'column'
      return '  <div class="' + className + '">\n' +
        book.indentBlock(renderBlocks(cell, context, depth + 1), '    ') +
        '\n  </div>'
    })
    return '<div class="columns columns-' + firstCells.length + '">\n' +
      columns.join('\n') + '\n</div>'
  }

  const html = ['<table>']
  rows.forEach(function (row, index) {
    const cells = docx.children(row, 'w:tc')
    const isHeader = hasHeader && index === 0
    if (isHeader) html.push('  <thead>')
    if (index === (hasHeader ? 1 : 0)) html.push('  <tbody>')

    html.push('    <tr>')
    cells.forEach(function (cell) {
      const tag = isHeader ? 'th' : 'td'
      const span = docx.value(docx.child(cell, 'w:tcPr'), 'w:gridSpan')
      const attributes = span && span !== '1' ? ' colspan="' + span + '"' : ''
      let content = renderBlocks(cell, context, depth + 1)
      // A th is already bold; keeping the run's bold as well is noise.
      if (isHeader) content = content.replace(/<\/?strong>/g, '')
      // Keep single-paragraph cells on one line; they are the common case.
      const inner = content.split('\n').length === 1
        ? content.replace(/^<p>([\s\S]*)<\/p>$/, '$1')
        : '\n' + book.indentBlock(content, '        ') + '\n      '
      html.push('      <' + tag + attributes + '>' + inner + '</' + tag + '>')
    })
    html.push('    </tr>')

    if (isHeader) html.push('  </thead>')
  })
  html.push('  </tbody>')
  html.push('</table>')
  return html.join('\n')
}

// Render the block children of a container (body or table cell) to HTML.
// Grouping (lists, containers) happens here so it works at any nesting depth.
function renderBlocks (container, context, depth) {
  const output = []
  const nodes = container.children || []
  let index = 0

  while (index < nodes.length) {
    const node = nodes[index]

    if (node.name === 'w:tbl') {
      output.push(renderTable(node, context, depth || 0))
      index += 1
      continue
    }

    if (node.name !== 'w:p') { index += 1; continue }

    const entry = context.lookup(paragraphStyleId(node)) || {}
    const list = listInfo(node, context.numbering)

    // Consecutive list paragraphs become one list.
    if (list) {
      const items = []
      const ordered = list.ordered
      while (index < nodes.length && nodes[index].name === 'w:p') {
        const next = listInfo(nodes[index], context.numbering)
        if (!next || next.numId !== list.numId) break
        items.push('  <li>' + renderRuns(nodes[index], context) + '</li>')
        index += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      output.push('<' + tag + '>\n' + items.join('\n') + '\n</' + tag + '>')
      continue
    }

    // Consecutive paragraphs sharing a group become one list.
    if (entry.group) {
      const items = []
      const groupName = entry.group
      const tag = entry.groupElement || 'ol'
      while (index < nodes.length && nodes[index].name === 'w:p') {
        const next = context.lookup(paragraphStyleId(nodes[index]))
        if (!next || next.group !== groupName) break
        items.push('  <li>' + renderParagraphInner(nodes[index], next, context) + '</li>')
        index += 1
      }
      output.push('<' + tag + ' class="' + groupName + '">\n' +
        items.join('\n') + '\n</' + tag + '>')
      continue
    }

    // Consecutive paragraphs sharing a container become one div.
    if (entry.container) {
      const inner = []
      const containerName = entry.container
      while (index < nodes.length && nodes[index].name === 'w:p') {
        const next = context.lookup(paragraphStyleId(nodes[index]))
        if (!next || next.container !== containerName) break
        const html = renderParagraph(nodes[index], next, context)
        if (html) inner.push(html)
        index += 1
      }
      output.push('<div class="' + containerName + '">\n' +
        book.indentBlock(inner.join('\n')) + '\n</div>')
      continue
    }

    const html = renderParagraph(node, entry, context)
    if (html) output.push(html)
    index += 1
  }

  return output.filter(Boolean).join('\n')
}

// The inner HTML of a paragraph, with any leading item number pulled out.
function renderParagraphInner (paragraph, entry, context) {
  let inner = renderRuns(paragraph, context)
  if (entry.number) {
    inner = inner.replace(/^(\s*<[^>]+>)*\s*(\d{1,3})[.)]?\s+/, function (match, tags, digits) {
      return (tags || '') + '<span class="item-number">' + digits + '</span> '
    })
  }
  return inner
}

function renderParagraph (paragraph, entry, context) {
  if (entry.drop) return ''

  const inner = renderParagraphInner(paragraph, entry, context)
  if (inner.replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').trim() === '' &&
      !/<img\s/.test(inner)) {
    return ''
  }

  // A paragraph that holds nothing but an image becomes a figure.
  if (/^<img\s[^>]*\/>$/.test(inner.trim()) && !entry.element) {
    return '<figure>\n  <p>' + inner.trim() + '</p>\n</figure>'
  }

  const element = entry.element || 'p'
  const fill = fillOf(docx.child(paragraph, 'w:pPr'))
  const classes = []
  if (entry.class) classes.push(entry.class)
  if (fill && context.fills[fill]) classes.push(context.fills[fill])

  const attributes = classes.length ? ' class="' + classes.join(' ') + '"' : ''
  return '<' + element + attributes + '>' + inner + '</' + element + '>'
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Walk the body once, splitting it into page components wherever a paragraph's
// style says a new component starts.
function splitComponents (body, context, defaults) {
  const components = []
  let current = null
  let pendingEyebrow = null

  function startComponent (type) {
    current = { type, id: null, title: null, blocks: [], eyebrow: null, notes: [] }
    components.push(current)
    return current
  }

  const nodes = body.children || []
  const buffer = { name: '#buffer', children: [] }

  function flushBuffer () {
    if (buffer.children.length === 0) return
    if (!current) startComponent(defaults.leading || defaults.component || 'chapter')
    const html = renderBlocks(buffer, context, 0)
    if (html) current.blocks.push(html)
    buffer.children = []
  }

  // A label paragraph sitting directly above a chapter title is that
  // chapter's eyebrow ("CHAPTER 07"), not a standalone label. Word templates
  // reuse one label style for both, so position is what tells them apart.
  function liftEyebrow () {
    const last = buffer.children[buffer.children.length - 1]
    if (!last || last.name !== 'w:p') return null
    const entry = context.lookup(paragraphStyleId(last))
    if (!entry) return null
    const isLabel = entry.role === 'eyebrow' ||
      /(^|\s)label(\s|$)/.test(entry.class || '')
    if (!isLabel) return null
    buffer.children.pop()
    return renderRuns(last, context)
  }

  nodes.forEach(function (node) {
    if (node.name === 'w:p') {
      const entry = context.lookup(paragraphStyleId(node))

      if (entry && entry.role === 'eyebrow') {
        pendingEyebrow = renderRuns(node, context)
        return
      }

      if (entry && entry.component) {
        const eyebrow = pendingEyebrow || liftEyebrow()
        flushBuffer()
        startComponent(entry.component)
        current.eyebrow = eyebrow
        pendingEyebrow = null

        if (entry.role === 'title') {
          current.title = docx.textOf(node).trim()
          current.titleHtml = renderRuns(node, context)
          return
        }
      }

      if (entry && entry.role === 'title' && current && !current.title) {
        current.title = docx.textOf(node).trim()
        current.titleHtml = renderRuns(node, context)
        return
      }
    }

    if (node.name === 'w:p' || node.name === 'w:tbl') {
      buffer.children.push(node)
    }
  })

  flushBuffer()
  return components
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function dumpStyles (files, documentStyles) {
  const root = docx.parseXml(files['word/document.xml'].toString('utf8'))
  const body = docx.find(root, 'w:body')
  const counts = {}

  docx.findAll(body, 'w:p').forEach(function (paragraph) {
    const id = paragraphStyleId(paragraph) || 'Normal'
    const text = docx.textOf(paragraph).trim()
    if (!counts[id]) counts[id] = { count: 0, sample: '' }
    counts[id].count += 1
    if (!counts[id].sample && text) counts[id].sample = text.slice(0, 58)
  })

  const fills = {}
  docx.findAll(body, 'w:shd').forEach(function (shading) {
    const fill = shading.attributes['w:fill']
    if (fill && fill !== 'auto' && fill !== 'FFFFFF') {
      fills[fill.toUpperCase()] = (fills[fill.toUpperCase()] || 0) + 1
    }
  })

  console.log('\nParagraph styles used in this document')
  console.log('style id'.padEnd(24) + 'display name'.padEnd(24) + 'uses  sample')
  console.log('-'.repeat(92))
  Object.keys(counts)
    .sort(function (a, b) { return counts[b].count - counts[a].count })
    .forEach(function (id) {
      const style = documentStyles.styles[id]
      console.log(
        id.padEnd(24) +
        String(style ? style.name : '').padEnd(24) +
        String(counts[id].count).padStart(4) + '  ' +
        counts[id].sample
      )
    })

  if (Object.keys(fills).length) {
    console.log('\nShading fills used (map these under "fills")')
    Object.keys(fills).sort().forEach(function (fill) {
      console.log('  ' + fill + '  ×' + fills[fill])
    })
  }

  console.log('\nTables: ' + docx.findAll(body, 'w:tbl').length +
    ' · Images: ' + docx.findAll(body, 'w:drawing').length +
    ' · Footnotes: ' + Object.keys(docx.readNotes(files, 'word/footnotes.xml', 'w:footnote')).length)
}

function main () {
  const source = path.resolve(args.src)
  if (!fs.existsSync(source)) {
    console.error('No such file: ' + args.src)
    process.exit(1)
  }

  const files = docx.readZip(source)
  if (!files['word/document.xml']) {
    console.error(args.src + ' is not a Word document (no word/document.xml).')
    process.exit(1)
  }

  const documentStyles = docx.readStyles(files)

  if (args['dump-styles']) {
    dumpStyles(files, documentStyles)
    return
  }

  const styleMap = loadStyleMap(args.map)
  const outDir = path.resolve(args.out)
  const bookClass = slugify(args.slug || path.basename(outDir))

  let meta = {}
  if (args.meta && fs.existsSync(path.resolve(args.meta))) {
    meta = JSON.parse(fs.readFileSync(path.resolve(args.meta), 'utf-8'))
  }
  if (styleMap.meta) meta = Object.assign({}, styleMap.meta, meta)

  const uniqueId = book.createIdRegistry()
  const relationships = docx.readRelationships(files, 'word/document.xml')
  const numbering = docx.readNumbering(files)
  const footnotes = docx.readNotes(files, 'word/footnotes.xml', 'w:footnote')
  const endnotes = docx.readNotes(files, 'word/endnotes.xml', 'w:endnote')

  fs.mkdirSync(outDir, { recursive: true })

  // Notes are collected per component so each chapter keeps its own list.
  const noteState = { order: [], seen: {}, componentId: 'PENDING' }
  const images = []

  const context = {
    lookup: createStyleLookup(styleMap, documentStyles),
    fills: styleMap.fills || {},
    runStyles: lowercaseKeys(styleMap.runStyles || {}),
    runColours: uppercaseKeys(styleMap.runColors || styleMap.runColours || {}),
    relationships,
    numbering,

    noteReference: function (id, kind) {
      const key = kind + '-' + id
      let number = noteState.order.indexOf(key) + 1
      if (number === 0) {
        noteState.order.push(key)
        number = noteState.order.length
      }
      const slug = kind + '-' + id
      return '<sup id="fnref-' + slug + '-' + noteState.componentId + '">' +
        '<a href="#fn-' + slug + '-' + noteState.componentId +
        '" class="footnote">' + number + '</a></sup>'
    },

    renderImage: function (node) {
      const blip = docx.find(node, 'a:blip')
      const relationshipId = blip && (blip.attributes['r:embed'] || blip.attributes['r:link'])
      const relationship = relationshipId && relationships[relationshipId]
      if (!relationship) return ''

      const target = relationship.target.replace(/^\.\.\//, '')
      const partName = target.startsWith('word/') ? target : 'word/' + target
      const data = files[partName]
      if (!data) return ''

      const fileName = path.basename(target)
      if (images.indexOf(fileName) === -1) {
        fs.mkdirSync(path.join(outDir, 'images'), { recursive: true })
        fs.writeFileSync(path.join(outDir, 'images', fileName), data)
        images.push(fileName)
      }

      const description = docx.find(node, 'wp:docPr')
      const alt = description
        ? (description.attributes.descr || description.attributes.name || '')
        : ''
      return '<img src="images/' + fileName + '" alt="' + alt.replace(/"/g, '&quot;') + '" />'
    }
  }

  const root = docx.parseXml(files['word/document.xml'].toString('utf8'))
  const body = docx.find(root, 'w:body')
  const rawComponents = splitComponents(body, context, styleMap.defaults || {})

  if (rawComponents.length === 0) {
    console.error('No content found in ' + args.src)
    process.exit(1)
  }

  // Give each component an id, its opening heading, and its own notes.
  const fileComponents = rawComponents.map(function (component) {
    const id = uniqueId(component.title || component.type)
    noteState.componentId = id

    const level = book.titleLevel(component.type)
    const parts = []

    if (component.eyebrow) {
      parts.push('<p class="chapter-eyebrow">' + component.eyebrow + '</p>')
    }
    if (component.title) {
      parts.push('<h' + level + book.titleClass(component.type) + ' id="' + id + '">' +
        (component.titleHtml || book.escapeHtml(component.title)) +
        '</h' + level + '>')
    }

    let html = parts.concat(component.blocks).join('\n')
    html = html.replace(/(fnref|fn)-((?:footnote|endnote)-\d+)-PENDING\b/g, '$1-$2-' + id)

    // A cover is a fixed composition, not flowing text: its lines are styled
    // by position. Number them so the theme can target each one with a plain
    // class — Paged.js discards :nth-of-type during pagination.
    if (component.type === 'cover') html = numberCoverLines(html)

    const notes = renderNotes(noteState, id, footnotes, endnotes, context)
    if (notes) html += '\n' + notes
    noteState.order = []

    return { type: component.type, id, title: component.title || null, body: html }
  })

  const components = book.assemble(fileComponents, meta, uniqueId, function (text) {
    return typographise(book.escapeHtml(text))
  })

  const html = book.renderDocument(components, meta, bookClass, {
    standalone: args.standalone,
    theme: args.theme,
    css: args.css
  })
  const outFile = path.join(outDir, 'index.html')
  fs.writeFileSync(outFile, html)

  book.report(components, path.relative(process.cwd(), outFile))
  if (images.length) {
    console.log('\nExtracted ' + images.length + ' image(s) to ' +
      path.join(path.relative(process.cwd(), outDir), 'images'))
  }

  // Report styles the map says nothing about, so gaps are visible.
  const unmapped = {}
  docx.findAll(body, 'w:p').forEach(function (paragraph) {
    const id = paragraphStyleId(paragraph)
    if (!id) return
    if (context.lookup(id)) return
    if (docx.textOf(paragraph).trim() === '') return
    unmapped[id] = (unmapped[id] || 0) + 1
  })
  if (Object.keys(unmapped).length) {
    console.log('\nStyles with no mapping (rendered as plain paragraphs):')
    Object.keys(unmapped).forEach(function (id) {
      const style = documentStyles.styles[id]
      console.log('  ' + id + (style && style.name !== id ? ' (' + style.name + ')' : '') +
        ' ×' + unmapped[id])
    })
    console.log('Add them to the style map, or leave them if plain text is right.')
  }
}

function renderNotes (noteState, componentId, footnotes, endnotes, context) {
  if (noteState.order.length === 0) return ''

  const items = noteState.order.map(function (key, index) {
    const [kind, id] = [key.slice(0, key.indexOf('-')), key.slice(key.indexOf('-') + 1)]
    const source = kind === 'footnote' ? footnotes[id] : endnotes[id]
    const slug = kind + '-' + id
    const noteId = 'fn-' + slug + '-' + componentId
    const referenceId = 'fnref-' + slug + '-' + componentId
    const inner = source ? renderBlocks(source, context, 1) : ''
    const text = inner.replace(/^<p>/, '').replace(/<\/p>$/, '') || '&#160;'
    return '    <li id="' + noteId + '"><p>' + text +
      ' <a href="#' + referenceId + '" class="reversefootnote">↩</a></p></li>'
  })

  return '<div class="footnotes">\n  <ol>\n' + items.join('\n') + '\n  </ol>\n</div>'
}

// Add cover-line-1, cover-line-2 … to each paragraph of a cover, keeping any
// classes the paragraph already carries.
function numberCoverLines (html) {
  let line = 0
  return html.replace(/<p(\s+class="([^"]*)")?>/g, function (match, attribute, classes) {
    line += 1
    const all = (classes ? classes + ' ' : '') + 'cover-line-' + line
    return '<p class="' + all + '">'
  })
}

function lowercaseKeys (object) {
  const out = {}
  Object.keys(object).forEach(function (key) { out[key.toLowerCase()] = object[key] })
  return out
}

function uppercaseKeys (object) {
  const out = {}
  Object.keys(object).forEach(function (key) { out[key.toUpperCase()] = object[key] })
  return out
}

main()
