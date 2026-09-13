#!/usr/bin/env node
//
// Build a reflowable EPUB 3 from book HTML.
//
// This reads the converter's output — the flat, semantic HTML — and NOT the
// designed HTML that `design-pass.js` writes. That is deliberate and it is the
// one thing to understand about this script.
//
// A print page and a reflowing screen want opposite things. The design pass
// splits an opening paragraph in two so the first three lines can be locked to
// the heading above them; it wraps headings in boxes that must not break; it
// plants zero-height running heads. All of that is scaffolding for a page of a
// fixed size. On a phone, in a font the reader chose, at a size they chose,
// there is no such page: the split paragraph becomes two paragraphs with a gap
// down the middle of a sentence, and the keep boxes are noise.
//
// So the two formats fork from the same source and never from each other:
//
//     restyled .docx → docx-to-book.js → book HTML
//                                          ├── design-pass.js → PDF
//                                          └── make-epub.js   → EPUB
//
// Everything the print book expresses in page geometry, the EPUB expresses in
// document structure — which is why the closed style vocabulary in the
// manuscript matters more here than anywhere else.
'use strict'

const fs = require('fs')
const path = require('path')
const { parseArgs, slugify } = require('./common')
const { writeZip } = require('./lib/zip')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node make-epub.js --content <dir> [--out <file>] [--title <t>] [--author <a>]',
    '',
    '  --content <dir>   Book directory holding index.html, as written by',
    '                    docx-to-book.js or md-to-book.js. Use the converter',
    '                    output, not the output of design-pass.js.',
    '  --out <file>      Output .epub. Default: <content>/<dir-name>.epub',
    '  --title <t>       Override the title read from the book HTML.',
    '  --author <a>      Override the author read from the book HTML.',
    '  --lang <code>     Language code. Default: read from <html lang>, else en.',
    '',
    'Splits the book at its page components, writes one XHTML file per',
    'component, and builds the navigation from the headings inside them.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Reading the book HTML
// ---------------------------------------------------------------------------

const VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']

function components (body) {
  const out = []
  const open = /<div\b([^>]*)>/g
  let match
  while ((match = open.exec(body)) !== null) {
    const classes = /\bclass="([^"]*)"/.exec(match[1])
    if (!classes) continue
    const names = classes[1].split(/\s+/)
    const known = ['title-page', 'copyright-page', 'contents-page', 'chapter',
      'frontmatter', 'endmatter', 'part', 'index']
    if (!names.some(function (n) { return known.indexOf(n) !== -1 })) continue
    // Only top-level components: find this div's end and skip past it.
    const end = matchingClose(body, match.index)
    if (end === -1) continue
    const header = /\bdata-header="([^"]*)"/.exec(match[1])
    out.push({
      classes: names,
      title: header ? decode(header[1]) : '',
      html: body.slice(match.index, end)
    })
    open.lastIndex = end
  }
  return out
}

