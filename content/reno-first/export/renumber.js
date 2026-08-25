// renumber.js
//
// docx-js stamps w:id="1" on every bookmark it writes. Word wants
// them unique — duplicates make cross-references resolve to the
// wrong target or not at all — so the packed document is rewritten
// with the pairs numbered in document order before it is saved.

const JSZip = require('jszip');

module.exports = async function renumber(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');

    let next = 1;
    const open = [];
    const fixed = xml.replace(
        /<w:bookmark(Start|End)([^>]*)\/>/g,
        (whole, kind, attrs) => {
            if (kind === 'Start') {
                const id = next++;
                open.push(id);
                return `<w:bookmarkStart${attrs.replace(/\sw:id="\d+"/, '')} w:id="${id}"/>`;
            }
            const id = open.pop();
            if (id === undefined) return whole;
            return `<w:bookmarkEnd w:id="${id}"/>`;
        });

    zip.file('word/document.xml', fixed);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
