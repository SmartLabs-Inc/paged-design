"""One source of truth for what the audits look for.

The spreadsheet and the marked proof have to agree. If the highlighter carried
its own copy of the rules, the two would drift apart the first time one was
edited, and the proof would quietly stop matching the counts the author is
reading beside it.

So the rules live here, and the audit scripts and the highlighter all read
them. The audit scripts keep their own filenames with hyphens, which Python
cannot import, so they are loaded by path.
"""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(filename, name):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_language = _load('audit-language.py', 'aalai_audit_language')
_references = _load('audit-references.py', 'aalai_audit_references')

REGULATORY = _language.REGULATORY
EFFICACY = _language.EFFICACY
HOUSE_STYLE = _language.HOUSE_STYLE

# Both sides of every house-style pair: the point of marking them is that the
# book has not decided, so each form is as much a question as the other.
HOUSE_STYLE_FORMS = [pattern for _, pattern, _, alternative in HOUSE_STYLE
                     for pattern in (pattern, alternative)]

# Which audit finding belongs on which reference, and under which code.
FINDING_CODES = {
    'duplicate_doi': 'DUP',
    'duplicate_pmid': 'DUP',
    'duplicate_title': 'DUP',
    'duplicate_url': 'DUP',
    'never_cited': 'UNCITED',
    'no_identifier': 'NOID',
    'flagged_retraction': 'RETRACT',
    'flagged_expression_of_concern': 'RETRACT',
    'flagged_withdrawn': 'RETRACT',
    'preprint': 'PREPRINT',
    'nonclinical_source': 'SOURCE',
    'editorial_marker': 'TAG',
}


def reference_flags(manuscript):
    """Map each reference number to the codes the audit raised against it.

    A duplicate group is reported once, against its first member, because that
    is what an editor wants in a spreadsheet. On a proof every member of the
    group has to be lit up, or the reader sees one flagged entry and no reason
    for it — so the group is expanded here.
    """
    entries, order, citations = _references.parse(manuscript)
    findings = _references.audit(entries, order, citations)

    flags = {}
    for kind, rows in findings.items():
        code = FINDING_CODES.get(kind)
        if not code:
            continue
        for number, detail, _text in rows:
            numbers = [number]
            if kind.startswith('duplicate_') and 'shared by' in detail:
                shared = detail.split('shared by', 1)[1]
                numbers = [int(n) for n in shared.replace(',', ' ').split() if n.isdigit()]
            for value in numbers:
                codes = flags.setdefault(value, [])
                if code not in codes:
                    codes.append(code)
    return flags
