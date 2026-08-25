// export.js
//
// Export the Reno First book to .docx.
//
//   node docx/export.js [out.docx]
//
// The source of truth is content/reno-first/index.html — the same
// file paged.js sets for print — so the Word file carries exactly
// the content the book does. What it cannot carry is the paged.js
// layout: there is no marginalia column that text flows around, no
// full-bleed cover, and no rule whose position depends on where a
// section happens to end. Those are rebuilt here out of what Word
// does natively, and the result is an editable manuscript in the
// book's colours and type rather than a facsimile of the pages.

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const B = require('./blocks');
const { d, P } = B;

const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    ImageRun, WidthType, ShadingType, BorderStyle, AlignmentType,
    VerticalAlign, HeadingLevel, PageBreak, Header, Footer, PageNumber,
    ExternalHyperlink, InternalHyperlink, Bookmark, PageReference,
    PositionalTab, PositionalTabAlignment, PositionalTabLeader,
    LevelFormat, SectionType, LineRuleType,
} = d;

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(process.cwd(), 'reno-first-book.docx');

const $ = cheerio.load(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));

let bookmarkSeq = 0;
const bookmarks = new Map();          // element id -> bookmark name
function bookmarkFor(id) {
    if (!id) return `bk${++bookmarkSeq}`;
    if (!bookmarks.has(id)) bookmarks.set(id, `bk_${id.replace(/[^A-Za-z0-9]/g, '_')}`);
    return bookmarks.get(id);
}

