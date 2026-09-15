#!/usr/bin/env python3
"""Put a manuscript into the AALAI template: house tags, house look.

Restyling a manuscript to a closed vocabulary makes it *convertible*. It does
not make it *look* like anything: the author opens it and sees black type on
white, because the styles they now carry are defined nowhere they can see.

This takes the manuscript's content and the template's stylesheet. Every
paragraph is retagged to the AALAI house vocabulary, and the whole of the
template's `styles.xml`, theme and font table replace the manuscript's, so the
tags resolve to the house colours and faces in Word.

Two things the template does not do for itself, which are added here:

* Its AALAI styles carry no `outlineLvl`. A style with no outline level is not
  a heading as far as Word's navigator, a generated contents, or an EPUB
  converter is concerned — so the book would style correctly and still convert
  to a flat document. The heading styles are rewritten with an outline level,
  keeping the template's own character formatting untouched.

* Nothing in the template sets widow control or keep-with-next.

Everything else in `styles.xml` is the template's, byte for byte. That is
deliberate: hand-editing inside an existing `<w:pPr>` is what produced a file
Word refused to open, because CT_PPrBase is a sequence and its children have
one legal order. Whole blocks are replaced or appended, never edited in place.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ET.register_namespace('w', W[1:-1])

if len(sys.argv) != 5 or sys.argv[1] in ('-h', '--help'):
    sys.exit('usage: apply-aalai-template.py <manuscript.docx> <template.docx> '
             '<out.docx> <work-dir>')

SRC, TPL, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
work = Path(sys.argv[4])
shutil.rmtree(work, ignore_errors=True)
work.mkdir(parents=True)
with zipfile.ZipFile(SRC) as z:
    z.extractall(work)

# ---------------------------------------------------------------------------
# What each role is called in the house vocabulary
# ---------------------------------------------------------------------------
# The left side is the role the restyle works out from the manuscript; the
# right is the style id in the AALAI template. Where the template has no style
# for a role, one is defined below in the template's own visual language.

ROLE_TO_TEMPLATE = {
    'Title': 'Title',
    'Subtitle': 'Subtitle',
    'Author': 'AALAILabel',
    'Heading1': 'AALAIChapterTitle',      # a part opener or a front-matter title
    'Heading2': 'AALAIH1',                # a section
    'Heading3': 'AALAIH2',                # a sub-section
    'Heading4': 'AALAIH3',
    'EntryName': 'AALAIEntry',
    'Standfirst': 'AALAIStandfirst',
    'BodyText': 'Normal',
    'Bullet': 'ListBullet',
    'Reference': 'AALAIReference',
    'ReferencesHeading': 'AALAILabel',
    'TableText': 'AALAITableText',
    'IndexEntry': 'AALAIIndexEntry',
    'IndexLetter': 'AALAIIndexLetter',
}

# Outline levels, so the book has a structure and not just a look.
OUTLINE = {
    'AALAIChapterTitle': 0,
    'AALAIH1': 1,
    'AALAIH2': 2,
    'AALAIH3': 3,
    'AALAIEntry': 4,
    'AALAIIndexLetter': 4,
}

# ---------------------------------------------------------------------------
# Step 1: retag the manuscript
# ---------------------------------------------------------------------------

doc = work / 'word/document.xml'
tree = ET.parse(doc)
body = tree.getroot().find(W + 'body')


def style_of(p):
    pr = p.find(W + 'pPr')
    if pr is None:
        return 'Normal'
    s = pr.find(W + 'pStyle')
    return s.get(W + 'val') if s is not None else 'Normal'


def set_style(p, name):
    pr = p.find(W + 'pPr')
    if pr is None:
        pr = ET.Element(W + 'pPr')
        p.insert(0, pr)
    s = pr.find(W + 'pStyle')
    if s is None:
        s = ET.SubElement(pr, W + 'pStyle')
        pr.remove(s)
        pr.insert(0, s)          # pStyle is first in CT_PPrBase
    s.set(W + 'val', name)


def text_of(p):
    return ''.join(n.text or '' for n in p.iter(W + 't')).strip()


REFS = re.compile(r'^references\b', re.I)
NUMBERED = re.compile(r'^\d+\.\s')
HEADINGS = ('Heading1', 'Heading2', 'Heading3', 'Heading4',
            'ReferencesHeading', 'Title', 'Subtitle')

chapter = ''
in_refs = in_index = grouped = False
last_heading = None
counts = {}
drop = []

for el in list(body):
    if el.tag == W + 'sdt':
        inner = el.findall('.//' + W + 'p')
        if inner and all(style_of(p).startswith('TOC') for p in inner):
            drop.append(el)
            continue
    if el.tag == W + 'tbl':
        for p in el.iter(W + 'p'):
            set_style(p, ROLE_TO_TEMPLATE['TableText'])
            counts['TableText'] = counts.get('TableText', 0) + 1
        continue
    if el.tag != W + 'p':
        continue

    st, txt = style_of(el), text_of(el)
    if st in ('TOC1', 'TOC2', 'TOC3') or (st == 'TOCHeading' and txt.lower() == 'table of contents'):
        drop.append(el)
        continue

    role = st
    if st in ('Title', 'Subtitle', 'Author'):
        pass
    elif st == 'TOCHeading':
        role, chapter = 'Heading1', txt
        in_refs = in_index = grouped = False
    elif st == 'Heading1':
        role, chapter = 'Heading1', txt
        in_refs = grouped = False
        in_index = txt.lower().startswith('alphabetical index')
    elif st == 'Heading2':
        if REFS.match(txt):
            role, in_refs = 'ReferencesHeading', True
        else:
            role, in_refs, grouped = 'Heading2', False, False
    elif st == 'Heading3':
        in_refs = False
        if NUMBERED.match(txt):
            role, grouped = 'Heading3', True
        else:
            role = 'Heading4' if grouped else 'Heading3'
    elif st == 'Heading4':
        role, in_refs = 'Heading4', False
    elif st == 'EntryName':
        role = 'IndexLetter' if len(txt) <= 2 else 'EntryName'
    elif st == 'FirstParagraph':
        role = 'Standfirst' if last_heading in HEADINGS else 'BodyText'
    elif st == 'BodyText':
        role = 'IndexEntry' if in_index else 'BodyText'
    elif st == 'Compact':
        role = 'Reference' if in_refs else 'Bullet'
    elif st == 'Normal':
        if not txt:
            continue
        role = 'Reference' if in_refs else 'BodyText'

    set_style(el, ROLE_TO_TEMPLATE.get(role, role))
    counts[role] = counts.get(role, 0) + 1
    if txt:
        last_heading = role

for el in drop:
    body.remove(el)

xml = ET.tostring(tree.getroot(), encoding='UTF-8', xml_declaration=False)
doc.write_bytes(b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml)

# ---------------------------------------------------------------------------
# Step 2: take the template's stylesheet, theme and fonts
# ---------------------------------------------------------------------------

with zipfile.ZipFile(TPL) as t:
    template_parts = set(t.namelist())
    for part in ('word/styles.xml', 'word/theme/theme1.xml', 'word/fontTable.xml'):
        if part in template_parts:
            target = work / part
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(t.read(part))

sty = work / 'word/styles.xml'
sx = sty.read_text(encoding='utf-8')


def style_block(styles_xml, style_id):
    match = re.search(r'<w:style [^>]*w:styleId="%s".*?</w:style>' % style_id,
                      styles_xml, re.S)
    return match.group(0) if match else None


def run_props(block):
    """The template's own character formatting, kept exactly as it is."""
    match = re.search(r'<w:rPr>.*?</w:rPr>', block, re.S)
    return match.group(0) if match else '<w:rPr/>'


