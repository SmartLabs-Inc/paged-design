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

### Extent at 7 × 10in, two columns — estimated, then measured

| Region | Estimated | Measured |
| --- | --- | --- |
| Front matter | ~12 | 26 |
| Body | ~383 | 684 |
| Index | ~10 | 20 |
| References | ~187 | 238 |
| **Total** | **~590** | **972** |

The estimate was arithmetic on the word count: 268,411 words at about 700
words to a two-column page. That number is right for solid text and wrong for
this book, which is not solid text. It is 463 entry cards, 928 tracked-out
labels, 136 section openers and 109 sub-section panels that span the measure,
and all of that structure is what makes the book usable at arm's length. The
measured rate is **392 words to the page** — 56% of solid setting. The other
44% is the design.

So 972pp is not waste. Page fill is 90% and only 42 body pages in 684 are
under 70% full, most of those section openers that are meant to be. It is
simply what this design costs, and the decision is editorial rather than
technical.

**If it has to come down**, in order of how little each one costs the reader:

| Lever | Saves | Cost |
| --- | --- | --- |
| References to three columns at 7.5pt | ~50pp | nothing; it is apparatus |
| Tighten entry and label spacing by a third | ~50pp | the grid gets busier |
| Body to 9pt on 11.9pt | ~48pp | a size down, still comfortable |
| All three | ~150pp → **~820** | |
| Two volumes, split at Part IV | — | two spines, two ISBNs |

At 972pp on 50lb the block is about 2.2in — bindable, but it is a case-bound
book with a hinge problem, not a paperback. Confirm with the printer before
locking anything.

## The Markdown changes everything

A second file arrived under the name `Dr_Alexander_Grinberg_CV.md`. It is not
a CV. It is the whole book in Markdown, 424,089 words, and it is a far better
source than the .docx in every way that matters.

**It solves the reference problem outright.** The list is numbered 1–4083 with
3,750 entries, each preceded by its own HTML anchor:

```
<a id="ref-1"></a>

1. Hossain MA, Kocan M, Yao ST, et al. A single-chain derivative of the relaxin…
```

Citations in the text are `[[123]]`, machine-readable and unambiguous. Of
**6,867 citation marks, every single one resolves** — zero unresolved, against
roughly 290 that pointed at nothing in the .docx. Seven references are never
cited, and 333 numbers are skipped in the sequence, neither of which matters.

**It solves the index.** 1,145 entries, each a real link to the anchor of the
entry it indexes:

```
- [3D Bioprinting and Organ Engineering](#f27-3d-bioprinting-and-organ-engineering)
```

No glued-on Word page numbers to strip. The anchors are exactly the mechanism
the folio pass needs: paginate, resolve each anchor to the page it landed on,
write the number in.

**It solves the figures.** The twelve diagrams are SVG, not the flattened
greyscale PNGs the .docx carries, and each has real alt text rather than a
caption baked into the bitmap. Vector means they can be recoloured to the house
palette; the alt text becomes the live caption.

**It removes the style-map problem.** Five clean heading levels — 16 parts and
front-matter sections, 54 sections, 109 sub-sections, 463 entries, 928
sub-headings — so nothing has to be inferred from Word styles at all.

### What the Markdown still needs

* **The SVG files themselves.** The Markdown references them by name
  (`TGF_Beta_Intervention_Points_20260908.svg`); the files were not sent.
* **A table reconciliation.** The .docx has 80 tables; the Markdown has 28 pipe
  tables. Every sampled table's content appears somewhere in the Markdown, but
  not necessarily still shaped as a table. Before committing, walk the 80 and
  confirm which form is authoritative. Bounded work, not a blocker.

### Which source wins

Build from the **Markdown**, and use `md-to-book.js` rather than the .docx
converter. That drops `restyle-aet.py` and the whole style-inference layer from
the print path.

The .docx route still matters for one thing: the Word file the author reviews.
`apply-aalai-template.py` stays for that, fed from the Markdown rather than
from his export.

## The rest of the work, in order

### 1. Convert from the Markdown — half a day

`md-to-book.js` against the five heading levels, with two extra passes: turn
`[[n]]` into a linked superscript pointing at `#ref-n`, and keep the reference
anchors through to the book HTML so the links resolve.

No style map, no restyle, no inference.

### 2. The folio pass — one day

The one piece of machinery that does not exist yet, and now the only thing
standing between us and a finished book. Paginate, resolve every `#ref-` and
`#f…` anchor to the page it landed on, and write the numbers back into the
index and any cross-references. It has to run after pagination settles and
before the final render, which means the build gains a second render.

### 3. Rebuild the index — folds into the folio pass

No longer a separate job. The Markdown index is 1,145 entries already linked
to their targets; the folio pass turns each link into a page number.

### 4. Figures — needs the files

Twelve SVGs, named in the Markdown but not supplied. Once they arrive they can
be recoloured to the house palette by rewriting their fills, and the alt text
sets as the caption. Ask for the SVG source.

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

1. **The twelve SVG files.** Named in the Markdown, not supplied.
2. **Marks linked to a back-of-book list, or footnotes?** Recommend the list —
   the anchors are already there, so the links cost nothing.
3. **~590 pages acceptable?** If not, the references can set smaller or in
   three columns, which takes roughly 60 pages out.

The reference question is closed: the Markdown answers it.
