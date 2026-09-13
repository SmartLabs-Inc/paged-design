#!/usr/bin/env python3
"""Give the manuscript a closed style vocabulary: one style, one meaning.

The manuscript arrives with seven Word styles carrying sixteen roles between
them. `Compact` is table cells and reference items and bullets; `Body Text` is
running prose and index entries; `heading 2` is a section title and the word
"References". Nothing in the file says which is which, so every downstream
tool — ours for print, theirs for EPUB — has to guess, and guesses differently.

This rewrites the style applied to every paragraph so the name says the role.
No wording is changed. The only paragraphs removed are Word's generated table
of contents, which is a field of stale print page numbers and is rebuilt from
the text by both pipelines.
"""
import re, shutil, sys, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ET.register_namespace('w', W[1:-1])

if len(sys.argv) != 4 or sys.argv[1] in ('-h', '--help'):
    sys.exit('usage: restyle-aet.py <in.docx> <out.docx> <work-dir>')

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
work = Path(sys.argv[3]); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
with zipfile.ZipFile(SRC) as z: z.extractall(work)

doc = work / 'word/document.xml'
tree = ET.parse(doc); body = tree.getroot().find(W + 'body')

def style_of(p):
    pr = p.find(W + 'pPr')
    if pr is None: return 'Normal'
    s = pr.find(W + 'pStyle')
    return s.get(W + 'val') if s is not None else 'Normal'

def set_style(p, name):
    pr = p.find(W + 'pPr')
    if pr is None:
        pr = ET.Element(W + 'pPr'); p.insert(0, pr)
    s = pr.find(W + 'pStyle')
    if s is None:
        s = ET.SubElement(pr, W + 'pStyle'); pr.remove(s); pr.insert(0, s)
    s.set(W + 'val', name)

def text_of(p): return ''.join(n.text or '' for n in p.iter(W + 't')).strip()

in_table = set()
for tbl in body.iter(W + 'tbl'):
    for p in tbl.iter(W + 'p'): in_table.add(id(p))

HEADINGS = ('Heading1', 'Heading2', 'Heading3', 'Heading4',
            'ReferencesHeading', 'Title', 'Subtitle')
REFS = re.compile(r'^references\b', re.I)
NUMBERED = re.compile(r'^\d+\.\s')
# Six paragraphs in the manuscript hold section properties that were escaped
# into visible text rather than written as markup. They print as a line of raw
# XML in both the book and the EPUB.
STRAY_XML = re.compile(r'^<w:[a-zA-Z]+[ /]')

chapter = ''          # current Heading1 text
in_refs = False       # inside a reference list
in_index = False      # inside the alphabetical index
grouped = False       # inside a numbered group inside the current section
last_heading = None   # the style of the last non-empty paragraph seen
counts = {}
drop = []
stray = []

for el in list(body):
    # Word wraps its generated contents in a structured-document tag, so its
    # 187 paragraphs are not children of the body and a loop over the body
    # never sees them. The whole block goes.
    if el.tag == W + 'sdt':
        inner = el.findall('.//' + W + 'p')
        if inner and all(style_of(p).startswith('TOC') for p in inner):
            drop.append(el); continue
    if el.tag == W + 'tbl':
        for p in el.iter(W + 'p'):
            set_style(p, 'TableText'); counts['TableText'] = counts.get('TableText', 0) + 1
        continue
    if el.tag != W + 'p':
        continue

    st, txt = style_of(el), text_of(el)

    if STRAY_XML.match(txt):
        stray.append(el); continue

    # Word's generated contents: a field of stale print folios. Both pipelines
    # build their own from the text, so it goes.
    if st in ('TOC1', 'TOC2', 'TOC3') or (st == 'TOCHeading' and txt.lower() == 'table of contents'):
        drop.append(el); continue

    new = st
    if st in ('Title', 'Subtitle', 'Author'):
        pass
    elif st == 'TOCHeading':                       # a chapter wearing the wrong style
        new = 'Heading1'; chapter = txt; in_refs = in_index = grouped = False
    elif st == 'Heading1':
        new = 'Heading1'; chapter = txt; in_refs = grouped = False
        in_index = txt.lower().startswith('alphabetical index')
    elif st == 'Heading2':
        if REFS.match(txt): new, in_refs = 'ReferencesHeading', True
        else: new, in_refs, grouped = 'Heading2', False, False
    elif st == 'Heading3':
        in_refs = False
        if NUMBERED.match(txt):                    # a numbered group opener
            new, grouped = 'Heading3', True
        else:                                      # a topic inside one is a level down
            new = 'Heading4' if grouped else 'Heading3'
    elif st == 'Heading4':
        new = 'Heading4'; in_refs = False
    elif st == 'EntryName':
        new = 'IndexLetter' if len(txt) <= 2 else 'EntryName'
    elif st == 'FirstParagraph':
        # Word applies "First Paragraph" after *any* heading, so 69 of these
        # are the first body paragraph of an entry rather than the standfirst
        # of a section. Downstream that matters: a standfirst ends an entry, so
        # those entries came out empty and their names stranded at page feet.
        new = 'Standfirst' if last_heading in HEADINGS else 'BodyText'
    elif st == 'BodyText':
        new = 'IndexEntry' if in_index else 'BodyText'
    elif st == 'Compact':
        new = 'Reference' if in_refs else 'Bullet'
    elif st == 'Normal':
        if not txt: continue                       # spacer, leave alone
        new = 'Reference' if in_refs else 'BodyText'

    if new != st or st == 'Compact':
        set_style(el, new)
    counts[new] = counts.get(new, 0) + 1
    if txt:
        last_heading = new

