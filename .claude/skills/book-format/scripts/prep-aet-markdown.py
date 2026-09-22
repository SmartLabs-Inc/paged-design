#!/usr/bin/env python3
"""Prepare the AET Markdown for conversion.

The manuscript arrives as one Markdown file carrying three conventions the
book converter does not know about:

* citations already written as Markdown links, `[[123]](#ref-123)`,
* a reference list numbered 1–4083 with an HTML anchor before each entry,
* an index whose entries already link to anchors in the body.

Three things happen here, and the third is the one that matters most.

1. `[[123]](#ref-123)` becomes a superscript link. The whole construct has to
   be matched: replacing only the `[[123]]` label leaves the `(#ref-123)`
   behind as visible text next to every one of the 6,867 marks.

   Marks that sit next to each other are set as one mark. The manuscript
   writes a run of sources with nothing between them, so three citations in a
   row print as the single unreadable number 121314; there are 1,498 such
   runs, one of them 28 marks long. They are punctuated here, and a run of
   consecutive numbers closes up into a range — the convention every journal
   uses, and the only way a run of 28 is readable at all.

2. The reference list is left numbered exactly as the author numbered it.

3. **The number on each reference is wrapped in HTML so Markdown cannot
   renumber it.** A line beginning `1886. Birk AV…` is an ordered-list item as
   far as any Markdown parser is concerned, and a parser renumbers a list from
   one. The author's sequence skips 333 numbers — deliberately, because those
   references were removed — so letting it renumber would silently shift every
   citation above the first gap onto the wrong source.

   A backslash escape does not work here: the converter passes `1886\.`
   through and the reader sees the backslash. A span does work, and gives the
   number something to be styled by.

4. **Each entry is wrapped in its own paragraph, here, in HTML.** This was
   found by rendering: the reference section came out at 556 pages when it
   should be under 200, and the reason was that there were no paragraphs in it
   at all. An entry line begins with a `<span>`, so the converter hands the
   whole run to the page as raw inline text — one continuous flow of 3,750
   citations with nothing for `.references p` to style and nothing for the
   paginator to break between. The 8pt two-column rule was matching zero
   elements.

   Wrapping the entries means the inline Markdown inside them is ours to
   convert too, because a raw HTML block is passed through untouched: the 3,139
   `<https://…>` autolinks are the urgent ones. Left alone the browser parses
   `<https://pubmed.ncbi.nlm.nih.gov/36753958/>` as a start tag and the URL
   vanishes from the page — every reference silently losing the one thing a
   reader would use to check it.
"""
import re
import sys
from pathlib import Path

if len(sys.argv) != 3 or sys.argv[1] in ('-h', '--help'):
    sys.exit('usage: prep-aet-markdown.py <in.md> <out.md>')

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
text = SRC.read_text(encoding='utf-8')

head = text.index('\n# References')
body, refs = text[:head], text[head:]

# 1. Citations become links.
citations = 0


runs = 0

ONE = re.compile(r'\[\[(\d+)\]\]\(#([^)]+)\)')



# Marks in one run before it is allowed to break across lines. Five keeps the
# original rule intact for the 4,501 runs that fit and releases the 32 that
# do not.
LONG_RUN = 5

def anchor(number, target):
    return '<a href="#%s">%s</a>' % (target, number)


