# Authoring in Word

Authors write in Word. The layout reads the **named styles** they applied, not
how the text looks. A heading typed in 18pt bold is body text; a heading given
the *Heading 1* style is a chapter. That difference is the whole system.

This is deliberate. Direct formatting is invisible to the pipeline, so a
manuscript always lands the same way no matter who typed it or which version
of Word they used.

## The three-step loop

```bash
# 1. See what styles the manuscript actually uses
node .claude/skills/book-format/scripts/docx-to-book.js --src book.docx --dump-styles

# 2. Convert, using the style map that matches the house template
node .claude/skills/book-format/scripts/docx-to-book.js \
  --src book.docx --out content/my-book --map aalai

# 3. Render and check
node .claude/skills/book-format/scripts/render-pdf.js --content content/my-book --theme aalai
node .claude/skills/book-format/scripts/check-layout.js --content content/my-book --theme aalai
```

Step 1 is not optional on a manuscript you have not seen before. `--dump-styles`
prints every paragraph style in the document with a use count, sample text, and
the shading colours it uses — everything needed to write or correct a map.

After converting, the script lists any style it had no mapping for. Those
paragraphs still appear, as plain body text; the list tells you what the map is
missing.

## What survives the trip

Applied automatically, no styles needed:

- **bold, italic, underline, strikethrough, superscript, subscript** — critical
  for scientific text (CO₂, m², citation markers)
- **footnotes and endnotes** inserted with *References ▸ Insert Footnote*
- **images**, extracted to the book's `images/` folder
- **hyperlinks**, internal and external
- **lists** made with Word's bullet and numbering buttons
- **tables**, including merged cells

Ignored on purpose: manual font changes, manual sizes, manual colours (unless
the map assigns a meaning to a specific colour), page breaks, section breaks,
headers and footers. The theme decides all of those.

## Giving Word structure the layout can read

### Chapters

Apply the chapter-title style — *Heading 1* by default, *AALAI Chapter Title*
in the AALAI template. Every occurrence starts a new chapter.

A label paragraph directly above a chapter title becomes that chapter's
eyebrow: the "CHAPTER 07" line. It has to be the paragraph immediately before
the title, with nothing in between.

### Sections

*Heading 2* and *Heading 3* (or *AALAI H1*, *H2*, *H3*) are the levels inside a
chapter. Body text needs no style at all — leave it as *Normal*.

### Callout boxes

Insert a **1×1 table** and shade the cell. The fill colour chooses the kind of
box, through the map's `fills` section:

| Fill | Becomes |
| --- | --- |
| `EAF3F3` | `.callout` — the standard tinted box |
| `0D2035` | `.callout.callout-dark` — navy, white text |
| `F4F6F7` | `.panel` — neutral grey |
| `EEF3F7` | `.figure-placeholder` — where art will go |

Inside the box, an all-bold first line automatically becomes the box's label,
so `CLINICAL APPLICATION` on its own line comes out as a proper label without
needing a style.

### Tables and side-by-side panels

Build tables normally. **Make every cell in the first row bold** and that row
becomes the table header. A table with one row and several columns is treated
as a layout, not data: each cell becomes a side-by-side panel.

### Numbered lists that the design numbers

Styles with a `group` in the map — *AALAI Objective*, *AALAI Takeaway* — collect
consecutive paragraphs into one list. Do not type the numbers; the theme draws
them, so they stay correct when items are added or reordered.

## Writing a style map

A map is JSON in `style-maps/`. Each entry says what one Word style becomes.

```json
{
  "defaults": { "component": "chapter", "leading": "title-page" },
  "styles": {
    "Heading 1":     { "component": "chapter", "role": "title" },
    "Heading 2":     { "element": "h3" },
    "AALAI Label":   { "element": "p", "class": "label" },
    "AALAI Objective": { "group": "objectives", "groupElement": "ol" },
    "Quote":         { "element": "blockquote" },
    "Header":        { "drop": true }
  },
  "fills":     { "EAF3F3": "callout" },
  "runColors": { "137C7A": "accent" }
}
```

Keys an entry understands:

| Key | Effect |
| --- | --- |
| `component` | Start a new page component of this type (`chapter`, `frontmatter`, `part`, `endmatter`, …) |
| `role` | `title` marks the component's title; `eyebrow` marks a label that belongs to the next component |
| `element` | HTML element to emit. Default `p` |
| `class` | Classes to put on it |
| `container` | Consecutive paragraphs sharing this value merge into one `div` with that class |
| `group` / `groupElement` | Consecutive paragraphs become items in one list |
| `number` | Pull a leading `01` / `1.` out of the text into a `.item-number` span |
| `drop` | Discard these paragraphs |

Top-level keys: `defaults` (`component` for body content, `leading` for anything
before the first titled component), `fills`, `runColors`, `runStyles`, and
`meta` (default book metadata).

Styles match on the display name authors see in Word (`AALAI Chapter Title`) or
on the internal style id (`AALAIChapterTitle`), case- and space-insensitively —
so either works.

## Generating a house template

Rather than telling authors which styles to apply, hand them a Word file that
already has them:

```bash
node .claude/skills/book-format/scripts/make-word-template.js \
  --map aalai --out AALAI-Authoring-Template.docx
```

The template carries one paragraph style per mapped style, a worked example of
each, instructions, and the right page size. The styles appear in Word's style
gallery, so authors pick from a list instead of remembering names.

Its styling only affects how the document looks *in Word*. The book's real
design lives in the theme — which is what lets the same manuscript be reissued
in a different design without touching the text.

## When a manuscript has no house styles

Plenty of manuscripts arrive formatted by hand. Two options:

1. **Ask the author to restyle** using the generated template. Best result,
   costs the author an hour with the style gallery.
2. **Convert with `--map default`**, which maps Word's built-in styles, then
   hand-tag the semantic features in the HTML afterwards, as with a Markdown
   manuscript. See `references/markup.md`.

Option 2 is fine for a one-off. For a series, option 1 pays for itself
immediately: every future book converts with no manual work.
