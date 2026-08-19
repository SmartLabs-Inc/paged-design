#!/usr/bin/env node

// Export a paged-design book to InDesign.
//
//   node to-idml.js --content content/my-book --out My-Book.idml
//   node to-idml.js --content content/my-book --icml My-Book.icml
//
// InDesign's own .indd is a closed binary format that only InDesign writes, so
// nothing outside Adobe can produce one. IDML is the published interchange
// format: InDesign opens it directly and File > Save As writes the .indd. That
// is the supported route in and it is what this produces.
//
// Two outputs, because they answer different questions:
//
//   --out  <file>.idml   a whole document: page size, margins, columns, master
//                        pages with running head and folio, threaded frames,
//                        and the full style sheet. Open it and you have a book.
//   --icml <file>.icml   the text alone, styled, as an InCopy story. Place it
//                        into a template somebody has already built in
//                        InDesign. Fewer moving parts, and the right choice
//                        when the design already exists on the InDesign side.
//
// What does not survive, and is reported at the end of every run rather than
// left to be discovered: tables arrive as tab-separated paragraphs (Table >
// Convert Text to Table turns them back), and figure slots arrive as styled
// paragraphs rather than empty graphic frames.

const fs = require('fs')
const path = require('path')
const { requireRepoRoot, parseArgs } = require('./common')
const { writeZip } = require('./lib/zip')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node to-idml.js --content <dir> [options]',
    '',
    '  --content <dir>  Directory holding the book’s index.html.',
    '  --out <file>     Write an IDML document. Default: <book>.idml.',
    '  --icml <file>    Also write an InCopy story for placing in a template.',
    '  --pages <n>      Pages of threaded frames to build. Default: 320.',
    '  --theme <name>   Theme whose page size, margins and columns to use.',
    '                   Default: beatrix.',
    '  --title <text>   Document title. Default: the book’s <title>.',
    '',
    'InDesign cannot be scripted from here, so the package is checked against',
    'the parts and cross-references the format requires, not against InDesign.',
    'Open the result and save as .indd.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const contentDir = path.resolve(root, args.content)
const bookName = path.basename(contentDir)
const idmlOut = path.resolve(root, args.out || (bookName + '.idml'))
const icmlOut = args.icml ? path.resolve(root, args.icml) : null
const PAGES = Number(args.pages || 320)

