// Book assembly shared by the Markdown and Word converters.
//
// A converter's job is to turn source paragraphs into page components:
// { type, id, title, body }. Everything after that — generating the standard
// frontmatter, building the contents page, ordering components and emitting
// the final HTML — happens here, so every converter produces the same shape
// of book HTML.

const { slugify } = require('../common')

// Page-component types, and the class each one carries in the HTML.
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

// Types numbered in roman numerals, and listed as frontmatter in the TOC.
const FRONTMATTER_TYPES = [
  'cover', 'half-title', 'previous-publications', 'frontispiece', 'title-page',
  'copyright', 'contents', 'dedication', 'epigraph', 'frontmatter'
]

// The order generated frontmatter appears in.
const FRONTMATTER_ORDER = ['cover', 'half-title', 'previous-publications',
  'frontispiece', 'title-page', 'copyright', 'dedication', 'epigraph']

// Heading level a component's own title is rendered at. Chapters sit under
// parts, so their titles are h2; everything else opens at h1.
function titleLevel (type) {
  return type === 'chapter' ? 2 : 1
}

// Frontmatter and endmatter titles are h1 semantically but should look like
// chapter titles. Themes style this class with @include h2().
function titleClass (type) {
  return (type === 'frontmatter' || type === 'endmatter') ? ' class="heading-2"' : ''
}

