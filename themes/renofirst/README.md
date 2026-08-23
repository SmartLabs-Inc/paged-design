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

Gold `#f5a623` and navy `#14395f` are the Reno First brand colours; sand
`#fdf5e8` is the tint they generate, and it does one job throughout the
workbook: **anything printed sits on white, anything the reader fills in sits
on sand.**

- Display: Archivo (variable, 400–800)
- Text: Source Serif 4 (variable, roman and italic)
- Wordmark script: Yellowtail

Fonts are stored in `fonts/` and declared in `partials/_fonts.scss` rather
than linked from Google, as the project README recommends for production: an
upstream font change can reflow a whole book. Licences are alongside the
files (OFL for Archivo and Source Serif 4, Apache 2.0 for Yellowtail).

## Components

| Selector | What it is |
| --- | --- |
| `.chapter-opener` | Navy panel: eyebrow, title, gold rule, chapter summary, ghost numeral from `data-numeral` |
| `.worksheet-header` | Light opener for planner pages |
| `.pros-cons` | Paired advantages/disadvantages panels — Chapter 1 compares seven structures |
| `ul.checklist` | End-of-chapter checklists, with drawn tick boxes |
| `.directory-entry` | Agency listings in Appendices B and C |
| `.reno-tip` | Local practical advice, reversed out of navy |
| `.context-note` | A Nevada-specific aside, gold rule on sand |
| `.verify-note` | A ◇ figure that will change |
| `table.form-table` | Worksheet forms; `td.fill` marks a write-in cell |
| `table.check-table` | Forms with a tick column |
| `.write-in` / `.prompt-box` | Ruled answer areas |

## Notes for anyone editing this

- The brand lockup on the cover and title page (`.brand-lockup`) is set in
  type as a stand-in. Drop the real logo in as
  `<p class="title-page-logo"><img …></p>` when the artwork is available.
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
