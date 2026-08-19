# The shipped themes

Fourteen themes live in `themes/`. Pick the closest starting point and adapt it —
starting from `template` is only worth it when nothing else is close.

`beatrix` is the default: it is what `new-theme.js`, `render-pdf.js` and
`check-layout.js` assume when no theme is named.

Themes are not universal. Each was written against a particular HTML structure.
The five Ketida themes target the class names a Ketida/Coko export produces
(`section.component-body.chapter` and friends); the five generic themes target
the class names in `references/markup.md`. Using a theme against different HTML
means overriding `_selectors.scss` — see the end of that file.

## Generic themes

These work with the markup contract in `references/markup.md`.

### `template` — shown as "Vanilla"

The unopinionated baseline: default variables, no custom styles, 216 × 280 mm.
Copy it to start a new design. Preview with `content/samples`, which exercises
every supported book feature.

### `beatrix`

Classic children's/short-fiction paperback. 111 × 178 mm (a small pocket trim),
Vollkorn text with a Fondamento display face, 10 pt on 15 pt, justified,
indented paragraphs, chapters on recto. Preview with
`content/alice-in-wonderland`.

Start here for: novels, short stories, anything narrative and single-column.

### `density`

Space-age look for large reference books. 177.8 × 254 mm, Roboto Slab text with
Bungee Hairline display, 9 pt on 13 pt, ragged right. The heaviest custom
styling of the generic themes. Preview with `content/the-future-of-ideas`.

Start here for: dense non-fiction, technical books, anything with a lot of
apparatus.

### `plastered`

Deliberately wild and wonky — attention-grabbing display type, asymmetric
margins (24 mm outside, 15 mm inside). 129 × 198 mm, PT Serif on ZCOOL KuaiLe,
9 pt on 14 pt, justified. Preview with `content/little-brother`.

Start here for: zines, manifestos, anything that should look loud.

### `aalai`

A 7 × 10in academic textbook for scientific and clinical reference works,
built to an InDesign prototype. Navy `#0D2035` and teal `#137C7A` with a gold
accent; Georgia for text and headings, a grotesque sans for labels and
apparatus; spaced paragraphs, ragged right, hyphenated.

Beyond the usual book features it styles a component set textbooks need:
chapter eyebrow and gold rule, learning objectives, tinted and dark callouts
with labels, an evidence table with a navy header and zebra rows,
evidence-classification chips (`.level-established` through
`.level-experimental`), side-by-side panels from single-row Word tables, figure
placeholders, and chapter-summary takeaways.

Pairs with the `aalai` style map, so a Word manuscript written against the AALAI
template converts and lays out with no hand-tagging. Preview with
`content/aalai-sample`.

Start here for: short and mid-length textbooks, sample chapters, proposals and
specimens — anything where the design system matters more than the extent.

Know before you pick it for a long book: the body sets 9 pt across a 5.66in
column, which measures out at a median of **109 characters a line** on real
manuscript text. A book sets 60 to 70. At that measure the type is doing the
work of an A4 report, and a long reference work set in it reads as a Word
document no matter what components are on the page. `aalai-textbook` is the
same design with that fixed.

### `aalai-6x9`

The same design at 6 × 9in, the standard trade and academic trim and the one a
short-run digital printer quotes cheapest. Palette, type scale, components and
running feet are all inherited; only the geometry and two component layouts
differ. Preview with `content/aalai-6x9-sample`, a specimen chapter that
exercises every component in the design.

Text width lands at 117 mm, about 68 characters a line. That measure is what
forces the two changes:

- **The side callout tucks into the text.** At 7 × 10in `.sidenote` floats right
  at 34% and the text runs past it in a 95 mm column. The same float here leaves
  77 mm — near forty characters — which cannot rag or hyphenate cleanly. So the
  note stops floating and becomes an inset block, stepped in from both edges,
  keeping the teal rule. Both edges, not just the left: one indent would leave a
  full-measure line of small type running to eighty-odd characters, worse than
  the float it replaced.
