# Troubleshooting

## Paged.js limitations to design around

These are current gaps in Paged.js, not bugs in a theme. Do not spend time
trying to make them work.

| Feature | Status | Work around it by |
| --- | --- | --- |
| `float: top` / `float: bottom` | Not supported | Let figures sit inline; place them at natural breaks |
| Page footnotes (`@footnotes`) | Not supported | Collect notes at the end of each component; the default `.reversefootnote` rule prints "(page N)" back-references |
| `leader(" ")` in TOC entries | Not supported | The default TOC uses `target-counter` with `float: right` instead of dot leaders |
| `counter-reset: page N` | Resets to 1 only | Use `page-1` on the first numbered component and let numbering run |
| Non-Chrome browsers | Broken pagination | Preview and render in Chrome/Chromium only |
| `::before` / `::after` content on ordinary elements | Dropped during pagination | Draw rules and ornaments with a background gradient or a border. `target-counter` in margin boxes and TOC entries still works |

## CSS that silently does nothing

**Too much specificity.** Paged.js rewrites paged-media CSS as it paginates and
cannot cope with deeply nested or highly specific selectors. The symptom is
distinctive: the rule works in normal browser rendering, then after pagination
the class is not even visible in dev tools. Flatten the selector.

```scss
// Breaks
.chapter .content .box > blockquote p.source { … }

// Works
.box .source { … }
```

**`>` child selectors.** Paged.js inserts wrapper divs between elements while
splitting content across pages, so a direct-child relationship in the source
HTML is usually not a direct-child relationship after pagination. Use descendant
selectors.

**Generated content vanished.** A `::after { content: "" }` rule that draws a
rule or ornament renders as `content: none` after pagination — Paged.js rewrites
generated content for margin boxes and discards the rest. The reliable
substitute is a background gradient sized and positioned where the ornament
goes:

```scss
.chapter-subtitle {
    padding-bottom: 1.5em;
    background-image: linear-gradient($gold, $gold);
    background-repeat: no-repeat;
    background-size: 16.5mm 1.5pt;   // the rule's size
    background-position: left bottom 0.5em;
}
```

**You forgot to rebuild.** The browser loads `themes/<theme>/main.css`. Editing
`.scss` changes nothing until `node js/build.js` (or `npm start`, which watches)
regenerates it.

## Layout problems

### Blank pages appear between chapters

Expected. `$chapters-start-on: recto` forces each chapter onto a right-hand
page, inserting a blank verso where needed — this is correct for print. Set
`$chapters-start-on: auto` only if the book will never be printed as a bound
book.

### Content overflows the page

Something in the flow cannot be broken and is taller than the text area.
Usual suspects, in order of likelihood:

1. An image taller than the text area. Constrain it:
   `img { max-height: 100%; max-width: 100%; }` — already set inside `$figure`,
   but not for bare images elsewhere.
2. A `break-inside: avoid` block (figure, box, table) that is simply too tall.
   Allow it to break, or shorten it.
3. A fixed height in `pt`/`mm` on an element that also has padding, with
   `box-sizing` not set to `border-box`.
4. A `<pre>` block with long unbroken lines. Add `white-space: pre-wrap` and
   `overflow-wrap: break-word` for code.

`scripts/check-layout.js` reports overflowing elements with their selectors.

### Widows and orphans

Defaults are conservative; tighten per element:

```scss
p { orphans: 2; widows: 2; }               // minimum lines either side of a break
h1, h2, h3, h4 { break-after: avoid; }     // never leave a heading alone at the foot
figure, .box, table { break-inside: avoid; }
```

### A label is stranded at the foot of a page

The defaults give `h1`–`h6` `break-after: avoid`, but a paragraph styled to look
like a heading — a tracked-out label such as `LEARNING OBJECTIVES`, an eyebrow,
a callout label — is still a paragraph, and will happily sit alone at the foot
of a page with the thing it introduces overleaf. Name those classes explicitly:

```scss
.label,
.chapter-eyebrow,
.callout-label {
    break-after: avoid;
}
```

`check-layout.js` reports these under "Headings and labels stranded at the foot
of a page", so the whole class of problem is caught rather than spotted by eye.

`break-after: avoid` on headings is the single most valuable rule. If a stubborn
paragraph still breaks badly, add `class="keep-together"` in the HTML and style
it `break-inside: avoid` — but use it sparingly; too many unbreakable blocks
create short pages.

### Running heads are empty

- `string(h1-text, last)` returns nothing if no `h1` has appeared yet on or
  before that page. Chapter titles are usually `h2` — use `string(h2-text, last)`.
- Chapter-opening and standalone pages deliberately suppress margin boxes.
- Check the value is unquoted where it should be: `string(h1-text, last)` is a
  function, `"Book title"` is a literal string. Quoting the function turns it
  into text.
- Use `string()`, not `element()`.

### TOC entries print no page number

The entry's `href` does not match any `id` in the document.
`target-counter(attr(href), page)` resolves against real ids only. Check for
typos, duplicate ids, and ids on elements that were removed.

### Text is not hyphenating

`$hyphenation: manual` (the default) only breaks at real hyphens and soft
hyphens (`&shy;`). Set `$hyphenation: auto` — and make sure the element is
covered by `$hyphenated` (default: `p, ul, ol, dl`) and that `lang` is set on
`<html>`, since automatic hyphenation is language-dependent.

### Lines do not align across a spread

Something broke the baseline grid. Every vertical measurement — line height,
margins, padding, image heights, box padding — must be a multiple of the line
height. Find the offender by hunting for spacing values that are not derived
from `$line-height-default`. In baseline-grid themes, work in px, not pt.

### Pages reflow after a font change

Never link to web fonts for production. Save the font files into the project and
declare them with `@font-face`. A remote font's metrics can change under you and
repaginate the entire book.

## PDF problems

### PDF page size is wrong

Render with `preferCSSPageSize` (the supplied `render-pdf.js` does this) so
Chromium uses the `@page size` rather than the default paper size. If a printer
reports the wrong trim, check `$page-width`/`$page-height`, and remember that
`$bleed` adds to the physical page.

### Colours look wrong at the printer

Set `$colorspace: cmyk` and use colours the printer specified. Browser-generated
PDFs are RGB by default; a print shop may need conversion regardless — ask them
before generating the final file.

### Images look soft in print

Source images must be at least 300 dpi at their printed size. A 600 px-wide
image placed across a 120 mm column is about 127 dpi. Check the source files,
not the PDF.

### The theme switcher appears in the PDF

Only happens when printing the demo site by hand. `render-pdf.js` removes
`#pagerControls` before printing; when printing manually from Chrome the
switcher hides itself via a print media query.
