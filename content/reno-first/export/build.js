// build.js — assemble the document and write it.

const fs = require('fs');
const path = require('path');
const B = require('./blocks');
const C = require('./export');
const { d, P } = B;
const { $, ROOT, OUT, runs, para, clean, bookmarkFor } = C;

const {
    Document, Packer, Paragraph, TextRun, Table, WidthType, ShadingType,
    AlignmentType, HeadingLevel, Header, PageNumber, ImageRun,
    InternalHyperlink, Bookmark, PageReference, TabStopType, LevelFormat,
    SectionType, LineRuleType, AlignmentType: AT,
} = d;

// ---------------------------------------------------------------- headings

function heading(el, level) {
    const $h = $(el);
    const spec = {
        2: { size: 30, space: { before: 240, after: 110 } },
        3: { size: 22, space: { before: 200, after: 70 } },
        4: { size: 18, space: { before: 180, after: 60 } },
    }[level];
    return new Paragraph({
        children: runs(el, {
            font: P.display, size: spec.size, bold: true, color: P.navy,
            characterSpacing: level === 4 ? P.track(spec.size, 0.09) : P.track(spec.size, -0.006),
        }),
        heading: { 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
                   4: HeadingLevel.HEADING_4 }[level],
        spacing: { ...spec.space, line: level === 2 ? 300 : 270 },
        indent: B.measured(),
        keepNext: true,
    });
}

function bullets(el) {
    return $(el).find('> li').map((_, li) => new Paragraph({
        children: [
            new TextRun({ text: '◆  ', font: P.display, size: 11, color: P.gold }),
            ...runs(li, { font: P.text, size: 21, color: P.ink }),
        ],
        spacing: { after: 70, line: P.lh(20), lineRule: LineRuleType.AT_LEAST },
        indent: { ...B.measured(), left: 300, hanging: 300 },
    })).get();
}

function ordered(el) {
    return $(el).find('> li').map((_, li, arr) => new Paragraph({
        children: [
            new TextRun({ text: `${_ + 1}.  `, font: P.display, size: 19,
                          bold: true, color: P.gold }),
            ...runs(li, { font: P.text, size: 21, color: P.ink }),
        ],
        spacing: { after: 70, line: P.lh(20), lineRule: LineRuleType.AT_LEAST },
        indent: { ...B.measured(), left: 340, hanging: 340 },
    })).get();
}

// ---------------------------------------------------------------- dispatch

function renderNode(el, out) {
    const $e = $(el);
    const tag = el.name ? el.name.toLowerCase() : '';
    const has = c => $e.hasClass(c);

    if (tag === 'section' && has('section')) {
        $e.children().each((_, c) => renderNode(c, out));
        out.push(B.sectionRule());
        return;
    }
    if (tag === 'header') { $e.children().each((_, c) => renderNode(c, out)); return; }

    if (tag === 'aside' && has('margin-note')) {
        out.push(B.marginNote({
            label: clean($e.find('.margin-note-label').text()) || 'Note',
            text: clean($e.clone().find('.margin-note-label').remove().end().text()),
        }));
        return;
    }
    if (tag === 'table') { out.push(C.formTable(el)); out.push(spacer()); return; }
    if (tag === 'figure') { out.push(...C.figure(el)); return; }
    if (tag === 'ul' && has('checklist')) { out.push(C.checklist(el), spacer()); return; }
    if (tag === 'ul') { out.push(...bullets(el)); return; }
    if (tag === 'ol') { out.push(...ordered(el)); return; }
    if (tag === 'h2') { out.push(heading(el, 2)); return; }
    if (tag === 'h3') { out.push(heading(el, 3)); return; }
    if (tag === 'h4') { out.push(heading(el, 4)); return; }

    if (has('pros-cons')) { out.push(C.prosCons(el), spacer()); return; }
    if (has('reno-tip')) { out.push(C.renoTip(el), spacer()); return; }
    if (has('context-note')) { out.push(C.contextNote(el), spacer()); return; }
    if (has('verify-note')) { out.push(C.verifyNote(el), spacer()); return; }
    if (has('prompt-box')) { out.push(C.promptBox(el), spacer()); return; }
    if (has('field-panel')) { out.push(C.fieldPanel(el), spacer()); return; }
    if (has('write-in')) { out.push(...C.writeIn(el), spacer()); return; }
    if (has('directory-entry')) { out.push(...C.directoryEntry(el)); return; }
    if (has('notes-rules')) { out.push(C.notesRules()); return; }

    if (tag === 'p') {
        if (has('lede')) {
            out.push(para(el, {
                run: { font: P.text, size: 24, color: P.navy },
                spacing: { after: 220, line: P.lh(24), lineRule: LineRuleType.AT_LEAST },
            }));
            return;
        }
        if (has('source-note')) {
            out.push(para(el, {
                run: { font: P.display, size: 15, color: P.slatePale },
                spacing: { after: 140, line: P.lh(16), lineRule: LineRuleType.AT_LEAST },
            }));
            return;
        }
        out.push(para(el));
        return;
    }
    if (tag === 'div') { $e.children().each((_, c) => renderNode(c, out)); return; }
}