- **The process row wraps two by two.** Four steps across 117 mm gives each 27 mm,
  narrower than the words inside them.

A trap this theme demonstrates: `.columns > *` sets `flex` on every child at one
class of specificity, so a bare `.level` rule tying the evidence chip to a fixed
width is decided by file order, not intent — and it lost silently until the page
was rendered and looked at. Scoped selectors (`.columns > .level`) cannot be
reordered into failure. Same failure mode as `.pillar p` beating `.pillar-title`
in the print theme.

Start here for: the same house design on a trade-sized book, or any AALAI title
where 7 × 10in is more page than the content needs.

## Ketida / textbook themes

These five target Ketida platform HTML and preview with
`content/ketida-sample-with-parts`. They all use a **baseline grid**: a single
`$baseline-grid-unit` in px drives line height, margins, and spacing, and a
`postlayout` script (`js/baseline-grid.js`) snaps content to it. They also run a
`prelayout` script (`js/headers.js`) that tags `<header>` elements with their
heading level.

Sizes in px, not pt — Paged.js renders px accurately.

| Theme | Trim | Type | Paragraphs | Character |
| --- | --- | --- | --- | --- |
| `apollo` | 210 × 297 mm (A4) | Crimson Pro / Inter | spaced | Elegant, conservative |
| `aphrodite` | 152 × 228 mm | Gelasio | indented | Bright, wavy |
| `demeter` | 178 × 254 mm | Crimson Pro / Jost | spaced | Smart, sleek |
| `gaia` | 216 × 280 mm | Crimson Pro / Inter | indented | Gentle, quirky |
| `zeus` | 189 × 246 mm | Barlow | indented | Strong, blocky |

All five put the sidebar outside with a 0 mm outer margin, so marginal notes,
figures, and headings can hang into the outside column.

`gaia` and `zeus` have the most elaborate partial structure
(`partials/platform/` for the HTML-shape rules, `partials/theme/` for the design)
and are the best models for a large, feature-rich textbook design.

## Registering a theme

A theme directory needs:

```
themes/my-theme/
  main.scss          # imports defaults, then this theme's files
  _variables.scss
  _selectors.scss
  _styles.scss
  theme.json         # { "name": "My Theme" }  → the display name
  screenshot.jpg     # optional, for the demo site gallery
  js/                # optional prelayout/postlayout scripts
```

`theme.json` declares scripts if the theme needs them:

```json
{
  "name": "My Theme",
  "scripts": {
    "prelayout":  ["headers.js"],
    "postlayout": ["baseline-grid.js"]
  }
}
```

`prelayout` scripts run before Paged.js paginates; `postlayout` after.

`node js/build.js` compiles every theme and regenerates `js/themes.json`, which
is what populates the demo site's theme switcher. A theme without a `theme.json`
compiles but does not appear in the switcher.

Add the theme to the gallery in `index.html` if it should show on the demo site.

### `aalai-textbook`

The AALAI design at 7 × 10in again, rebuilt for a long illustrated reference
work rather than a specimen. Palette, components and style map are inherited
from `aalai`; what changes is the grid and the apparatus. Built against a
285-page clinical reference of 333 entries and 87 figures.

**The grid.** Two columns, justified, 10 pt body — a measured median of 50
characters a line, against the parent's 109 in one wide column. Two columns are
what a reference textbook is set in and the reason is the measure: a single
column fixes a 109-character line by shortening it and spends a great deal of
paper doing so, while two columns fix it by using the width the trim already
has. The same text ran 432 pages in one column and 285 in two.

**The apparatus**, all of it added on top of `aalai`:

- **Full-width section openers.** A disclaimer or a methodology note is a
  section in its own right: its title and standfirst run the whole text block
  and the body sits in two balanced columns beneath. A heading group that
  introduces a full-width table spans too — a topic head set in a 64mm column
  above a table running the full 133mm reads as belonging to a different page.
