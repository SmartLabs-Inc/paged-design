#!/usr/bin/env python3
"""
Find the loose lines in a finished PDF: justified lines whose words have been
pushed too far apart.

This REPORTS. It changes nothing.

A justified line is filled by stretching its word spaces. A line that had to
take a long word down to the next line is filled with what is left, and the
spaces show: a "river" when several fall together, a gap-toothed line when it
is one. Taking hyphenation away from a word (to break up a stack of hyphens,
or to keep a name whole) is exactly what makes them, so this is the check to
run after fit-hyphenation.js.

The measure is taken from the PDF, which is the thing being judged. pdftotext
gives every word its box; the space between two words on a line is the gap
between their boxes; and the line's looseness is its average gap against the
normal word space of its own type size. Only lines that are part of a
justified block are judged — a line that stops short of its column's edge is
ragged, or the last line of a paragraph, and its spaces are not stretched.

    python3 report-loose-lines.py book.pdf [--loose 3] [--worst 40] [--json out.json]

--loose is the ratio of a line's average gap to the natural word space above
which the line is listed. The natural space is measured from the PDF: the gap
on lines that are not stretched. In narrow justified columns most lines are
stretched to about twice that and it does not show; three times begins to,
and five or six is a hole in the line.
"""
import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from html import unescape


def words_by_page(pdf, first=None, last=None):
    cmd = ['pdftotext', '-bbox-layout']
    if first:
        cmd += ['-f', str(first)]
    if last:
        cmd += ['-l', str(last)]
    cmd += [pdf, '-']
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    page = (first or 1) - 1
    line = None
    pages = defaultdict(list)
    for raw in out.split('\n'):
        raw = raw.strip()
        if raw.startswith('<page '):
            page += 1
        elif raw.startswith('<line '):
            box = dict(re.findall(r'(\w+)="([^"]*)"', raw))
            line = {'x0': float(box['xMin']), 'x1': float(box['xMax']), 'y0': float(box['yMin']), 'y1': float(box['yMax']), 'words': []}
        elif raw.startswith('<word '):
            box = dict(re.findall(r'(\w+)="([^"]*)"', raw.split('>')[0]))
            text = unescape(re.sub(r'<[^>]+>', '', raw))
            if line is not None:
                line['words'].append((float(box['xMin']), float(box['xMax']), text))
        elif raw.startswith('</line>') and line is not None:
            if line['words']:
                pages[page].append(line)
            line = None
    return pages


def join_broken(lines):
    """pdftotext gives up on a line whose words are very far apart and reports
    it as two or three. Those are the worst lines there are, so they are put
    back together: pieces on one baseline, the later one not starting at a
    column's own left edge."""
    starts = defaultdict(int)
    for ln in lines:
        starts[round(ln['x0'])] += 1
    column_starts = [x for x, count in starts.items() if count >= 6]
    rows = defaultdict(list)
    for ln in lines:
        rows[round(ln['y0'] * 2)].append(ln)
    out = []
    for key in sorted(rows):
        row = sorted(rows[key], key=lambda ln: ln['x0'])
        current = None
        for ln in row:
            at_column = any(abs(ln['x0'] - x) <= 1.5 for x in column_starts)
            if current is not None and not at_column and ln['x0'] - current['x1'] < 60:
                current = {'x0': current['x0'], 'x1': ln['x1'], 'y0': current['y0'], 'y1': current['y1'],
                           'words': current['words'] + ln['words'], 'joined': True}
            else:
                if current is not None:
                    out.append(current)
                current = dict(ln)
        if current is not None:
            out.append(current)
    return out


def gaps_of(line):
    words = line['words']
    return [g for g in (words[i + 1][0] - words[i][1] for i in range(len(words) - 1)) if g > 0]


def main():
    ap = argparse.ArgumentParser(description='List the loose lines in a justified PDF.')
    ap.add_argument('pdf')
    ap.add_argument('--loose', type=float, default=3.0, help='average gap, in natural word spaces, that counts as loose')
    ap.add_argument('--worst', type=int, default=40, help='how many of the worst to print')
    ap.add_argument('--first', type=int)
    ap.add_argument('--last', type=int)
    ap.add_argument('--json')
    args = ap.parse_args()

    pages = words_by_page(args.pdf, args.first, args.last)
    for number in pages:
        pages[number] = join_broken(pages[number])

    # The natural word space, measured and not assumed: the gap on lines that
    # are not stretched — the last line of a paragraph, a ragged line — for
    # each size of type. In this measure a line's size is the height of its box.
    natural_by_size = defaultdict(list)
    judged_lines = []
    for number in sorted(pages):
        lines = pages[number]
        edges = defaultdict(int)
        for ln in lines:
            edges[round(ln['x1'])] += 1
        for ln in lines:
            size = round(ln['y1'] - ln['y0'], 1)
            gaps = gaps_of(ln)
            if not gaps or size < 6 or size > 22:
                continue
            shared = sum(count for edge, count in edges.items() if abs(edge - ln['x1']) <= 1)
            if shared >= 4 and len(ln['words']) >= 2:
                judged_lines.append((number, size, ln, gaps))
            elif len(ln['words']) >= 3 and not ln.get('joined'):
                natural_by_size[size].append(sum(gaps) / len(gaps))
    natural = {}
    for size, values in natural_by_size.items():
        if len(values) >= 20:
            values.sort()
            natural[size] = values[len(values) // 2]

    judged = 0
    loose = []
    for number, size, ln, gaps in judged_lines:
        if size not in natural:
            continue
        judged += 1
        ratio = (sum(gaps) / len(gaps)) / natural[size]
        if ratio >= args.loose:
            loose.append({
                'sheet': number,
                'ratio': round(ratio, 2),
                'gap': round(sum(gaps) / len(gaps), 1),
                'words': len(ln['words']),
                'text': ' '.join(w[2] for w in ln['words']).replace('\u00ad', '')
            })

    loose.sort(key=lambda item: -item['ratio'])
    print('Natural word space, by line size: ' + ', '.join(f'{size} pt line: {value:.2f} pt' for size, value in sorted(natural.items())))
    print(f'{judged} justified lines judged; {len(loose)} with an average gap of {args.loose:g} natural spaces or more '
          f'({100.0 * len(loose) / max(1, judged):.2f}%)')
    for low, high in ((6, 99), (5, 6), (4, 5), (3, 4), (2, 3)):
        if low < args.loose - 0.001:
            continue
        count = sum(1 for item in loose if low <= item['ratio'] < high)
        print(f'  {count:6d}  {low} to {high} spaces' if high < 99 else f'  {count:6d}  {low} spaces or more')
    print('')
    for item in loose[:args.worst]:
        print(f"  sheet {item['sheet']:4d}  x{item['ratio']:<5} gap {item['gap']} pt  “{item['text'][:70]}”")
    if args.json:
        with open(args.json, 'w', encoding='utf8') as handle:
            json.dump({'judged': judged, 'loose': loose, 'threshold': args.loose, 'natural': natural}, handle, ensure_ascii=False)


if __name__ == '__main__':
    sys.exit(main())
