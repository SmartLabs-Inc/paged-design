# The shipped themes

Ten themes live in `themes/`. Pick the closest starting point and adapt it —
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

Start here for: textbooks, clinical or scientific reference works, anything with
heavy apparatus and a house style to match.

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