- **`.part-panel`** — the part opener carries its contents as a ruled panel with
  a mark beside the label, the shape a textbook uses for its objectives box.
  `.needs-copy` marks the subtitle and standfirst the manuscript does not have,
  the same way a figure slot marks a missing picture.
- **`.tight`** — a leading reduction the build applies where it measures that a
  section overspills its last page by a little. Applied by measurement, not by
  eye: mark, re-render, and keep the mark only where the section really did come
  in shorter.

- **`.entry`** — a card for the unit a reader looks things up by: a teal rule
  down the side, the name in sans, and a number badge counted within the topic.
  A rule and not a tinted box, because three hundred tinted boxes is a grey
  book; the tints stay for callouts, where they still mean something.
- **`.figure` / `.figure-slot` / `.figure-brief`** — a sized empty box for a
  picture that does not exist yet, with the commissioning brief printed under
  the caption and carried on the figure element as `data-alt`, ready to become
  the `img` alt attribute. Slots come in three sizes: part opener, spanning,
  and single column.
- **`.part-title` / `.section-head` / `.apparatus-head`** — a manuscript that
  uses `h2` for both the part and the sections inside it loses its top two
  levels at a stroke. These separate them; `.section-head` takes a page break,
  `.apparatus-head` (References and the like) deliberately does not.
- **`.part-contents`** — the part opener lists its sections with entry counts,
  read off the manuscript at build time so they cannot drift.
- **A fore-edge thumb index** — a coloured tab in a page margin box, a different
  colour and vertical slot for each part, so the closed book carries a staircase
  down its edge. This needs a named page per part (`.chapter.part-3`), because a
  margin box cannot know which chapter it is on, and a named page does not
  inherit `@page chapter`'s content — the `part-page` mixin restates it.
- **Running heads** — the topic across the top outside, the part along the foot.
- **`.cite`** — reference marks raised and reduced instead of set inline at body
  size.
- **`.table-figure`** — a table whose caption is the table's own `<caption>`
  element, so it cannot be left at the foot of a column while the table starts
  the next one.
- **Back matter that works.** Reference lists are collected out of the chapters
  into one section at the back, grouped by the part and section they came from
  so no number in the text changes. The index gets real page numbers, found by
  paginating the book, reading the text of every page, and writing the folios
  back — including roman folios where a term lands in the front matter.
  Neither is justified: they are lists of unlike things, most of them shorter
  than a line, and justified the short ones stretch to the measure.
- **Structure plates** — one per peptide topic rather than one per entry: every
  molecule of a therapeutic area drawn to one scale so they can be compared,
  which is the point of grouping them. Three hundred single structures would be
  a third of the book.

**What spans the columns and what does not.** Running prose is in the column;
anything a reader is meant to stop at goes across the page — shaded boxes,
tables, figures, pull quotes and every heading above the entry. Those only read
as breaks if they are wider than what surrounds them. The panel grids
(`.columns`, `.process`) are the exception and stack inside one column instead:
left spanning, each pathway entry of the cross-reference chapter filled a fifth
of a page and pushed the rest to the next, and thirty-nine consecutive pages
came out four-fifths empty.

Six things this theme learned the hard way, all verified by rendering or by
measuring in the browser:

- **Do not border and pad a container that fragments.** The entry card's rule
  was first drawn on the `.entry` wrapper. Paged.js splits a paragraph inside a
  bordered, padded box into its internal column set and then reports the
  paragraph as running past the trim. Bordering the children instead leaves no
  fragmenting box and the page looks identical.
