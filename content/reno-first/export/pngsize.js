// pngsize.js — width/height out of a PNG header, so figures keep
// their aspect ratio without pulling in an image library.
const fs = require('fs');
module.exports = function pngsize(file) {
    const b = fs.readFileSync(file);
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};