function matchingClose (html, from) {
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

function decode (text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function escapeXml (text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// HTML to XHTML
// ---------------------------------------------------------------------------
// EPUB is parsed as XML, so anything a browser forgives — an unclosed <br>, a
// bare ampersand, a named entity that is not one of the five XML knows — is a
// hard failure in a reader rather than a rendering quirk.

const NAMED = { amp: '&amp;', lt: '&lt;', gt: '&gt;', quot: '&quot;', apos: '&apos;' }
const ENTITIES = {
  nbsp: 160, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, ldquo: 8220,
  rdquo: 8221, hellip: 8230, times: 215, deg: 176, plusmn: 177, micro: 181,
  alpha: 945, beta: 946, gamma: 947, delta: 948, kappa: 954, lambda: 955,
  mu: 956, pi: 960, sigma: 963, tau: 964, omega: 969, trade: 8482, copy: 169,
  reg: 174, prime: 8242, Prime: 8243, larr: 8592, rarr: 8594, harr: 8596,
  le: 8804, ge: 8805, ne: 8800, asymp: 8776, minus: 8722, bull: 8226
}

function toXhtml (fragment) {
  let out = fragment

  // Entities first, before anything else touches an ampersand.
  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, function (all, name) {
    if (NAMED[name]) return all
    if (ENTITIES[name] !== undefined) return '&#' + ENTITIES[name] + ';'
    return '&amp;' + name + ';'
  })
  // A bare ampersand that is not the start of any entity at all.
  out = out.replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')

  // Close the void elements.
  VOID.forEach(function (name) {
    out = out.replace(new RegExp('<' + name + '\\b([^>]*?)\\s*/?>', 'gi'), function (all, attrs) {
      return '<' + name + attrs.replace(/\s+$/, '') + ' />'
    })
  })

  // Boolean attributes need a value in XML — but only inside a tag. Matching
  // them in the text corrupts the book: this rewrote every occurrence of the
  // word "selected" in running prose to selected="selected".
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    function (all, name, attrs) {
      const fixed = attrs.replace(/(^|\s)(checked|selected|disabled|hidden|multiple|readonly)(?=\s|$)/g,
        '$1$2="$2"')
      return '<' + name + fixed + '>'
    })
  return out
}

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------
// Deliberately small. A reflowable book should carry structure and let the
// reader's device decide measure, size and margin; every length here that
// could be absolute is relative so it survives being overridden.

const CSS = `/* Advanced reference book — reflowable styles.
   Sizes are relative on purpose: the reader picked the base size, not us. */
html { font-size: 100%; }
body { margin: 0 5%; line-height: 1.5; font-family: serif; widows: 2; orphans: 2; }

h1, h2, h3, h4, h5, h6 { font-family: sans-serif; line-height: 1.25; page-break-after: avoid;
  break-after: avoid; -webkit-hyphens: none; hyphens: none; }
h1 { font-size: 1.6em; margin: 1.2em 0 0.6em; }
h2 { font-size: 1.3em; margin: 1.4em 0 0.5em; border-top: 2px solid #157a78; padding-top: 0.4em; }
h3 { font-size: 1.12em; margin: 1.2em 0 0.4em; color: #0d2035; }
h4 { font-size: 1em; margin: 1em 0 0.3em; }
h5 { font-size: 1em; margin: 1.3em 0 0.2em; color: #0d2035; }

p { margin: 0 0 0.7em; text-indent: 0; }
p.standfirst { font-style: italic; color: #333; margin-bottom: 1em; }
p.title-page-subtitle { font-size: 1.1em; font-style: italic; }
p.title-page-author { font-size: 1.05em; margin-top: 1.5em; }

/* The entry name carries a number in print. On screen it is the heading. */
h5 .entry-number { display: inline-block; background: #157a78; color: #fff;
  font-size: 0.75em; padding: 0 0.4em; margin-right: 0.4em; border-radius: 2px; }

sup.cite, sup { font-size: 0.72em; line-height: 0; vertical-align: super; }

ol.references { font-size: 0.9em; padding-left: 1.4em; }
ol.references li { margin-bottom: 0.35em; }
p.reference-section { font-size: 0.78em; letter-spacing: 0.08em; text-transform: uppercase;
  font-family: sans-serif; color: #555; margin: 1.4em 0 0.4em; }

ul.index-list { list-style: none; padding: 0; font-size: 0.92em; }
ul.index-list li { margin: 0 0 0.2em; }
h2.index-letter { border: 0; background: #157a78; color: #fff; display: inline-block;
  padding: 0.05em 0.5em; font-size: 1em; margin: 1.2em 0 0.4em; }

ul.bullets { padding-left: 1.3em; }

/* A wide table cannot reflow, so let it scroll rather than clip. */
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.82em; margin: 1em 0; }
th { background: #0d2035; color: #fff; text-align: left; font-family: sans-serif;
  font-size: 0.92em; padding: 0.4em 0.5em; }
td { padding: 0.4em 0.5em; border-bottom: 1px solid #dde3e6; vertical-align: top; }
tr:nth-child(even) td { background: #f5f7f8; }
`

// ---------------------------------------------------------------------------

const contentDir = path.resolve(args.content)
const indexFile = path.join(contentDir, 'index.html')
if (!fs.existsSync(indexFile)) {
  console.error('No index.html in ' + contentDir)
  process.exit(1)
}

const html = fs.readFileSync(indexFile, 'utf8')
const bodyStart = html.indexOf('<body>')
const body = html.slice(bodyStart + 6, html.lastIndexOf('</body>'))
const lang = args.lang || (/<html[^>]*\blang="([^"]*)"/.exec(html) || [])[1] || 'en'

const parsed = components(body)
if (!parsed.length) {
  console.error('No page components found — is this book HTML?')
  process.exit(1)
}

const titleFromPage = (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(
  (parsed.filter(function (c) { return c.classes.indexOf('title-page') !== -1 })[0] || {}).html || ''
) || [])[1]
const authorFromPage = (/<p class="title-page-author">([\s\S]*?)<\/p>/.exec(body) || [])[1]

const title = args.title || decode((titleFromPage || path.basename(contentDir)).replace(/<[^>]+>/g, '').trim())
const author = args.author || decode((authorFromPage || '').replace(/<[^>]+>/g, '').trim())

// One file per component. The contents page goes: an EPUB has real navigation,
// and a list of print page numbers is worse than no list at all.
const files = []
const navPoints = []
let counter = 0

