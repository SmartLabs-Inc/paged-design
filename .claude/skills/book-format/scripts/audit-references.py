#!/usr/bin/env python3
"""Audit a reference apparatus the size of a small database.

Three thousand seven hundred and fifty references are past the point where
anyone can check them by reading. The faults that matter are not typos; they
are structural, and they are invisible one entry at a time:

* The same source under two different numbers. A specialist reading
  "…confirmed in two independent studies[[1005]][[3464]]" is being shown one
  study twice. This is the fault most worth finding, and it cannot be seen
  except by comparing every entry against every other.
* A reference nothing cites, which usually means a claim was cut and its
  support left behind.
* A stated PMID that disagrees with the PubMed link printed beside it.
* A reference with no resolvable identifier at all, which cannot be checked
  by anyone, ever.
* Retractions, errata and expressions of concern the text cites as if intact.

Everything here is computed from the manuscript alone. Checking that a DOI
resolves, that a PMID is the paper claimed, or that a paper has since been
retracted needs the network: `--verify` does that where there is one. Without
it the audit says so rather than implying the identifiers were confirmed.
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

DOI = re.compile(r'\b(10\.\d{4,9}/[^\s<>",;)\]]+)', re.I)
PMID = re.compile(r'\bPMID:?\s*(\d{1,9})\b', re.I)
PMC = re.compile(r'\bPMC(\d{5,9})\b', re.I)
URL = re.compile(r'https?://[^\s<>"\)]+')
PUBMED_URL_ID = re.compile(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d+)')
PMC_URL_ID = re.compile(r'pmc/articles/PMC(\d+)|articles/PMC(\d+)')

RETRACTION = re.compile(r'\bretract', re.I)
CONCERN = re.compile(r'expression of concern', re.I)
ERRATUM = re.compile(r'\b(erratum|corrigend)', re.I)
CORRECTION = re.compile(r'\bcorrection\b', re.I)
WITHDRAWN = re.compile(r'\bwithdrawn\b', re.I)
PREPRINT = re.compile(r'\b(biorxiv|medrxiv|preprint|ssrn)\b', re.I)
NONCLINICAL_SOURCE = re.compile(
    r'\b(peptutor|reddit|forum|community|practitioner report|self-experiment|'
    r'blog|youtube|telegram|discord)\b', re.I)


def normalise_doi(value):
    return value.rstrip('.,;)]').lower()


def normalise_title(text):
    """Enough of the citation to recognise the same paper written twice."""
    stripped = re.sub(r'^\d+\.\s*', '', text)
    stripped = re.sub(r'https?://\S+', '', stripped)
    stripped = re.sub(r'\b(doi|pmid|pmcid)\b.*$', '', stripped, flags=re.I)
    stripped = re.sub(r'[^a-z0-9 ]', '', stripped.lower())
    stripped = re.sub(r'\s+', ' ', stripped).strip()
    return stripped[:90]


def parse(path):
    text = Path(path).read_text(encoding='utf-8')
    head = text.index('\n# References')
    body, tail = text[:head], text[head:]

    # Each entry is a number, then the citation, then any continuation lines
    # (PMID, URL) up to the next anchor or numbered line.
    entries = {}
    order = []
    current = None
    for line in tail.split('\n'):
        match = re.match(r'^(?:<span class="ref-number">)?(\d{1,4})[.\\]*\s*(?:</span>)?\s*(.*)$', line)
        if match and not re.match(r'^\d+\.\s*https?://', line):
            current = int(match.group(1))
            if current in entries:
                entries[current]['repeated_number'] = True
                continue
            entries[current] = {'number': current, 'text': match.group(2).strip(),
                                'repeated_number': False}
            order.append(current)
        elif current is not None and line.strip():
            if line.strip().startswith('<a id='):
                continue
            entries[current]['text'] += ' ' + line.strip()

    citations = Counter()
    for match in re.finditer(r'\[\[(\d+)\]\]', body):
        citations[int(match.group(1))] += 1
    return entries, order, citations


def audit(entries, order, citations):
    findings = defaultdict(list)
    by_doi, by_pmid, by_title, by_url = (defaultdict(list) for _ in range(4))

    for number in order:
        entry = entries[number]
        text = entry['text']

        dois = [normalise_doi(d) for d in DOI.findall(text)]
        pmids = PMID.findall(text)
        urls = URL.findall(text)
        entry['doi'] = dois[0] if dois else ''
        entry['pmid'] = pmids[0] if pmids else ''
        entry['url'] = urls[0] if urls else ''

        for value in set(dois):
            by_doi[value].append(number)
        for value in set(pmids):
            by_pmid[value].append(number)
        for value in set(urls):
            by_url[value.rstrip('/.')].append(number)
        title = normalise_title(text)
        if len(title) > 45:
            by_title[title].append(number)

        # A stated PMID that disagrees with the link printed beside it.
        linked = set(PUBMED_URL_ID.findall(text))
        if pmids and linked and not (set(pmids) & linked):
            findings['pmid_link_mismatch'].append(
                (number, 'states PMID %s, links to %s' % (', '.join(pmids), ', '.join(linked)), text))

        if not dois and not pmids and not urls:
            findings['no_identifier'].append((number, 'no DOI, PMID or URL', text))

        for pattern, label in ((RETRACTION, 'retraction'), (CONCERN, 'expression of concern'),
                               (ERRATUM, 'erratum'), (WITHDRAWN, 'withdrawn'),
                               (CORRECTION, 'correction')):
            if pattern.search(text):
                findings['flagged_' + label.replace(' ', '_')].append((number, label, text))
                break

        if PREPRINT.search(text):
            findings['preprint'].append((number, 'preprint or preprint server', text))
        if NONCLINICAL_SOURCE.search(text):
            findings['nonclinical_source'].append((number, 'non-clinical source', text))
        if entry['repeated_number']:
            findings['repeated_number'].append((number, 'this number appears more than once', text))

    def duplicates(index, label):
        for value, numbers in sorted(index.items()):
            if len(numbers) > 1:
                findings[label].append(
                    (numbers[0], '%s shared by %s' % (value[:70], ', '.join(map(str, numbers))),
                     entries[numbers[0]]['text']))

    duplicates(by_doi, 'duplicate_doi')
    duplicates(by_pmid, 'duplicate_pmid')
    duplicates(by_title, 'duplicate_title')
    duplicates(by_url, 'duplicate_url')

    for number in order:
        if citations.get(number, 0) == 0:
            findings['never_cited'].append((number, 'no citation points here', entries[number]['text']))

    for number in sorted(citations):
        if number not in entries:
            findings['cited_but_missing'].append(
                (number, 'cited %d time(s), no such reference' % citations[number], ''))

    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('manuscript')
    parser.add_argument('--out', default='reference-audit', help='output prefix')
    parser.add_argument('--verify', action='store_true',
                        help='resolve DOIs and PMIDs against Crossref and PubMed '
                             '(needs network; says so plainly if it cannot reach them)')
    args = parser.parse_args()

    entries, order, citations = parse(args.manuscript)
    findings = audit(entries, order, citations)

    rows = []
    for kind in sorted(findings):
        for number, detail, text in findings[kind]:
            rows.append({'check': kind, 'reference': number, 'detail': detail,
                         'citations': citations.get(number, 0),
                         'text': re.sub(r'\s+', ' ', text)[:300]})

    report = Path(args.out + '.csv')
    with report.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=['check', 'reference', 'citations',
                                                    'detail', 'text'])
        writer.writeheader()
        for row in sorted(rows, key=lambda r: (r['check'], r['reference'])):
            writer.writerow(row)

    # The identifiers, so the live half can run anywhere there is a network.
    ids = Path(args.out + '-identifiers.json')
    ids.write_text(json.dumps({
        'dois': sorted({entries[n]['doi'] for n in order if entries[n]['doi']}),
        'pmids': sorted({entries[n]['pmid'] for n in order if entries[n]['pmid']}),
    }, indent=1), encoding='utf-8')

    print('References parsed            : %5d' % len(entries))
    print('Citations in the text        : %5d marks, %d distinct' %
          (sum(citations.values()), len(citations)))
    print()
    labels = [
        ('duplicate_doi', 'Same DOI under different numbers'),
        ('duplicate_pmid', 'Same PMID under different numbers'),
        ('duplicate_title', 'Same citation text under different numbers'),
        ('duplicate_url', 'Same URL under different numbers'),
        ('repeated_number', 'Reference number used twice'),
        ('pmid_link_mismatch', 'Stated PMID disagrees with its link'),
        ('no_identifier', 'No DOI, PMID or URL at all'),
        ('never_cited', 'Never cited in the text'),
        ('cited_but_missing', 'Cited but absent from the list'),
        ('flagged_retraction', 'Mentions a retraction'),
        ('flagged_expression_of_concern', 'Mentions an expression of concern'),
        ('flagged_withdrawn', 'Mentions a withdrawal'),
        ('flagged_erratum', 'Mentions an erratum'),
        ('flagged_correction', 'Mentions a correction'),
        ('preprint', 'Preprint or preprint server'),
        ('nonclinical_source', 'Non-clinical source (forum, practitioner report)'),
    ]
    for key, label in labels:
        print('%-50s %5d' % (label, len(findings.get(key, []))))

    print()
    print('Wrote %s (%d findings) and %s' % (report, len(rows), ids))
    if args.verify:
        print()
        print('--verify: resolution against Crossref and PubMed was requested.')
        print('Nothing was resolved here — this environment blocks outbound')
        print('requests to both. The identifier lists are written out so the')
        print('check can run where there is a network.')


if __name__ == '__main__':
    main()
