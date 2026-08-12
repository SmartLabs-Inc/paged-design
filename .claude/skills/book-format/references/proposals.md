# Client proposals

A proposal set in the same system, at the same trim, in the same design as the
book it is selling is its own strongest argument. The client is holding the
sample chapter before they have agreed to anything.

The last proposal that shipped is kept as a template. A **deal file** supplies
the names, dates and money; `make-proposal.js` fills them in and writes a book
the rest of the skill renders like any other.

```bash
# 1. Start from a blank deal file
node .claude/skills/book-format/scripts/make-proposal.js --example \
  > .claude/skills/book-format/proposals/deals/acme.json

# 2. Edit it, then build
node .claude/skills/book-format/scripts/make-proposal.js --deal <that file>

# 3. Render and check, as with any book
node .claude/skills/book-format/scripts/check-layout.js \
  --content content/proposal-acme --theme aalai-screen --strict
node .claude/skills/book-format/scripts/render-pdf.js \
  --content content/proposal-acme --theme aalai-screen --out Acme-Proposal.pdf
```

Use **`aalai-screen`**, not `aalai`. A proposal is read on a screen, and the
print theme opens each section on a recto, which leaves blank pages a scrolling
reader takes for a rendering failure.

Output goes under `content/`, which is where it has to be: the layout and PDF
scripts serve the repository, so content outside it never loads and pagination
hangs until it times out.

## The deal file

| Group | Holds |
| --- | --- |
| `slug` | Names the output directory, `content/proposal-<slug>` |
| `client` | `salutation` (cover), `familiar` (the letter's "Dear …"), `signatory` (signature block) |
| `studio` | `name`, `shortName`, `signatory`, `signatoryTitle` |
| `imprint` | `name`, `short`, `parent` |
| `book` | `title`, `chapterCount`, `extentShort`, `extentSentence`, `trim`, `trimShort` |
| `fee` | `total`, `totalWords`, and the three milestone amounts `p1`–`p3` |
| `delivery` | `city`, `eventMonth`, `calendarMonths` |
| `dates` | `proposal`, `validUntil`, `start`, `printer`, `delivery` — all `YYYY-MM-DD` |
| `schedule` | `weeks`, `weeksWithArticle`, and the `book` and `launch` row arrays |

Every date is parsed and formatted in UTC, so a machine in another timezone
cannot shift one by a day. Three are checked against each other: the printer
date must fall before delivery, the start before the printer, and the validity
date not before the proposal date. A schedule that cannot happen is a mistake
worth catching at build time rather than in front of a client.

Missing values are reported by name and the build fails. Nothing ships with an
empty bracket where a fee should be.

## Schedule rows

The week ranges are the part worth automating — counting backward from a
delivery date by hand is where a Tuesday becomes a Wednesday.

```json
{ "weeks": [1],    "what": "Contract and deposit. Manuscript intake." },
{ "weeks": [7, 8], "dates": "Sep 21&#8202;–&#8202;Oct 2",
                   "what": "Print, bind, and freight." },
{ "dates": "Oct 5&#8202;–&#8202;6", "what": "Books delivered." }
```

- `weeks` counts from `dates.start`, which should be a Monday. Week 1 is that
  Monday to the following Sunday. A row naming several weeks gets one range
  spanning them, and a week label like `7–8`.
- `dates` overrides the computed range. Use it where a stage does not end on
  the Sunday of its week — print and freight finishing on a Friday, or a
  delivery window after the production grid has run out.
- Rows with only `dates` print no week number.

## Changing the wording

Edit `proposals/textbook-launch.html` directly. It is ordinary book HTML — the
same markup contract as any other content, described in `references/markup.md`
— with `{{tokens}}` where the deal-specific strings go.

Three template constructs, and no more:

| | |
| --- | --- |
| `{{path.to.value}}` | Substituted and HTML-escaped |
| `{{{path.to.value}}}` | Substituted raw, for pre-built HTML like schedule rows |
| `{{#if path}}…{{/if}}`, `{{#unless path}}…{{/unless}}` | Include a block when a deal value is set |

Use `{{#if}}` to make a section optional rather than keeping two templates.
A book-only engagement with no launch campaign, for instance, can wrap Section
04 in `{{#if launch}}` and leave `launch` out of that deal file.

Watch for words that carry a grammatical article. `On an eight-week schedule`
becomes `On a six-week schedule` — the article changes with the word, so it
travels in the token (`weeksWithArticle`) instead of being typed in the
template. The same trap waits for any a/an, singular/plural, or possessive
that depends on a substituted value.

## Keeping client terms out of the repository

`proposals/deals/` is gitignored. Fees, names and terms belong to the client,
not the repository, and a proposal that has been sent should not be
recoverable from a public branch. `content/proposal-*/` is ignored for the
same reason.

The template and `example-deal.json` are committed — those are the reusable
asset, and the example carries placeholder values only.

## Verifying a template change

After editing the template, rebuild a deal you have already sent and diff it
against what went out:

```bash
node .claude/skills/book-format/scripts/make-proposal.js \
  --deal .claude/skills/book-format/proposals/deals/grinberg.json --out /tmp/rt
diff -u content/proposal-grinberg/index.html /tmp/rt/index.html
```

Identical output means the edit changed only what you intended. This is how
the template was built in the first place — derived from the shipped document
by substitution, then round-tripped until the diff was empty. It caught six
defects on the first pass, including a salutation using the client's full name
where the letter wants the short form, and `a eight-week schedule`.
