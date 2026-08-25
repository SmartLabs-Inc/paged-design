// palette.js
//
// The theme's two colours and everything derived from them, resolved
// to the flat hex Word needs. These are read straight out of the
// built themes/renofirst/main.css so the .docx and the printed book
// cannot drift apart.

module.exports = {
    gold:          'FBAE06',
    navy:          '02305F',
    goldTick:      'BC8203',   // 1px tick-box outline only
    goldRule:      'FDDB8F',   // gold at 45%
    goldWash:      'FEF4DF',   // gold at 13% — surfaces to write on
    goldWashDeep:  'FEF0D0',   // gold at 19% — panels to read
    ink:           '011C37',   // body text
    slate:         '537292',
    slatePale:     '8DA2B7',
    rule:          'BDC9D5',
    mist:          'D4DCE4',
    tint:          'F0F3F5',
    white:         'FFFFFF',
    navyPale:      'C0CCD8',   // white at 74% over navy, flattened

    // Type
    display: 'Archivo',
    text:    'Source Serif 4',

    // Leading, in twips, the way Word wants it: the book sets its
    // line heights in px at 96dpi, so px * 15 is the same measure.
    lh: px => Math.round(px * 15),

    // Letter-spacing, also in twips — NOT the em fraction CSS uses.
    // A label tracked 0.09em at 7.5pt is 0.675pt, or 13 twips; pass
    // the CSS values and this does the conversion.
    track: (halfPoints, em) => Math.round((halfPoints / 2) * em * 20),

    // Page, in DXA (1440 = 1in). US Letter, the book's margins
    // averaged left/right since Word gets no marginalia column of
    // its own — the measure is held by indenting body text instead.
    pageWidth:  12240,
    pageHeight: 15840,
    marginY:    1134,   // 20mm
    marginX:    1021,   // 18mm
    get measure() { return this.pageWidth - this.marginX * 2; },  // 10198 ≈ 180mm
    column:     2835,   // 50mm: the width body text gives up, as the book does
    get textMeasure() { return this.measure - this.column; },     // 7363 ≈ 130mm
};
