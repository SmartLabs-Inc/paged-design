#!/usr/bin/env node

// Convert a Markdown manuscript into paged-design book HTML.
//
//   node md-to-book.js --src manuscript/ --out content/my-book --meta book.json
//   node md-to-book.js --src manuscript.md --out content/my-book --split h1
//
// Produces <out>/index.html plus a copy of any non-Markdown assets in --src.
// The conversion is mechanical: it gets structure right and semantics only as
// far as the source marks them. Tag epigraphs, pull quotes, sources and boxes
// afterwards (or inline, with {.class} attributes) — see references/markup.md.

const fs = require('fs')
const path = require('path')
const { parseArgs, slugify } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.src || !args.out) {
  console.log([
    'Usage: node md-to-book.js --src <dir|file> --out <dir> [options]',
    '',
    '  --src <dir|file>  A directory of .md files (converted in filename order),',
    '                    or a single .md file.',
    '  --out <dir>       Output directory, e.g. content/my-book.',
    '  --meta <file>     JSON of book metadata (see below).',
    '  --split h1|h2     Split a single source file into components at this',
    '                    heading level. Default: h1 for a file, none for a dir.',
    '  --type <type>     Default component type for source files. Default: chapter.',
    '  --slug <name>     Book class added to every component. Default: from --out.',
    '  --no-smart        Leave straight quotes, -- and ... as typed.',
    '  --standalone      Link the theme CSS directly instead of loading the',
    '                    demo site’s pager.js (use --theme to name the theme).',
    '  --theme <name>    Theme for --standalone output. Default: template.',
    '',
    'book.json keys (all optional):',
    '  title, subtitle, author, contributors, publisher, publisherUrl,',
    '  publisherLogo, isbn, copyright, rights[], cover, dedication,',
    '  epigraph { text, source }, previousPublications[], lang, contents (bool)',
    '',
    'Per-file front matter (YAML subset, between --- lines):',
    '  title:  Component title',
    '  type:   chapter | frontmatter | part | endmatter | copyright |',
    '          dedication | epigraph | contents | title-page | half-title |',
    '          previous-publications | frontispiece | cover',
    '  number: Chapter number, rendered as .chapter-number',
    '  id:     Explicit HTML id (default: slug of the title)'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const smart = !args['no-smart'] && args.smart !== 'false'

// ---------------------------------------------------------------------------
// Inline Markdown
// ---------------------------------------------------------------------------

// Apply book typography to text: dashes, ellipses, and curly quotes.
function typographise (text) {
  if (!smart) return text
  return text
    .replace(/---/g, '—')
    .replace(/(^|[^-])--([^-]|$)/g, '$1–$2')
    .replace(/\.\.\./g, '…')
    // Apostrophes inside words, and elided leading digits ('90s).
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/'(?=\d\ds\b)/g, '’')
    // Opening quotes follow the start of the string, whitespace or an opening
    // bracket or dash; everything else closes.
    .replace(/(^|[\s([{–—])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s([{–—])'/g, '$1‘')
    .replace(/'/g, '’')
}

// Escape bare ampersands, leaving existing entities and inline HTML alone.
function escapeAmpersands (text) {
  return text.replace(/&(?!#?\w+;)/g, '&amp;')
}

// Convert the inline syntax of a single run of text.
// Code spans are lifted out first so nothing else touches them.
function renderInline (text, context) {
  const codeSpans = []
  let result = text.replace(/(`+)([\s\S]*?)\1/g, function (match, ticks, code) {
    codeSpans.push(code.trim())
    return '\ue000CODE' + (codeSpans.length - 1) + '\ue000'
  })

  // Raw inline HTML is protected too, so that smart punctuation cannot
  // curl the quotes inside its attributes.
  const htmlTags = []
  result = result.replace(/<\/?[a-zA-Z][^<>]*>/g, function (tag) {
    htmlTags.push(tag)
    return '\ue001HTML' + (htmlTags.length - 1) + '\ue001'
  })

  result = escapeAmpersands(result)
  result = typographise(result)

  // Images: ![alt](src "title")
  result = result.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["\u201c]([^"\u201d]*)["\u201d])?\)/g,
    function (match, alt, src, title) {
      return '<img src="' + src + '" alt="' + alt + '"' +
        (title ? ' title="' + title + '"' : '') + ' />'
    }
  )

  // Footnote references: [^id]
  result = result.replace(/\[\^([^\]]+)\]/g, function (match, id) {
    if (!context) return match
    return context.footnoteReference(id)
  })

  // Inline links: [text](url "title")
  result = result.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+["\u201c]([^"\u201d]*)["\u201d])?\)/g,
    function (match, label, href, title) {
      return '<a href="' + href + '"' +
        (title ? ' title="' + title + '"' : '') + '>' + label + '</a>'
    }
  )

  // Reference links: [text][label] and [label][]
  result = result.replace(
    /\[([^\]]+)\](?:\[([^\]]*)\])/g,
    function (match, label, reference) {
      const key = (reference || label).toLowerCase()
      const link = context && context.linkDefinitions[key]
      if (!link) return match
      return '<a href="' + link.href + '"' +
        (link.title ? ' title="' + link.title + '"' : '') + '>' + label + '</a>'
    }
  )

  result = result
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    // Two trailing spaces mean a hard line break.
    .replace(/ {2}\n/g, '<br />\n')

  result = result.replace(/\ue000CODE(\d+)\ue000/g, function (match, index) {
    return '<code>' + codeSpans[index]
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;') + '</code>'
  })

  return result.replace(/\ue001HTML(\d+)\ue001/g, function (match, index) {
    return htmlTags[index]
  })
}

// ---------------------------------------------------------------------------
// Block Markdown
// ---------------------------------------------------------------------------

// Pull a trailing {.class #id} attribute list off a block's last line.
function extractAttributes (text) {
  const match = text.match(/\s*\{:?\s*([^}]+)\}\s*$/)
  if (!match) return { text, attributes: '' }

  const classes = []
  let id = null
  match[1].trim().split(/\s+/).forEach(function (token) {
    if (token.startsWith('.')) classes.push(token.slice(1))
    else if (token.startsWith('#')) id = token.slice(1)
  })
  if (classes.length === 0 && !id) return { text, attributes: '' }

  let attributes = ''
  if (id) attributes += ' id="' + id + '"'
  if (classes.length) attributes += ' class="' + classes.join(' ') + '"'
  return { text: text.slice(0, match.index), attributes }
}

// Merge an attribute string into an already-rendered opening tag.
function applyAttributes (html, attributes) {
  if (!attributes) return html
  return html.replace(/^<([a-z0-9]+)/i, '<$1' + attributes)
}

function renderList (items, ordered, context, indent) {
  const tag = ordered ? 'ol' : 'ul'
  const lines = [indent + '<' + tag + '>']
  items.forEach(function (item) {
    let body = renderInline(item.text.join('\n').trim(), context)
    if (item.children.length) {
      body += '\n' + renderList(
        item.children, item.childrenOrdered, context, indent + '  '
      ) + '\n' + indent + '  '
    }
    lines.push(indent + '  <li>' + body + '</li>')
  })
  lines.push(indent + '</' + tag + '>')
  return lines.join('\n')
}

// Parse the list beginning at lines[start]; returns { html, next }.
function parseList (lines, start, context, indent) {
  const listItemPattern = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
  const baseIndent = lines[start].match(listItemPattern)[1].length
  const ordered = /^\s*\d/.test(lines[start])
  const items = []
  let index = start

  while (index < lines.length) {
    const line = lines[index]
    const match = line.match(listItemPattern)

    if (match && match[1].length === baseIndent) {
      items.push({ text: [match[3]], children: [], childrenOrdered: false })
      index += 1
      continue
    }
    if (match && match[1].length > baseIndent && items.length) {
      const nested = parseList(lines, index, context, '')
      const current = items[items.length - 1]
      current.children = nested.items
      current.childrenOrdered = nested.ordered
      index = nested.next
      continue
    }
    // An item indented less than this list belongs to an enclosing list.
    if (match && match[1].length < baseIndent) break

    // A blank line ends the list unless another item of the same kind follows.
    if (line.trim() === '') {
      const next = lines[index + 1]
      const nextMatch = next && next.match(listItemPattern)
      if (nextMatch && nextMatch[1].length >= baseIndent &&
          /^\d/.test(nextMatch[2]) === ordered) {
        index += 1
        continue
      }
      break
    }
    // Lazy continuation of the current item.
    if (items.length) {
      items[items.length - 1].text.push(line.trim())
      index += 1
      continue
    }
    break
  }

  if (indent === null) return { items, ordered, next: index }
  return {
    html: renderList(items, ordered, context, indent || ''),
    next: index,
    items,
    ordered
  }
}

function renderTable (rows, alignments, context) {
  const html = ['<table>']
  html.push('  <thead>')
  html.push('    <tr>' + rows[0].map(function (cell, i) {
    const align = alignments[i] ? ' style="text-align: ' + alignments[i] + '"' : ''
    return '<th' + align + '>' + renderInline(cell, context) + '</th>'
  }).join('') + '</tr>')
  html.push('  </thead>')
  html.push('  <tbody>')
  rows.slice(1).forEach(function (row) {
    html.push('    <tr>' + row.map(function (cell, i) {
      const align = alignments[i] ? ' style="text-align: ' + alignments[i] + '"' : ''
      return '<td' + align + '>' + renderInline(cell, context) + '</td>'
    }).join('') + '</tr>')
  })
  html.push('  </tbody>')
  html.push('</table>')
  return html.join('\n')
}

function splitTableRow (line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
    .split('|').map(function (cell) { return cell.trim() })
}

// Convert a Markdown body into HTML blocks.
// context carries footnote and link state for the component.
function renderMarkdown (source, context) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let index = 0

  // Collect link reference definitions up front so order does not matter.
  lines.forEach(function (line) {
    const match = line.match(/^\s{0,3}\[([^^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?\s*$/)
    if (match) {
      context.linkDefinitions[match[1].toLowerCase()] = {
        href: match[2], title: match[3]
      }
    }
  })

  while (index < lines.length) {
    const line = lines[index]

    // Blank
    if (line.trim() === '') { index += 1; continue }

    // Link reference definition (already collected)
    if (/^\s{0,3}\[[^^\]]+\]:\s*\S+/.test(line)) { index += 1; continue }

    // Footnote definition: [^id]: text, continued by indented lines
    const footnoteMatch = line.match(/^\s{0,3}\[\^([^\]]+)\]:\s*(.*)$/)
    if (footnoteMatch) {
      const body = [footnoteMatch[2]]
      index += 1
      while (index < lines.length &&
             (lines[index].startsWith('    ') || lines[index].startsWith('\t'))) {
        body.push(lines[index].trim())
        index += 1
      }
      context.footnoteDefinitions[footnoteMatch[1]] = body.join('\n').trim()
      continue
    }

    // Fenced code
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*([\w-]*)\s*$/)
    if (fenceMatch) {
      const fence = fenceMatch[1][0].repeat(3)
      const language = fenceMatch[2]
      const code = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence)) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      const escaped = code.join('\n')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      output.push('<pre><code' +
        (language ? ' class="language-' + language + '"' : '') +
        '>' + escaped + '</code></pre>')
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (headingMatch) {
      const extracted = extractAttributes(headingMatch[2])
      const level = headingMatch[1].length
      output.push({
        heading: level,
        text: extracted.text.trim(),
        attributes: extracted.attributes
      })
      index += 1
      continue
    }

    // Thematic break
    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      output.push('<hr />')
      index += 1
      continue
    }

    // Blockquote. Tag it by putting {: .pullquote} on the line after it.
    if (/^\s{0,3}>/.test(line)) {
      const quoted = []
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      const inner = blocksToHtml(renderMarkdown(quoted.join('\n'), context), context)
      output.push('<blockquote>\n' + indentBlock(inner) + '\n</blockquote>')
      continue
    }

    // Table
    if (line.includes('|') && index + 1 < lines.length &&
        /^\s*\|?[\s:-]*-[\s|:-]*$/.test(lines[index + 1]) &&
        lines[index + 1].includes('-')) {
      const alignments = splitTableRow(lines[index + 1]).map(function (cell) {
        if (/^:.*:$/.test(cell)) return 'center'
        if (/:$/.test(cell)) return 'right'
        if (/^:/.test(cell)) return 'left'
        return null
      })
      const rows = [splitTableRow(line)]
      index += 2
      while (index < lines.length && lines[index].includes('|') &&
             lines[index].trim() !== '') {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      output.push(renderTable(rows, alignments, context))
      continue
    }

    // List
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
      const parsed = parseList(lines, index, context, '')
      output.push(parsed.html)
      index = parsed.next
      continue
    }

    // Raw HTML block
    if (/^\s{0,3}</.test(line)) {
      const block = []
      while (index < lines.length && lines[index].trim() !== '') {
        block.push(lines[index])
        index += 1
      }
      output.push(block.join('\n'))
      continue
    }

    // Standalone attribute line, applied to the previous block
    const standaloneAttributes = line.match(/^\s*\{:\s*([^}]+)\}\s*$/)
    if (standaloneAttributes && output.length) {
      const extracted = extractAttributes(line.trim())
      const previous = output[output.length - 1]
      if (typeof previous === 'string') {
        output[output.length - 1] = applyAttributes(previous, extracted.attributes)
      } else if (previous && previous.heading) {
        previous.attributes = extracted.attributes
      }
      index += 1
      continue
    }

    // Paragraph
    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' &&
           !/^(#{1,6}\s|\s{0,3}>|\s*(```|~~~)|\s{0,3}<)/.test(lines[index]) &&
           !/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(lines[index]) &&
           !/^\s*\{:\s*[^}]+\}\s*$/.test(lines[index]) &&
           !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    const raw = paragraph.join('\n')
    const extracted = extractAttributes(raw)
    const rendered = renderInline(extracted.text.trim(), context)

    // A paragraph that is nothing but an image becomes a figure.
    const imageOnly = rendered.match(/^<img\s[^>]*\/>$/)
    if (imageOnly && !extracted.attributes) {
      const title = rendered.match(/\stitle="([^"]*)"/)
      output.push(
        '<figure>\n  <p>' + rendered.replace(/\stitle="[^"]*"/, '') + '</p>' +
        (title ? '\n  <p>' + title[1] + '</p>' : '') +
        '\n</figure>'
      )
    } else {
      output.push(applyAttributes('<p>' + rendered + '</p>', extracted.attributes))
    }
  }

  return output
}

function indentBlock (text, indent) {
  const pad = indent || '  '
  return String(text).split('\n').map(function (line) {
    return line.trim() === '' ? line : pad + line
  }).join('\n')
}

// renderMarkdown leaves headings as objects so callers can shift their levels.
// Everywhere else, flatten them to HTML at the level they were written.
function blocksToHtml (blocks, context, shift) {
  return blocks.map(function (block) {
    if (typeof block === 'string') return block
    const level = Math.min(6, Math.max(1, block.heading + (shift || 0)))
    return '<h' + level + block.attributes + '>' +
      renderInline(block.text, context) + '</h' + level + '>'
  }).join('\n')
}

// ---------------------------------------------------------------------------
// Front matter and source files
// ---------------------------------------------------------------------------

function parseFrontMatter (text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { data: {}, body: text }

  const data = {}
  match[1].split('\n').forEach(function (line) {
    const pair = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)
    if (!pair) return
    let value = pair[2].trim().replace(/^["']|["']$/g, '')
    if (value === 'true') value = true
    else if (value === 'false') value = false
    data[pair[1]] = value
  })
  return { data, body: text.slice(match[0].length) }
}

const TYPE_CLASSES = {
  cover: 'cover',
  'half-title': 'half-title-page',
  'previous-publications': 'previous-publications-page',
  frontispiece: 'frontispiece-page',
  'title-page': 'title-page',
  copyright: 'copyright-page',
  contents: 'contents-page',
  dedication: 'dedication-page',
  epigraph: 'epigraph-page',
  frontmatter: 'frontmatter',
  part: 'part-page',
  chapter: 'chapter',
  endmatter: 'endmatter'
}

const FRONTMATTER_TYPES = [
  'cover', 'half-title', 'previous-publications', 'frontispiece', 'title-page',
  'copyright', 'contents', 'dedication', 'epigraph', 'frontmatter'
]

// Heading level a component's own title is rendered at.
function titleLevel (type) {
  if (type === 'chapter') return 2
  return 1
}

// ---------------------------------------------------------------------------
// Component assembly
// ---------------------------------------------------------------------------

const usedIds = {}

function uniqueId (candidate) {
  let id = candidate || 'section'
  let suffix = 2
  while (usedIds[id]) {
    id = candidate + '-' + suffix
    suffix += 1
  }
  usedIds[id] = true
  return id
}

function newContext () {
  const footnoteOrder = []
  return {
    linkDefinitions: {},
    footnoteDefinitions: {},
    footnoteOrder,
    footnoteReference: function (id) {
      let number = footnoteOrder.indexOf(id) + 1
      if (number === 0) {
        footnoteOrder.push(id)
        number = footnoteOrder.length
      }
      return '<sup id="fnref-' + slugify(id) + '-' + this.componentId + '">' +
        '<a href="#fn-' + slugify(id) + '-' + this.componentId +
        '" class="footnote">' + number + '</a></sup>'
    },
    // Footnote ids need the component id, which is only known once the
    // component's title has been parsed. Placeholder until then.
    componentId: 'PENDING'
  }
}

function renderFootnotes (context) {
  if (context.footnoteOrder.length === 0) return ''
  const items = context.footnoteOrder.map(function (id) {
    const noteId = 'fn-' + slugify(id) + '-' + context.componentId
    const referenceId = 'fnref-' + slugify(id) + '-' + context.componentId
    const body = context.footnoteDefinitions[id] || ''
    const rendered = renderInline(body, context)
    return '    <li id="' + noteId + '"><p>' + rendered +
      ' <a href="#' + referenceId + '" class="reversefootnote">↩</a></p></li>'
  })
  return '<div class="footnotes">\n  <ol>\n' + items.join('\n') + '\n  </ol>\n</div>'
}

// Build one page component from a source file.
function componentFromSource (source, defaults) {
  const parsed = parseFrontMatter(source.text)
  const type = parsed.data.type || defaults.type || 'chapter'
  const context = newContext()

  let blocks = renderMarkdown(parsed.body, context)

  // The component's own title: front matter wins, otherwise the first heading.
  let title = parsed.data.title
  let firstHeadingLevel = null
  const firstHeadingIndex = blocks.findIndex(function (block) {
    return typeof block === 'object' && block.heading
  })
  const leadsWithHeading = firstHeadingIndex === 0

  if (leadsWithHeading) {
    firstHeadingLevel = blocks[0].heading
    if (!title) title = blocks[0].text
    if (title === blocks[0].text) blocks = blocks.slice(1)
  }

  const target = titleLevel(type)
  const shift = firstHeadingLevel === null ? 0 : target - firstHeadingLevel

  // Render remaining headings, shifted to sit under the component title.
  let html = blocksToHtml(blocks, context, shift)

  const id = uniqueId(parsed.data.id || slugify(title || source.name))
  context.componentId = id

  // Footnote references were rendered before the component id was known.
  html = html.replace(/(fnref|fn)-([a-z0-9-]*?)-PENDING\b/g, '$1-$2-' + id)

  const notes = renderFootnotes(context)
  const bodyParts = html ? [html] : []
  if (notes) bodyParts.push(notes)

  const numberSpan = parsed.data.number
    ? '<span class="chapter-number">' + parsed.data.number + '</span> '
    : ''
  const headingClass = (type === 'frontmatter' || type === 'endmatter')
    ? ' class="heading-2"'
    : ''
  const heading = title
    ? '<h' + target + headingClass + ' id="' + id + '">' + numberSpan +
      renderInline(title, context) + '</h' + target + '>'
    : null

  return {
    type,
    id,
    title: title || null,
    body: (heading ? [heading] : []).concat(bodyParts).join('\n')
  }
}

// ---------------------------------------------------------------------------
// Generated frontmatter components
// ---------------------------------------------------------------------------

function inlineOnly (text) {
  const context = newContext()
  return renderInline(String(text), context)
}

function makeCover (meta) {
  return {
    type: 'cover',
    id: uniqueId('cover'),
    title: null,
    body: '<p class="cover"><img src="' + meta.cover + '" alt="' +
      (meta.title || '') + '" class="cover" /></p>'
  }
}

function makeHalfTitle (meta) {
  return {
    type: 'half-title',
    id: uniqueId('half-title-page'),
    title: 'Half-title page',
    tocSkip: true,
    firstNumbered: true,
    body: '<p class="title-page-title">' + inlineOnly(meta.title || '') + '</p>'
  }
}

function makePreviousPublications (meta) {
  const id = uniqueId('previous-publications')
  const items = meta.previousPublications.map(function (line) {
    return '<p>' + inlineOnly(line) + '</p>'
  })
  return {
    type: 'previous-publications',
    id,
    title: 'Also by the author',
    body: ['<h1 class="heading-2" id="' + id + '">Also by the author</h1>']
      .concat(items).join('\n')
  }
}

function makeTitlePage (meta) {
  const id = uniqueId('title-page-title')
  const parts = ['<p class="title-page-title" id="' + id + '">' +
    inlineOnly(meta.title || '') + '</p>']
  if (meta.subtitle) {
    parts.push('<p class="title-page-subtitle">' + inlineOnly(meta.subtitle) + '</p>')
  }
  if (meta.author) {
    parts.push('<p class="title-page-author">' + inlineOnly(meta.author) + '</p>')
  }
  if (meta.contributors) {
    parts.push('<p class="title-page-contributors">' +
      inlineOnly(meta.contributors) + '</p>')
  }
  if (meta.publisher) {
    const name = inlineOnly(meta.publisher)
    parts.push('<p class="title-page-publisher">' +
      (meta.publisherUrl
        ? '<a href="' + meta.publisherUrl + '">' + name + '</a>'
        : name) + '</p>')
  }
  if (meta.publisherLogo) {
    parts.push('<p class="title-page-logo"><img src="' + meta.publisherLogo +
      '" alt="' + inlineOnly(meta.publisher || 'Publisher') + '" /></p>')
  }
  return {
    type: 'title-page',
    id,
    title: 'Title page',
    tocSkip: true,
    body: parts.join('\n')
  }
}

function makeCopyright (meta) {
  const id = uniqueId('copyright')
  const parts = ['<h1 class="non-printing" id="' + id + '">Copyright</h1>']
  parts.push('<p><em>' + inlineOnly(meta.title || '') + '</em>' +
    (meta.copyright ? '<br />\n' + inlineOnly(meta.copyright) : '') + '</p>')
  if (meta.isbn) {
    parts.push([
      '<p class="identifiers">',
      '  <span class="identifier">',
      '    <span class="identifier-scheme">ISBN</span>:',
      '    <span class="identifier-id">' + meta.isbn + '</span>',
      '  </span>',
      '</p>'
    ].join('\n'))
  }
  const rights = [].concat(meta.rights || [])
  rights.forEach(function (line) {
    parts.push('<p>' + inlineOnly(line) + '</p>')
  })
  return {
    type: 'copyright',
    id,
    title: 'Copyright',
    body: parts.join('\n')
  }
}

function makeDedication (meta) {
  const id = uniqueId('dedication')
  return {
    type: 'dedication',
    id,
    title: 'Dedication',
    body: '<p class="dedication" id="' + id + '">' +
      inlineOnly(meta.dedication) + '</p>'
  }
}

function makeEpigraph (meta) {
  const id = uniqueId('epigraph')
  const epigraph = typeof meta.epigraph === 'string'
    ? { text: meta.epigraph }
    : meta.epigraph
  const parts = ['<p class="epigraph" id="' + id + '">' +
    inlineOnly(epigraph.text) + '</p>']
  if (epigraph.source) {
    parts.push('<p class="source">' + inlineOnly(epigraph.source) + '</p>')
  }
  return { type: 'epigraph', id, title: 'Epigraph', body: parts.join('\n') }
}

function makeContents (components) {
  const id = uniqueId('contents')
  const entries = components.filter(function (component) {
    return component.title && !component.tocSkip && component.type !== 'contents'
  }).map(function (component) {
    const classes = ['toc-entry-title']
    if (FRONTMATTER_TYPES.indexOf(component.type) > -1) {
      classes.push('frontmatter-entry')
    }
    if (component.type === 'part') classes.push('toc-entry-part')
    return [
      '  <li class="' + classes.join(' ') + '">',
      '    <a href="#' + component.id + '">',
      '      <span class="toc-entry-text">' + component.title + '</span>',
      '    </a>',
      '  </li>'
    ].join('\n')
  })

  return {
    type: 'contents',
    id,
    title: 'Contents',
    tocSkip: true,
    body: [
      '<h1 class="heading-2" id="' + id + '">Contents</h1>',
      '<ol class="toc-list">',
      entries.join('\n'),
      '</ol>'
    ].join('\n')
  }
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

function renderComponent (component, bookClass) {
  const classes = [bookClass, TYPE_CLASSES[component.type] || 'chapter']
  if (component.firstNumbered) classes.push('page-1')
  const header = component.title
    ? ' data-header="' + component.title.replace(/<[^>]+>/g, '')
      .replace(/"/g, '&quot;') + '"'
    : ''
  return [
    '    <div class="' + classes.join(' ') + '"' + header + '>',
    '        <div>',
    '            <div>',
    indentBlock(component.body, '                '),
    '            </div>',
    '        </div>',
    '    </div>'
  ].join('\n')
}

function renderDocument (components, meta, bookClass) {
  const head = [
    '<!DOCTYPE html>',
    '<html lang="' + (meta.lang || 'en') + '">',
    '',
    '<head>',
    '    <title>' + (meta.title || bookClass) + '</title>',
    '    <meta http-equiv="content-type" content="text/html; charset=UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">'
  ]

  if (args.standalone) {
    head.push('')
    head.push('    <link rel="stylesheet" type="text/css" href="' +
      (args.css || '../../themes/' + (args.theme || 'template') + '/main.css') + '">')
    head.push('    <script src="../../js/vendor/paged.polyfill.js"></script>')
  } else {
    head.push('')
    head.push('    <!-- Loads the theme, waits for MathJax, then runs Paged.js. -->')
    head.push('    <script src="../../js/pager.js"></script>')
  }

  head.push('</head>')
  head.push('')
  head.push('<body>')

  const body = components.map(function (component) {
    return renderComponent(component, bookClass)
  })

  return head.concat(body, ['</body>', '', '</html>', '']).join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function readSources (source, splitLevel, defaultType) {
  const stat = fs.statSync(source)

  if (stat.isDirectory()) {
    return fs.readdirSync(source)
      .filter(function (name) { return /\.(md|markdown)$/i.test(name) })
      .sort()
      .map(function (name) {
        return {
          name: name.replace(/\.(md|markdown)$/i, '').replace(/^\d+[-_]?/, ''),
          text: fs.readFileSync(path.join(source, name), 'utf-8')
        }
      })
  }

  const text = fs.readFileSync(source, 'utf-8')
  const parsed = parseFrontMatter(text)
  const level = splitLevel === 'none' ? null : (splitLevel === 'h2' ? 2 : 1)
  if (!level) {
    return [{ name: path.basename(source, path.extname(source)), text }]
  }

  // Split at the chosen heading level, keeping each heading with its section.
  const marker = '#'.repeat(level)
  const pattern = new RegExp('^' + marker + '(?!#)\\s', 'm')
  const lines = parsed.body.split('\n')
  const sections = []
  let current = null
  lines.forEach(function (line) {
    if (pattern.test(line + '\n')) {
      current = { name: slugify(line.replace(/^#+\s*/, '')), lines: [line] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else if (line.trim() !== '') {
      current = { name: 'opening', lines: [line] }
      sections.push(current)
    }
  })

  if (sections.length === 0) {
    return [{ name: path.basename(source, path.extname(source)), text }]
  }
  return sections.map(function (section) {
    return { name: section.name, text: section.lines.join('\n') }
  })
}

// Copy any non-Markdown assets from the source directory to the output.
function copyAssets (source, target) {
  if (!fs.statSync(source).isDirectory()) return
  fs.readdirSync(source, { withFileTypes: true }).forEach(function (entry) {
    if (/\.(md|markdown)$/i.test(entry.name)) return
    if (entry.name === 'book.json') return
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      copyAssets(from, to)
    } else {
      fs.copyFileSync(from, to)
    }
  })
}

function main () {
  const source = path.resolve(args.src)
  const outDir = path.resolve(args.out)

  if (!fs.existsSync(source)) {
    console.error('No such source: ' + args.src)
    process.exit(1)
  }

  let meta = {}
  const metaPath = args.meta
    ? path.resolve(args.meta)
    : path.join(fs.statSync(source).isDirectory() ? source : path.dirname(source),
      'book.json')
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    console.log('Metadata: ' + path.relative(process.cwd(), metaPath))
  }

  const bookClass = slugify(args.slug || meta.slug || path.basename(outDir))
  const splitLevel = args.split || (fs.statSync(source).isDirectory() ? 'none' : 'h1')

  const sources = readSources(source, splitLevel, args.type)
  if (sources.length === 0) {
    console.error('No Markdown files found in ' + args.src)
    process.exit(1)
  }

  const fileComponents = sources.map(function (item) {
    return componentFromSource(item, { type: args.type })
  })

  // Only generate the standard frontmatter a source file has not supplied.
  const suppliedTypes = fileComponents.map(function (c) { return c.type })
  const generated = []
  function addIfMissing (type, factory) {
    if (suppliedTypes.indexOf(type) > -1) return
    const component = factory()
    if (component) generated.push(component)
  }

  addIfMissing('cover', function () { return meta.cover ? makeCover(meta) : null })
  addIfMissing('half-title', function () {
    return meta.title ? makeHalfTitle(meta) : null
  })
  addIfMissing('previous-publications', function () {
    return meta.previousPublications && meta.previousPublications.length
      ? makePreviousPublications(meta)
      : null
  })
  addIfMissing('title-page', function () {
    return meta.title ? makeTitlePage(meta) : null
  })
  addIfMissing('copyright', function () {
    return (meta.copyright || meta.isbn || meta.rights) ? makeCopyright(meta) : null
  })
  addIfMissing('dedication', function () {
    return meta.dedication ? makeDedication(meta) : null
  })
  addIfMissing('epigraph', function () {
    return meta.epigraph ? makeEpigraph(meta) : null
  })

  // Order: generated frontmatter first, then the source files in order,
  // with any file-supplied frontmatter kept where the author put it.
  const ordering = ['cover', 'half-title', 'previous-publications',
    'frontispiece', 'title-page', 'copyright', 'dedication', 'epigraph']
  generated.sort(function (a, b) {
    return ordering.indexOf(a.type) - ordering.indexOf(b.type)
  })

  const components = generated.concat(fileComponents)

  // The contents page needs the full list, so build it last and splice it in
  // after the copyright page (or at the top of the frontmatter).
  if (meta.contents !== false && suppliedTypes.indexOf('contents') === -1) {
    const contents = makeContents(components)
    const afterCopyright = components.findIndex(function (component) {
      return component.type === 'copyright'
    })
    const insertAt = afterCopyright > -1
      ? afterCopyright + 1
      : components.findIndex(function (component) {
        return FRONTMATTER_TYPES.indexOf(component.type) === -1
      })
    components.splice(insertAt > -1 ? insertAt : components.length, 0, contents)
  }

  // Number pages from the first frontmatter component that carries content.
  const firstNumbered = components.find(function (component) {
    return component.type !== 'cover'
  })
  if (firstNumbered) firstNumbered.firstNumbered = true

  fs.mkdirSync(outDir, { recursive: true })
  copyAssets(source, outDir)

  const html = renderDocument(components, meta, bookClass)
  const outFile = path.join(outDir, 'index.html')
  fs.writeFileSync(outFile, html)

  console.log('Wrote ' + path.relative(process.cwd(), outFile) +
    ' (' + components.length + ' page components)')
  components.forEach(function (component) {
    console.log('  ' + (TYPE_CLASSES[component.type] || component.type).padEnd(28) +
      (component.title || ''))
  })
  console.log([
    '',
    'Next:',
    '  1. Read the HTML and tag semantic features the converter cannot infer:',
    '     epigraphs, pull quotes, sources, boxes, figure captions.',
    '     See references/markup.md.',
    '  2. If frontmatter titles should look like chapter titles, add to your',
    '     theme’s _styles.scss:  .heading-2 { @include h2(); }',
    '  3. Preview:  npm start  →  http://localhost:5000/' +
      path.relative(process.cwd(), outFile).split(path.sep).join('/') + '?theme=template'
  ].join('\n'))
}

main()
