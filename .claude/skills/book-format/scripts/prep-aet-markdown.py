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


def link(match):
    global citations
    citations += 1
    number, target = match.group(1), match.group(2)
    return ('<sup class="cite"><a href="#%s">%s</a></sup>' % (target, number))


body = re.sub(r'\[\[(\d+)\]\]\(#([^)]+)\)', link, body)

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

OUT.write_text(body + refs, encoding='utf-8')

print('  citations turned into superscript links: %d' % citations)
if leftover:
    print('  WARNING: %d [[n]] marks left unlinked' % leftover)
print('  reference numbers frozen against renumbering: %d' % escaped)
print('  wrote %s (%.1f MB)' % (OUT, OUT.stat().st_size / 1e6))