for el in drop + stray: body.remove(el)
# Word wants the standalone declaration; ElementTree will not write one.
xml = ET.tostring(tree.getroot(), encoding='UTF-8', xml_declaration=False)
doc.write_bytes(b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml)

print('  dropped Word’s generated contents: %d block(s)' % len(drop))
print('  dropped paragraphs of escaped section-properties XML: %d' % len(stray))
# Every new name needs a definition, or Word shows it as plain body text and
# the author cannot see the structure they are being asked to keep.
STYLE_DEFS = {
 'Standfirst': '<w:style w:type="paragraph" w:styleId="Standfirst" w:customStyle="1"><w:name w:val="Standfirst"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepLines/><w:spacing w:before="120" w:after="200"/><w:jc w:val="left"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/><w:sz w:val="23"/></w:rPr></w:style>',
 'Bullet': '<w:style w:type="paragraph" w:styleId="Bullet" w:customStyle="1"><w:name w:val="Bullet"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:spacing w:before="40" w:after="40"/><w:contextualSpacing/><w:jc w:val="left"/></w:pPr><w:rPr></w:rPr></w:style>',
 'TableText': '<w:style w:type="paragraph" w:styleId="TableText" w:customStyle="1"><w:name w:val="Table Text"/><w:basedOn w:val="BodyText"/><w:next w:val="TableText"/><w:qFormat/><w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>',
 'Reference': '<w:style w:type="paragraph" w:styleId="Reference" w:customStyle="1"><w:name w:val="Reference"/><w:basedOn w:val="BodyText"/><w:next w:val="Reference"/><w:qFormat/><w:pPr><w:keepLines/><w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/><w:contextualSpacing/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>',
 'IndexLetter': '<w:style w:type="paragraph" w:styleId="IndexLetter" w:customStyle="1"><w:name w:val="Index Letter"/><w:basedOn w:val="BodyText"/><w:next w:val="IndexEntry"/><w:qFormat/><w:pPr><w:keepNext w:val="true"/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:jc w:val="left"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:b/><w:color w:val="000000"/><w:sz w:val="26"/></w:rPr></w:style>',
 'IndexEntry': '<w:style w:type="paragraph" w:styleId="IndexEntry" w:customStyle="1"><w:name w:val="Index Entry"/><w:basedOn w:val="BodyText"/><w:next w:val="IndexEntry"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="20" w:line="240" w:lineRule="auto"/><w:ind w:left="240" w:hanging="240"/><w:contextualSpacing/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>',
 'ReferencesHeading': '<w:style w:type="paragraph" w:styleId="ReferencesHeading" w:customStyle="1"><w:name w:val="References Heading"/><w:basedOn w:val="BodyText"/><w:next w:val="Reference"/><w:qFormat/><w:pPr><w:keepNext w:val="true"/><w:keepLines/><w:spacing w:before="200" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>',
}
sty = work / 'word/styles.xml'
sx = sty.read_text(encoding='utf-8')
have = set(re.findall(r'w:styleId="([^"]+)"', sx))
added = [k for k in STYLE_DEFS if k not in have]
sx = sx.replace('</w:styles>', ''.join(STYLE_DEFS[k] for k in added) + '</w:styles>')
sty.write_text(sx, encoding='utf-8')

# Nothing may name a style that is not defined.
undefined = set()
defined = set(re.findall(r'w:styleId="([^"]+)"', sx))
for f in sorted(work.glob('word/*.xml')):
    if f.name == 'styles.xml': continue
    for name in re.findall(r'<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"', f.read_text(encoding='utf-8')):
        if name not in defined: undefined.add(name)
if undefined: sys.exit('undefined styles: %s' % sorted(undefined))

# Rezip. [Content_Types].xml goes first and uncompressed, as Word writes it.
OUT.unlink(missing_ok=True)
files = sorted(f for f in work.rglob('*') if f.is_file())
first = work / '[Content_Types].xml'
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(first, '[Content_Types].xml', compress_type=zipfile.ZIP_STORED)
    for f in files:
        if f != first: z.write(f, str(f.relative_to(work)))

print('  style definitions added: %s' % (', '.join(added) or 'none'))
print('  wrote %s (%.0f KB)' % (OUT, OUT.stat().st_size / 1024))
print('  %-20s %s' % ('style', 'paragraphs'))
for k in sorted(counts, key=lambda k: -counts[k]):
    print('  %-20s %5d' % (k, counts[k]))