def link(match):
    """One mark, or a whole run of them set as one."""
    global citations, runs
    marks = ONE.findall(match.group(0))
    citations += len(marks)
    if len(marks) > 1:
        runs += 1

    # Group consecutive numbers, in the order the author wrote them. Three or
    # more in a row become a range; two stay as two, because 6–7 saves nothing
    # over 6,7 and reads as a page span.
    groups = []
    for number, target in marks:
        value = int(number)
        if groups and value == groups[-1][-1][0] + 1:
            groups[-1].append((value, number, target))
        else:
            groups.append([(value, number, target)])

    parts = []
    for group in groups:
        if len(group) >= 3:
            parts.append(anchor(group[0][1], group[0][2]) + '\u2013' +
                         anchor(group[-1][1], group[-1][2]))
        else:
            parts.append(','.join(anchor(n, t) for _, n, t in group))

    # A run of sources is one mark and breaks nowhere, which is right: 12-14
    # split over a line ending reads as two different citations. But a long
    # enough run is wider than the column, and `nowrap` then walks it straight
    # across the gutter into the next one -- twenty-six marks did exactly that
    # on page 193.
    #
    # So the rule is kept and narrowed. A long run is marked, and a zero-width
    # space after each comma gives the line breaker somewhere to break: between
    # citations, never inside a number. Nothing is dropped; a reference book
    # about evidence boundaries is the last place to lose sources to fit a
    # column.
    if len(parts) >= LONG_RUN:
        return ('<sup class="cite cite-long">' +
                ',\u200b'.join(parts) + '</sup>')
    return '<sup class="cite">' + ','.join(parts) + '</sup>'


body = re.sub(r'(?:\[\[\d+\]\]\(#[^)]+\))+', link, body)

leftover = len(re.findall(r'\[\[\d+\]\]', body))

# The reference list cites nothing, but the index links into the body and
# those anchors have to survive, so nothing else in either half is touched.

# 2 and 3. Keep the author's numbering, and stop Markdown renumbering it.
escaped = 0


def freeze(match):
    global escaped
    escaped += 1
    return '<span class="ref-number">%s.</span> ' % match.group(1)


refs = re.sub(r'^(\d{1,4})\.\s+(?=\S)', freeze, refs, flags=re.M)

# 4. Each entry becomes one paragraph, and its inline Markdown is converted
#    here because a raw HTML block is passed through untouched downstream.

ENTITY = re.compile(r'&(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6});')


def inline(text):
    """Markdown inline syntax, in a fragment that is already HTML."""
    # Ampersands first, so nothing written below is escaped twice.
    text = ENTITY.sub(lambda m: '\x00%s\x00' % m.group(0)[1:-1], text)
    text = text.replace('&', '&amp;')
    text = re.sub(r'\x00([^\x00]+)\x00', r'&\1;', text)

    # <https://…> — the construct that disappears if it is left alone.
    text = re.sub(r'<(https?://[^>\s]+)>',
                  lambda m: '<a class="uri" href="%s">%s</a>' % (m.group(1), m.group(1)),
                  text)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)',
                  lambda m: '<a class="uri" href="%s">%s</a>' % (m.group(2), m.group(1)),
                  text)
    text = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', text)

    # Anything still angled is a stray, and prints rather than disappears.
    text = re.sub(r'<(?![/a-zA-Z])', '&lt;', text)
    return text


wrapped = 0


def entry(match):
    global wrapped
    wrapped += 1
    number, body_text = match.group(1), match.group(2).strip()
    # The anchor stays exactly where it was: 6,867 citations point at it.
    return ('<p class="reference"><a id="ref-%s"></a>'
            '<span class="ref-number">%s.</span> %s</p>'
            % (number, number, inline(body_text)))


refs = re.sub(
    r'<a id="ref-(\d+)"></a>\s*\n\s*\n<span class="ref-number">\d+\.</span>(.*)',
    entry, refs)

stray_anchors = len(re.findall(r'^<a id="ref-\d+"></a>\s*$', refs, flags=re.M))

OUT.write_text(body + refs, encoding='utf-8')

print('  citations turned into superscript links: %d' % citations)
print('  adjacent runs punctuated and closed up: %d' % runs)
if leftover:
    print('  WARNING: %d [[n]] marks left unlinked' % leftover)
print('  reference numbers frozen against renumbering: %d' % escaped)
print('  reference entries wrapped in their own paragraph: %d' % wrapped)
if stray_anchors:
    print('  WARNING: %d reference anchors with no entry after them' % stray_anchors)
print('  wrote %s (%.1f MB)' % (OUT, OUT.stat().st_size / 1e6))