parsed.forEach(function (component) {
  if (component.classes.indexOf('contents-page') !== -1) return
  counter += 1
  const name = 'text/' + String(counter).padStart(3, '0') + '-' +
    (slugify(component.title || component.classes[1] || 'section') || 'section') + '.xhtml'

  // Strip the two structural wrappers the print themes need; on screen they
  // only get in the way of the reader's own margins.
  let inner = component.html
    .replace(/^<div\b[^>]*>\s*<div>\s*<div>/, '')
    .replace(/<\/div>\s*<\/div>\s*<\/div>\s*$/, '')
  inner = inner
    .replace(/<h6 class="run-head">[\s\S]*?<\/h6>/g, '')
    .replace(/<div class="keep-lead[^"]*">([\s\S]*?)<\/div>/g, '$1')
  inner = inner.replace(/<table/g, '<div class="table-wrap"><table')
    .replace(/<\/table>/g, '</table></div>')

  const heading = component.title || title
  files.push({
    name: name,
    data: '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' +
      lang + '" lang="' + lang + '">\n<head>\n  <title>' + escapeXml(heading) +
      '</title>\n  <link rel="stylesheet" type="text/css" href="../styles/book.css" />\n' +
      '</head>\n<body epub:type="' +
      (component.classes.indexOf('frontmatter') !== -1 ? 'frontmatter'
        : component.classes.indexOf('endmatter') !== -1 ? 'backmatter' : 'bodymatter') +
      '">\n' + toXhtml(inner) + '\n</body>\n</html>\n'
  })

  navPoints.push({ href: name, title: heading, children: sectionsIn(inner) })
})

// Second-level navigation: the section heads inside a component.
function sectionsIn (fragment) {
  const found = []
  const heading = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g
  let match
  while ((match = heading.exec(fragment)) !== null) {
    if (/\bclass="[^"]*\bindex-letter\b/.test(match[1])) continue
    const id = (/\bid="([^"]*)"/.exec(match[1]) || [])[1]
    if (!id) continue
    found.push({ id: id, text: match[2].replace(/<[^>]+>/g, '').trim() })
  }
  return found
}

const navList = navPoints.map(function (point) {
  const children = point.children.length
    ? '\n      <ol>\n' + point.children.map(function (c) {
      return '        <li><a href="' + point.href + '#' + c.id + '">' + escapeXml(c.text) + '</a></li>'
    }).join('\n') + '\n      </ol>\n    '
    : ''
  return '    <li><a href="' + point.href + '">' + escapeXml(point.title) + '</a>' + children + '</li>'
}).join('\n')

const nav = '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' +
  lang + '" lang="' + lang + '">\n<head>\n  <title>Contents</title>\n' +
  '  <link rel="stylesheet" type="text/css" href="styles/book.css" />\n</head>\n<body>\n' +
  '  <nav epub:type="toc" id="toc">\n  <h1>Contents</h1>\n  <ol>\n' + navList +
  '\n  </ol>\n  </nav>\n</body>\n</html>\n'

const identifier = 'urn:uuid:' + require('crypto')
  .createHash('sha1').update(title + '|' + author).digest('hex')
  .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5')
const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

const manifest = files.map(function (file, i) {
  return '    <item id="t' + (i + 1) + '" href="' + file.name + '" media-type="application/xhtml+xml"/>'
}).join('\n')
const spine = files.map(function (file, i) { return '    <itemref idref="t' + (i + 1) + '"/>' }).join('\n')

const opf = '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="' + lang + '">\n' +
  '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
  '    <dc:identifier id="pub-id">' + identifier + '</dc:identifier>\n' +
  '    <dc:title>' + escapeXml(title) + '</dc:title>\n' +
  '    <dc:language>' + lang + '</dc:language>\n' +
  (author ? '    <dc:creator>' + escapeXml(author) + '</dc:creator>\n' : '') +
  '    <meta property="dcterms:modified">' + modified + '</meta>\n' +
  '  </metadata>\n  <manifest>\n' +
  '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
  '    <item id="css" href="styles/book.css" media-type="text/css"/>\n' +
  manifest + '\n  </manifest>\n  <spine>\n' + spine + '\n  </spine>\n</package>\n'

const entries = [
  // The mimetype must be first and uncompressed, or a reader will not open it.
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  {
    name: 'META-INF/container.xml',
    data: '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
      '  </rootfiles>\n</container>\n'
  },
  { name: 'OEBPS/content.opf', data: opf },
  { name: 'OEBPS/nav.xhtml', data: nav },
  { name: 'OEBPS/styles/book.css', data: CSS }
]
files.forEach(function (file) { entries.push({ name: 'OEBPS/' + file.name, data: file.data }) })

const outFile = path.resolve(args.out || path.join(contentDir, path.basename(contentDir) + '.epub'))
fs.writeFileSync(outFile, writeZip(entries))

const size = fs.statSync(outFile).size
console.log('Wrote ' + path.relative(process.cwd(), outFile) + ' — ' + files.length +
  ' documents, ' + (size / 1024).toFixed(0) + ' KB')
console.log('  title  ' + title)
if (author) console.log('  author ' + author)