const spacer = () => new Paragraph({
    children: [], spacing: { after: 0, line: 140, lineRule: LineRuleType.EXACT },
});

// ---------------------------------------------------------------- sections

function runningHead(title, verso) {
    const folio = new TextRun({
        children: [PageNumber.CURRENT],
        font: P.display, size: 16, bold: true, color: P.navy, characterSpacing: P.track(16, 0.06),
    });
    const name = new TextRun({
        text: title.toUpperCase(), font: P.display, size: 15,
        bold: true, color: P.slate, characterSpacing: P.track(15, 0.06),
    });
    return new Header({
        children: [new Paragraph({
            children: verso ? [folio, new TextRun({ text: '\t' }), name]
                            : [name, new TextRun({ text: '\t' }), folio],
            tabStops: [{ type: TabStopType.RIGHT, position: P.measure }],
            spacing: { after: 260 },
            border: { bottom: B.line(P.gold, 12) },
        })],
    });
}

const PAGE = {
    size: { width: P.pageWidth, height: P.pageHeight },
    margin: { top: P.marginY, bottom: P.marginY, left: P.marginX, right: P.marginX,
              header: 850, footer: 720 },
};

const blankHeader = () => new Header({ children: [new Paragraph({ children: [] })] });

const sections = [];
function addSection(children, { title, start, bare, recto } = {}) {
    if (!children.length) return;
    sections.push({
        properties: {
            // Chapters, parts and appendices open on a right-hand
            // page, as they do in the book.
            type: recto ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE,
            page: { ...PAGE, pageNumbers: start ? { start } : undefined },
            // The opener carries the title, so it needs no running
            // head of its own.
            titlePage: true,
        },
        headers: bare ? { first: blankHeader(), default: blankHeader(), even: blankHeader() } : {
            first: blankHeader(),
            default: runningHead(title, false),
            even: runningHead(title, true),
        },
        children,
    });
}

// ---------------------------------------------------------------- front matter

function imageParagraph(src, widthPt, opts = {}) {
    const file = path.join(ROOT, src);
    const png = require('./pngsize')(file);
    return new Paragraph({
        children: [new ImageRun({
            type: 'png', data: fs.readFileSync(file),
            transformation: {
                width: widthPt,
                height: Math.round(widthPt * png.height / png.width),
            },
        })],
        spacing: { after: opts.after ?? 300 },
        indent: null,
        alignment: opts.alignment,
    });
}

function cover() {
    const $c = $('.cover');
    return [B.panel(P.navy, [
        imageParagraph('images/reno-first-logo-reversed.png', 150, { after: 700 }),
        new Paragraph({
            children: [new TextRun({
                text: clean($c.find('.cover-kicker').text()).toUpperCase(),
                font: P.display, size: 16, bold: true, color: P.gold, characterSpacing: P.track(16, 0.16),
            })],
            spacing: { after: 200 }, indent: null,
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'How to Start a Business in ', font: P.display,
                              size: 64, bold: true, color: P.white }),
                new TextRun({ text: 'Reno, Nevada', font: P.display,
                              size: 64, bold: true, color: P.gold }),
            ],
            spacing: { after: 280, line: P.lh(20), lineRule: LineRuleType.AT_LEAST }, indent: null,
        }),
        new Paragraph({
            children: [new TextRun({
                text: clean($c.find('.cover-subtitle').text()),
                font: P.display, size: 22, color: P.navyPale,
            })],
            spacing: { after: 600, line: P.lh(21), lineRule: LineRuleType.AT_LEAST }, indent: null,
        }),
        imageParagraph('images/reno-skyline-gold.png', 480, { after: 0 }),
    ], { margins: { top: 700, bottom: 500, left: 560, right: 560 } })];
}