def paragraph_style(style_id, name, based_on, rpr, ppr_extra='', outline=None):
    """A complete, correctly ordered style block.

    CT_PPrBase is a sequence: keepNext, keepLines, pageBreakBefore, framePr,
    widowControl, … spacing, ind, … jc, … outlineLvl. Writing whole blocks
    keeps that order under this function's control rather than depending on
    surgery inside someone else's markup.
    """
    ppr = '<w:keepLines/><w:widowControl/>'
    if outline is not None:
        ppr = '<w:keepNext/>' + ppr
    ppr += ppr_extra
    if outline is not None:
        ppr += '<w:outlineLvl w:val="%d"/>' % outline
    return ('<w:style w:type="paragraph" w:styleId="%s" w:customStyle="1">'
            '<w:name w:val="%s"/><w:basedOn w:val="%s"/><w:qFormat/>'
            '<w:pPr>%s</w:pPr>%s</w:style>' % (style_id, name, based_on, ppr, rpr))


# The heading styles the template already has, rewritten so that they carry an
# outline level and hold on to what follows. Their character formatting is the
# template's, lifted unchanged.
rewritten = []
for style_id, level in OUTLINE.items():
    block = style_block(sx, style_id)
    if block is None:
        continue
    name = re.search(r'<w:name w:val="([^"]*)"', block).group(1)
    spacing = re.search(r'<w:spacing[^/]*/>', block)
    replacement = paragraph_style(
        style_id, name, 'Normal', run_props(block),
        ppr_extra=(spacing.group(0) if spacing else ''), outline=level)
    sx = sx.replace(block, replacement, 1)
    rewritten.append(style_id)