function escapeHtml (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute (text) {
  return String(text).replace(/<[^>]+>/g, '').replace(/"/g, '&quot;')
}

// Tracks ids across a whole book so cross-references never collide.
function createIdRegistry () {
  const used = Object.create(null)
  return function uniqueId (candidate) {
    const base = slugify(candidate) || 'section'
    let id = base
    let suffix = 2
    while (used[id]) {
      id = base + '-' + suffix
      suffix += 1
    }
    used[id] = true
    return id
  }
}

function indentBlock (text, indent) {
  const pad = indent || '  '
  return String(text).split('\n').map(function (line) {
    return line.trim() === '' ? line : pad + line
  }).join('\n')
}

// ---------------------------------------------------------------------------
// Generated frontmatter
// ---------------------------------------------------------------------------

// Each factory takes (meta, uniqueId, inline) where inline() renders a short
// run of source markup — the converters differ in what that means.
function makeCover (meta, uniqueId) {
  return {
    type: 'cover',
    id: uniqueId('cover'),
    title: null,
    tocSkip: true,
    body: '<p class="cover"><img src="' + meta.cover + '" alt="' +
      escapeAttribute(meta.title || '') + '" class="cover" /></p>'
  }
}

function makeHalfTitle (meta, uniqueId, inline) {
  return {
    type: 'half-title',
    id: uniqueId('half-title-page'),
    title: 'Half-title page',
    tocSkip: true,
    body: '<p class="title-page-title">' + inline(meta.title || '') + '</p>'
  }
}

function makePreviousPublications (meta, uniqueId, inline) {
  const id = uniqueId('previous-publications')
  return {
    type: 'previous-publications',
    id,
    title: 'Also by the author',
    body: ['<h1 class="heading-2" id="' + id + '">Also by the author</h1>']
      .concat(meta.previousPublications.map(function (line) {
        return '<p>' + inline(line) + '</p>'
      })).join('\n')
  }
}

function makeTitlePage (meta, uniqueId, inline) {
  const id = uniqueId('title-page-title')
  const parts = ['<p class="title-page-title" id="' + id + '">' +
    inline(meta.title || '') + '</p>']

  if (meta.subtitle) {
    parts.push('<p class="title-page-subtitle">' + inline(meta.subtitle) + '</p>')
  }
  if (meta.author) {
    parts.push('<p class="title-page-author">' + inline(meta.author) + '</p>')
  }
  if (meta.contributors) {
    parts.push('<p class="title-page-contributors">' + inline(meta.contributors) + '</p>')
  }
  if (meta.publisher) {
    const name = inline(meta.publisher)
    parts.push('<p class="title-page-publisher">' +
      (meta.publisherUrl
        ? '<a href="' + meta.publisherUrl + '">' + name + '</a>'
        : name) + '</p>')
  }
  if (meta.publisherLogo) {
    parts.push('<p class="title-page-logo"><img src="' + meta.publisherLogo +
      '" alt="' + escapeAttribute(meta.publisher || 'Publisher') + '" /></p>')
  }

  return {
    type: 'title-page',
    id,
    title: 'Title page',
    tocSkip: true,
    body: parts.join('\n')
  }
}

function makeCopyright (meta, uniqueId, inline) {
  const id = uniqueId('copyright')
  const parts = ['<h1 class="non-printing" id="' + id + '">Copyright</h1>']

  parts.push('<p><em>' + inline(meta.title || '') + '</em>' +
    (meta.copyright ? '<br />\n' + inline(meta.copyright) : '') + '</p>')

  if (meta.isbn) {
    parts.push([
      '<p class="identifiers">',
      '  <span class="identifier">',
      '    <span class="identifier-scheme">ISBN</span>:',
      '    <span class="identifier-id">' + escapeHtml(meta.isbn) + '</span>',
      '  </span>',
      '</p>'
    ].join('\n'))
  }

  const rights = [].concat(meta.rights || [])
  rights.forEach(function (line) { parts.push('<p>' + inline(line) + '</p>') })

  return { type: 'copyright', id, title: 'Copyright', body: parts.join('\n') }
}

function makeDedication (meta, uniqueId, inline) {
  const id = uniqueId('dedication')
  return {
    type: 'dedication',
    id,
    title: 'Dedication',
    body: '<p class="dedication" id="' + id + '">' + inline(meta.dedication) + '</p>'
  }
}

function makeEpigraph (meta, uniqueId, inline) {
  const id = uniqueId('epigraph')
  const epigraph = typeof meta.epigraph === 'string'
    ? { text: meta.epigraph }
    : meta.epigraph
  const parts = ['<p class="epigraph" id="' + id + '">' + inline(epigraph.text) + '</p>']
  if (epigraph.source) {
    parts.push('<p class="source">' + inline(epigraph.source) + '</p>')
  }
  return { type: 'epigraph', id, title: 'Epigraph', body: parts.join('\n') }
}

// The contents page needs the finished component list, so it is built last
// and spliced in afterwards.
function makeContents (components, uniqueId) {
  const id = uniqueId('contents')
  const entries = components.filter(function (component) {
    return component.title && !component.tocSkip && component.type !== 'contents'
  }).map(function (component) {
    const classes = ['toc-entry-title']
    if (FRONTMATTER_TYPES.indexOf(component.type) > -1) classes.push('frontmatter-entry')
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

// Generate whatever standard frontmatter the metadata supports and the source
// did not already supply, then return the full ordered component list.
function assemble (fileComponents, meta, uniqueId, inline) {
  const supplied = fileComponents.map(function (component) { return component.type })
  const generated = []

  function addIfMissing (type, factory) {
    if (supplied.indexOf(type) > -1) return
    const component = factory()
    if (component) generated.push(component)
  }

  addIfMissing('cover', function () {
    return meta.cover ? makeCover(meta, uniqueId) : null
  })
  addIfMissing('half-title', function () {
    return meta.title ? makeHalfTitle(meta, uniqueId, inline) : null
  })
  addIfMissing('previous-publications', function () {
    return (meta.previousPublications && meta.previousPublications.length)
      ? makePreviousPublications(meta, uniqueId, inline)
      : null
  })
  addIfMissing('title-page', function () {
    return meta.title ? makeTitlePage(meta, uniqueId, inline) : null
  })
  addIfMissing('copyright', function () {
    return (meta.copyright || meta.isbn || meta.rights)
      ? makeCopyright(meta, uniqueId, inline)
      : null
  })
  addIfMissing('dedication', function () {
    return meta.dedication ? makeDedication(meta, uniqueId, inline) : null
  })
  addIfMissing('epigraph', function () {
    return meta.epigraph ? makeEpigraph(meta, uniqueId, inline) : null
  })

  generated.sort(function (a, b) {
    return FRONTMATTER_ORDER.indexOf(a.type) - FRONTMATTER_ORDER.indexOf(b.type)
  })

  const components = generated.concat(fileComponents)

  if (meta.contents !== false && supplied.indexOf('contents') === -1) {
    const contents = makeContents(components, uniqueId)
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

  // Page numbering starts at the first component that is actually printed.
  const firstNumbered = components.find(function (component) {
    return component.type !== 'cover'
  })
  if (firstNumbered) firstNumbered.firstNumbered = true

  return components
}

// ---------------------------------------------------------------------------
// HTML emission
// ---------------------------------------------------------------------------

function renderComponent (component, bookClass) {
  const classes = [bookClass, TYPE_CLASSES[component.type] || 'chapter']
  if (component.firstNumbered) classes.push('page-1')
  if (component.classes) classes.push(component.classes)

  const header = component.title
    ? ' data-header="' + escapeAttribute(component.title) + '"'
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

// options: { standalone, theme, css }
function renderDocument (components, meta, bookClass, options) {
  const settings = options || {}
  const head = [
    '<!DOCTYPE html>',
    '<html lang="' + (meta.lang || 'en') + '">',
    '',
    '<head>',
    '    <title>' + escapeHtml(meta.title || bookClass) + '</title>',
    '    <meta http-equiv="content-type" content="text/html; charset=UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    ''
  ]

  if (settings.standalone) {
    head.push('    <link rel="stylesheet" type="text/css" href="' +
      (settings.css || '../../themes/' + (settings.theme || 'beatrix') + '/main.css') +
      '">')
    head.push('    <script src="../../js/vendor/paged.polyfill.js"></script>')
  } else {
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

// A one-line summary of what was built, for the CLI.
function report (components, outFile) {
  console.log('Wrote ' + outFile + ' (' + components.length + ' page components)')
  components.forEach(function (component) {
    console.log('  ' + (TYPE_CLASSES[component.type] || component.type).padEnd(28) +
      (component.title || ''))
  })
}

module.exports = {
  TYPE_CLASSES,
  FRONTMATTER_TYPES,
  titleLevel,
  titleClass,
  escapeHtml,
  escapeAttribute,
  createIdRegistry,
  indentBlock,
  assemble,
  makeContents,
  renderComponent,
  renderDocument,
  report
}
