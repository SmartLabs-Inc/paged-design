// A ZIP writer, dependency-free.
//
// Every container format this skill writes — .docx, .idml — is a ZIP with XML
// inside, so there is one writer rather than one per script.
//
// `store: true` writes an entry uncompressed. IDML and EPUB both require their
// first entry to be an uncompressed `mimetype`, and a reader that checks for it
// will reject the package if it is deflated.

const zlib = require('zlib')

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

// entries: [{ name, data, store? }] — data is a string or Buffer.
function writeZip (entries) {
  const chunks = []
  const central = []
  let offset = 0

  entries.forEach(function (entry) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const method = entry.store ? 0 : 8
    const body = entry.store ? raw : zlib.deflateRawSync(raw)
    const sum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, name, body)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt32LE(sum, 16)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + body.length
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

module.exports = { writeZip, crc32 }