# The roles the template has no style for, in the template's visual language.
navy, teal, grey = '0D2035', '137C7A', '66717C'
serif, sans = 'Georgia', 'Aptos'


def rpr(color=None, size=None, font=None, bold=False, italic=False):
    bits = []
    if font:
        bits.append('<w:rFonts w:ascii="%s" w:hAnsi="%s"/>' % (font, font))
    if bold:
        bits.append('<w:b/>')
    if italic:
        bits.append('<w:i/>')
    if color:
        bits.append('<w:color w:val="%s"/>' % color)
    if size:
        bits.append('<w:sz w:val="%d"/><w:szCs w:val="%d"/>' % (size, size))
    return '<w:rPr>' + ''.join(bits) + '</w:rPr>'


ADDED = {
    'AALAIH3': ('AALAI H3', rpr(navy, 21, sans, bold=True), '', 3),
    'AALAIEntry': ('AALAI Entry', rpr(navy, 21, sans, bold=True), '', 4),
    'AALAIIndexLetter': ('AALAI Index Letter', rpr(teal, 24, sans, bold=True), '', 4),
    'AALAIStandfirst': ('AALAI Standfirst', rpr(navy, 19, serif, italic=True),
                        '<w:spacing w:before="60" w:after="160"/>', None),
    'AALAIReference': ('AALAI Reference', rpr(grey, 15, sans),
                       '<w:spacing w:after="40"/><w:contextualSpacing/>', None),
    'AALAITableText': ('AALAI Table Text', rpr(None, 15, sans),
                       '<w:spacing w:before="20" w:after="20"/>', None),
    'AALAIIndexEntry': ('AALAI Index Entry', rpr(None, 15, sans),
                        '<w:spacing w:after="20"/><w:ind w:left="240" w:hanging="240"/>'
                        '<w:contextualSpacing/>', None),
}

added = []
for style_id, (name, character, spacing, level) in ADDED.items():
    if style_block(sx, style_id):
        continue
    sx = sx.replace('</w:styles>',
                    paragraph_style(style_id, name, 'Normal', character, spacing, level) +
                    '</w:styles>')
    added.append(style_id)

# The template is a chapter sample, so it has no style for things a whole book
# uses — a hyperlink, a table. Anything the document still names is carried
# over from the manuscript's own stylesheet, whole and unedited. The template
# wins wherever both define a style; the manuscript only fills gaps.
original = {}
with zipfile.ZipFile(SRC) as z:
    origin_xml = z.read('word/styles.xml').decode('utf-8')
for block in re.findall(r'<w:style [^>]*>.*?</w:style>', origin_xml, re.S):
    original[re.search(r'w:styleId="([^"]+)"', block).group(1)] = block

carried = []


