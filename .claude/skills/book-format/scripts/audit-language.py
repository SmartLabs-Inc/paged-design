#!/usr/bin/env python3
"""Count the words a specialist reference is judged on.

A style sheet for a book this size cannot be written from memory. It has to be
written against what the manuscript actually says, and then the decisions are
about real numbers rather than impressions.

Two groups.

**Regulatory status**, where the words are not interchangeable and using the
wrong one is a claim: approved, cleared, authorized, registered, listed,
investigational, off-label, compounded. A trial registration is not an
approval; an establishment listing is not a clearance. Each occurrence is
reported with the sentence around it, because whether a use is right depends
entirely on what it is attached to.

**Efficacy and house style**, where the question is consistency rather than
accuracy: clinically proven, safe, effective, reverses aging, anti-aging
against longevity medicine, stem cell against stem/stromal cell, micropeptide
against microprotein, and the unit forms.

Nothing here is a judgement. It is the list someone has to decide from.
"""
import argparse
import csv
import re
from collections import Counter
from pathlib import Path

REGULATORY = {
    'approved': r'\bapproved?\b',
    'approval': r'\bapprovals?\b',
    'cleared / clearance': r'\bclear(?:ed|ance)\b',
    'authorized / authorisation': r'\bauthoriz(?:ed|ation)\b|\bauthoris(?:ed|ation)\b',
    'registered / registration': r'\bregist(?:ered|ration)\b',
    'listed / listing': r'\blist(?:ed|ing)\b',
    'investigational': r'\binvestigational\b',
    'off-label': r'\boff[- ]label\b',
    'compounded / compounding': r'\bcompound(?:ed|ing)\b',
    'research use only': r'\bresearch use only\b',
    'GRAS': r'\bGRAS\b',
    'supplement': r'\bsupplements?\b',
    'biologic': r'\bbiologics?\b',
    'device': r'\bdevices?\b',
}

EFFICACY = {
    'clinically proven': r'\bclinically proven\b',
    'proven': r'\bproven\b',
    'safe / safety claim': r'\bis safe\b|\bare safe\b|\bsafe and effective\b',
    'effective': r'\beffective\b',
    'efficacious': r'\befficacious\b',
    'reverses / reversal of aging': r'\brevers(?:e|es|ed|al)\s+(?:of\s+)?aging\b',
    'regenerates': r'\bregenerates?\b',
    'rejuvenat*': r'\brejuvenat\w*\b',
    'cure / cures': r'\bcures?\b',
}

HOUSE_STYLE = [
    ('anti-aging', r'\banti[- ]aging\b', 'longevity medicine', r'\blongevity medicine\b'),
    ('stem cell', r'\bstem cells?\b', 'stem/stromal cell', r'\bstem/stromal cells?\b'),
    ('micropeptide', r'\bmicropeptides?\b', 'microprotein', r'\bmicroproteins?\b'),
    ('µg', r'µg', 'micrograms', r'\bmicrograms?\b'),
    ('mcg', r'\bmcg\b', 'micrograms', r'\bmicrograms?\b'),
    ('FDA-approved', r'\bFDA[- ]approved\b', 'FDA approval', r'\bFDA approval\b'),
    ('exosome', r'\bexosomes?\b', 'extracellular vesicle', r'\bextracellular vesicles?\b'),
    ('peptide bioregulator', r'\bbioregulators?\b', 'short peptide', r'\bshort peptides?\b'),
]


def sentences(text):
    """Split loosely. Good enough to show a word in the claim it sits in."""
    for part in re.split(r'(?<=[.!?])\s+(?=[A-Z])', text):
        yield part


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('manuscript')
    parser.add_argument('--out', default='language-audit')
    parser.add_argument('--context', type=int, default=200,
                        help='characters of surrounding sentence to record')
    args = parser.parse_args()

    text = Path(args.manuscript).read_text(encoding='utf-8')
    # The reference list is citation metadata, not the author's prose.
    head = text.index('\n# References')
    body = text[:head]

    # Which part of the book each hit falls in, so an editor can work in order.
    parts = [(m.start(), m.group(1)) for m in re.finditer(r'^#{1,2} (.+)$', body, re.M)]

    def locate(position):
        name = 'Front matter'
        for start, title in parts:
            if start <= position:
                name = title
            else:
                break
        return name

    rows = []
    counts = Counter()
    for group, table in (('regulatory', REGULATORY), ('efficacy', EFFICACY)):
        for label, pattern in table.items():
            for match in re.finditer(pattern, body, re.I):
                counts[(group, label)] += 1
                start = max(0, match.start() - args.context // 2)
                snippet = re.sub(r'\s+', ' ', body[start:match.end() + args.context // 2])
                rows.append({'group': group, 'term': label, 'section': locate(match.start()),
                             'matched': match.group(0), 'context': snippet.strip()})

    # `--out audit.csv` should write audit.csv, not audit.csv.csv.
    report = Path(args.out if args.out.endswith('.csv') else args.out + '.csv')
    with report.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=['group', 'term', 'section',
                                                    'matched', 'context'])
        writer.writeheader()
        for row in sorted(rows, key=lambda r: (r['group'], r['term'], r['section'])):
            writer.writerow(row)

    print('REGULATORY STATUS — not interchangeable; each use is a claim')
    for label in REGULATORY:
        print('  %-28s %6d' % (label, counts[('regulatory', label)]))
    print()
    print('EFFICACY AND CLAIM LANGUAGE')
    for label in EFFICACY:
        print('  %-28s %6d' % (label, counts[('efficacy', label)]))
    print()
    print('HOUSE STYLE — pick one of each pair')
    print('  %-26s %7s   %-26s %7s' % ('form', 'uses', 'alternative', 'uses'))
    for left_label, left, right_label, right in HOUSE_STYLE:
        a = len(re.findall(left, body, re.I))
        b = len(re.findall(right, body, re.I))
        if not a and not b:
            continue
        mixed = '  ← both in use' if a and b else ''
        print('  %-26s %7d   %-26s %7d%s' % (left_label, a, right_label, b, mixed))
    print()
    print('Wrote %s (%d occurrences with context)' % (report, len(rows)))


if __name__ == '__main__':
    main()
