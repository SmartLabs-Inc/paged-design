#!/usr/bin/env node

// Build a .docx authoring template from a style map, so authors get exactly
// the styles the map knows how to place.
//
//   node make-word-template.js --map aalai --out AALAI-Authoring-Template.docx
//
// The template carries one paragraph style per mapped style, a worked example
// of each, and instructions. Authors write in it, apply styles from Word's
// style gallery, and the converter places everything without guesswork.

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help) {
  console.log([
    'Usage: node make-word-template.js --map <name> --out <file.docx>',
    '',
    '  --map <name>   Style map to build a template for. Default: aalai.',
    '  --out <file>   Output .docx. Default: <map>-authoring-template.docx.',
    '  --title <text> Document title shown on the first page.'
  ].join('\n'))
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (stored entries — a template is small, and this keeps
// the script dependency-free)
// ---------------------------------------------------------------------------

function crc32 (buffer) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let i = 0; i < 256; i += 1) {
      let c = i
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
      table[i] = c >>> 0
    }
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF]
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function writeZip (entries) {
  const chunks = []
  const central = []
  let offset = 0

  entries.forEach(function (entry) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.from(entry.data, 'utf8')
    const compressed = zlib.deflateRawSync(raw)
    const sum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, name, compressed)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt32LE(sum, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + compressed.length
  })

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([Buffer.concat(chunks), centralBuffer, end])
}

// ---------------------------------------------------------------------------
// Word parts
// ---------------------------------------------------------------------------

// The namespace set Word writes on every part. Readers other than Word reject
// a document that references a prefix it has not declared.
const NAMESPACES = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">'