const html = fs.readFileSync(path.join(contentDir, 'index.html'), 'utf-8')
const docTitle = args.title || (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || bookName

// ---------------------------------------------------------------------------
// Geometry, in points, from the theme
// ---------------------------------------------------------------------------
// InDesign works in points. The theme is written in px on a 96dpi basis, which
// is exactly 0.75pt to the px, so the two are the same measurements said
// differently — no rounding is introduced here.

const round = n => Math.round(n * 1000) / 1000

const PX = 0.75
const MM = 72 / 25.4
const IN = 72
const PT = 1

// The page is read out of the theme's compiled CSS rather than written here.
// Hard-coding 7 × 10in worked for the book in hand and quietly produced a
// 7 × 10in InDesign document for a 111 × 178mm novel, which is the kind of
// wrong that survives review because every other number looks right.

function cssLength (value) {
  const m = String(value).trim().match(/^(-?[\d.]+)(mm|cm|in|pt|px|pc)?$/)
  if (!m) return null
  const n = Number(m[1])
  switch (m[2]) {
    case 'mm': return n * MM
    case 'cm': return n * 10 * MM
    case 'in': return n * IN
    case 'pc': return n * 12
    case 'px': return n * PX
    default: return n * PT
  }
}

function readTheme (name) {
  const file = path.join(root, 'themes', name, 'main.css')
  if (!fs.existsSync(file)) {
    console.error('No compiled CSS for theme "' + name + '". Run build-css.js first.')
    process.exit(1)
  }
  const css = fs.readFileSync(file, 'utf-8')

  const size = css.match(/@page\s*\{[^}]*?size:\s*([\d.]+\w*)\s+([\d.]+\w*)/)
  if (!size) { console.error('Theme has no @page size.'); process.exit(1) }

  const side = function (which) {
    const block = css.match(new RegExp('@page\\s*:' + which + '\\s*\\{([^}]*)\\}'))
    if (!block) return null
    const get = prop => {
      const m = block[1].match(new RegExp(prop + ':\\s*([^;\\n}]+)'))
      return m ? cssLength(m[1]) : null
    }
    return { top: get('margin-top'), bottom: get('margin-bottom'),
      left: get('margin-left'), right: get('margin-right') }
  }
  const right = side('right')
  const left = side('left')

  // Columns: the theme sets them on the chapter's inner wrapper. A theme that
  // sets none is a single-column book.
  const cols = css.match(/column-count:\s*(\d+)[^}]*?column-gap:\s*([\d.]+\w*)/)
  const gapOnly = css.match(/column-gap:\s*([\d.]+\w*)/)

  // Body type, so the styles below are set at the theme's scale and not at the
  // one they were written against. Only the base size and leading are read;
  // every other style is scaled from it, which keeps the relationships in the
  // design and stops a pocket novel arriving set at a textbook's size.
  const body = css.match(/body\s*\{[^}]*font-family:[^;]*;\s*font-size:\s*([\d.]+\w*)[^}]*line-height:\s*([\d.]+\w*)/)
  const fonts = css.match(/body\s*\{[^}]*font-family:\s*([^;]+);/)

  return {
    bodySize: body ? cssLength(body[1]) : null,
    bodyLeading: body ? cssLength(body[2]) : null,
    bodyFont: fonts ? fonts[1].split(',')[0].replace(/["']/g, '').trim() : null,
    width: cssLength(size[1]),
    height: cssLength(size[2]),
    inside: right ? right.left : (left ? left.right : 20 * MM),
    outside: right ? right.right : (left ? left.left : 20 * MM),
    top: (right && right.top) || 40,
    bottom: (right && right.bottom) || 50,
    facing: !!(left && right),
    columns: cols ? Number(cols[1]) : 1,
    gutter: cols ? cssLength(cols[2]) : (gapOnly ? cssLength(gapOnly[1]) : 12)
  }
}

const themeName = args.theme || 'beatrix'
const THEME = readTheme(themeName)

const PAGE_W = THEME.width
const PAGE_H = THEME.height
const M_INSIDE = THEME.inside
const M_OUTSIDE = THEME.outside
const M_TOP = THEME.top
const M_BOTTOM = THEME.bottom
const COLUMNS = THEME.columns
const GUTTER = THEME.gutter
const FACING = THEME.facing

const FRAME_W = PAGE_W - M_INSIDE - M_OUTSIDE
const FRAME_H = PAGE_H - M_TOP - M_BOTTOM

// The style table below is written at the scale of the theme it was built
// against. A theme that sets its body larger or smaller scales the whole table
// by the same factor, so the size relationships between a heading and its text
// survive the move.
const BASELINE_SIZE = 12.8 * PX
const BASELINE_LEADING = 17 * PX
const SIZE_SCALE = THEME.bodySize ? THEME.bodySize / BASELINE_SIZE : 1
const LEAD_SCALE = THEME.bodyLeading ? THEME.bodyLeading / BASELINE_LEADING : 1


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
// One InDesign paragraph style per component in the theme, carrying the sizes
// the theme sets. The names are the ones a designer will see in the Paragraph
// Styles panel, so they read as design roles rather than as CSS class names.

// The text face comes from the theme; the secondary face is the one the AALAI
// design uses for labels and apparatus and is a reasonable default elsewhere.
// Both are names InDesign has to be able to resolve on the machine that opens
// the file — a missing font is flagged there, not here.
const FONT_SERIF = THEME.bodyFont || 'Georgia'
const FONT_SANS = 'Aptos'

const NAVY = 'Color/AALAI Navy'
const TEAL = 'Color/AALAI Teal'
const GOLD = 'Color/AALAI Gold'
const MID = 'Color/AALAI Mid'
const BLACK = 'Color/Black'

// size and leading in px, as the theme states them; converted on the way out.
const PARA_STYLES = [
  ['Body', { font: FONT_SERIF, size: 12.8, leading: 17, align: 'LeftJustified', space: 9.4, hyphen: true }],
  ['Part Eyebrow', { font: FONT_SANS, size: 11, leading: 17, caps: true, track: 220, color: GOLD, bold: true, space: 8 }],
  ['Part Title', { font: FONT_SERIF, size: 34, leading: 40, color: NAVY, space: 8, keep: true }],
  ['Part Subtitle', { font: FONT_SERIF, size: 15, leading: 20, italic: true, color: NAVY, space: 8 }],
  ['Section Head', { font: FONT_SERIF, size: 21, leading: 26, color: NAVY, spaceBefore: 20, space: 10, keep: true, startPage: true }],
  ['Apparatus Head', { font: FONT_SANS, size: 12, leading: 17, caps: true, track: 140, bold: true, color: MID, spaceBefore: 20, space: 6, keep: true }],
  ['Topic Head', { font: FONT_SERIF, size: 15.5, leading: 22, color: NAVY, spaceBefore: 22, space: 6, keep: true }],
  ['Subtopic Head', { font: FONT_SANS, size: 10.5, leading: 17, bold: true, color: TEAL, spaceBefore: 18, space: 4, keep: true }],
  ['Entry Name', { font: FONT_SANS, size: 11, leading: 17, bold: true, color: NAVY, spaceBefore: 14, space: 4, keep: true }],
  ['Standfirst', { font: FONT_SERIF, size: 14.3, leading: 20, italic: true, color: NAVY, space: 12, keep: true }],
  ['Label', { font: FONT_SANS, size: 8.5, leading: 17, caps: true, track: 140, bold: true, color: TEAL, spaceBefore: 10, space: 4 }],
  ['Callout Label', { font: FONT_SANS, size: 8.5, leading: 14, caps: true, track: 140, bold: true, color: TEAL, space: 3 }],
  ['Callout', { font: FONT_SANS, size: 10.5, leading: 14, space: 6 }],
  ['Contents Entry', { font: FONT_SANS, size: 12, leading: 20, color: NAVY, space: 4 }],
  ['Table Head', { font: FONT_SANS, size: 8, leading: 14, caps: true, track: 140, bold: true, color: BLACK, space: 2 }],
  ['Table Cell', { font: FONT_SANS, size: 10.5, leading: 14, space: 2 }],
  ['Table Caption', { font: FONT_SANS, size: 9, leading: 14, caps: true, track: 140, bold: true, color: MID, spaceBefore: 12, space: 3, keep: true }],
  ['Figure Caption', { font: FONT_SANS, size: 8, leading: 13, bold: true, color: NAVY, space: 3 }],
  ['Figure Slot', { font: FONT_SANS, size: 10, leading: 16, caps: true, track: 140, bold: true, color: 'Color/AALAI Supported', spaceBefore: 12, space: 3, keep: true }],
  ['Production Note', { font: FONT_SANS, size: 7.5, leading: 12, color: GOLD, space: 10 }],
  ['Reference Part', { font: FONT_SERIF, size: 17, leading: 24, color: NAVY, spaceBefore: 20, space: 6, keep: true }],
  ['Reference Section', { font: FONT_SANS, size: 9.5, leading: 14, caps: true, track: 140, bold: true, color: MID, spaceBefore: 12, space: 4, keep: true }],
  ['Reference', { font: FONT_SANS, size: 10.5, leading: 13.3, space: 6, indent: 14, hang: true }],
  ['Index Letter', { font: FONT_SANS, size: 13, leading: 17, bold: true, color: TEAL, spaceBefore: 14, space: 4, keep: true }],
  ['Index Entry', { font: FONT_SANS, size: 10.5, leading: 12.2, space: 3, indent: 12, hang: true }]
]

const CHAR_STYLES = [
  ['Citation', { size: 8, superscript: true, bold: true, color: TEAL, font: FONT_SANS }],
  ['Bold', { bold: true }],
  ['Italic', { italic: true }],
  ['Index Locator', { font: FONT_SANS, size: 8.5, color: TEAL }],
  ['URL', { font: FONT_SANS, size: 9.7, color: MID }]
]

const COLORS = [
  ['AALAI Navy', [13, 32, 53]],
  ['AALAI Teal', [19, 124, 122]],
  ['AALAI Gold', [183, 154, 91]],
  ['AALAI Mid', [102, 113, 124]],
  ['AALAI Supported', [49, 94, 145]]
]

// ---------------------------------------------------------------------------
// The book, read as a stream of styled paragraphs
// ---------------------------------------------------------------------------
// A small tag walker rather than a set of regular expressions, because style
// depends on where an element sits as much as on what it is: a <li> is a
// reference in the reference section, an index entry in the index and a
// contents line on a part opener, and the element itself says none of that.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  middot: '·', mdash: '—', ndash: '–', hellip: '…',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  times: '×', deg: '°', shy: ''
}

