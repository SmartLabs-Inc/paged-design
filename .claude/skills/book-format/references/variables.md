# Theme variables

Every variable below is declared with `!default` in
`themes/_defaults/_variables.scss`. To change one, copy it into
`themes/<theme>/_variables.scss` **without** `!default` — the theme's file is
imported after the defaults, so a plain assignment wins.

Do not edit `themes/_defaults/`. It is the fallback every theme inherits.

## Page setup

| Variable | Default | Notes |
| --- | --- | --- |
| `$page-width` | `216mm` | Trim width |
| `$page-height` | `280mm` | Trim height |
| `$margin-top` | `45pt` | |
| `$margin-bottom` | `60pt` | Bigger than top — leaves room for folios |
| `$margin-inside` | `15mm` | Spine side; larger than outside on thick books |
| `$margin-outside` | `15mm` | |
| `$bleed` | `0` | Set (e.g. `3mm`) when art runs off the trim |
| `$trim` | `0` | Paper size beyond trim |
| `$crop-marks` | `crop` | `crop` or `none` |
| `$colorspace` | `rgb` | `rgb`, `cmyk`, or `gray` — printers usually want `cmyk` |

Common trim sizes: A5 `148mm × 210mm`; Demy `135mm × 216mm`; US Trade
`152mm × 229mm` (6" × 9"); US Letter `216mm × 280mm`.

Margins go into `@page :left` / `@page :right`, not `@page`, because Paged.js
requires it. This is already handled in `partials/_page-setup.scss`.

## Sidebar (scholarly margin column)

| Variable | Default | Notes |
| --- | --- | --- |
| `$sidebar-width` | `45mm` | Taken out of the text area |
| `$sidebar-position` | `outside` | `outside`, `left`, `right`, `none` |
| `$sidebar-gap` | `5mm` | |

Use the `move-to-sidebar($selector, $shift-outwards)` mixin to push an element
into the column.

## Type

| Variable | Default | Notes |
| --- | --- | --- |
| `$font-text-main` | `"Crimson Pro", serif` | Running text |
| `$font-text-secondary` | `"Lato", sans-serif` | Captions, notes, boxes |
| `$font-display-main` | `"Lato", sans-serif` | Headings |
| `$font-display-secondary` | `"Lato", sans-serif` | Subheads, folios |
| `$font-code` | `"Inconsolata", monospace` | |
| `$font-size-default` | `11pt` | |
| `$line-height-default` | `15pt` | The unit the whole design should be built from |
| `$text-align-default` | `justify` | `justify` or `start` |
| `$font-size-smaller` | `0.8` | *Ratio*, not a size |
| `$font-size-larger` | `1.4` | *Ratio*, not a size |

When Paged.js is the rendering target, **px is more accurate than pt** — themes
that need a strict baseline grid (Gaia, Zeus) set sizes in px and derive
everything from one `$baseline-grid-unit`.

Derive spacing from `$line-height-default` (`$line-height-default / 2`, `* 2`)
rather than typing new values. Any spacing that is not a multiple of the line
height breaks line alignment across a spread.

## Paragraphs

| Variable | Default | Notes |
| --- | --- | --- |
| `$paragraphs` | `indented` | `indented` or `spaced` |
| `$text-indent` | `11pt` | Usually one em of the text size |
| `$text-spacing` | `$line-height-default` | Space between paragraphs when `spaced` |

Fiction and most trade non-fiction use `indented`. Reference and textbooks often
use `spaced`. Do not use both.

## Page breaks and numbering

| Variable | Default | Notes |
| --- | --- | --- |
| `$chapters-start-on` | `recto` | `recto` (right page, conventional), `auto`, `verso` |
| `$frontmatter-page-numbers` | `lower-roman` | Numbering style for `.frontmatter` pages |

`recto` inserts blank verso pages where needed. That is correct for print and is
the usual cause of "why are there blank pages?"

## Running heads and folios

Twenty margin boxes per page, each a separate variable, in four families:

