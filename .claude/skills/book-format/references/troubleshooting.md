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

### Colors look wrong at the printer

Set `$colorspace: cmyk` and use colors the printer specified. Browser-generated
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

## Paged.js removes every break-before and break-after from your CSS

This is not a bug you can style around, and it costs a day if you do not know
it. Paged.js parses the stylesheet, **deletes** every `break-before`,
`break-after`, `page-break-before` and `page-break-after` declaration, and
re-implements them as `data-break-before` / `data-break-after` attributes that
its own layout engine reads. Its engine implements only the page-level values —
`page`, `always`, `left`, `right`, `recto`, `verso`. Everything else is
discarded.

Two consequences, both measured in the browser rather than reasoned about:

- **`break-before: column` does nothing.** It computes to `auto` on the
  element. Twenty-six entries were marked with it to move them off the foot of
  a column; none moved.
- **`break-after: avoid` on a heading does nothing either.** It also computes
  to `auto`. A heading will sit at the foot of a column with its content
  overleaf and no CSS you write on the heading will stop it.

`break-inside` is **not** intercepted and works normally. So the only
keep-with-next available is a wrapper:

```html
<div class="keep-lead">      <!-- break-inside: avoid -->
  <h5>The heading</h5>
  <p>The paragraph it introduces.</p>
</div>
```

A group too tall for a fresh fragmentainer is not lost — the CSS fragmentation
rules drop `break-inside: avoid` where the box fits nowhere, so a very long
opening paragraph degrades to breaking normally instead of being pushed onto a
page of its own.

`orphans` and `widows` are also left alone and do work in Chromium's multicol —
verified by sweeping a heading down a column, where `orphans: 5` on the
following paragraph moved it at four lines remaining and `orphans: 2` did not.
But `orphans` moves the *paragraph*; without a wrapper the heading stays behind,
which is worse than the problem. Use the wrapper.

## A spanning element cannot cross a page break, and failing at it is silent

**Paged.js cannot fragment a `column-span: all` element across a page break.**
If a spanner has to be pushed past a page boundary, the layout engine repeats
without progress until it hits its own guard — and when it gives up it *stops
paginating the rest of the document*.

Nothing errors. The only trace is a `Layout repeated at:` line on the browser
console, and a page count that looks plausible. On one 305-page reference this
produced 294 pages, silently missing the last part, the author note and the
entire index. It was noticed only because two contents links resolved to
nothing.

So: check the console for `Layout repeated`, and check that the *last* thing in
your document actually rendered:

```js
!!document.querySelector('.pagedjs_page [id="the-last-anchor"]')
```

A spanner that **always starts a page** is safe, because it is never pushed —
that is why `.section-head` and `.part-title` can span. For anything else,
either drop the span or give it `break-before: page`. Dropping it is usually
right: a two-column table sets perfectly well in a 64mm column, which is how a
reference sets a glossary anyway.

## Do not bisect the stylesheet by injecting a `<style>` block

A `<style>` appended to the page after load **does not reach Paged.js** — it
takes its stylesheets earlier, and the injected rules never affect the layout,
even with `!important`. The computed value on the rendered element is unchanged.

This produces confident, entirely meaningless bisects. Three separate "not the
cause" conclusions in the spanning-table hunt above came from this method
before the injection itself was tested:

```js
// the check that should have been run first
getComputedStyle(document.querySelector('.pagedjs_page .thing')).columnSpan
```

Bisect by editing the theme and rebuilding the CSS. It is slower and it is the
only method that means anything.

## A `<thead>` does not repeat, so split the table before pagination

Paged.js has no implementation of `display: table-header-group`. A table that
runs over a page turn leaves the reader with unlabelled columns on every page
after the first.

The fix is to cut the table into pieces that each fit, each carrying its own
`<thead>` — and to measure for that **before** pagination, not after. Measuring
after seems natural and cannot work: you would be reading the pagination to
find which tables split, and on a document where a table is the thing breaking
the layout, that pagination is the one that never finishes.

Render the tables statically at the width they will be set at, with the theme
CSS applied and Paged.js not running, and add up row heights against the page's
text height:

```js
await page.setContent('<link rel="stylesheet" href="…/main.css">' +
  '<div class="chapter" style="width:64mm">' + tables.join('') + '</div>')
// then read each <tr>'s height and cut where the running total exceeds budget
```

The caption stays on the first piece; repeated, it reads as a second table.

## Anything measured has to be measured again after it moves

Passes that change pagination and passes that read pagination must be ordered,
and the reading ones go last:

1. structure, hyphenation, figures — change the content
2. repeat table headers — changes the content, but needs a pagination to know
   which tables split
3. the heading-break fixer — needs a pagination, and moves pages
4. folio locators for the index — needs the final pagination

Two of those iterate: the break fixer marks, re-paginates, and marks again,
because moving one heading creates and cures offenders further down. It settles
in three or four rounds. Never run two of these passes against the same file at
once — they each read, edit and write the whole document, so a second one
racing the first silently discards its work.

## Check the document is still well-formed after every rewriting pass

