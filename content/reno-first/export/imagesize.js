// imagesize.js — width/height out of a PNG or JPEG header, so figures
// keep their aspect ratio without pulling in an image library.

const fs = require('fs');

function png(b) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), type: 'png' };
}

// Walk the JPEG marker chain to the start-of-frame, which is the only
// segment carrying the dimensions. SOF0/1/2/3/5/6/7/9/10/11/13/14/15 all
// hold them; DHT, DRI, APPn and the rest are skipped by their length.
function jpeg(b) {
    let i = 2;
    while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2;
            continue;
        }
        const len = b.readUInt16BE(i + 2);
        const isSOF = marker >= 0xc0 && marker <= 0xcf
            && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
            return {
                height: b.readUInt16BE(i + 5),
                width: b.readUInt16BE(i + 7),
                type: 'jpg',
            };
        }
        i += 2 + len;
    }
    throw new Error('no SOF marker in ' + b.length + ' bytes of JPEG');
}

module.exports = function imagesize(file) {
    const b = fs.readFileSync(file);
    if (b[0] === 0x89 && b[1] === 0x50) return png(b);
    if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
    throw new Error('unrecognised image: ' + file);
};
