// blocks.js
//
// The book's components, rebuilt out of what Word does natively.
// Each helper takes the parsed HTML node and returns docx elements.

const d = require('docx');
const P = require('./palette');

const {
    Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
    WidthType, ShadingType, BorderStyle, AlignmentType, VerticalAlign,
    HeadingLevel, ExternalHyperlink, Bookmark, LineRuleType,
} = d;

const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };

const line = (color, size = 6) => ({ style: BorderStyle.SINGLE, size, color });

// A run of body copy at the book's measure, not the page's.
const measured = (extra = {}) => ({ right: P.column, ...extra });

function shadedCell(fill, children, opts = {}) {
    return new TableCell({
        children,
        shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
        margins: { top: 120, bottom: 120, left: 180, right: 180, ...opts.margins },
        borders: opts.borders || noBorders,
        width: opts.width,
        columnSpan: opts.columnSpan,
        verticalAlign: opts.verticalAlign,
    });
}

// A full-measure panel: one shaded cell running the whole text block.
// Chapter openers, part pages, tips and callouts are all this shape.
function panel(fill, children, opts = {}) {
    return new Table({
        columnWidths: [P.measure],
        width: { size: P.measure, type: WidthType.DXA },
        borders: opts.tableBorders || noBorders,
        rows: [new TableRow({
            cantSplit: true,
            children: [shadedCell(fill, children, {
                margins: opts.margins,
                borders: opts.cellBorders,
                width: { size: P.measure, type: WidthType.DXA },
            })],
        })],
    });
}

// ---------------------------------------------------------------- rules

// The gold rule that closes a section. In the book it is a border on
// the section box, which paged.js places at whichever page the
// section ends on; Word has no equivalent, so it becomes an empty
// paragraph carrying a bottom border at the same place in the flow.
const sectionRule = () => new Paragraph({
    children: [],
    spacing: { before: 60, after: 260 },
    indent: measured(),
    border: { bottom: line(P.gold, 18) },
});

const writingRule = (opts = {}) => new Paragraph({
    children: [],
    spacing: { before: 0, after: 0, line: P.lh(19 * 1.15), lineRule: d.LineRuleType.EXACT },
    indent: opts.indent || measured(),
    shading: opts.shading === null ? undefined
        : { type: ShadingType.CLEAR, fill: P.goldWash, color: 'auto' },
    border: { bottom: line(P.goldRule, 4) },
});

// ---------------------------------------------------------------- openers

function chapterOpener({ eyebrow, title, summary, numeral, bookmarkId }) {
    const kids = [
        new Paragraph({
            children: [new TextRun({
                text: eyebrow.toUpperCase(), font: P.display, size: 16,
                bold: true, color: P.navyPale, characterSpacing: P.track(16, 0.16),
            })],
            spacing: { after: 220 },
        }),
        new Paragraph({
            children: [new Bookmark({
                id: bookmarkId,
                children: [new TextRun({
                    text: title, font: P.display, size: 60, bold: true, color: P.gold,
                    characterSpacing: P.track(60, -0.022),
                })],
            })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 0, after: 240 },
            border: summary ? { bottom: line(P.gold, 18) } : undefined,
        }),
    ];
    if (summary) {
        kids.push(new Paragraph({
            children: [new TextRun({
                text: summary, font: P.display, size: 21, color: P.navyPale,
            })],
            spacing: { before: 240, after: 60, line: P.lh(20), lineRule: LineRuleType.AT_LEAST },
        }));
    }
    return panel(P.navy, kids, { margins: { top: 400, bottom: 400, left: 400, right: 400 } });
}

function partPage({ number, title, blurb, bookmarkId }) {
    return panel(P.navy, [
        new Paragraph({
            children: [new TextRun({
                text: number.toUpperCase(), font: P.display, size: 20, bold: true,
                color: P.navyPale, characterSpacing: P.track(20, 0.24),
            })],
            spacing: { before: 2600, after: 300 },
        }),
        new Paragraph({
            children: [new Bookmark({
                id: bookmarkId,
                children: [new TextRun({
                    text: title, font: P.display, size: 81, bold: true, color: P.gold,
                    characterSpacing: P.track(81, -0.03),
                })],
            })],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 300 },
            border: { bottom: line(P.gold, 22) },
        }),
        new Paragraph({
            children: [new TextRun({
                text: blurb, font: P.display, size: 24, color: P.navyPale,
            })],
            spacing: { before: 320, after: 2600, line: P.lh(23), lineRule: LineRuleType.AT_LEAST },
        }),
    ], { margins: { top: 400, bottom: 400, left: 560, right: 560 } });
}

function worksheetHeader({ eyebrow, title, bookmarkId }) {
    return [
        new Paragraph({
            children: [new TextRun({
                text: eyebrow.toUpperCase(), font: P.display, size: 16,
                bold: true, color: P.slate, characterSpacing: P.track(16, 0.09),
            })],
            spacing: { after: 100 },
        }),
        new Paragraph({
            children: [new Bookmark({
                id: bookmarkId,
                children: [new TextRun({
                    text: title, font: P.display, size: 40, bold: true, color: P.gold,
                    characterSpacing: P.track(40, -0.018),
                })],
            })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 0, after: 240 },
            border: { bottom: line(P.navy, 18) },
        }),
    ];
}

// ---------------------------------------------------------------- notes

// The book floats these in the outer column, where the eye looks
// for them and the text runs past. Word can do the same with a
// floating table pinned to the right margin, with the body text —
// which is indented to the book's 130mm measure — running past it.
// (RelativeHorizontalPosition.OUTSIDE would alternate by hand, as
// the book does, but readers other than Word resolve it as LEFT and
// drop the note on the inside edge; RIGHT is honoured everywhere.)
function marginNote({ label, text }) {
    return new Table({
        columnWidths: [P.column - 500],
        width: { size: P.column - 500, type: WidthType.DXA },
        borders: noBorders,
        float: {
            horizontalAnchor: d.TableAnchorType.MARGIN,
            verticalAnchor: d.TableAnchorType.TEXT,
            relativeHorizontalPosition: d.RelativeHorizontalPosition.RIGHT,
            leftFromText: 220,
            rightFromText: 0,
            absoluteHorizontalPosition: 0,
            topFromText: 60,
            bottomFromText: 120,
        },
        rows: [new TableRow({
            cantSplit: true,
            children: [shadedCell(P.goldWash, [
                new Paragraph({
                    children: [new TextRun({
                        text: label.toUpperCase(), font: P.display, size: 15,
                        bold: true, color: P.gold, characterSpacing: P.track(15, 0.09),
                    })],
                    spacing: { after: 60 },
                }),
                new Paragraph({
                    children: [new TextRun({ text, font: P.display, size: 17, color: P.slate })],
                    spacing: { after: 0, line: P.lh(15), lineRule: LineRuleType.AT_LEAST },
                }),
            ], {
                width: { size: P.column - 500, type: WidthType.DXA },
                borders: { ...noBorders, left: line(P.gold, 12) },
                margins: { top: 140, bottom: 140, left: 160, right: 140 },
            })],
        })],
    });
}

module.exports = {
    d, P, NONE, noBorders, line, measured, shadedCell, panel,
    sectionRule, writingRule, chapterOpener, partPage, worksheetHeader, marginNote,
};