function titlePage() {
    const $t = $('.title-page');
    const out = [imageParagraph('images/reno-first-logo.png', 175, { after: 600 })];
    out.push(new Paragraph({
        children: [
            new TextRun({ text: 'How to Start a Business in ', font: P.display,
                          size: 52, bold: true, color: P.navy }),
            new TextRun({ text: 'Reno, Nevada', font: P.display,
                          size: 52, bold: true, color: P.gold }),
        ],
        spacing: { after: 200, line: P.lh(20), lineRule: LineRuleType.AT_LEAST }, indent: null,
    }));
    out.push(new Paragraph({
        children: [new TextRun({
            text: clean($t.find('.title-page-subtitle').text()).toUpperCase(),
            font: P.display, size: 19, bold: true, color: P.slate, characterSpacing: P.track(19, 0.14),
        })],
        spacing: { after: 260 }, indent: null,
    }));
    out.push(new Paragraph({
        children: [], spacing: { after: 220 }, indent: { right: P.measure - 1000 },
        border: { bottom: B.line(P.gold, 18) },
    }));
    out.push(new Paragraph({
        children: [new TextRun({
            text: clean($t.find('.title-page-edition').text()),
            font: P.display, size: 21, bold: true, color: P.navy,
        })],
        spacing: { after: 1400 }, indent: null,
    }));
    out.push(para($t.find('.title-page-contributors')[0], {
        run: { font: P.text, size: 21, color: P.slate },
        indent: { right: P.column }, spacing: { after: 1600 },
    }));
    out.push(new Paragraph({
        children: [new TextRun({
            text: clean($t.find('.title-page-publisher').text()).toUpperCase(),
            font: P.display, size: 17, bold: true, color: P.navy, characterSpacing: P.track(17, 0.14),
        })],
        spacing: { after: 0 }, indent: null,
    }));
    return out;
}

function copyrightPage() {
    const $c = $('.copyright-page');
    const out = [];
    out.push(para($c.find('.imprint')[0], {
        run: { font: P.text, size: 21, color: P.ink },
        spacing: { after: 200, line: P.lh(20), lineRule: LineRuleType.AT_LEAST }, indent: null,
    }));
    out.push(para($c.find('.identifiers')[0], {
        run: { font: P.display, size: 17, color: P.slate },
        spacing: { after: 300 }, indent: null,
    }));
    out.push(new Paragraph({
        children: [new TextRun({
            text: 'FROM THE EDITORS', font: P.display, size: 16,
            bold: true, color: P.gold, characterSpacing: P.track(16, 0.09),
        })],
        spacing: { after: 120 }, indent: null,
    }));
    out.push(para($c.find('.disclaimer')[0], {
        run: { font: P.text, size: 18, color: P.slate },
        spacing: { after: 300, line: P.lh(18.5), lineRule: LineRuleType.AT_LEAST }, indent: null,
    }));
    out.push(C.verifyNote($c.find('.verify-note')[0]));
    return out;
}