- **Chromium here cannot hyphenate.** `hyphens: auto` is inert without a
  hyphenation dictionary, and a headless container has none — measured
  directly: a narrow box of long words is exactly the same height with
  `hyphens: auto` as with `hyphens: none`. Justified text at fifty characters
  needs hyphenation or it opens rivers, so the break opportunities are put in
  the document as soft hyphens at build time. That is the better answer anyway:
  a print book's line breaks must not depend on which machine made the PDF.
- **Do not hyphenate an HTML entity.** A soft hyphen inside `&middot;` stops it
  being an entity, and it prints as literal text.
- **Paged.js does not resolve `attr()` inside `string-set`.** Stamping the part
  name onto a `title` attribute and reading `string(h2-title, first)` gave an
  empty foot on every page. A zero-size `h1` carrying the part name works: an
  element that is not laid out never sets its string, so `display: none` is not
  an option.
- **A page margin box gets a third of the text width and no more**, so a
  running head in tracked-out capitals wraps. Mixed case at 7.5 pt fits.
- **`break-after: avoid` works at a column break and not at a page break.** The
  columns are native CSS multicol laid out by the browser; it is Paged.js's own
  page fragmentation that ignores it. Entry headings and standfirsts are held to
  what follows them on that basis, and the handful that still strand are
  stranding at page boundaries. Where a break must never happen — a table and
  its caption — use structure rather than a hint: a `<caption>` is part of the
  table's box and cannot be separated from it at all.
- **A page margin box wraps inside a `.pagedjs_margin-content`.** Setting
  `white-space: nowrap` on the `@top-left` box does nothing; Paged.js paints the
  generated content into a child element and that is what wraps. Set it there,
  and shorten the string at build time as well — a box a third of the text block
  wide holds about 28 characters at 7.5pt, and clipping a title mid-word is not
  a fix.
- **Nothing tracked-out is ever justified.** A label is a few words in capitals
  with letter-spacing already added; asked to justify, it puts the rest of the
  measure into the word gaps.

A trap it repeats from the 6 × 9in theme: the default theme centres every
paragraph inside a figure (`figure p, .figure p`), which at one class and one
element outranks a bare `.figure-brief` — so the commissioning note set centred
while the rule said left, and it lost silently until the page was rendered.
Scoping to `.figure > .figure-brief` fixes it. Same failure mode as
`.columns > *` beating `.level`.

Start here for: long clinical or scientific reference works, textbooks with an
entry structure, anything over about 200 pages in the AALAI house style.

### `aalai-6040`

The AALAI apparatus on an asymmetric grid: one text column at sixty per cent of
the text block, and a margin column at forty beside it carrying the callouts,
the figures and the entry names. Inherits everything from `aalai-textbook` and
then undoes the even two columns.

The margin column is not white space. On this manuscript it holds the name of
every entry, which is the thing that appears on every page — the text column
carries the argument unbroken and the margin becomes a column of names a reader
can run a finger down. Without that the grid does not pay for itself here: a
hundred figures across four hundred pages would leave two fifths of the paper
empty, which is worse than an even two-column page rather than better.

Measured: 87.5mm text column, about 62 characters at ten point, against 47 in
two even columns. It costs paper — the same book runs 315 pages set in two
columns and 429 set this way. That is the trade, and it is the client's.

Three things worth knowing if you adapt it:

- **A margin column is a float with a negative margin, not a second column.**
  CSS multi-column cannot make columns of different widths, so the flow gets a
  padding on the outside edge and the apparatus floats into it. Both have to be
  mirrored on Paged.js's own `.pagedjs_left_page` / `.pagedjs_right_page`
  classes, because the outside edge changes side at every turn.
- **Things that break out do it with a negative margin** on the outside edge:
  full-width tables, part titles and section heads reclaim the margin column
  for their own width and the text closes back over them.
- **The index and the reference list keep two even columns of their own.** They
  are look-up tables, not argument, and the margin has nothing to add to them.

Start here for: a reference work whose apparatus is heavy enough to fill a
margin column on most spreads, or a design that wants a wide measure for
continuous prose.
