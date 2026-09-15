#!/usr/bin/env python3
"""Mark up a proof with everything the audits found, for review with the author.

A spreadsheet of 1,398 findings is the right artefact for a production editor
and the wrong one for a conversation with the author. Sitting down with
Dr. Grinberg, what is wanted is the book itself, with the questionable words
highlighted where they occur, in the sentence that has to be judged.

So this reads the same rules the audits use and paints them onto the book:
regulatory-status words whose use is a claim, efficacy language, the
house-style pairs where both forms are in play, and — in the reference list —
the duplicates, the never-cited entries, the retraction notices and the
internal editorial tags that were never meant to be printed.

Everything is highlighted in yellow, as a marked proof is, with a short code
so a reader can tell at a glance why a word is lit up. A legend goes in at the
front.

Nothing is changed but the marking. This is a proof to argue with, not an
edit.
"""
import argparse
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_references_rules import (REGULATORY, EFFICACY, HOUSE_STYLE_FORMS,
                                    reference_flags)

CODES = {
    'REG': 'Regulatory status — approved, cleared, authorised, registered and '
           'listed are not interchangeable, and each use is a claim',
    'CLAIM': 'Efficacy or safety language',
    'STYLE': 'House style undecided — both forms of this term are in use',
    'TAG': 'Internal editorial marker, never meant to print',
    'DUP': 'Duplicate — this source also appears under another number',
    'UNCITED': 'Nothing in the text cites this reference',
    'NOID': 'No DOI, PMID or URL: nobody can check this one',
    'RETRACT': 'Mentions a retraction, withdrawal or expression of concern',
    'PREPRINT': 'Preprint — not peer reviewed',
    'SOURCE': 'Source outside the clinical literature',
}


def outside_tags(markup, transform):
    """Apply a text transform only where a reader would see the text."""
    out = []
    index = 0
    while index < len(markup):
        nxt = markup.find('<', index)
        if nxt == -1:
            out.append(transform(markup[index:]))
            break
        out.append(transform(markup[index:nxt]))
        close = markup.find('>', nxt)
        if close == -1:
            out.append(markup[nxt:])
            break
        out.append(markup[nxt:close + 1])
        index = close + 1
    return ''.join(out)


def mark(code):
    def wrap(match):
        return ('<mark class="flag flag-%s">%s<span class="flag-code">%s</span></mark>'
                % (code.lower(), match.group(0), code))
    return wrap


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--content', required=True, help='book directory, rewritten in place')
    parser.add_argument('--manuscript', required=True, help='the Markdown the audits read')
    args = parser.parse_args()

    index_file = Path(args.content) / 'index.html'
    markup = index_file.read_text(encoding='utf-8')

    flags = reference_flags(args.manuscript)
    counts = {}

    # --- the reference list -------------------------------------------------
    # Each entry is found by its anchor, and the codes ride on the number.
    def flag_reference(match):
        number = int(match.group(1))
        codes = flags.get(number, [])
        if not codes:
            return match.group(0)
        for code in codes:
            counts[code] = counts.get(code, 0) + 1
        badges = ''.join('<span class="flag-code">%s</span>' % c for c in codes)
        return ('%s<mark class="flag flag-ref">%s%s</mark>'
                % (match.group(0), '', badges))

    markup = re.sub(r'<span class="ref-number">(\d+)\.</span>', flag_reference, markup)

    # Internal editorial tags print as text, so they are marked where they sit.
    def tag_marker(text):
        return re.sub(r'\[@[^\]]+\]:?', mark('TAG'), text)

    # --- the body -----------------------------------------------------------
    body_start = markup.find('<body>')
    references_start = markup.find('data-header="References"')
    if references_start == -1:
        references_start = len(markup)

    head, body, tail = (markup[:body_start], markup[body_start:references_start],
                        markup[references_start:])

    # One pass, not three. Run separately, the regulatory rule matches the
    # "approved" inside a word the house-style rule has already marked as
    # "FDA-approved", and the mark lands inside the mark — 267 of them. A
    # single alternation gives every position exactly one code.
    #
    # Order is precedence: the most specific rule claims the word first.
    combined = re.compile(
        '(?P<STYLE>' + '|'.join('(?:%s)' % p for p in HOUSE_STYLE_FORMS) + ')'
        '|(?P<REG>' + '|'.join('(?:%s)' % p for p in REGULATORY.values()) + ')'
        '|(?P<CLAIM>' + '|'.join('(?:%s)' % p for p in EFFICACY.values()) + ')',
        re.I)

    def language(text):
        def once(match):
            code = match.lastgroup
            return ('<mark class="flag flag-%s">%s<span class="flag-code">%s</span></mark>'
                    % (code.lower(), match.group(0), code))
        return combined.sub(once, text)

    def paint(text):
        if not text.strip():
            return text
        # A word already inside a mark must not be marked again.
        if 'flag-code' in text:
            return text
        return language(text)

    body = outside_tags(body, paint)
    tail = outside_tags(tail, tag_marker)

    for code in ('REG', 'CLAIM', 'STYLE'):
        counts[code] = len(re.findall(r'flag-%s"' % code.lower(), body))
    counts['TAG'] = len(re.findall(r'flag-tag"', tail))

    markup = head + body + tail

    # --- the legend ---------------------------------------------------------
    slug = (re.search(r'<div class="([a-z0-9-]+) ', markup) or ['', 'book'])[1]
    rows = ''.join(
        '                <p class="legend-row"><span class="flag-code">%s</span> %s</p>\n'
        % (code, html.escape(text)) for code, text in CODES.items())
    legend = (
        '<div class="%s chapter frontmatter legend-page" data-header="How to read this proof">\n'
        '        <div>\n            <div>\n'
        '                <h1 class="heading-2">How to read this proof</h1>\n'
        '                <p class="standfirst">Every highlight is a question, not a '
        'correction. The code says which question.</p>\n%s'
        '                <p>Counts are in the audit spreadsheets. Nothing in the text '
        'has been changed.</p>\n'
        '            </div>\n        </div>\n    </div>' % (slug, rows))

    if 'legend-page' not in markup.split('<body>')[0]:
        first = re.search(r'<div class="[^"]*chapter[^"]*"[^>]*data-header="Copyright"', markup)
        if first:
            markup = markup[:first.start()] + legend + '\n\n    ' + markup[first.start():]

    index_file.write_text(markup, encoding='utf-8')

    print('Marked %s' % index_file)
    for code in CODES:
        if counts.get(code):
            print('  %-9s %6d' % (code, counts[code]))
    print('  legend page added at the front')


if __name__ == '__main__':
    main()
