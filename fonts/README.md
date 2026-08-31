# Fonts

The book embeds its own faces. Nothing here is fetched at render time: a remote
font update would reflow the whole book, and a headless container substitutes
silently when a face is missing — which is how a 290-page proof came to be set
entirely in Liberation Serif without anything reporting it.

| File | Role | Licence |
| --- | --- | --- |
| `Windorse-Regular.woff` | Display only — book title, part titles, index title | **Commercial, licensed to the client. Not redistributable — gitignored.** |
| `CharisSIL-*.ttf` | Text face — running prose, headings, tables | SIL Open Font Licence 1.1 |

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
