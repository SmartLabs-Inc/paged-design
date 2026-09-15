# Fonts

The book embeds its own faces. Nothing here is fetched at render time: a remote
font update would reflow the whole book, and a headless container substitutes
silently when a face is missing — which is how a 290-page proof came to be set
entirely in Liberation Serif without anything reporting it.

| File | Role | Licence |
| --- | --- | --- |
| `Windorse-Regular.woff` | The licensed file as supplied | **Commercial, licensed to the client. Not redistributable — gitignored.** |
| `Windorse-Regular.ttf` | Display only — book title, part titles, index title. Built from the WOFF; see below | **Same licence. Not redistributable — gitignored.** |
| `CharisSIL-*.ttf` | Text face — running prose, headings, tables | SIL Open Font Licence 1.1 |
| `SourceSans3-*.ttf` | The sans — labels, entry names, running heads, folios | SIL Open Font Licence 1.1 (`SourceSans3-LICENSE.md`) |

## Why there is a sans at all, and why this one

The design sets its labels, entry names, running heads and folios in a sans
against the serif text. The parent theme names Aptos for that role. Aptos is
not licensed here and a headless container does not have it, so every one of
those elements was being set in whatever the renderer reached for — Liberation
Sans, a Helvetica clone — and embedded in the PDF with nothing reporting the
substitution.

Source Sans 3 is the deliberate stand-in: a humanist sans of the same family
of shapes as Aptos, with a semibold that holds at the 8px label sizes this
design uses. To set the book in Aptos instead, drop the files in here and
change `$font-display-secondary` in the theme's `_variables.scss`; nothing
else refers to the face by name.

## Why the split

Windorse is a high-contrast display serif with 190 glyphs, one weight, and no
italic. Two things rule it out for body text in this book and neither is a
matter of taste:

- **Its digit 1, capital I and lowercase l are the same stroke.** In a
  physician's reference that sets `BPC-157`, `IGF-1 LR3`, `P-113` and
  `5-Amino-1MQ`, that is a safety problem, not a style one.
- **There is no bold and no italic in the file**, and the book needs 2,467
  words of bold and 602 of italic. The renderer would smear and slant the
  regular instead of setting drawn weights.

At display size it is genuinely handsome, and the eleven part titles and the
book title contain no arabic digits at all — checked, not assumed. So it sets
those and nothing else.

Charis SIL carries the text. It descends from Bitstream Charter, drawn by
Matthew Carter, who also drew Georgia — so it sits in the same lineage as the
face the design originally specified. It ships real bold, italic and bold
italic, and covers 2,448 codepoints against the book's 111, missing exactly one
glyph (a lone κ, which falls back).

## Replacing Windorse

Drop the file in and keep the name, or change `$font-display-hero` in
`themes/aalai-textbook/_variables.scss`. Check any replacement against the
book's own characters before committing to it:

    node .claude/skills/book-format/scripts/font-check.js fonts/Your-Font.otf \
      --content content/<book>

## Why the display face is converted to TrueType

The licence supplies Windorse as a WOFF wrapping CFF (PostScript) outlines.
Chromium will not embed a CFF web font in the PDF it prints: it emits the
glyphs as a **Type 3** font — drawing procedures rather than a font program —
which is not a real embedded face, prints unpredictably, and is refused by
some RIPs. The first proof that used Windorse went out that way and read as
embedded to a byte scan.

The fix is a format conversion, not an edit to the licensed file: the same
outlines converted from cubic to quadratic curves embed as an ordinary
TrueType subset. Rebuild it with:

```bash
python3 .claude/skills/book-format/scripts/otf-to-ttf.py fonts/Windorse-Regular.woff
```

Check the result in any PDF the book produces: the font must appear with
`/Subtype /TrueType` or `/CIDFontType2`, never `/Subtype /Type3`.