```
$verso-<position>              # left-hand body pages
$recto-<position>              # right-hand body pages
$verso-<position>-frontmatter  # left-hand frontmatter pages
$recto-<position>-frontmatter  # right-hand frontmatter pages
```

`<position>` is one of: `top`, `top-left`, `top-right`, `top-left-corner`,
`top-right-corner`, `bottom`, `bottom-left`, `bottom-right`,
`bottom-left-corner`, `bottom-right-corner`. (`top`/`bottom` mean the centre
box.)

Values:

| Value | Result |
| --- | --- |
| `normal` | Empty |
| `counter(page)` | Page number |
| `counter(page, lower-roman)` | Page number in a given style |
| `"Any phrase"` | Literal text (double quotes required) |
| `"\2003"` | Em space, or any CSS/ISO entity |
| `string(h1-text, last)` | Text of the last `h1` on the page — a running head |
| `string(h1-text, first)` / `(…, start)` | First heading on the page / carried from the previous page |

Increment `h1-text` to `h2-text`…`h6-text` for lower levels. Use
`string(h1-text, …)`, not `element()`.

Defaults put a page number bottom-centre on every page and nothing else. A
conventional book design is:

```scss
$verso-top-left: counter(page);
$verso-top-right: string(h1-text, last);   // book or part title
$recto-top-left: string(h2-text, last);    // chapter title
$recto-top-right: counter(page);
$verso-bottom: normal;
$recto-bottom: normal;
```

Chapter-opening and standalone pages suppress their margin boxes automatically.

## Colour and rules

| Variable | Default |
| --- | --- |
| `$color-text-main` | `black` |
| `$color-text-secondary` | `darkgrey` |
| `$color-light` | `#eee` |
| `$color-mid` | `grey` |
| `$color-accent` | `#C74F32` |
| `$color-links` | `inherit` |
| `$border-radius` | `0.1em` |
| `$rule-thickness` | `0.5pt` |
| `$text-divider` | `""` | Generated content for `hr`, e.g. `"❦"` |

For print, set `$colorspace: cmyk` and express colours the printer expects. A
one-colour book should use `black` and greys only — a "black" that is actually
`#222` prints as four-colour grey.

## Layout details

| Variable | Default | Notes |
| --- | --- | --- |
| `$start-depth` | `$line-height-default * 5` | How far down chapter openers start |
| `$locales-page` | `"page"` | Translate for non-English books |
| `$edition-suffix` | `null` | Suffix scoping classes to one edition, e.g. `-large-print` |

## Hyphenation and justification

| Variable | Default | Notes |
| --- | --- | --- |
| `$hyphenation` | `manual` | `auto`, `none`, or `manual` (breaks only on real and soft hyphens) |
| `$hyphenate-after` | `3` | Minimum letters carried to the new line |
| `$hyphenate-before` | `3` | Minimum letters left before the hyphen |
| `$hyphenate-lines` | `2` | Preferred maximum consecutive hyphenated lines |

Justified text without hyphenation produces rivers. If `$text-align-default` is
`justify`, set `$hyphenation: auto`.

## Mixins

Defined in `themes/_defaults/partials/`, available in `_styles.scss`:

`h1()` `h2()` `h3()` `h4()` `h5()` `h6()` `p()` `list()` `ol()` `ul()`
`definition-list()` `blockquote()` `links()` `source()` `image-spacing()`
`move-to-sidebar($selector, $shift-outwards: 0px)`

Use them to give an element another element's appearance while keeping correct
semantics:

```scss
.subheadline { @include h2(); }     // a <p> that looks like a heading
.dedication  { @include source(); }
```

This is the intended way to reconcile semantic HTML with visual hierarchy — for
example frontmatter titles that are `h1` semantically but must look like `h2`.

## Custom variables

Themes may declare their own (Gaia's `$baseline-grid-unit`, `$box-padding`,
`$theme-circle-size`). Declare them at the top of the theme's `_variables.scss`
and derive the standard variables from them.