function escapeXml (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Half-points, twips: Word's units.
function styleXml (id, name, options) {
  // Schema order: rFonts, b, i, caps, color, spacing, sz.
  const runProperties = [
    options.font ? '<w:rFonts w:ascii="' + options.font + '" w:hAnsi="' + options.font + '"/>' : '',
    options.bold ? '<w:b/>' : '<w:b w:val="0"/>',
    options.italic ? '<w:i/>' : '',
    options.caps ? '<w:caps/>' : '',
    options.color ? '<w:color w:val="' + options.color + '"/>' : '',
    options.spacing ? '<w:spacing w:val="' + options.spacing + '"/>' : '',
    options.size ? '<w:sz w:val="' + Math.round(options.size * 2) + '"/>' : ''
  ].join('')

  // Schema order: keepNext, shd, spacing, ind, outlineLvl.
  const paragraphProperties = [
    options.keepNext ? '<w:keepNext/>' : '',
    options.shading ? '<w:shd w:val="clear" w:color="auto" w:fill="' + options.shading + '"/>' : '',
    '<w:spacing w:before="' + (options.before || 0) + '" w:after="' + (options.after || 120) + '"/>',
    options.indent ? '<w:ind w:left="' + options.indent + '"/>' : '',
    options.outline !== undefined ? '<w:outlineLvl w:val="' + options.outline + '"/>' : ''
  ].join('')

  return '<w:style w:type="paragraph" w:customStyle="1" w:styleId="' + id + '">' +
    '<w:name w:val="' + escapeXml(name) + '"/>' +
    '<w:basedOn w:val="Normal"/>' +
    '<w:qFormat/>' +
    '<w:pPr>' + paragraphProperties + '</w:pPr>' +
    '<w:rPr>' + runProperties + '</w:rPr>' +
    '</w:style>'
}

function paragraph (styleId, text) {
  const runs = String(text).split('\n').map(function (line, index) {
    return (index ? '<w:r><w:br/></w:r>' : '') +
      '<w:r><w:t xml:space="preserve">' + escapeXml(line) + '</w:t></w:r>'
  }).join('')
  return '<w:p>' +
    (styleId ? '<w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' : '') +
    runs + '</w:p>'
}

// A one-cell shaded table: the callout box an author draws in Word.
function calloutTable (fill, paragraphs) {
  return '<w:tbl>' +
    '<w:tblPr><w:tblW w:w="5000" w:type="pct"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '</w:tblBorders>' +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar>' +
    '<w:top w:w="170" w:type="dxa"/><w:left w:w="170" w:type="dxa"/>' +
    '<w:bottom w:w="170" w:type="dxa"/><w:right w:w="170" w:type="dxa"/>' +
    '</w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>' +
    '<w:tr><w:tc>' +
    '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/></w:tcPr>' +
    paragraphs +
    '</w:tc></w:tr></w:tbl>' +
    paragraph(null, '')
}

function main () {
  const mapName = args.map || 'aalai'
  const mapPath = path.join(__dirname, '..', 'style-maps', mapName + '.json')
  if (!fs.existsSync(mapPath)) {
    console.error('No such style map: ' + mapName)
    process.exit(1)
  }
  const styleMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'))
  const outFile = path.resolve(args.out || (mapName + '-authoring-template.docx'))

  // Visual definitions for the AALAI styles. These only affect how the
  // template looks in Word — the book's real design lives in the theme.
  const navy = '0D2035'
  const teal = '137C7A'
  const grey = '66717C'
  const serif = 'Georgia'
  const sans = 'Aptos'

  const definitions = [
    ['AALAILabel', 'AALAI Label',
      { font: sans, size: 7.5, color: teal, bold: true, caps: true, spacing: 30, before: 240 }],
    ['AALAIChapterTitle', 'AALAI Chapter Title',
      { font: serif, size: 27, color: navy, after: 60, outline: 0, keepNext: true }],
    ['AALAISubtitle', 'AALAI Subtitle',
      { font: serif, size: 12, color: navy, italic: true, after: 120 }],
    ['AALAIStandfirst', 'AALAI Standfirst',
      { font: serif, size: 10.5, color: navy, italic: true, after: 240 }],
    ['AALAIH1', 'AALAI H1',
      { font: serif, size: 17, color: navy, before: 240, after: 60, outline: 1, keepNext: true }],
    ['AALAIH2', 'AALAI H2',
      { font: sans, size: 11.5, color: teal, bold: true, before: 200, after: 60, outline: 2, keepNext: true }],
    ['AALAIH3', 'AALAI H3',
      { font: sans, size: 10, color: navy, bold: true, before: 160, after: 60, outline: 3, keepNext: true }],
    ['AALAIObjective', 'AALAI Objective',
      { font: sans, size: 9, after: 80, indent: 340 }],
    ['AALAITakeaway', 'AALAI Takeaway',
      { font: sans, size: 9, after: 80, indent: 340 }],
    ['AALAICalloutLabel', 'AALAI Callout Label',
      { font: sans, size: 7, color: teal, bold: true, caps: true, spacing: 30, after: 60 }],
    ['AALAICallout', 'AALAI Callout',
      { font: sans, size: 9, after: 60 }],
    ['AALAIPull', 'AALAI Pull',
      { font: serif, size: 12.5, color: navy, after: 120 }],
    ['AALAICaption', 'AALAI Caption',
      { font: sans, size: 7.5, color: grey, after: 120 }],
    ['AALAISource', 'AALAI Source',
      { font: sans, size: 7.5, color: grey, after: 120 }],
    ['AALAIReference', 'AALAI Reference',
      { font: sans, size: 8, after: 60, indent: 340 }]
  ]

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="' + serif + '" w:hAnsi="' + serif + '"/><w:sz w:val="21"/>' +
    '</w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
    '<w:name w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr>' +
    '</w:style>' +
    definitions.map(function (entry) {
      return styleXml(entry[0], entry[1], entry[2])
    }).join('') +
    '</w:styles>'

  // The body: instructions, then a worked chapter using every style.
  const fills = styleMap.fills || {}
  const calloutFill = Object.keys(fills).find(function (key) {
    return fills[key] === 'callout'
  }) || 'EAF3F3'
  const darkFill = Object.keys(fills).find(function (key) {
    return String(fills[key]).indexOf('callout-dark') > -1
  }) || '0D2035'

  const body = [
    paragraph('AALAILabel', 'HOW TO USE THIS TEMPLATE'),
    paragraph('AALAIChapterTitle', args.title || 'Authoring Template'),
    paragraph('AALAIStandfirst',
      'Write your chapter in this file. Apply the AALAI styles from Word’s ' +
      'style gallery instead of formatting by hand — the styles are what the ' +
      'layout reads. Anything you format manually is ignored.'),

    paragraph('AALAIH1', 'The styles, and what each one becomes'),
    paragraph(null,
      'AALAI Chapter Title starts a new chapter and gives it its title. ' +
      'Put AALAI Label directly above it for the chapter eyebrow, such as ' +
      'CHAPTER 07.'),
    paragraph(null,
      'AALAI H1, H2 and H3 are the section levels inside a chapter. ' +
      'Body text needs no style at all — just leave it as Normal.'),
    paragraph(null,
      'AALAI Objective and AALAI Takeaway become numbered lists. Use one ' +
      'paragraph per item and do not type the numbers; the layout numbers them.'),
    paragraph(null,
      'AALAI Caption, AALAI Source and AALAI Reference handle figure captions, ' +
      'attribution lines and bibliography entries.'),

    paragraph('AALAIH1', 'Callout boxes'),
    paragraph(null,
      'A callout is a one-cell table with a shaded background. Insert a 1×1 ' +
      'table, shade the cell, then style the first line AALAI Callout Label ' +
      'and the rest AALAI Callout. The shading colour chooses the kind of box:'),
    calloutTable(calloutFill, [
      paragraph('AALAICalloutLabel', 'CLINICAL APPLICATION'),
      paragraph('AALAICallout',
        'Shade the cell ' + calloutFill + ' for a standard tinted callout. ' +
        'Use these for material that genuinely deserves emphasis.')
    ].join('')),
    calloutTable(darkFill, [
      paragraph('AALAICalloutLabel', 'KEY TAKEAWAY'),
      paragraph('AALAIPull',
        'Shade the cell ' + darkFill + ' for the dark box, reserved for the ' +
        'single most important statement in a chapter.')
    ].join('')),

    paragraph('AALAIH1', 'Tables'),
    paragraph(null,
      'Build tables normally. Make every cell in the first row bold and the ' +
      'layout will treat that row as the table header. A table with one row ' +
      'and several columns becomes side-by-side panels rather than a table.'),

    paragraph('AALAIH1', 'A worked example'),
    paragraph('AALAILabel', 'CHAPTER 01'),
    paragraph('AALAIChapterTitle', 'Your Chapter Title'),
    paragraph('AALAISubtitle', 'The subtitle sits under the title'),
    paragraph('AALAIStandfirst',
      'A short italic paragraph that sets up what the chapter argues.'),
    paragraph('AALAILabel', 'LEARNING OBJECTIVES'),
    paragraph('AALAIObjective', 'Understand the first thing'),
    paragraph('AALAIObjective', 'Identify the second thing'),
    paragraph('AALAIObjective', 'Evaluate the third thing'),
    paragraph('AALAIH2', '1.1  Your first section'),
    paragraph(null,
      'Ordinary body text. Leave it as Normal and keep writing. Footnotes ' +
      'inserted with Word’s References ▸ Insert Footnote carry through to ' +
      'the book, as do images, hyperlinks, bold, italic, superscript and ' +
      'subscript.'),
    paragraph('AALAILabel', 'KEY TAKEAWAYS'),
    paragraph('AALAITakeaway', 'The first thing worth remembering.'),
    paragraph('AALAITakeaway', 'The second thing worth remembering.')
  ].join('')

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">' +
    '<w:body>' + body +
    // 7 × 10in with the prototype's margins.
    '<w:sectPr><w:pgSz w:w="10080" w:h="14400"/>' +
    '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1260" ' +
    'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'

  const relationshipsNs =
    'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
  const officeDocument =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

  // Word opens a package with only document.xml and styles.xml, but writes
  // settings, fontTable and docProps itself. Including them keeps other
  // readers happy and stops Word offering to "repair" the file.
  const settings =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings ' + NAMESPACES + '>' +
    '<w:defaultTabStop w:val="720"/>' +
    '<w:characterSpacingControl w:val="doNotCompress"/>' +
    '</w:settings>'

  const fontTable =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:fonts ' + NAMESPACES + '>' +
    '<w:font w:name="' + serif + '"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>' +
    '<w:font w:name="' + sans + '"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>' +
    '</w:fonts>'

  const coreProperties =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties ' +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + escapeXml(args.title || styleMap.name + ' authoring template') + '</dc:title>' +
    '<cp:keywords>paged-design</cp:keywords>' +
    '</cp:coreProperties>'

  const entries = [
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships ' + relationshipsNs + '>' +
        '<Relationship Id="rId1" Type="' + officeDocument + '/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships ' + relationshipsNs + '>' +
        '<Relationship Id="rId1" Type="' + officeDocument + '/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="' + officeDocument + '/settings" Target="settings.xml"/>' +
        '<Relationship Id="rId3" Type="' + officeDocument + '/fontTable" Target="fontTable.xml"/>' +
        '</Relationships>'
    },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/settings.xml', data: settings },
    { name: 'word/fontTable.xml', data: fontTable },
    { name: 'docProps/core.xml', data: coreProperties }
  ]

  fs.writeFileSync(outFile, writeZip(entries))
  console.log('Wrote ' + path.relative(process.cwd(), outFile))
  console.log('  ' + definitions.length + ' paragraph styles, 7×10in page')
  console.log('\nOpen it in Word, write the book in it, then convert with:')
  console.log('  node docx-to-book.js --src <your.docx> --out content/<book> --map ' + mapName)
}

main()