function decode (text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m))
    // Soft hyphens are stripped. They were put in because Chromium here has no
    // hyphenation dictionary; InDesign has its own and will hyphenate better
    // than a pre-broken word lets it.
    .replace(/­/g, '')
}

// Which paragraph style a block gets, given the block itself and its ancestry.
function paragraphStyleFor (tag, cls, stack) {
  const has = name => cls.indexOf(name) !== -1
  const within = name => stack.some(s => s.cls.indexOf(name) !== -1)

  if (has('run-head') || has('part-name')) return null       // string carriers
  if (has('figure-brief') || has('needs-copy')) return 'Production Note'
  if (has('figure-slot-id') || has('figure-slot-size')) return 'Figure Slot'
  if (has('figure-caption')) return 'Figure Caption'
  if (has('table-caption')) return 'Table Caption'
  if (has('chapter-eyebrow')) return 'Part Eyebrow'
  if (has('chapter-subtitle')) return 'Part Subtitle'
  if (has('part-title')) return 'Part Title'
  if (has('section-head')) return 'Section Head'
  if (has('apparatus-head')) return 'Apparatus Head'
  if (has('reference-part')) return 'Reference Part'
  if (has('reference-section')) return 'Reference Section'
  if (has('standfirst')) return 'Standfirst'
  if (has('callout-label')) return 'Callout Label'
  if (has('label') || has('part-count') || has('part-panel-label')) return 'Label'

  if (tag === 'li') {
    if (within('references')) return 'Reference'
    if (within('index')) return 'Index Entry'
    if (within('part-contents')) return 'Contents Entry'
    return 'Body'
  }
  if (tag === 'h1' || tag === 'h2') return within('index') ? 'Index Letter' : 'Section Head'
  if (tag === 'h3') return 'Topic Head'
  if (tag === 'h4') return 'Subtopic Head'
  if (tag === 'h5' || tag === 'h6') return 'Entry Name'
  if (within('callout') || within('panel')) return 'Callout'
  return 'Body'
}

function characterStyleFor (tag, cls) {
  if (cls.indexOf('cite') !== -1) return 'Citation'
  if (cls.indexOf('index-locators') !== -1) return 'Index Locator'
  if (cls.indexOf('uri') !== -1) return 'URL'
  if (tag === 'strong' || tag === 'b') return 'Bold'
  if (tag === 'em' || tag === 'i' || tag === 'cite') return 'Italic'
  if (tag === 'sup') return 'Citation'
  return null
}

const BLOCK = /^(p|h1|h2|h3|h4|h5|h6|li|caption|figcaption|blockquote)$/
const VOID = /^(br|img|col|hr|meta|link|input|source)$/

function readParagraphs (source) {
  const body = source.slice(source.indexOf('<body'), source.lastIndexOf('</body>'))
  const paragraphs = []
  const stack = []
  let para = null              // { style, runs }
  let row = null               // cells of the current table row
  let cell = null
  let inHead = false
  const counts = {}

  const bump = k => { counts[k] = (counts[k] || 0) + 1 }

  const flush = () => {
    if (!para) return
    const text = para.runs.map(r => r.text).join('').replace(/\s+/g, ' ').trim()
    if (text) { paragraphs.push(para); bump(para.style) }
    para = null
  }

  const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/g
  let m
  while ((m = TOKEN.exec(body))) {
    if (m[0].slice(0, 4) === '<!--') continue

    if (m[3] !== undefined) {                                  // text
      const text = decode(m[3])
      if (!text.trim() && !(para && para.runs.length)) continue
      const charStyle = stack.slice().reverse()
        .map(s => characterStyleFor(s.tag, s.cls)).find(Boolean) || null
      if (cell) cell.push(text)
      else if (para) para.runs.push({ text: text, style: charStyle })
      continue
    }

    const tag = m[1].toLowerCase()
    const closing = m[0][1] === '/'
    const attrs = m[2] || ''
    const cls = (attrs.match(/class="([^"]*)"/) || ['', ''])[1]

    if (closing) {
      while (stack.length && stack[stack.length - 1].tag !== tag) stack.pop()
      const open = stack.pop()
      if (tag === 'td' || tag === 'th') { if (row && cell) row.push(cell.join('').replace(/\s+/g, ' ').trim()); cell = null }
      else if (tag === 'tr') {
        if (row && row.length) {
          paragraphs.push({
            style: inHead ? 'Table Head' : 'Table Cell',
            runs: [{ text: row.join('\t'), style: null }]
          })
          bump(inHead ? 'Table Head' : 'Table Cell')
        }
        row = null
      } else if (tag === 'thead') inHead = false
      else if (BLOCK.test(tag)) flush()
      continue
    }

    const selfClosing = /\/$/.test(attrs) || VOID.test(tag)
    if (!selfClosing) stack.push({ tag: tag, cls: cls })

    if (tag === 'br' && para) { para.runs.push({ text: ' ', style: null }); continue }
    if (tag === 'thead') { inHead = true; continue }
    if (tag === 'tr') { row = []; continue }
    if (tag === 'td' || tag === 'th') { cell = []; continue }

    if (BLOCK.test(tag)) {
      flush()
      const style = paragraphStyleFor(tag, cls, stack.slice(0, -1))
      para = style ? { style: style, runs: [] } : null
    }
  }
  flush()
  return { paragraphs: paragraphs, counts: counts }
}


// ---------------------------------------------------------------------------
// IDML parts
// ---------------------------------------------------------------------------

const DOM = '18.0'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const PKG = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"'

