---
name: book-format
description: Format and typeset books into print-ready, paginated PDFs using Paged.js and the paged-design theme library. Use when a user wants to lay out a book, turn a manuscript (Markdown, HTML, docx) into a book, design or adapt a book theme, set page size/margins/running heads/typography for print, generate a print-ready or press-ready PDF, or fix pagination problems like widows, orphans, overflow, or chapters starting on the wrong page.
---

# Book formatting with Paged.js

Turn a manuscript into a typeset, print-ready PDF. The pipeline is:

```
manuscript (.md/.html/.docx) → book HTML → theme CSS (Sass) → Paged.js → PDF
```

Everything is CSS. There is no page-layout GUI: page size, margins, running
heads, chapter openers, and footnotes are all set in Sass variables and rules
that Paged.js turns into pages.

## Setup (once per project)

This skill works inside a clone of the
[paged-design](https://github.com/electricbookworks/paged-design) repo — the
themes, Sass partials, and Paged.js polyfill it drives all live there. If the
current project is not that repo, clone it first and work inside the clone.

```bash
npm install            # node-sass, http-server, nodemon
node js/build.js       # compile every theme's main.scss → main.css
```

The commands below assume the skill sits at `.claude/skills/book-format` in
that repo; adjust the paths if it is installed elsewhere. Every script takes
`--help`. `render-pdf.js` and `check-layout.js` also need Playwright
(`npm install -g playwright`).

## Workflow

### 1. Get the manuscript into book HTML

Book HTML is a single `index.html` whose top-level `<div>`s are *page
components* — one per cover, title page, chapter, etc. — each carrying a class
the theme styles (`chapter`, `title-page`, `copyright-page`, …). Put it in
`content/<book-slug>/index.html` so the preview server and theme switcher find it.

**From Word** — the usual route when authors are not developers. The converter
reads the manuscript's named paragraph styles and a style map decides what each
one becomes, so nothing depends on how the author formatted the text by hand:

```bash
# Always look first: what styles does this manuscript actually use?
node .claude/skills/book-format/scripts/docx-to-book.js --src book.docx --dump-styles

node .claude/skills/book-format/scripts/docx-to-book.js \
  --src book.docx --out content/my-book --map aalai
```

Bold, italic, super/subscript, footnotes, images, hyperlinks, lists and tables
all carry through. Shaded one-cell tables become callout boxes, and the fill
color picks which kind. Read `references/word-authoring.md` before writing or
editing a style map — it documents every key and the conventions authors follow.

To give authors a Word file that already contains the right styles:

```bash
node .claude/skills/book-format/scripts/make-word-template.js --map aalai --out Template.docx
```

**From Markdown:**

```bash
node .claude/skills/book-format/scripts/md-to-book.js \
  --src manuscript/ --out content/my-book --meta manuscript/book.json
```

It converts each `.md` file to one page component, generates cover, title,
copyright, and contents pages from `book.json`, applies book typography
(curly quotes, en/em dashes, ellipses), and wires up footnotes.

Either way, **read `references/markup.md` and hand-tag whatever the source did
not mark**: epigraphs, pull quotes, sources, boxes, dedications, figure
captions. A manuscript written against a house template needs almost none of
this; a hand-formatted one needs a lot. This tagging is what makes a design look
designed — do not skip it. Markdown can carry the tags inline as `{.epigraph}`
attributes.

### 2. Choose a theme

Ten themes ship in `themes/`. See `references/themes.md` for what each looks
like and which to start from. **`beatrix` is the default** and the right
starting point for most books; `template` (shown as "Vanilla") is the neutral
baseline when a design needs to start from nothing.

```bash
node .claude/skills/book-format/scripts/new-theme.js my-theme            # from beatrix
node .claude/skills/book-format/scripts/new-theme.js my-theme --from aalai
```

### 3. Design the theme

A theme is three files that override the defaults:

| File | Purpose |
| --- | --- |
| `_variables.scss` | page size, margins, fonts, spacing, running heads |
| `_selectors.scss` | map the theme's feature names onto *this book's* HTML classes |
| `_styles.scss` | custom CSS beyond what variables can express |

Set variables first — most design decisions are one variable, and
`references/variables.md` lists all of them. Only write custom CSS in
`_styles.scss` once variables run out.

If the book's HTML uses different class names (e.g. `section.chapter` rather
than `div.chapter`), override `_selectors.scss` rather than rewriting the HTML.

Rebuild after each change (`--watch` to rebuild on save):

```bash
node .claude/skills/book-format/scripts/build-css.js my-theme
```

### 4. Preview

```bash
npm start   # then open Chrome at http://localhost:5000
```

The demo site lists content and themes; `?theme=my-theme` switches the theme.
**Paged.js only renders correctly in Chrome/Chromium.**

### 5. Render the PDF

```bash
node .claude/skills/book-format/scripts/render-pdf.js \
  --content content/my-book --theme my-theme --out my-book.pdf
```

Headless Chromium runs Paged.js and prints with the CSS page size, so the PDF
comes out at the theme's trim. For a press-ready file, set `$bleed`, `$trim`
and `$crop-marks` in the theme's `_variables.scss` first — the marks are part
of the page box, not a flag on the renderer.

Remote resources are blocked by default: Paged.js waits for `@import`-ed
stylesheets, so one unreachable font host hangs the render indefinitely. Web
fonts therefore fall back to local faces unless you pass `--allow-remote`. This
is another reason to embed fonts in the project, as production books should.

### 6. Check the layout before calling it done

```bash
node .claude/skills/book-format/scripts/check-layout.js \
  --content content/my-book --theme my-theme
```

Reports page count, chapters that open on the wrong side, content overflowing
the page box, images too large for the text area, blank pages, widows, orphans,
stranded headings, and internal links whose target is missing (those print no
page number in the TOC). Fix what it finds — see `references/troubleshooting.md`
— then re-render. `--json` gives the machine-readable report; `--strict` exits
non-zero when anything is found, for use in a build.

## Rules that matter

- **Chrome only.** Paged.js does not paginate correctly in other engines.
- **Keep selectors shallow.** Paged.js rewrites paged-media CSS and breaks on
  deep nesting and high specificity. If a rule silently does nothing, flatten it.
- **`>` child selectors usually fail.** Paged.js injects wrapper divs between
  your elements.
- **Never link to web fonts in production.** A remote font update reflows the
  whole book. Save font files into the project and `@font-face` them locally.
- **`::after` content does not survive pagination.** Paged.js discards generated
  content on ordinary elements. Draw rules and ornaments with a background
  gradient or a border instead.
- **Set `$bleed`/`$trim` before generating anything a printer will accept**, and
  confirm the trim size with the printer first.
- **Rebuild CSS after every Sass edit** — the browser loads `main.css`, not
  `main.scss`. `npm start` watches and rebuilds automatically.

## References

Read these when the task reaches them; they are not needed up front.

- `references/word-authoring.md` — how authors write in Word, what survives the
  conversion, and every key a style map understands. Read before converting a
  `.docx` or editing a map.
- `references/markup.md` — the book HTML contract: every page-component class
  and feature class, with examples. Read before writing or tagging book HTML.
- `references/variables.md` — every theme variable, grouped, with effects.
  Read before designing a theme.
- `references/themes.md` — the nine shipped themes and when to pick each.
- `references/troubleshooting.md` — Paged.js limitations and fixes for
  overflow, widows, orphans, bad breaks, and missing running heads.
