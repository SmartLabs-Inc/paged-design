# Getting a book into InDesign

## `.indd` cannot be written from outside InDesign

InDesign's own document format is closed and undocumented, and Adobe ships no
writer for it. Nothing but InDesign produces a valid `.indd`, and any tool that
claims to is either driving a copy of InDesign or producing something else and
renaming it.

The published interchange format is **IDML**. InDesign opens an IDML directly —
File > Open, then File > Save As writes the `.indd`. That is the supported route
in, it is what Adobe's own round-tripping uses, and it is what `to-idml.js`
produces.

    node to-idml.js --content content/my-book --theme my-theme --out My-Book.idml

## Two ways in, and when to use each

**IDML — a whole document.** Page size, margins, columns, a master spread,
threaded text frames on every page, and the full style sheet. Open it and there
is a book. Use this when InDesign is taking over from the HTML and there is no
InDesign template yet.

**ICML — the text alone.** An InCopy story: the same paragraphs with the same
styles, and nothing else. Place it into a template somebody has already built.
Far fewer moving parts, and the right choice when the design already exists on
the InDesign side and only the copy is moving.

    node to-idml.js --content content/my-book --icml My-Book.icml

## What the exporter reads from the theme

Nothing about the page is written into the script. `--theme` names a theme and
the compiled CSS supplies the trim from `@page { size }`, the margins from
`@page :left` and `@page :right`, the column count and gutter, and the body size
and leading from the `body` rule. Every other type size in the style table is
scaled from the body, so the relationship between a heading and its text is the
same in InDesign as on the page.

This was a real bug before it was a feature: with the geometry hard-coded, a
111 × 178mm novel exported as a 7 × 10in InDesign document and everything else
about the file looked correct.

## What survives, and what does not

Paragraph and character styles come across as named styles a designer can edit
in one place — the names are design roles (Body, Entry Name, Standfirst, Table
Caption, Reference, Index Entry) rather than CSS class names.

Three things arrive as text rather than as objects, and the exporter says so at
the end of every run rather than leaving them to be discovered:

- **Tables** become tab-separated paragraphs in Table Head and Table Cell
  styles. Select them and use Table > Convert Text to Table.
- **Figure slots** become styled paragraphs where the figure belongs, carrying
  the number, the finished size and the commissioning brief. Replace each with
  a graphic frame.
- **The running head and folio** are not on the master. Draw them once on the
  master spread and use Type > Insert Special Character > Markers > Current
  Page Number.

Soft hyphens are stripped on the way out. They exist in the HTML because
headless Chromium has no hyphenation dictionary; InDesign has its own and will
hyphenate better if it is not handed pre-broken words.

## The package is checked, but InDesign is the only real test

Every run validates the package against what the format requires: `mimetype`
first and stored uncompressed, every part the design map points at present,
every XML part well-formed, every style, colour, story and frame that a
reference names actually defined, and every threaded frame pointing at a frame
that exists. That catches the ways a generated package usually fails.

It does not prove InDesign is happy with it, and it cannot — InDesign cannot be
run from the build. Open the file before relying on it.

## Page count

`--pages` sets how many pages of threaded frames to build; it defaults to 320.
InDesign composes the text itself and will not agree with Paged.js line for
line, so expect the last frame to be overset or the last few pages to be empty.
Add or delete pages there. Take the Paged.js page count as the starting number.