// The contents page uses live cross-references: Word resolves each
// number from the bookmark on the title it points at, so the list
// stays right when the document reflows. Press Ctrl+A then F9 to
// refresh them after an edit.
function contentsPage() {
    const out = [new Paragraph({
        children: [new TextRun({
            text: 'Contents', font: P.display, size: 44, bold: true, color: P.gold,
        })],
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 240 }, indent: null,
        border: { bottom: B.line(P.navy, 18) },
    }), spacer()];

    $('.contents-page .toc-list > li').each((_, li) => {
        const $li = $(li);
        if ($li.hasClass('toc-group')) {
            out.push(new Paragraph({
                children: [new TextRun({
                    text: clean($li.text()).toUpperCase(), font: P.display, size: 16,
                    bold: true, color: P.gold, characterSpacing: P.track(16, 0.09),
                })],
                spacing: { before: 280, after: 120 }, indent: null, keepNext: true,
            }));
            return;
        }
        const a = $li.find('a').first();
        const href = (a.attr('href') || '').replace(/^#/, '');
        const label = clean($li.find('.toc-entry-text').text() || a.text());
        const isPart = $li.hasClass('toc-part');
        const num = clean($li.find('.toc-entry-number').text());
        if (!label) return;

        out.push(new Paragraph({
            children: [
                new InternalHyperlink({
                    anchor: bookmarkFor(href),
                    children: [new TextRun({
                        text: (num ? num + '  ' : '') + label,
                        font: P.display,
                        size: isPart ? 22 : 18,
                        bold: isPart,
                        color: isPart ? P.navy : P.ink,
                    })],
                }),
                new TextRun({ text: '\t', font: P.display, size: 17 }),
                new PageReference(bookmarkFor(href), {
                    font: P.display, size: 17, color: P.slate,
                }),
            ],
            tabStops: [{
                type: TabStopType.RIGHT,
                position: P.measure,
                leader: d.LeaderType.DOT,
            }],
            spacing: { before: isPart ? 240 : 0, after: isPart ? 100 : 60, line: P.lh(17.5), lineRule: LineRuleType.AT_LEAST },
            indent: null,
        }));

        const summary = clean($li.find('.toc-entry-summary').text());
        if (summary) out.push(new Paragraph({
            children: [new TextRun({ text: summary, font: P.display, size: 15, color: P.slate })],
            spacing: { after: 120, line: P.lh(15), lineRule: LineRuleType.AT_LEAST }, indent: { left: 0, right: P.column },
        }));
    });
    return out;
}

// ---------------------------------------------------------------- assemble

addSection(cover(), { bare: true });
addSection(titlePage(), { bare: true, start: 1 });
addSection(copyrightPage(), { bare: true });
addSection(contentsPage(), { bare: true });

$('body > div.reno-first').each((_, div) => {
    const $d = $(div);
    const id = $d.attr('id') || '';
    if ($d.hasClass('cover') || $d.hasClass('half-title-page') ||
        $d.hasClass('title-page') || $d.hasClass('copyright-page') ||
        $d.hasClass('contents-page')) return;

    if ($d.hasClass('part-page')) {
        addSection([B.partPage({
            number: clean($d.find('.part-number').text()),
            title: clean($d.find('h1').text()),
            blurb: clean($d.find('.part-blurb').text()),
            bookmarkId: bookmarkFor($d.find('h1').attr('id')),
        })], { bare: true, recto: true });
        return;
    }

    const out = [];
    const $opener = $d.find('> header').first();
    let title = clean($d.find('h1').first().text());

    if ($opener.hasClass('chapter-opener') || $opener.hasClass('appendix-opener')) {
        out.push(B.chapterOpener({
            eyebrow: clean($opener.find('.chapter-number').text()),
            title,
            summary: clean($opener.find('.chapter-summary').text()),
            bookmarkId: bookmarkFor($opener.find('h1').attr('id')),
        }));
        out.push(spacer());
    } else if ($opener.hasClass('worksheet-header')) {
        out.push(...B.worksheetHeader({
            eyebrow: clean($opener.find('.worksheet-eyebrow').text()),
            title,
            bookmarkId: bookmarkFor($opener.find('h1').attr('id')),
        }));
    }

    $d.children().each((_, c) => {
        if (c === $opener[0]) return;
        renderNode(c, out);
    });

    const runner = $d.hasClass('worksheet') ? 'The Reno Launch Planner' : title;
    addSection(out, { title: runner, recto: !$d.hasClass('worksheet') });
});

const doc = new Document({
    creator: 'Reno First',
    title: 'How to Start a Business in Reno, Nevada',
    description: 'The 2026 Reno Edition, including The Reno Launch Planner.',
    evenAndOddHeaderAndFooter: true,
    features: { updateFields: true },
    styles: {
        default: {
            document: { run: { font: P.text, size: 21, color: P.ink } },
        },
    },
    sections,
});

Packer.toBuffer(doc)
    .then(buf => require('./renumber')(buf))
    .then(buf => {
        fs.writeFileSync(OUT, buf);
        console.log('wrote', OUT, (buf.length / 1024 / 1024).toFixed(2) + ' MB',
                    '/', sections.length, 'sections');
    });
