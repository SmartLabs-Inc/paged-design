# Advanced and Emerging Therapies, First Edition — production plan

Written against the manuscript delivered 15 September 2026
(`Advanced_and_Emerging_Therapies_First_Edition.docx`, 4.0 MB, 1,273 pages
in Word). This is the real book, not the sample we have been rehearsing on.

## What arrived

| | |
| --- | --- |
| Words | 403,705 |
| Top-level blocks | 16,226 |
| Parts / sections / entries | 5 / 27 / 460 |
| Sub-headings under entries | 1,025 |
| Tables | 80 — **none longer than a page** |
| Figures | 12 PNG diagrams |
| Citation marks in the text | 6,409 |
| Reference lines | 6,562 (5,081 citations + 1,481 bare URLs) |
| Index entries | 598 |

### Estimated extent at 7 × 10in, two columns

| Region | Words | Pages |
| --- | --- | --- |
| Front matter | 1,786 | ~12 |
| Body | 268,411 | ~383 |
| References | 130,841 | ~187 |
| Index (rebuilt) | 2,451 | ~10 |
| **Total** | | **~590** |

Word's 1,273 pages are single-column 12pt. Two columns at the house size
roughly halves it. 590pp is a real book but a normal one for a clinical
reference; it binds without trouble.

## The one genuine problem: the reference apparatus

Everything else here is work. This one is a decision, and it blocks the
schedule until the author answers.

The body carries **6,409 citation marks**, using **3,635 distinct numbers**
running up to **4,063**. The reference list cannot currently answer them:

* The list is numbered two different ways. The first ~1,000 entries use
  Word's list numbering, which leaves no number in the text. From roughly
  entry 157 onward the numbers are typed into the text instead —
  `1886. Ji J, Lipkow E, …`.
* Recovering both and interleaving them yields about **3,773 entries**
  against a highest citation of **4,063**. Something in the order of **290
  citations point at nothing**, before counting the 178 numbers genuinely
  absent from the middle of the run.
* Every citation is split across several paragraphs — the citation, then the
  PMID, then the bare URL, each its own paragraph. That is why the list reads
  as 6,562 lines for perhaps 3,800 references.

**None of this is recoverable by guessing.** A citation linked to the wrong
source is worse than one linked to nothing, because it looks right. The
numbering has to be repaired before the apparatus can be built, and the
repair needs the author.

### What to ask Dr. Grinberg for

One clean, continuously numbered reference list, one reference per paragraph,
numbered 1 to N in the text, with the PMID and URL on the same line as the
citation they belong to. If that list is exported from whatever tool holds his
library, this becomes a non-issue in an afternoon.

### How the citations should then behave

Recommended: **superscript marks linked to a numbered list at the back**, not
footnotes.

We built footnotes for the sample and they work, but at this scale they are
the wrong instrument: 6,409 notes averaging twenty words is another 130,000
words competing for the foot of every page, and a source cited five times
becomes five identical notes. A consolidated back-of-book list is what the
genre expects, keeps the extent predictable, and in EPUB the marks become
internal links that behave exactly like the footnotes did.

## The rest of the work, in order

### 1. A new style map — half a day

The vocabulary changed completely. This manuscript uses `Heading 4` for an
entry name, `Heading 5` for the sub-heading inside it, `List Paragraph`,
`Table Paragraph` and a great deal of `Normal`. The `aet` map and
`restyle-aet.py` were written against `EntryName`, `FirstParagraph` and
`Compact` and will not fit. The logic survives; the inputs change.

### 2. Repair the reference numbering — blocked on the author

See above. Until it lands, build the book with the marks left as plain text
so everything else can proceed.

### 3. Rebuild the index — half a day

598 entries, each with the author's Word page number run straight onto the end
of the text: `3D Bioprinting and Organ Engineering731`. The locators have to be
split off and thrown away, and new ones generated from our own pagination —
which means a pass that reads folios back from the paginated book. That pass
does not exist yet; it was on the list before and is now unavoidable.

### 4. Figures — depends on the answer

Twelve mechanism diagrams, greyscale, with their captions baked into the PNG.
For a full-colour AALAI title they should be redrawn in the house palette with
live captions. That is a design job, not a conversion job. The alternative is
to place them as they are and accept grey boxes in a colour book.

Five part-opener figure slots are still empty.

### 5. Build time — plan for it

The sample book was 327 pages and paginated in about fifty seconds. This is
roughly 1.8× the extent with a 25 MB `document.xml`. Expect single renders in
the low minutes, and remember that the widow pass re-paginates on every
attempt. Budget half an hour for a full build and run it in the background.

Worth a smoke test before committing to the approach: convert, paginate once,
confirm Paged.js does not fall over at this size. If it does, the answer is to
build the book in parts and merge the PDFs, which changes the pagination
sequence and the index pass.

## What is already solved

Worth saying, because it was most of the pain last time:

* **Tables.** Eighty of them, largest 13 rows, none over a page. The
  oversized-table problem that needed a landscape-or-appendix decision is
  gone — the author split them.
* **The template.** Styles, theme and fonts come from the AALAI template, so
  the Word file the author reviews looks like the book.
* **The pipeline.** `build-book.js` runs restyle → convert → EPUB → design →
  CSS → widows → render → check in one command.
* **Proofing.** `proof-check.js` reports widows, orphans, broken names,
  stranded headings, short pages, clipped running heads and footer patterns
  against the paginated book rather than the source.

## Decisions needed before we start

1. **The reference list.** Can the author supply a clean, continuously
   numbered export? Everything about the apparatus depends on it.
2. **Marks linked to a back-of-book list, or footnotes?** Recommend the list.
3. **Figures redrawn in the house palette, or placed as they are?**
4. **~590 pages acceptable?** If not, the references can set smaller or in
   three columns, which takes roughly 60 pages out.