def carry_over(style_id, styles_xml):
    """Bring a style, and whatever it is based on or links to, from the source."""
    pending, seen = [style_id], set()
    while pending:
        current = pending.pop()
        if current in seen or style_block(styles_xml, current):
            continue
        seen.add(current)
        block = original.get(current)
        if block is None:
            continue
        styles_xml = styles_xml.replace('</w:styles>', block + '</w:styles>')
        carried.append(current)
        for reference in re.findall(r'<w:(?:basedOn|link|next) w:val="([^"]+)"', block):
            pending.append(reference)
    return styles_xml


used_now = set()
for part in sorted(work.glob('word/*.xml')):
    if part.name == 'styles.xml':
        continue
    used_now |= set(re.findall(r'<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"',
                               part.read_text(encoding='utf-8')))
for style_id in sorted(used_now):
    if not style_block(sx, style_id):
        sx = carry_over(style_id, sx)

sty.write_text(sx, encoding='utf-8')

# Nothing in the document may name a style the stylesheet does not define.
defined = set(re.findall(r'w:styleId="([^"]+)"', sx))
used = set()
for part in sorted(work.glob('word/*.xml')):
    if part.name == 'styles.xml':
        continue
    used |= set(re.findall(r'<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"',
                           part.read_text(encoding='utf-8')))
missing = sorted(used - defined)
if missing:
    sys.exit('styles used but not defined: %s' % missing)

# ---------------------------------------------------------------------------
# Step 3: the running heads follow the retag
# ---------------------------------------------------------------------------
# The headers pull the current section with STYLEREF, and STYLEREF names a
# style by its *display name*. Retagging "heading 2" to "AALAI H1" left those
# fields pointing at a style no paragraph carries any more, and every page came
# out reading "Error: Reference source not found".

def display_name(style_id, styles_xml):
    block = style_block(styles_xml, style_id)
    if not block:
        return None
    match = re.search(r'<w:name w:val="([^"]*)"', block)
    return match.group(1) if match else None


renames = {}
for role, style_id in ROLE_TO_TEMPLATE.items():
    was = display_name(role, origin_xml)
    now = display_name(style_id, sx)
    if was and now and was.lower() != now.lower():
        renames[was.lower()] = now

repointed = 0
for part in sorted(work.glob('word/*.xml')):
    if not re.match(r'(header|footer)\d+\.xml', part.name):
        continue
    text = part.read_text(encoding='utf-8')
    before = text

    def repoint(match):
        quoted = match.group(2)
        replacement = renames.get(quoted.lower())
        return match.group(0) if not replacement else \
            match.group(1) + replacement + match.group(3)

    text = re.sub(r'(STYLEREF\s+&quot;)([^&]+)(&quot;)', repoint, text)
    text = re.sub(r'(STYLEREF\s+")([^"]+)(")', repoint, text)
    if text != before:
        part.write_text(text, encoding='utf-8')
        repointed += 1

OUT.unlink(missing_ok=True)
files = sorted(f for f in work.rglob('*') if f.is_file())
first = work / '[Content_Types].xml'
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(first, '[Content_Types].xml', compress_type=zipfile.ZIP_STORED)
    for f in files:
        if f != first:
            z.write(f, str(f.relative_to(work)))

print('  dropped Word’s generated contents: %d block(s)' % len(drop))
print('  stylesheet, theme and fonts taken from %s' % TPL.name)
print('  heading styles given an outline level: %s' % ', '.join(rewritten))
print('  styles added for roles the template lacks: %s' % ', '.join(added))
if carried:
    print('  styles carried over from the manuscript: %s' % ', '.join(sorted(carried)))
print('  running-head STYLEREF fields repointed in %d parts: %s' %
      (repointed, ', '.join('%s → %s' % (k, v) for k, v in renames.items()) or 'none'))
print('  wrote %s (%.0f KB)' % (OUT, OUT.stat().st_size / 1024))
print('  %-22s %s' % ('role', 'paragraphs'))
for role in sorted(counts, key=lambda r: -counts[r]):
    print('  %-22s %5d  → %s' % (role, counts[role],
                                      ROLE_TO_TEMPLATE.get(role, role)))