// A control character below 0x20 that is not tab, newline or return is illegal
// in XML 1.0, and one of those inside a Content element makes the package
// unopenable rather than merely wrong. Built rather than written literally so
// the source of this file stays printable.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g')

function esc (text) {
  return String(text)
    .replace(CONTROL, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrap (tagName, inner) {
  return HEAD + '\n<idPkg:' + tagName + ' ' + PKG + ' DOMVersion="' + DOM + '">\n' +
    inner + '\n</idPkg:' + tagName + '>\n'
}

function paragraphStyleXml (name, s) {
  const bits = ['Self="ParagraphStyle/' + esc(name) + '"', 'Name="' + esc(name) + '"',
    'PointSize="' + round(s.size * PX * SIZE_SCALE) + '"',
    'Leading="' + round(s.leading * PX * LEAD_SCALE) + '"',
    'SpaceAfter="' + round((s.space || 0) * PX * LEAD_SCALE) + '"',
    'SpaceBefore="' + round((s.spaceBefore || 0) * PX * LEAD_SCALE) + '"',
    'Justification="' + (s.align || 'LeftAlign') + '"',
    'Hyphenation="' + (s.hyphen ? 'true' : 'false') + '"',
    'Capitalization="' + (s.caps ? 'AllCaps' : 'Normal') + '"',
    'Tracking="' + (s.track || 0) + '"',
    'LeftIndent="' + round((s.indent || 0) * PX * SIZE_SCALE) + '"',
    'FirstLineIndent="' + round(s.hang ? -(s.indent || 0) * PX * SIZE_SCALE : 0) + '"',
    'KeepWithNext="' + (s.keep ? 1 : 0) + '"',
    'KeepLinesTogether="true"', 'KeepFirstLines="2"', 'KeepLastLines="2"']
  if (s.startPage) bits.push('StartParagraph="NextPage"')
  const face = s.bold && s.italic ? 'Bold Italic' : s.bold ? 'Bold' : s.italic ? 'Italic' : 'Regular'
  const props = [
    '<Properties>',
    '<AppliedFont type="string">' + esc(s.font || FONT_SERIF) + '</AppliedFont>',
    s.color ? '<FillColor type="object">' + esc(s.color) + '</FillColor>' : '',
    '</Properties>'
  ].join('')
  return '<ParagraphStyle ' + bits.join(' ') + ' FontStyle="' + face + '">' + props + '</ParagraphStyle>'
}

function characterStyleXml (name, s) {
  const bits = ['Self="CharacterStyle/' + esc(name) + '"', 'Name="' + esc(name) + '"']
  if (s.size) bits.push('PointSize="' + round(s.size * PX * SIZE_SCALE) + '"')
  if (s.superscript) bits.push('Position="Superscript"')
  const face = s.bold && s.italic ? 'Bold Italic' : s.bold ? 'Bold' : s.italic ? 'Italic' : null
  if (face) bits.push('FontStyle="' + face + '"')
  const props = ['<Properties>',
    s.font ? '<AppliedFont type="string">' + esc(s.font) + '</AppliedFont>' : '',
    s.color ? '<FillColor type="object">' + esc(s.color) + '</FillColor>' : '',
    '</Properties>'].join('')
  return '<CharacterStyle ' + bits.join(' ') + '>' + props + '</CharacterStyle>'
}

function styleDefinitions () {
  const colors = COLORS.map(function (c) {
    return '<Color Self="Color/' + esc(c[0]) + '" Model="Process" Space="RGB" ' +
      'ColorValue="' + c[1].join(' ') + '" Name="' + esc(c[0]) + '" ' +
      'ColorEditable="true" ColorRemovable="true" Visible="true" ' +
      'AlternateSpace="NoAlternateColor" AlternateColorValue="" ' +
      'SwatchColorGroupReference="uColorGroup"/>'
  }).join('\n')

  return [
    '<RootCharacterStyleGroup Self="uCharGroup">',
    '<CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]" Imported="false"/>',
    CHAR_STYLES.map(s => characterStyleXml(s[0], s[1])).join('\n'),
    '</RootCharacterStyleGroup>',
    '<RootParagraphStyleGroup Self="uParaGroup">',
    '<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false"/>',
    '<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false"/>',
    PARA_STYLES.map(s => paragraphStyleXml(s[0], s[1])).join('\n'),
    '</RootParagraphStyleGroup>',
    '<RootObjectStyleGroup Self="uObjGroup">',
    '<ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/>',
    '<ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"/>',
    '<ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"/>',
    '</RootObjectStyleGroup>',
    '<RootTableStyleGroup Self="uTableGroup">',
    '<TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]"/>',
    '<TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]"/>',
    '</RootTableStyleGroup>',
    '<RootCellStyleGroup Self="uCellGroup">',
    '<CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/>',
    '</RootCellStyleGroup>',
    '<ColorGroup Self="uColorGroup" Name="$ID/[Root Color Group]" IsRootColorGroup="true"/>',
    '<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" AlternateSpace="NoAlternateColor" AlternateColorValue="" SwatchColorGroupReference="uColorGroup"/>',
    '<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" Name="Paper" ColorEditable="false" ColorRemovable="false" Visible="true" AlternateSpace="NoAlternateColor" AlternateColorValue="" SwatchColorGroupReference="uColorGroup"/>',
    colors,
    '<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" SwatchColorGroupReference="uColorGroup"/>'
  ].join('\n')
}

function storyBody (self, paragraphs) {
  const out = ['<Story Self="' + self + '" AppliedTOCStyle="n" UserText="true" ' +
    'IsEndnoteStory="false" TrackChanges="false" StoryTitle="' + esc(docTitle) + '" ' +
    'AppliedNamedGrid="n">',
    '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" ' +
    'FrameType="TextFrameType" StoryOrientation="Horizontal" ' +
    'StoryDirection="LeftToRightDirection"/>']

  paragraphs.forEach(function (p) {
    out.push('<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/' + esc(p.style) + '">')
    p.runs.forEach(function (run) {
      if (!run.text) return
      const applied = run.style
        ? 'CharacterStyle/' + esc(run.style)
        : 'CharacterStyle/$ID/[No character style]'
      out.push('<CharacterStyleRange AppliedCharacterStyle="' + applied + '">' +
        '<Content>' + esc(run.text) + '</Content></CharacterStyleRange>')
    })
    // The paragraph break is a character in the story, which is how InDesign
    // writes it: <Br/> at the end of the paragraph's last run.
    out.push('<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Br/></CharacterStyleRange>')
    out.push('</ParagraphStyleRange>')
  })

  out.push('</Story>')
  return out.join('\n')
}


// ---------------------------------------------------------------------------
// Pages, spreads and frames
// ---------------------------------------------------------------------------
// Facing pages. A spread's coordinate origin is the spine, vertically centred,
// so a verso sits at x = -pageWidth and a recto at x = 0. Frames are written
// with an identity transform and their real coordinates in the path, which
// keeps the two systems from having to be composed and got wrong.

function pathGeometry (left, top, right, bottom) {
  return ['<Properties><PathGeometry><GeometryPathType PathOpen="false">',
    '<PathPointArray>',
    '<PathPointType Anchor="' + round(left) + ' ' + round(top) + '" LeftDirection="' + round(left) + ' ' + round(top) + '" RightDirection="' + round(left) + ' ' + round(top) + '"/>',
    '<PathPointType Anchor="' + round(left) + ' ' + round(bottom) + '" LeftDirection="' + round(left) + ' ' + round(bottom) + '" RightDirection="' + round(left) + ' ' + round(bottom) + '"/>',
    '<PathPointType Anchor="' + round(right) + ' ' + round(bottom) + '" LeftDirection="' + round(right) + ' ' + round(bottom) + '" RightDirection="' + round(right) + ' ' + round(bottom) + '"/>',
    '<PathPointType Anchor="' + round(right) + ' ' + round(top) + '" LeftDirection="' + round(right) + ' ' + round(top) + '" RightDirection="' + round(right) + ' ' + round(top) + '"/>',
    '</PathPointArray></GeometryPathType></PathGeometry></Properties>'].join('')
}

// ColumnsPositions is the left and right edge of every column measured from
// the inside of the margins, so two columns need four numbers and not two. A
// short list here is one of the ways a package opens with the guides in the
// wrong place while everything else looks correct.
const COL_W = (FRAME_W - GUTTER * (COLUMNS - 1)) / COLUMNS
const COL_POSITIONS = (function () {
  const out = []
  for (let i = 0; i < COLUMNS; i += 1) {
    const start = i * (COL_W + GUTTER)
    out.push(round(start), round(start + COL_W))
  }
  return out.join(' ')
})()

function marginPreference (recto) {
  return '<MarginPreference ColumnCount="' + COLUMNS + '" ColumnGutter="' + round(GUTTER) +
    '" Top="' + round(M_TOP) + '" Bottom="' + round(M_BOTTOM) +
    '" Left="' + round(recto ? M_INSIDE : M_OUTSIDE) +
    '" Right="' + round(recto ? M_OUTSIDE : M_INSIDE) +
    '" ColumnDirection="Horizontal" ColumnsPositions="' + COL_POSITIONS + '"/>'
}

// The text block on a page, in spread coordinates.
function frameBounds (recto) {
  const pageLeft = recto ? 0 : -PAGE_W
  const left = pageLeft + (recto ? M_INSIDE : M_OUTSIDE)
  const top = -PAGE_H / 2 + M_TOP
  return { left: left, top: top, right: left + FRAME_W, bottom: top + FRAME_H }
}

function textFrame (self, story, prev, next, recto) {
  const b = frameBounds(recto)
  return ['<TextFrame Self="' + self + '" ParentStory="' + story + '" ' +
    'PreviousTextFrame="' + (prev || 'n') + '" NextTextFrame="' + (next || 'n') + '" ' +
    'ContentType="TextType" ItemLayer="uLayer" Visible="true" ItemTransform="1 0 0 1 0 0" ' +
    'AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]">',
    pathGeometry(b.left, b.top, b.right, b.bottom),
    '<TextFramePreference TextColumnCount="' + COLUMNS + '" TextColumnGutter="' + round(GUTTER) +
      '" VerticalJustification="TopAlign"/>',
    '<TextWrapPreference Inverse="false" ApplyToMasterPageOnly="false" TextWrapSide="BothSides" TextWrapMode="None"/>',
    '</TextFrame>'].join('\n')
}

function pageXml (self, name, recto, master) {
  const x = recto ? 0 : -PAGE_W
  return ['<Page Self="' + self + '" Name="' + name + '" AppliedMaster="' + master + '" ' +
    'MasterPageTransform="1 0 0 1 0 0" TabOrder="" OverrideList="" ' +
    'GridStartingPoint="TopOutside" UseMasterGrid="true" ' +
    'ItemTransform="1 0 0 1 ' + round(x) + ' ' + round(-PAGE_H / 2) + '" ' +
    'GeometricBounds="0 0 ' + round(PAGE_H) + ' ' + round(PAGE_W) + '" ' +
    'AppliedTrapPreset="TrapPreset/$ID/kDefaultTrapStyleName">',
    marginPreference(recto),
    '</Page>'].join('\n')
}

const FLATTENER = '<FlattenerPreference LineArtAndTextResolution="300" ' +
  'GradientAndMeshResolution="150" ClipComplexRegions="false" ' +
  'ConvertAllStrokesToOutlines="false" ConvertAllTextToOutlines="false">' +
  '<Properties><RasterVectorBalance type="double">50</RasterVectorBalance></Properties>' +
  '</FlattenerPreference>'

// Build the spreads. Page one sits alone on the first spread so that odd pages
// fall on rectos, exactly as the printed book has them.
function buildSpreads (storyId, pageCount) {
  const spreads = []
  const frames = []
  let page = 1
  let spreadIndex = 0

  while (page <= pageCount) {
    const isFirst = spreadIndex === 0
    const pagesHere = isFirst ? 1 : Math.min(2, pageCount - page + 1)
    const items = []
    const pageXmls = []

    for (let i = 0; i < pagesHere; i += 1) {
      const number = page + i
      const recto = number % 2 === 1
      const pageId = 'uPage' + number
      const frameId = 'uFrame' + number
      pageXmls.push(pageXml(pageId, String(number), recto, 'uMasterA'))
      frames.push({ id: frameId, recto: recto })
      items.push(frameId)
    }

    spreads.push({
      self: 'uSpread' + spreadIndex,
      pageCount: pagesHere,
      pages: pageXmls,
      frameIds: items
    })
    page += pagesHere
    spreadIndex += 1
  }

  // Thread the frames in page order.
  const frameXml = {}
  frames.forEach(function (f, i) {
    frameXml[f.id] = textFrame(f.id, storyId,
      i > 0 ? frames[i - 1].id : null,
      i < frames.length - 1 ? frames[i + 1].id : null,
      f.recto)
  })

  return spreads.map(function (s) {
    return {
      self: s.self,
      xml: wrap('Spread', ['<Spread Self="' + s.self + '" PageCount="' + s.pageCount +
        '" BindingLocation="' + (s.pageCount === 1 ? 0 : 1) + '" ShowMasterItems="true" ' +
        'PageTransitionType="None" PageTransitionDirection="NotApplicable" ' +
        'PageTransitionDuration="Medium" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0" ' +
        'FlattenerOverride="Default">',
      FLATTENER,
      s.pages.join('\n'),
      s.frameIds.map(id => frameXml[id]).join('\n'),
      '</Spread>'].join('\n'))
    }
  })
}

function masterSpreadXml () {
  return wrap('MasterSpread', ['<MasterSpread Self="uMasterA" Name="A-Master" ' +
    'NamePrefix="A" BaseName="Master" ShowMasterItems="true" PageCount="2" ' +
    'ItemTransform="1 0 0 1 0 0" OverriddenPageItemProps="">',
  FLATTENER,
  pageXml('uMasterPageL', 'A-Master', false, 'n'),
  pageXml('uMasterPageR', 'A-Master', true, 'n'),
  '</MasterSpread>'].join('\n'))
}


// ---------------------------------------------------------------------------
// The rest of the package
// ---------------------------------------------------------------------------

function fontsXml () {
  const family = function (name) {
    const faces = ['Regular', 'Bold', 'Italic', 'Bold Italic'].map(function (style) {
      const ps = name.replace(/\s+/g, '') + (style === 'Regular' ? '' : '-' + style.replace(/\s+/g, ''))
      return '<Font Self="uFont' + esc(name + style).replace(/[^A-Za-z]/g, '') + '" ' +
        'FontFamily="' + esc(name) + '" Name="' + esc(name + ' ' + style) + '" ' +
        'PostScriptName="' + esc(ps) + '" Status="Installed" FontStyleName="' + esc(style) + '" ' +
        'FontType="OpenTypeTT" WritingScript="0" FullName="' + esc(name + ' ' + style) + '" ' +
        'FullNameNative="' + esc(name + ' ' + style) + '" FontStyleNameNative="' + esc(style) + '" ' +
        'PlatformName="" Version="1.000"/>'
    }).join('\n')
    return '<FontFamily Self="uFamily' + esc(name).replace(/[^A-Za-z]/g, '') + '" Name="' +
      esc(name) + '">\n' + faces + '\n</FontFamily>'
  }
  return wrap('Fonts', [family(FONT_SERIF), family(FONT_SANS)].join('\n'))
}

function graphicXml () {
  const colors = COLORS.map(function (c) {
    return '<Color Self="Color/' + esc(c[0]) + '" Model="Process" Space="RGB" ' +
      'ColorValue="' + c[1].join(' ') + '" ColorOverride="Normal" ' +
      'AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="' + esc(c[0]) + '" ' +
      'ColorEditable="true" ColorRemovable="true" Visible="true" ' +
      'SwatchCreatorID="7937" SwatchColorGroupReference="uColorGroup"/>'
  }).join('\n')

  const swatches = COLORS.map(function (c) {
    return '<Swatch Self="Swatch/' + esc(c[0]) + '" Name="' + esc(c[0]) + '" ' +
      'ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937" ' +
      'SwatchColorGroupReference="uColorGroup"/>'
  }).join('\n')

  return wrap('Graphic', [
    '<ColorGroup Self="uColorGroup" Name="$ID/[Root Color Group]" IsRootColorGroup="true">',
    '<ColorGroupSwatch Self="uCGS0" SwatchItemRef="Color/Black"/>',
    '<ColorGroupSwatch Self="uCGS1" SwatchItemRef="Color/Paper"/>',
    COLORS.map((c, i) => '<ColorGroupSwatch Self="uCGS' + (i + 2) + '" SwatchItemRef="Color/' + esc(c[0]) + '"/>').join('\n'),
    '</ColorGroup>',
    '<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" SwatchColorGroupReference="uColorGroup"/>',
    '<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" SwatchColorGroupReference="uColorGroup"/>',
    colors,
    '<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" SwatchColorGroupReference="uColorGroup"/>',
    swatches,
    '<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>',
    '<StrokeStyle Self="StrokeStyle/$ID/ThinThin" Name="$ID/ThinThin"/>',
    '<Ink Self="Ink/$ID/Process Cyan" Name="$ID/Process Cyan" Angle="75" ConvertToProcess="false" Frequency="70" NeutralDensity="0.61" PrintInk="true" InkType="Normal" TrapOrderIndex="1"/>',
    '<Ink Self="Ink/$ID/Process Magenta" Name="$ID/Process Magenta" Angle="15" ConvertToProcess="false" Frequency="70" NeutralDensity="0.76" PrintInk="true" InkType="Normal" TrapOrderIndex="2"/>',
    '<Ink Self="Ink/$ID/Process Yellow" Name="$ID/Process Yellow" Angle="0" ConvertToProcess="false" Frequency="70" NeutralDensity="0.16" PrintInk="true" InkType="Normal" TrapOrderIndex="3"/>',
    '<Ink Self="Ink/$ID/Process Black" Name="$ID/Process Black" Angle="45" ConvertToProcess="false" Frequency="70" NeutralDensity="1.7" PrintInk="true" InkType="Normal" TrapOrderIndex="4"/>'
  ].join('\n'))
}

function preferencesXml () {
  return wrap('Preferences', [
    '<TransparencyDefaultContainerObject/>',
    '<DocumentPreference PageHeight="' + round(PAGE_H) + '" PageWidth="' + round(PAGE_W) + '" ' +
      'PagesPerDocument="1" FacingPages="true" DocumentBleedTopOffset="0" ' +
      'DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" ' +
      'DocumentBleedOutsideOrRightOffset="0" DocumentBleedUniformSize="true" ' +
      'SlugTopOffset="0" SlugBottomOffset="0" SlugInsideOrLeftOffset="0" ' +
      'SlugRightOrOutsideOffset="0" DocumentSlugUniformSize="false" ' +
      'PreserveLayoutWhenShuffling="true" AllowPageShuffle="true" ' +
      'ColumnDirection="Horizontal" PageBinding="LeftToRight" ' +
      'ColumnGuideLocked="false" MarginGuideLocked="false" ' +
      'IntentType="PrintIntent"/>',
    marginPreference(true),
    '<ViewPreference HorizontalMeasurementUnits="Points" VerticalMeasurementUnits="Points" ' +
      'RulerOrigin="PageOrigin" TextSizeMeasurementUnits="Points" ' +
      'TypographicMeasurementUnits="Points" PointsPerInch="72" ' +
      'ShowRulers="true" ShowFrameEdges="true"/>',
    '<TextDefault AppliedFont="' + esc(FONT_SERIF) + '" PointSize="' + round(BASELINE_SIZE * SIZE_SCALE) + '" ' +
      'Leading="' + round(BASELINE_LEADING * LEAD_SCALE) + '" AppliedLanguage="Language/$ID/en_US" Hyphenation="true"/>',
    '<TextFramePreference TextColumnCount="' + COLUMNS + '" TextColumnGutter="' + round(GUTTER) + '"/>',
    '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" ' +
      'FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>',
    '<GridPreference/>',
    '<GuidePreference GuidesShown="true" GuidesLocked="false" GuidesInBack="true"/>'
  ].join('\n'))
}

function designMapXml (spreadFiles, storyFiles) {
  return [HEAD,
    '<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(51)" ?>',
    '<Document ' + PKG + ' DOMVersion="' + DOM + '" Self="d" StoryList="' + storyFiles.map(s => s.self).join(' ') + '" ' +
      'Name="' + esc(docTitle) + '" ZeroPoint="0 0" ActiveLayer="uLayer" ' +
      'CMYKProfile="$ID/None" RGBProfile="$ID/None" ' +
      'AccurateLABSpots="false" CMYKPolicy="ColorPolicyPreserveNumbers" ' +
      'RGBPolicy="ColorPolicyPreserveNumbers">',
    '<Language Self="Language/$ID/en_US" Name="$ID/English: USA" SingleQuotes="&#x2018;&#x2019;" ' +
      'DoubleQuotes="&#x201C;&#x201D;" PrimaryLanguageName="$ID/English" SublanguageName="$ID/USA" ' +
      'Id="269" HyphenationVendor="Hunspell" SpellingVendor="Hunspell"/>',
    '<idPkg:Graphic src="Resources/Graphic.xml"/>',
    '<idPkg:Fonts src="Resources/Fonts.xml"/>',
    '<idPkg:Styles src="Resources/Styles.xml"/>',
    '<idPkg:Preferences src="Resources/Preferences.xml"/>',
    '<Layer Self="uLayer" Name="Layer 1" Visible="true" Locked="false" ' +
      'IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" ' +
      'Expendable="true" Printable="true"><Properties>' +
      '<LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>',
    '<idPkg:MasterSpread src="MasterSpreads/MasterSpread_uMasterA.xml"/>',
    spreadFiles.map(s => '<idPkg:Spread src="Spreads/Spread_' + s.self + '.xml"/>').join('\n'),
    '<idPkg:BackingStory src="XML/BackingStory.xml"/>',
    storyFiles.map(s => '<idPkg:Story src="Stories/Story_' + s.self + '.xml"/>').join('\n'),
    '</Document>'].join('\n') + '\n'
}

function backingStoryXml () {
  return wrap('BackingStory', ['<XmlStory Self="uBackingStory" AppliedTOCStyle="n" ' +
    'UserText="false" IsEndnoteStory="false" TrackChanges="false" StoryTitle="$ID/" ' +
    'AppliedNamedGrid="n">',
  '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" ' +
    'FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>',
  '<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>',
  '</XmlStory>'].join('\n'))
}


// ---------------------------------------------------------------------------
// Structural check
// ---------------------------------------------------------------------------
// InDesign cannot be run from here, so the package is checked against what the
// format requires: the parts the design map points at exist, every XML part
// parses, and every style, colour, story and frame a reference names is
// actually defined. That catches the ways a generated package usually fails.
// It does not, and cannot, prove InDesign is happy with it.

const docx = require('./lib/docx')

function validate (entries) {
  const problems = []
  const files = {}
  entries.forEach(e => { files[e.name] = String(e.data) })

  if (entries[0].name !== 'mimetype' || !entries[0].store) {
    problems.push('mimetype must be the first entry and stored uncompressed')
  }
  ;['designmap.xml', 'META-INF/container.xml', 'Resources/Styles.xml',
    'Resources/Graphic.xml', 'Resources/Fonts.xml', 'Resources/Preferences.xml',
    'XML/BackingStory.xml'].forEach(function (name) {
    if (!files[name]) problems.push('missing required part: ' + name)
  })

  Object.keys(files).forEach(function (name) {
    if (!/\.xml$/.test(name)) return
    try { docx.parseXml(files[name]) } catch (error) {
      problems.push(name + ' is not well-formed XML: ' + error.message)
    }
  })

  const map = files['designmap.xml'] || ''
  const refs = []
  map.replace(/src="([^"]+)"/g, function (m, src) { refs.push(src); return m })
  refs.forEach(function (src) {
    if (!files[src]) problems.push('design map points at a missing part: ' + src)
  })

  const styles = files['Resources/Styles.xml'] || ''
  const defined = new Set()
  styles.replace(/Self="((?:Paragraph|Character)Style\/[^"]*)"/g, function (m, id) { defined.add(id); return m })
  const graphic = files['Resources/Graphic.xml'] || ''
  const colors = new Set()
  graphic.replace(/<Color Self="([^"]+)"/g, function (m, id) { colors.add(id); return m })

  const stories = new Set()
  const usedStyles = new Set()
  Object.keys(files).forEach(function (name) {
    if (!/^Stories\//.test(name)) return
    files[name].replace(/Self="(u[^"]*)"/, function (m, id) { stories.add(id); return m })
    files[name].replace(/Applied(?:Paragraph|Character)Style="([^"]+)"/g, function (m, id) {
      usedStyles.add(id); return m
    })
  })
  usedStyles.forEach(function (id) {
    if (!defined.has(id)) problems.push('story uses an undefined style: ' + id)
  })
  styles.replace(/<FillColor type="object">([^<]+)<\/FillColor>/g, function (m, id) {
    if (!colors.has(id)) problems.push('style uses an undefined colour: ' + id)
    return m
  })

  const frames = new Set()
  const parents = new Set()
  const links = []
  Object.keys(files).forEach(function (name) {
    if (!/^Spreads\//.test(name)) return
    files[name].replace(/<TextFrame Self="([^"]+)" ParentStory="([^"]+)" PreviousTextFrame="([^"]+)" NextTextFrame="([^"]+)"/g,
      function (m, self, story, prev, next) {
        frames.add(self); parents.add(story)
        if (prev !== 'n') links.push(prev)
        if (next !== 'n') links.push(next)
        return m
      })
  })
  parents.forEach(function (id) {
    if (!stories.has(id)) problems.push('a frame points at a missing story: ' + id)
  })
  links.forEach(function (id) {
    if (!frames.has(id)) problems.push('a frame is threaded to a missing frame: ' + id)
  })

  return { problems: problems, frames: frames.size, stories: stories.size, styles: defined.size }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const read = readParagraphs(html)
const paragraphs = read.paragraphs
const STORY = 'uStoryBody'

const spreads = buildSpreads(STORY, PAGES)
const storyFiles = [{ self: STORY, xml: wrap('Story', storyBody(STORY, paragraphs)) }]

const entries = [
  { name: 'mimetype', data: 'application/vnd.adobe.indesign-idml-package', store: true },
  { name: 'designmap.xml', data: designMapXml(spreads, storyFiles) },
  { name: 'META-INF/container.xml', data: HEAD + '\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles>' +
    '</container>\n' },
  { name: 'META-INF/metadata.xml', data: HEAD + '\n<Metadata/>\n' },
  { name: 'Resources/Fonts.xml', data: fontsXml() },
  { name: 'Resources/Graphic.xml', data: graphicXml() },
  { name: 'Resources/Preferences.xml', data: preferencesXml() },
  { name: 'Resources/Styles.xml', data: wrap('Styles', styleDefinitions()) },
  { name: 'MasterSpreads/MasterSpread_uMasterA.xml', data: masterSpreadXml() },
  { name: 'XML/BackingStory.xml', data: backingStoryXml() },
  { name: 'XML/Tags.xml', data: wrap('Tags', '<XMLTag Self="XMLTag/Root" Name="Root"><Properties><TagColor type="enumeration">LightBlue</TagColor></Properties></XMLTag>') }
]
spreads.forEach(s => entries.push({ name: 'Spreads/Spread_' + s.self + '.xml', data: s.xml }))
storyFiles.forEach(s => entries.push({ name: 'Stories/Story_' + s.self + '.xml', data: s.xml }))

const check = validate(entries)
fs.writeFileSync(idmlOut, writeZip(entries))

if (icmlOut) {
  fs.writeFileSync(icmlOut, [HEAD,
    '<?aid style="50" type="snippet" readerVersion="6.0" featureSet="257" product="18.0(51)" ?>',
    '<?aid SnippetType="InCopyInterchange"?>',
    '<Document DOMVersion="' + DOM + '" Self="icmlDoc">',
    styleDefinitions(),
    storyBody(STORY, paragraphs),
    '</Document>'].join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const byStyle = Object.keys(read.counts).sort(function (a, b) { return read.counts[b] - read.counts[a] })

console.log('Wrote ' + path.relative(root, idmlOut) + ' — ' +
  (fs.statSync(idmlOut).size / 1024).toFixed(0) + ' KB')
if (icmlOut) console.log('Wrote ' + path.relative(root, icmlOut))
console.log('')
console.log('  body ' + round(BASELINE_SIZE * SIZE_SCALE) + 'pt on ' +
  round(BASELINE_LEADING * LEAD_SCALE) + 'pt ' + FONT_SERIF)
console.log('  theme ' + themeName + ': ' + round(PAGE_W / MM) + ' × ' + round(PAGE_H / MM) +
  'mm, ' + (FACING ? 'facing pages' : 'single pages') + ', ' + COLUMNS +
  (COLUMNS === 1 ? ' column' : ' columns') + ', ' + PAGES + ' pages of threaded frames')
console.log('  paragraphs: ' + paragraphs.length + ' in ' + byStyle.length + ' styles')
byStyle.slice(0, 8).forEach(function (name) {
  console.log('    ' + String(read.counts[name]).padStart(6) + '  ' + name)
})
if (byStyle.length > 8) console.log('    ' + String(byStyle.slice(8).reduce((n, k) => n + read.counts[k], 0)).padStart(6) + '  in ' + (byStyle.length - 8) + ' more styles')
console.log('')
console.log('  package check: ' + check.stories + ' story, ' + check.frames +
  ' frames, ' + check.styles + ' styles defined')
if (check.problems.length) {
  console.log('  PROBLEMS (' + check.problems.length + '):')
  check.problems.slice(0, 12).forEach(p => console.log('    ' + p))
  process.exitCode = 1
} else {
  console.log('  no structural problems found')
}
console.log('')
console.log('  Carried across as text, not as objects:')
console.log('    tables      → tab-separated paragraphs (Table > Convert Text to Table)')
console.log('    figures     → styled paragraphs where the slot belongs')
console.log('    running head and folio are not on the master; set them in InDesign')
console.log('')
console.log('  In InDesign: File > Open, choose the .idml, then File > Save As to get .indd.')