const clean = t => (t || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- inline

// Walk a node's children into docx runs, keeping bold, italic and
// links. Everything the book sets in the text face is set here.
function runs(node, base = {}) {
    const out = [];
    const style = { font: P.text, size: 21, color: P.ink, ...base };

    const walk = (n, inherited) => {
        $(n).contents().each((_, c) => {
            if (c.type === 'text') {
                const t = c.data.replace(/\s+/g, ' ');
                if (t) out.push(new TextRun({ text: t, ...inherited }));
                return;
            }
            if (c.type !== 'tag') return;
            const tag = c.name.toLowerCase();
            if (tag === 'br') { out.push(new TextRun({ break: 1 })); return; }
            if (tag === 'strong' || tag === 'b') return walk(c, { ...inherited, bold: true });
            if (tag === 'em' || tag === 'i') return walk(c, { ...inherited, italics: true });
            if (tag === 'a') {
                const href = $(c).attr('href') || '';
                const text = clean($(c).text());
                if (!text) return;
                if (/^https?:|^mailto:/.test(href)) {
                    out.push(new ExternalHyperlink({
                        link: href,
                        children: [new TextRun({
                            ...inherited, text, font: P.display,
                            size: Math.round((inherited.size || 21) * 0.9),
                            color: P.gold, bold: false,
                        })],
                    }));
                } else {
                    out.push(new TextRun({ ...inherited, text }));
                }
                return;
            }
            walk(c, inherited);
        });
    };
    walk(node, style);
    return out.length ? out : [new TextRun({ text: '', ...style })];
}

const para = (node, opts = {}) => new Paragraph({
    children: runs(node, opts.run),
    spacing: { after: 160, line: P.lh(19), lineRule: LineRuleType.AT_LEAST, ...opts.spacing },
    indent: opts.indent === null ? undefined : (opts.indent || B.measured()),
    alignment: opts.alignment,
    heading: opts.heading,
    border: opts.border,
    shading: opts.shading,
    keepNext: opts.keepNext,
    numbering: opts.numbering,
});

// ---------------------------------------------------------------- tables

// The planner's forms. Cells the reader fills in are washed gold and
// ruled in gold; everything printed for them stays on white — the
// one structural rule the whole workbook runs on.
function formTable(el) {
    const $t = $(el);
    const isCheck = $t.hasClass('check-table');
    const rows = [];

    const widths = (() => {
        const first = $t.find('tr').first();
        const n = first.find('th,td').length || 1;
        const tickW = 480;
        if (isCheck && n > 1) {
            const rest = Math.floor((P.measure - tickW) / (n - 1));
            return [tickW, ...Array(n - 1).fill(rest)];
        }
        return Array(n).fill(Math.floor(P.measure / n));
    })();
    const total = widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += P.measure - total;

    $t.find('thead tr').each((_, tr) => {
        rows.push(new TableRow({
            tableHeader: true,
            cantSplit: true,
            children: $(tr).find('th').map((i, th) => new TableCell({
                children: [new Paragraph({
                    children: runs(th, {
                        font: P.display, size: 15, bold: true,
                        color: P.white, characterSpacing: P.track(15, 0.07),
                    }).map(r => r),
                    spacing: { after: 0, line: P.lh(16), lineRule: LineRuleType.AT_LEAST },
                    indent: null,
                })],
                shading: { type: ShadingType.CLEAR, fill: P.navy, color: 'auto' },
                margins: { top: 90, bottom: 90, left: 120, right: 120 },
                borders: B.noBorders,
                width: { size: widths[i] || widths[0], type: WidthType.DXA },
                columnSpan: parseInt($(th).attr('colspan') || '1', 10),
            })).get(),
        }));
    });

    $t.find('tbody tr').each((_, tr) => {
        const cells = $(tr).find('td');
        rows.push(new TableRow({
            cantSplit: true,
            children: cells.map((i, td) => {
                const $td = $(td);
                const fill = $td.hasClass('fill');
                const tick = $td.hasClass('tick');
                const kids = [];

                if (tick) {
                    kids.push(new Paragraph({
                        children: [new TextRun({
                            text: '☐', font: P.display, size: 26, color: P.goldTick,
                        })],
                        spacing: { after: 0, line: P.lh(16), lineRule: LineRuleType.AT_LEAST },
                        indent: null,
                        alignment: AlignmentType.CENTER,
                    }));
                } else if ($td.find('.cell-title').length) {
                    kids.push(new Paragraph({
                        children: runs($td.find('.cell-title')[0], {
                            font: P.display, size: 17, bold: true, color: P.navy,
                        }),
                        spacing: { after: 30, line: P.lh(16), lineRule: LineRuleType.AT_LEAST }, indent: null,
                    }));
                    $td.find('.cell-note').each((_, n) => kids.push(new Paragraph({
                        children: runs(n, { font: P.display, size: 15, color: P.slate }),
                        spacing: { after: 0, line: P.lh(15), lineRule: LineRuleType.AT_LEAST }, indent: null,
                    })));
                } else {
                    const bold = $td.hasClass('label') || i === 0;
                    kids.push(new Paragraph({
                        children: runs(td, {
                            font: P.display, size: 17,
                            color: bold ? P.navy : P.ink, bold,
                        }),
                        spacing: { after: 0, line: P.lh(16), lineRule: LineRuleType.AT_LEAST }, indent: null,
                    }));
                }

                return new TableCell({
                    children: kids,
                    shading: fill
                        ? { type: ShadingType.CLEAR, fill: P.goldWash, color: 'auto' }
                        : undefined,
                    margins: { top: 100, bottom: 100, left: 120, right: 120 },
                    borders: {
                        ...B.noBorders,
                        top: B.line(P.rule, 3),
                        bottom: B.line(fill ? P.goldRule : P.rule, 3),
                    },
                    width: { size: widths[i] || widths[0], type: WidthType.DXA },
                    columnSpan: parseInt($td.attr('colspan') || '1', 10),
                });
            }).get(),
        }));
    });

    return new Table({
        columnWidths: widths,
        width: { size: P.measure, type: WidthType.DXA },
        borders: B.noBorders,
        rows,
    });
}

// Detail on one side, a box to write in on the other.
function fieldPanel(el) {
    const $p = $(el);
    const check = $p.hasClass('field-panel-check');
    const left = Math.round(P.measure * 0.52);
    const right = P.measure - left;

    const rows = $p.find('.field-row').map((_, row) => {
        const $r = $(row);
        const kids = [];
        const name = $r.find('.field-name').first();
        kids.push(new Paragraph({
            children: [
                ...(check ? [new TextRun({
                    text: '☐  ', font: P.display, size: 24, color: P.goldTick,
                })] : []),
                ...runs(name[0], { font: P.display, size: 18, bold: true, color: P.navy }),
            ],
            spacing: { after: 40, line: P.lh(16.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
        }));
        $r.find('.field-note').each((_, n) => kids.push(new Paragraph({
            children: runs(n, { font: P.display, size: 15, color: P.slate }),
            spacing: { after: 0, line: P.lh(15), lineRule: LineRuleType.AT_LEAST },
            indent: check ? { left: 260 } : null,
        })));

        return new TableRow({
            cantSplit: true,
            children: [
                new TableCell({
                    children: kids,
                    margins: { top: 120, bottom: 120, left: 0, right: 200 },
                    borders: { ...B.noBorders, top: B.line(P.rule, 3), bottom: B.line(P.rule, 3) },
                    width: { size: left, type: WidthType.DXA },
                }),
                new TableCell({
                    children: [new Paragraph({
                        children: [], spacing: { before: 200, after: 200 }, indent: null,
                    })],
                    shading: { type: ShadingType.CLEAR, fill: P.goldWash, color: 'auto' },
                    margins: { top: 120, bottom: 120, left: 140, right: 140 },
                    borders: {
                        ...B.noBorders,
                        top: B.line(P.rule, 3),
                        bottom: B.line(P.rule, 3),
                        left: B.line(P.goldRule, 3),
                    },
                    width: { size: right, type: WidthType.DXA },
                }),
            ],
        });
    }).get();

    return new Table({
        columnWidths: [left, right],
        width: { size: P.measure, type: WidthType.DXA },
        borders: B.noBorders,
        rows,
    });
}

// Chapter 1 compares seven business structures; the paired panels
// are what turn four pages of prose into something scannable.
function prosCons(el) {
    const half = Math.floor(P.measure / 2);
    const side = (sel, fill, accent, headColor) => {
        const $s = $(el).find(sel);
        const kids = [new Paragraph({
            children: runs($s.find('h4')[0], {
                font: P.display, size: 18, bold: true,
                color: headColor, characterSpacing: P.track(18, 0.06),
            }),
            spacing: { after: 120, line: P.lh(16.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
        })];
        $s.find('ul.bullets li').each((_, li) => kids.push(new Paragraph({
            children: [
                new TextRun({ text: '◆  ', font: P.display, size: 11, color: accent }),
                ...runs(li, { font: P.display, size: 16, color: P.ink }),
            ],
            spacing: { after: 70, line: P.lh(15), lineRule: LineRuleType.AT_LEAST },
            indent: { left: 200, hanging: 200 },
        })));
        return new TableCell({
            children: kids,
            shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
            margins: { top: 200, bottom: 220, left: 220, right: 220 },
            borders: { ...B.noBorders, top: B.line(accent, 18) },
            width: { size: half, type: WidthType.DXA },
        });
    };
    return new Table({
        columnWidths: [half, P.measure - half],
        width: { size: P.measure, type: WidthType.DXA },
        borders: B.noBorders,
        rows: [new TableRow({
            cantSplit: true,
            children: [
                side('.pros', P.goldWashDeep, P.gold, P.navy),
                side('.cons', P.tint, P.slatePale, P.slate),
            ],
        })],
    });
}

function checklist(el) {
    const rows = $(el).find('li').map((_, li) => new TableRow({
        cantSplit: true,
        children: [
            new TableCell({
                children: [new Paragraph({
                    children: [new TextRun({
                        text: '☐', font: P.display, size: 26, color: P.goldTick,
                    })],
                    spacing: { after: 0, line: P.lh(16), lineRule: LineRuleType.AT_LEAST }, indent: null,
                })],
                margins: { top: 120, bottom: 120, left: 0, right: 100 },
                borders: { ...B.noBorders, bottom: B.line(P.mist, 3) },
                width: { size: 460, type: WidthType.DXA },
            }),
            new TableCell({
                children: [new Paragraph({
                    children: runs(li, { font: P.display, size: 18, color: P.ink }),
                    spacing: { after: 0, line: P.lh(17.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
                })],
                margins: { top: 120, bottom: 120, left: 0, right: 100 },
                borders: { ...B.noBorders, bottom: B.line(P.mist, 3) },
                width: { size: P.measure - 460, type: WidthType.DXA },
            }),
        ],
    })).get();

    return new Table({
        columnWidths: [460, P.measure - 460],
        width: { size: P.measure, type: WidthType.DXA },
        borders: { ...B.noBorders, top: B.line(P.mist, 3) },
        rows,
    });
}

function renoTip(el) {
    const kids = [new Paragraph({
        children: [new TextRun({
            text: 'RENO TIP', font: P.display, size: 15, bold: true,
            color: P.gold, characterSpacing: P.track(15, 0.09),
        })],
        spacing: { after: 100 }, indent: null,
    })];
    $(el).find('p').each((_, p) => kids.push(new Paragraph({
        children: runs(p, { font: P.display, size: 19, color: P.white, bold: false }),
        spacing: { after: 0, line: P.lh(18.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
    })));
    return B.panel(P.navy, kids, { margins: { top: 240, bottom: 260, left: 300, right: 300 } });
}

function contextNote(el) {
    return B.panel(P.goldWash, [new Paragraph({
        children: runs(el, { font: P.display, size: 19, color: P.ink }),
        spacing: { after: 0, line: P.lh(18.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
    })], {
        margins: { top: 200, bottom: 220, left: 280, right: 280 },
        cellBorders: { ...B.noBorders, left: B.line(P.gold, 18) },
    });
}

function verifyNote(el) {
    const text = clean($(el).text()).replace(/^◇\s*/, '');
    return B.panel(P.goldWash, [new Paragraph({
        children: [
            new TextRun({ text: '◇  ', font: P.display, size: 20, color: P.gold, bold: true }),
            new TextRun({ text, font: P.display, size: 17, color: P.slate }),
        ],
        spacing: { after: 0, line: P.lh(17.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
    })], { margins: { top: 180, bottom: 200, left: 260, right: 260 } });
}

function promptBox(el) {
    const kids = [new Paragraph({
        children: runs($(el).find('.prompt')[0], {
            font: P.display, size: 18, bold: true, color: P.navy,
        }),
        spacing: { after: 120, line: P.lh(16.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
    })];
    const n = $(el).find('.rule').length || 3;
    if (n) kids.push(ruledLines(n, { width: P.measure - 560, plain: true }));
    return B.panel(P.goldWash, kids, {
        margins: { top: 200, bottom: 200, left: 280, right: 280 },
        cellBorders: { ...B.noBorders, left: B.line(P.gold, 18) },
    });
}

function writeIn(el) {
    const n = $(el).find('.rule').length || 3;
    return [ruledLines(n)];
}

function directoryEntry(el) {
    const out = [];
    const $e = $(el);
    out.push(new Paragraph({
        children: runs($e.find('.entry-name')[0], {
            font: P.display, size: 17, bold: true, color: P.navy, characterSpacing: P.track(17, 0.05),
        }),
        spacing: { before: 180, after: 40, line: P.lh(16.5), lineRule: LineRuleType.AT_LEAST },
        indent: B.measured(),
        border: { top: B.line(P.mist, 3) },
        keepNext: true,
    }));
    $e.find('.entry-contact').each((_, c) => out.push(new Paragraph({
        children: runs(c, { font: P.display, size: 17, color: P.gold }),
        spacing: { after: 40, line: P.lh(16), lineRule: LineRuleType.AT_LEAST }, indent: B.measured(),
    })));
    $e.find('p').not('.entry-name,.entry-contact').each((_, p) => out.push(new Paragraph({
        children: runs(p, { font: P.text, size: 18, color: P.slate }),
        spacing: { after: 120, line: P.lh(17.5), lineRule: LineRuleType.AT_LEAST }, indent: B.measured(),
    })));
    return out;
}

function figure(el) {
    const out = [];
    const src = $(el).find('img').attr('src');
    if (src) {
        const file = path.join(ROOT, src);
        if (fs.existsSync(file)) {
            const png = require('./pngsize')(file);
            const w = P.measure / 20;                       // DXA -> pt
            const h = Math.round(w * png.height / png.width);
            out.push(new Paragraph({
                children: [new ImageRun({
                    type: 'png', data: fs.readFileSync(file),
                    transformation: { width: Math.round(w), height: h },
                })],
                spacing: { before: 200, after: 160 },
                indent: null,
            }));
        }
    }
    const cap = $(el).find('figcaption');
    if (cap.length) {
        out.push(new Paragraph({
            children: runs(cap[0], { font: P.display, size: 17, color: P.slate }),
            spacing: { after: 240, line: P.lh(16.5), lineRule: LineRuleType.AT_LEAST },
            indent: null,
            border: { top: B.line(P.gold, 12) },
        }));
    }
    return out;
}

// A page of ruled lines.
//
// Not a run of bordered paragraphs: Word merges the borders of
// adjacent paragraphs that carry identical border settings into one
// box, so a stack of ruled paragraphs prints as a single empty
// rectangle. One table row per line keeps every rule.
function ruledLines(count, opts = {}) {
    const width = opts.width || P.measure;
    const height = opts.height || Math.round(P.lh(19) * 1.35);
    return new Table({
        columnWidths: [width],
        width: { size: width, type: WidthType.DXA },
        borders: B.noBorders,
        rows: Array.from({ length: count }, () => new TableRow({
            cantSplit: true,
            height: { value: height, rule: d.HeightRule.EXACT },
            children: [new TableCell({
                children: [new Paragraph({
                    children: [],
                    spacing: { after: 0, line: height, lineRule: LineRuleType.EXACT },
                    indent: null,
                })],
                shading: opts.plain ? undefined
                    : { type: ShadingType.CLEAR, fill: P.goldWash, color: 'auto' },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                borders: { ...B.noBorders, bottom: B.line(P.goldRule, 6) },
                width: { size: width, type: WidthType.DXA },
            })],
        })),
    });
}

// Enough lines to fill the page under a worksheet header, and not
// one more: a Notes page that spills a stray rule onto a page of its
// own is worse than a slightly short one.
const notesRules = () => ruledLines(32);

module.exports = {
    $, ROOT, OUT, runs, para, clean, bookmarkFor,
    formTable, fieldPanel, prosCons, checklist, renoTip, contextNote,
    verifyNote, promptBox, writeIn, directoryEntry, figure, notesRules, ruledLines,
};