Build passes rewrite tags with regular expressions, and a regular expression
that gets an open and a close out of step corrupts the DOM in a way that
nothing downstream reports. The browser silently repairs it, the page count
still looks plausible, and the damage surfaces as an inexplicable overflow two
hundred pages away from the pass that caused it.

The specific trap: an alternation whose open and close lists are independent.

```js
// WRONG — `<table …>` is allowed to close at the first `</p>`,
// which is inside the table's first header cell
/<h5[^>]*>[\s\S]*?<\/h5>((?:\s*<(?:p|ul|ol|table|div)\b[\s\S]*?<\/(?:p|ul|ol|table|div)>)*)/

// RIGHT — take a contiguous run up to the next heading and enumerate nothing
/<h5[^>]*>[\s\S]*?<\/h5>((?:(?!<h[1-6])[\s\S])*)/
```

Two cheap assertions catch this class of bug at the pass that caused it. Run
them before writing the file, and exit non-zero:

```js
const opens = (html.match(/<div\b/g) || []).length
const closes = (html.match(/<\/div>/g) || []).length
if (opens !== closes) throw new Error(opens + ' <div> against ' + closes + ' </div>')

// a closing tag stranded inside a table cell means a wrapper closed in the
// wrong place — the count above will not catch it, because it still balances
const stray = html.match(/<t[hd]\b[^>]*>(?:(?!<\/t[hd]>)[\s\S])*?<\/div>/g)
if (stray) throw new Error(stray.length + ' </div> inside a table cell')
```

The same family of bug bites regular expressions that need something *after*
the part they capture — see the backtracking note below: a non-greedy body will
run forward across whole chapters to make a trailing lookahead succeed. Where a
pattern needs a heading and then something that follows it, split on the
heading instead of matching across it.

\n
## `column-span: all` resolves against a box much wider than the page

Paged.js paginates by flowing the content through a multi-column box far wider
than the sheet and clipping it to the page. So a spanner does not span *the
page* — it spans that wide box. Measured on an index title with
`column-span: all` computed and honoured:

```
page box width 502px
flow width    1918px          ← what the spanner spans
title width    246px          ← half a page, on a page it was supposed to cross
```

This is the same mechanism behind the truncation note above, and the practical
advice is the same: do not reach for `column-span` to make something full
width. Put the element in a flow that has one column instead. An index wants a
full-measure title over two columns of entries — build it as a single-column
chapter flow containing one two-column list, not as a two-column flow with
spanning headings.

The corollary is worth stating: a heading per letter followed by a list per
letter gives each letter its own column set, so a letter with three entries
ends its block there and leaves the rest of the page white. One list, with the
dividers as items inside it, flows continuously.

## An ancestor-dependent selector can stop matching after pagination

The skill's rules already say to keep selectors shallow and that `>` child
selectors usually fail. This is the same family and it bites harder, because it
fails **silently and selectively**: in the paginated DOM an element's ancestor
chain is not its source chain, so a descendant selector that depends on an
ancestor class can stop matching while a bare class selector on the same
element keeps working.

The symptom is a rule that looks more specific and loses anyway:

```scss
.part-title            { column-span: all; }   // still matches after pagination
.index .part-title     { column-span: auto; }  // never matches — no .index ancestor
```

Measured on the element in the rendered page: no inline style, and
`column-span: all` computed. The override with twice the specificity had simply
never applied.

**Do not scope an override by ancestor. Put the class on the element.** Where a
component needs to behave differently in one part of the book, give it its own
class at build time — `.index-title` rather than `.index .part-title` — and
style that directly.

The corollary for debugging: when a rule "does not work", read the computed
value on the rendered element before touching the CSS. Specificity arithmetic
done against the source stylesheet can be exactly right and completely
irrelevant.

## A keep-together box empties the column before it

`break-inside: avoid` on a wrapper is the only keep-with-next Paged.js
implements, so it is the standard fix for a heading stranded at the foot of a
column. It has a cost nobody mentions: a box that cannot fit the space left in
a column does not break, it **moves whole**, and everything it was going to
fill that column with goes with it.

On one book a wrapper holding an entry name to a forty-line opening paragraph
left the column before it four lines deep. Seventy-five pages had columns four
or more lines out of step, and reading the CSS showed nothing wrong — the rule
was doing exactly what it said.

The fix is to apply the constraint by measurement rather than by rule. Measure
each wrapper at the width it will be set at, and keep `break-inside: avoid`
only where moving the box costs less than the hole it leaves — a sixth of the
page is a reasonable cap for body text. Above that, drop it and rely on the
two mechanisms that cost nothing:

- **`break-after: avoid` on the heading.** Columns are native CSS multicol laid
  out by the browser, so a *column* break obeys the ordinary break properties.
  It is only Paged.js's own page fragmentation that ignores them.
- **A pass that measures the paginated book** and pushes a heading left short
  at the foot of a *page* — the one case `break-after` does not cover.

Diagnosing this is a two-step measurement, and the first step alone will
mislead you. Find the pages where one column ends well above the other, then
for each, walk up from the element at the top of the second column looking for
an ancestor whose computed `break-inside` is `avoid`. That names the box that
moved. Where nothing on the chain refuses to break, the gap has another cause
— an `orphans` value, a `column-span` element, or simply the end of a section —
and tightening the wrappers will not touch it.
