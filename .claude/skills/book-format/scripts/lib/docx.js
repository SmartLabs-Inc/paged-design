// Reading .docx files with no dependencies.
//
// A .docx is a ZIP of XML parts. This module provides just enough of a ZIP
// reader and an XML parser to walk the document body, plus helpers for the
// parts a manuscript actually uses: styles, numbering, relationships,
// footnotes, endnotes and embedded images.

const fs = require('fs')
const zlib = require('zlib')

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

// Read a ZIP archive into { name: Buffer }. Only the stored (0) and deflate
// (8) methods exist in practice for .docx files.
function readZip (filePath) {
  const buffer = fs.readFileSync(filePath)

  // Locate the end-of-central-directory record, scanning back over any comment.
  let end = -1
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65536; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end === -1) throw new Error('Not a ZIP archive (no end-of-central-directory)')

  const entryCount = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)

  const files = {}
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break

    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    // The local header repeats the name and extra fields, with its own lengths.
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = buffer.subarray(dataStart, dataStart + compressedSize)

    if (method === 0) {
      files[name] = data
    } else if (method === 8) {
      files[name] = zlib.inflateRawSync(data)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  return files
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

// Parse XML into a tree of { name, attributes, children }, where a text node
// is { text }. Sufficient for OOXML, which has no CDATA or entities beyond
// the standard five.
function parseXml (xml) {
  const root = { name: '#root', attributes: {}, children: [] }
  const stack = [root]
  const tagPattern = /<([!?/]?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g
  let match

  while ((match = tagPattern.exec(xml)) !== null) {
    const [, prefix, name, rawAttributes, selfClosing, text] = match

    if (text !== undefined) {
      if (text.trim() !== '' || text.includes(' ')) {
        stack[stack.length - 1].children.push({ text: decodeXml(text) })
      }
      continue
    }

    if (prefix === '!' || prefix === '?') continue

    if (prefix === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }

    const node = { name, attributes: parseAttributes(rawAttributes), children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }

  return root
}

function parseAttributes (raw) {
  const attributes = {}
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g
  let match
  while ((match = pattern.exec(raw)) !== null) {
    attributes[match[1] || match[3]] = decodeXml(match[2] !== undefined ? match[2] : match[4])
  }
  return attributes
}

function decodeXml (text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, hex) {
      return String.fromCodePoint(parseInt(hex, 16))
    })
    .replace(/&#(\d+);/g, function (m, dec) {
      return String.fromCodePoint(parseInt(dec, 10))
    })
    .replace(/&amp;/g, '&')
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function children (node, name) {
  if (!node || !node.children) return []
  return node.children.filter(function (child) { return child.name === name })
}

function child (node, name) {
  return children(node, name)[0] || null
}

// First descendant with the given tag name, depth-first.
function find (node, name) {
  if (!node || !node.children) return null
  for (const entry of node.children) {
    if (entry.name === name) return entry
    const nested = find(entry, name)
    if (nested) return nested
  }
  return null
}

// All descendants with the given tag name.
function findAll (node, name, results) {
  const out = results || []
  if (!node || !node.children) return out
  node.children.forEach(function (entry) {
    if (entry.name === name) out.push(entry)
    findAll(entry, name, out)
  })
  return out
}

// The value of a <w:something w:val="…"/> child.
function value (node, name) {
  const found = child(node, name)
  return found ? found.attributes['w:val'] : null
}

// A boolean toggle property: present means on unless w:val says otherwise.
function toggle (node, name) {
  const found = child(node, name)
  if (!found) return false
  const val = found.attributes['w:val']
  return val === undefined || val === '1' || val === 'true' || val === 'on'
}

// All text inside a node, concatenated.
function textOf (node) {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  if (!node.children) return ''
  return node.children.map(function (entry) {
    if (entry.name === 'w:tab') return '\t'
    if (entry.name === 'w:br') return '\n'
    return textOf(entry)
  }).join('')
}

// ---------------------------------------------------------------------------
// Document parts
// ---------------------------------------------------------------------------

// Map styleId → { id, name, type, basedOn }, plus a lookup by display name.
// Word stores the styleId in the document but authors see the display name,
// so a style map should be able to use either.
function readStyles (files) {
  const styles = {}
  const byName = {}
  const part = files['word/styles.xml']
  if (!part) return { styles, byName }

  const root = parseXml(part.toString('utf8'))
  findAll(root, 'w:style').forEach(function (node) {
    const id = node.attributes['w:styleId']
    if (!id) return
    const entry = {
      id,
      type: node.attributes['w:type'] || 'paragraph',
      name: value(node, 'w:name') || id,
      basedOn: value(node, 'w:basedOn')
    }
    styles[id] = entry
    byName[entry.name.toLowerCase()] = entry
  })

  return { styles, byName }
}

// Map relationship id → target, for hyperlinks and images.
function readRelationships (files, partName) {
  const relationships = {}
  const relPath = partName.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels')
  const part = files[relPath]
  if (!part) return relationships

  const root = parseXml(part.toString('utf8'))
  findAll(root, 'Relationship').forEach(function (node) {
    relationships[node.attributes.Id] = {
      target: node.attributes.Target,
      type: node.attributes.Type,
      external: node.attributes.TargetMode === 'External'
    }
  })
  return relationships
}

// Map numId → the numbering format of each level, so ordered and unordered
// lists can be told apart.
function readNumbering (files) {
  const numbering = {}
  const part = files['word/numbering.xml']
  if (!part) return numbering

  const root = parseXml(part.toString('utf8'))

  const abstractFormats = {}
  findAll(root, 'w:abstractNum').forEach(function (node) {
    const abstractId = node.attributes['w:abstractNumId']
    const levels = {}
    children(node, 'w:lvl').forEach(function (level) {
      levels[level.attributes['w:ilvl']] = value(level, 'w:numFmt') || 'decimal'
    })
    abstractFormats[abstractId] = levels
  })

  findAll(root, 'w:num').forEach(function (node) {
    const numId = node.attributes['w:numId']
    const abstractId = value(node, 'w:abstractNumId')
    numbering[numId] = abstractFormats[abstractId] || {}
  })

  return numbering
}

// Footnotes and endnotes, keyed by id. The first few ids are Word's own
// separator marks and carry no content.
function readNotes (files, partName, rootTag) {
  const notes = {}
  const part = files[partName]
  if (!part) return notes

  const root = parseXml(part.toString('utf8'))
  findAll(root, rootTag).forEach(function (node) {
    const type = node.attributes['w:type']
    if (type === 'separator' || type === 'continuationSeparator' ||
        type === 'continuationNotice') {
      return
    }
    notes[node.attributes['w:id']] = node
  })
  return notes
}

module.exports = {
  readZip,
  parseXml,
  children,
  child,
  find,
  findAll,
  value,
  toggle,
  textOf,
  readStyles,
  readRelationships,
  readNumbering,
  readNotes
}
