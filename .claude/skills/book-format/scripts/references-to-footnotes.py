#!/usr/bin/env python3
"""Turn bracketed citations into real Word footnotes.

The manuscript cites as plain text — "…development questions.[2]" — with a
numbered reference list at the end of each section. The number looks like a
citation and behaves like nothing: it is not a link, it does not move with the
text, and converting to EPUB gives a reader a bracketed digit that goes
nowhere.

This makes each one a footnote: the mark becomes a real `w:footnoteReference`,
the reference text becomes the note, and Word, a PDF export and an EPUB reader
all treat it as what it is. In EPUB it becomes a linked pop-up note.

Where the numbering is ambiguous the mark is left alone. A citation is only
converted when its number falls inside the reference list of its own section,
because a wrong link is worse than a plain number: it is a wrong link that
looks right.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
ET.register_namespace('w', W[1:-1])
ET.register_namespace('r', R[1:-1])

if len(sys.argv) != 4 or sys.argv[1] in ('-h', '--help'):
    sys.exit('usage: references-to-footnotes.py <in.docx> <out.docx> <work-dir>')

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
work = Path(sys.argv[3])
shutil.rmtree(work, ignore_errors=True)
work.mkdir(parents=True)
with zipfile.ZipFile(SRC) as z:
    z.extractall(work)

REFERENCE_STYLE = 'AALAIReference'
REFERENCE_HEADING = 'AALAILabel'
CITATION = re.compile(r'\[(\d+(?:\s*[,–-]\s*\d+)*)\]')

doc = work / 'word/document.xml'
tree = ET.parse(doc)
body = tree.getroot().find(W + 'body')


def style_of(p):
    pr = p.find(W + 'pPr')
    if pr is None:
        return 'Normal'
    s = pr.find(W + 'pStyle')
    return s.get(W + 'val') if s is not None else 'Normal'


def text_of(p):
    return ''.join(n.text or '' for n in p.iter(W + 't'))


def runs_of(paragraph):
    """Every run in a paragraph, including runs inside hyperlinks."""
    found = []
    for child in paragraph:
        if child.tag == W + 'r':
            found.append((paragraph, child))
        elif child.tag == W + 'hyperlink':
            for run in child.findall(W + 'r'):
                found.append((child, run))
    return found


# ---------------------------------------------------------------------------
# Pair each stretch of body with the reference list that closes it
# ---------------------------------------------------------------------------

sections = []          # [{'paragraphs': [...], 'refs': [element, ...]}]
current = {'paragraphs': [], 'refs': []}
collecting = False

for element in list(body):
    if element.tag == W + 'tbl':
        for p in element.iter(W + 'p'):
            current['paragraphs'].append(p)
        continue
    if element.tag != W + 'p':
        continue
    style = style_of(element)
    text = text_of(element).strip()

    if style == REFERENCE_HEADING and text.lower().startswith('reference'):
        collecting = True
        current['heading'] = element
        continue
    if collecting and style == REFERENCE_STYLE:
        current['refs'].append(element)
        continue
    if collecting:
        sections.append(current)
        current = {'paragraphs': [], 'refs': []}
        collecting = False
    current['paragraphs'].append(element)

if collecting or current['paragraphs']:
    sections.append(current)

# ---------------------------------------------------------------------------
# Build the notes, and point the marks at them
# ---------------------------------------------------------------------------
# Word reserves ids -1 and 0 for the separators it draws above the notes.

notes = []             # (id, [run elements copied from the reference paragraph])
next_id = 1
converted = skipped = 0
skipped_detail = {}


def reference_runs(paragraph):
    """The reference's own runs, so its italics and links survive the move."""
    copied = []
    for parent, run in runs_of(paragraph):
        clone = ET.fromstring(ET.tostring(run))
        copied.append(clone)
    return copied


for index, section in enumerate(sections, 1):
    refs = section['refs']
    if not refs:
        continue
    ref_runs = [reference_runs(p) for p in refs]

    for paragraph in section['paragraphs']:
        for parent, run in runs_of(paragraph):
            for node in list(run.findall(W + 't')):
                value = node.text or ''
                if '[' not in value:
                    continue
                pieces = []
                last = 0
                for match in CITATION.finditer(value):
                    numbers = []
                    for part in re.split(r'[,–-]', match.group(1)):
                        part = part.strip()
                        if part.isdigit():
                            numbers.append(int(part))
                    if not numbers or any(n < 1 or n > len(refs) for n in numbers):
                        skipped += len(numbers) or 1
                        skipped_detail[index] = skipped_detail.get(index, 0) + 1
                        continue
                    pieces.append((match.start(), match.end(), numbers))
                    last = match.end()
                if not pieces:
                    continue

                # Rebuild the run as: text, note, text, note, … text
                position = list(parent).index(run)
                template = ET.tostring(run)
                cursor = 0
                new_nodes = []
                for start, end, numbers in pieces:
                    before = value[cursor:start]
                    if before:
                        piece = ET.fromstring(template)
                        for extra in piece.findall(W + 't'):
                            piece.remove(extra)
                        t = ET.SubElement(piece, W + 't')
                        t.text = before
                        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                        new_nodes.append(piece)
                    for number in numbers:
                        mark = ET.Element(W + 'r')
                        rpr = ET.SubElement(mark, W + 'rPr')
                        ET.SubElement(rpr, W + 'rStyle').set(W + 'val', 'FootnoteReference')
                        ET.SubElement(mark, W + 'footnoteReference').set(W + 'id', str(next_id))
                        notes.append((next_id, ref_runs[number - 1]))
                        next_id += 1
                        converted += 1
                        new_nodes.append(mark)
                    cursor = end
                tail = value[cursor:]
                if tail:
                    piece = ET.fromstring(template)
                    for extra in piece.findall(W + 't'):
                        piece.remove(extra)
                    t = ET.SubElement(piece, W + 't')
                    t.text = tail
                    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                    new_nodes.append(piece)

                parent.remove(run)
                for offset, node_to_add in enumerate(new_nodes):
                    parent.insert(position + offset, node_to_add)
                break          # this run is gone; move to the next one

