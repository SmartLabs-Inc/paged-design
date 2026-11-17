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

Every worksheet is followed by ruled Notes pages that belong to it: one page
per page of worksheet, with one as the floor. That keeps each worksheet and its
notes to an even number of pages, so the planner holds the same hand all the
way through — the sheet on the verso, somewhere to write facing it on the
recto. The counts are measured from the rendered book and recorded in
`content/reno-first/notes.json`, the same way the page-perfecting levels are.

## Colours and type

**Two colours, both sampled from the Reno First mark: gold `#fbae06` and navy
`#02305f`.** Nothing else is invented. Every other value in `_variables.scss` is one of those two
mixed toward white or black, or laid over the page at reduced opacity — so the
whole book re-tunes from two lines, and no third hue can creep in.

The gold is what carries the design. It sets every title in the book — chapter,
part, appendix and worksheet — closes every section with a rule, marks the
checkboxes and margin notes, and, at 13% over white, fills every surface the
reader writes on. That gives the workbook its one structural rule: **anything
printed sits on white, anything you fill in sits on gold.** Panels that are
there to be read rather than written on use the same gold a little stronger
(19%), so the two never get confused.

Navy is the reading colour: body text, section headings, table heads, and the
ground the chapter and part titles are reversed out of.

Every piece of gold **type** in the book is the brand gold itself, undarkened —
no near-miss stands in for it anywhere. The one value derived from it is
`$reno-gold-tick`, a notch darker, used only for the 1px outline of a drawn
tick box, which needs the extra weight to read on white.

- Display: Archivo (variable, 400–800)
- Text: Source Serif 4 (variable, roman and italic)

Fonts are stored in `fonts/` and declared in `partials/_fonts.scss` rather
than linked from Google, as the project README recommends for production: an
upstream font change can reflow a whole book. Licences (OFL) sit alongside the
files.

## The cover

The cover is supplied artwork, not type set here:

```
content/reno-first/images/reno-first-cover-2027.jpg   2550 x 3300px, 300 dpi
```

It is a flat 8.5 x 11in file at exactly the trim size, placed edge to edge by
`.cover-art` in `partials/_frontmatter.scss`. Reproducing it in CSS would mean
the printed cover could drift from the file the client approved, so the file
*is* the cover; `object-fit: cover` means a replacement that is not exactly the
trim size fills the page rather than distorting. A new cover drops in by
replacing the file and the one `src` in `content/reno-first/index.html`.

Note that the cover carries its own skyline, drawn as line art. The part pages
still use the filled gold silhouette in `reno-skyline-gold.png`. If the line
art is the brand's new treatment rather than a cover-only one, the part pages
should follow it.

## The logo

The mark is placed as supplied artwork, from two files:

```
content/reno-first/images/reno-first-logo.png           full colour, on white
content/reno-first/images/reno-first-logo-reversed.png  on the navy ground
```

Both are in place, supplied at 600 × 266px, and are used on the title page and
in the planner — the cover carries its own lockup inside the artwork. There is
deliberately **no type-set substitute**: if a file goes missing the slot stays
empty rather than standing in a lookalike lockup. `.reno-first
img.title-page-logo` sizes on width, so replacement artwork drops in without
retouching.

At the size the mark sits on the title page (62mm) the supplied 600px files
work out to about 245 dpi. That is fine for this placement but under the 300
dpi you would normally want for print — worth swapping in a larger master
before a real print run.

## The press build

`themes/renofirst-press` is the same design with 0.125in bleed and crop
marks, for the printer:

```
content/reno-first/index.html?theme=renofirst-press
```

It imports this theme wholesale and overrides three variables — `$bleed`,
`$crop-marks` and `$font-path` — so the design has one source and the two
builds cannot drift. Paged.js grows the sheet to 222.3 × 285.8mm and keeps the
page box at trim, which means a page meant to print edge to edge still stops at
the trim line; `partials/_bleed.scss` pushes the cover and the part pages out by
the bleed distance and stops the boxes above them clipping. Anything anchored to
the trim edges — the part pages' copy block — is moved in by the same amount so
it does not drift toward the cut.

### Before a file goes to a printer

**The cover artwork has no bleed — replacement artwork is on order.** The file
in hand is exactly 8.5 × 11in, the trim size. Until the bleed version lands the
press build fills the bleed with `object-fit: cover`, which scales the design
up about 3% and loses 0.125in off every edge; nothing important sits that close
to the edge, so it holds, but it is a stopgap and should not go to press.

The replacement needs to be:

| | |
| --- | --- |
| Artwork size | **8.75 × 11.25in** — 2625 × 3375px at 300 dpi |
| Trim | 8.5 × 11in, centred in the artwork |
| Bleed | 0.125in on all four sides, with the design run into it |
| Safe area | keep the logo, the edition line and the subtitle at least 0.25in inside trim |
| Ground | `#012245`, as supplied; ask the printer whether they want it converted to CMYK or will convert from RGB |
| Format | PDF, or PNG/JPEG at 300 dpi |

Dropping it in is a file swap and one `src` in `content/reno-first/index.html`.
No CSS changes: the same asset serves both builds, because the review build
crops it back to trim, which is exactly the trimmed view.

**Whether the cover belongs in this file is still open.** Perfect-bound books
are usually printed as an interior PDF plus a separate cover file carrying back
cover, spine and front as one spread; the spine width depends on the page count
and the paper stock, so it cannot be set here. If the printer wants it that
way, the cover comes out of the interior build and the book starts at the
half-title.

**The navy is settled: `#02305f` stays.** The cover artwork's ground is
`#012245`, which is a shade deeper. That is a cover-only ground, not a change
to the brand colour, so the interior is unchanged and the cover prints as
drawn.

## Page perfecting

How a section is set off, and two typesetting rules. Both rules are checked
against the rendered pages before the book is considered done — paginate in
Chrome, then measure every `section.section` fragment:

**A section closes with its rule, rather than the next one opening with it.**
The gold rule is a `border-bottom` on `section.section`, so it prints where the
section *ends* — at the foot of the previous page when the next section starts
a new one — and a section that opens at the top of a page has no rule stacked
under the running head's. Paged.js unsets margins and padding on the fragments
of a split box but leaves borders alone, so the theme zeroes the border on
`[data-split-to]`; without that a section running over a page would print its
closing rule at the foot of every page it touches.

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
hand-nudged. As the book currently stands seven sections are tightened, none
past level 2.

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
| `.field-panel` | Detail on one side, a box to write in on the other; `.field-panel-check` adds a tick |
| `.write-in` / `.prompt-box` | Ruled answer areas |
| `.notes-page` | A page of ruled lines belonging to the worksheet before it |

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
- Word's own answer space is either a sliver of a table cell beside the
  question or a run of underscores inside it, and neither is enough to write
  in. Where that matters the build sets the table as a `.field-panel` instead —
  question on one side, an open gold box on the other. Which tables get that
  treatment is listed in `PANELS` in the build script, keyed by worksheet title
  and field label.
- Paged.js does not resolve the defaults' multi-value `string-set`
  (`h1-text content(), h1-title attr(title)`), so `string(h1-title)` comes
  back empty and running heads go blank. Use `string(h1-text, first)` and size
  the running head to fit the longest title in the book.
