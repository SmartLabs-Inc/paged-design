# Reno First

An 8.5 × 11in (US Letter) design for a reference guide that ships with a
companion workbook. Built for *How to Start a Business in Reno, Nevada* and
*The Reno Launch Planner*, in `content/reno-first`.

Preview: <http://localhost:5000/content/reno-first/index.html?theme=renofirst>

## The page

```
 ┌──────────────────────────────────────────────┐
 │            running head + gold rule          │  20mm
 │ ┌───────────────────────────┬──────────────┐ │
 │ │                           │              │ │
 │ │      text block           │  marginalia  │ │
 │ │      129.9mm              │  column      │ │
 │ │                           │  43mm        │ │
 │ │                           │              │ │
 │ └───────────────────────────┴──────────────┘ │
 │                                              │  20mm
 └──────────────────────────────────────────────┘
   23mm inside                    50mm     13mm
```

Letter is a wide page, so the text block is held to about 5.1in — roughly 72
characters at 10.5pt — and the space left over becomes a working outer column
rather than dead margin. Three things live there:

- `.margin-note-key` — a fact lifted out of the text, over a gold rule
- `.margin-note-ref` — a pointer to a worksheet or an appendix
- `.margin-note-verify` — a figure the reader has to re-check at the source

Chapter openers, checklists, advantage/disadvantage panels and full-page
figures reach across the text block *and* the column, stopping at the true
outer margin (`full-measure()` in `partials/_mixins.scss`).

Worksheet pages give the column up entirely and use the whole 180mm measure —
they are for writing on, not for reading around.

## Colours and type

**Two colours, both sampled from the Reno First mark: gold `#fbae06` and navy
`#02305f`.** Nothing else is invented. Every other value in `_variables.scss` is one of those two
mixed toward white or black, or laid over the page at reduced opacity — so the
whole book re-tunes from two lines, and no third hue can creep in.

The gold is what carries the design. It rules the headings, marks the
checkboxes and margin notes, and — at 13% over white — fills every surface the
reader writes on. That gives the workbook its one structural rule: **anything
printed sits on white, anything you fill in sits on gold.** Panels that are
there to be read rather than written on use the same gold a little stronger
(19%), so the two never get confused.

- Display: Archivo (variable, 400–800)
- Text: Source Serif 4 (variable, roman and italic)

Fonts are stored in `fonts/` and declared in `partials/_fonts.scss` rather
than linked from Google, as the project README recommends for production: an
upstream font change can reflow a whole book. Licences (OFL) sit alongside the
files.

## The logo

The mark is placed as supplied artwork, from two files:

```
content/reno-first/images/reno-first-logo.png           full colour, on white
content/reno-first/images/reno-first-logo-reversed.png  on the navy ground
```

Both are in place, supplied at 600 × 266px. There is deliberately **no
type-set substitute**: if a file goes missing the slot stays empty rather than
standing in a lookalike lockup. `.reno-first img.title-page-logo` sizes on
width, so replacement artwork drops in without retouching.

At the size the mark sits on the title page (62mm) the supplied 600px files
work out to about 245 dpi. That is fine for this placement but under the 300
dpi you would normally want for print — worth swapping in a larger master
before a real print run.

## Page perfecting

Two typesetting rules are enforced. Both are checked against the rendered
pages before the book is considered done — paginate in Chrome, then measure
every `section.section` fragment:

**A section may not begin in the last ten lines of a page** (a subsection, the
last five). The clearance is added as `padding-bottom` on the heading, which
makes its box too tall to fit into a short remainder, so paged.js moves the
whole heading to the next page; a matching negative `margin-bottom` pulls the
following copy back up, so the printed spacing is unchanged. `break-inside:
avoid` stops paged.js splitting the padding instead. See `needs-room-below()`
in `partials/_typography.scss`.

Any rule that overrides a heading's margin must also reset its
`padding-bottom`, or it will inherit that clearance as a gap — `.field-label`,
`.editors-heading` and `.entry-name` all do.

**No section may leave a tail of three lines or fewer alone on a new page.**
Where the clearance rule does not already resolve this, the build tightens the
offending section a notch — a little out of the leading and the space between
paragraphs, at three escalating levels (`.tighten-1` … `.tighten-3`). The
levels chosen are recorded in `content/reno-first/perfect.json` and written
into the markup as classes, so the committed HTML is reproducible rather than
hand-nudged. As the book currently stands the clearance rule alone is enough:
that file is empty and no section is tightened.

## Components

| Selector | What it is |
| --- | --- |
| `.chapter-opener` | Navy panel: eyebrow, title, gold rule, chapter summary, ghost numeral from `data-numeral` |
| `section.section` | One h2 and the copy under it — the unit the page-perfecting pass tightens |
| `.worksheet-header` | Light opener for planner pages |
| `.pros-cons` | Paired advantages/disadvantages panels — Chapter 1 compares seven structures |
| `ul.checklist` | End-of-chapter checklists, with drawn tick boxes |
| `.directory-entry` | Agency listings in Appendices B and C |
| `.reno-tip` | Local practical advice, reversed out of navy |
| `.context-note` | A Nevada-specific aside, gold rule on a gold wash |
| `.verify-note` | A ◇ figure that will change |
| `table.form-table` | Worksheet forms; `td.fill` marks a write-in cell |
| `table.check-table` | Forms with a tick column |
| `.write-in` / `.prompt-box` | Ruled answer areas |

## Notes for anyone editing this

- Paged.js reads `page` and `break-before` in source order, and skips an
  explicit page break when it thinks the named page is about to change. Named
  pages are therefore declared *before* their breaks in
  `partials/_page-setup.scss` — reverse them and consecutive worksheets run
  together on one page.
- The default `themes/_defaults/partials/_toc.scss` sets a `target-counter()`
  rule at the same specificity as a theme rule on `.contents-page a::after`.
  Two competing rules leave the page numbers unresolved, so this theme
  overrides the default's own selector instead of adding a rival one.
- Paged.js lays @page margins out as grid tracks around the page area, so the
  area's padding is the marginalia column *only* — the outer margin is
  already reserved.
- Paged.js does not resolve the defaults' multi-value `string-set`
  (`h1-text content(), h1-title attr(title)`), so `string(h1-title)` comes
  back empty and running heads go blank. Use `string(h1-text, first)` and size
  the running head to fit the longest title in the book.