# The lists are gone: every entry is now the note attached to its citation.
removed = 0
for section in sections:
    if not section['refs']:
        continue
    for paragraph in section['refs']:
        for parent in body.iter():
            if paragraph in list(parent):
                parent.remove(paragraph)
                removed += 1
                break
    heading = section.get('heading')
    if heading is not None:
        for parent in body.iter():
            if heading in list(parent):
                parent.remove(heading)
                break

# ---------------------------------------------------------------------------
# word/footnotes.xml
# ---------------------------------------------------------------------------

def separator(note_id, kind):
    return ('<w:footnote w:type="%s" w:id="%d"><w:p><w:pPr>'
            '<w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:%s/></w:r>'
            '</w:p></w:footnote>' % (kind, note_id, kind))


parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
         '<w:footnotes xmlns:w="%s" xmlns:r="%s">' % (W[1:-1], R[1:-1]),
         separator(-1, 'separator'),
         separator(0, 'continuationSeparator')]

for note_id, run_elements in notes:
    inner = ''.join(ET.tostring(r, encoding='unicode') for r in run_elements)
    inner = inner.replace('ns0:', 'w:').replace('ns1:', 'r:')
    parts.append(
        '<w:footnote w:id="%d"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
        '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
        '<w:r><w:t xml:space="preserve"> </w:t></w:r>%s</w:p></w:footnote>'
        % (note_id, inner))
parts.append('</w:footnotes>')
(work / 'word/footnotes.xml').write_text(''.join(parts), encoding='utf-8')

# ---------------------------------------------------------------------------
# Wire the part in: content type, relationship, styles
# ---------------------------------------------------------------------------

types = work / '[Content_Types].xml'
tx = types.read_text(encoding='utf-8')
if 'footnotes+xml' not in tx:
    tx = tx.replace('</Types>',
                    '<Override PartName="/word/footnotes.xml" ContentType="application/'
                    'vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
                    '</Types>')
    types.write_text(tx, encoding='utf-8')

rels = work / 'word/_rels/document.xml.rels'
rx = rels.read_text(encoding='utf-8')
if 'footnotes.xml' not in rx:
    used = set(re.findall(r'Id="rId(\d+)"', rx))
    new_id = 'rId%d' % (max((int(u) for u in used), default=0) + 1)
    rx = rx.replace('</Relationships>',
                    '<Relationship Id="%s" Type="http://schemas.openxmlformats.org/'
                    'officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
                    '</Relationships>' % new_id)
    rels.write_text(rx, encoding='utf-8')

sty = work / 'word/styles.xml'
sx = sty.read_text(encoding='utf-8')
added_styles = []
if not re.search(r'w:styleId="FootnoteText"', sx):
    sx = sx.replace('</w:styles>',
                    '<w:style w:type="paragraph" w:styleId="FootnoteText">'
                    '<w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>'
                    '<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
                    '<w:pPr><w:widowControl/><w:spacing w:after="0" w:line="240" '
                    'w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="16"/>'
                    '<w:szCs w:val="16"/></w:rPr></w:style></w:styles>')
    added_styles.append('FootnoteText')
if not re.search(r'w:styleId="FootnoteReference"', sx):
    sx = sx.replace('</w:styles>',
                    '<w:style w:type="character" w:styleId="FootnoteReference">'
                    '<w:name w:val="footnote reference"/><w:uiPriority w:val="99"/>'
                    '<w:semiHidden/><w:unhideWhenUsed/>'
                    '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>')
    added_styles.append('FootnoteReference')
if added_styles:
    sty.write_text(sx, encoding='utf-8')

xml = ET.tostring(tree.getroot(), encoding='UTF-8', xml_declaration=False)
doc.write_bytes(b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml)

OUT.unlink(missing_ok=True)
files = sorted(f for f in work.rglob('*') if f.is_file())
first = work / '[Content_Types].xml'
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(first, '[Content_Types].xml', compress_type=zipfile.ZIP_STORED)
    for f in files:
        if f != first:
            z.write(f, str(f.relative_to(work)))

print('  sections with a reference list: %d' % sum(1 for s in sections if s['refs']))
print('  citations turned into footnotes: %d' % converted)
if skipped:
    print('  citations left as plain text (number outside their section\'s list): %d'
          % skipped)
    for section_index, count in sorted(skipped_detail.items()):
        print('     section %d: %d' % (section_index, count))
print('  reference-list paragraphs removed: %d' % removed)
if added_styles:
    print('  styles added: %s' % ', '.join(added_styles))
print('  wrote %s (%.0f KB)' % (OUT, OUT.stat().st_size / 1024))
