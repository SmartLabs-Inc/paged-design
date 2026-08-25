# Word export

Builds `reno-first-book.docx` from `../index.html` — the same file
paged.js sets for print, so the Word file carries exactly the content
the book does.

```
npm install docx cheerio jszip
node content/reno-first/export/build.js [out.docx]
```

## What Word can and cannot take

The book is a paged.js design. Three things about it have no Word
equivalent, and are rebuilt here rather than reproduced:

- **The marginalia column.** Word has no column that body text flows
  around, so margin notes become floating tables pinned to the right
  margin, with the text held to the book's 130mm measure so they have
  somewhere to sit. `RelativeHorizontalPosition.OUTSIDE` would
  alternate by hand as the book does, but readers other than Word
  resolve it as LEFT and drop the note on the inside edge.
- **Full-bleed pages.** The cover and the part pages print to the
  paper's edge. Word cannot, so each becomes a navy panel inset to
  the margins.
- **Rules whose position depends on pagination.** In the book a
  section's closing gold rule prints wherever that section happens to
  end, including at the foot of the previous page. Word repaginates
  on its own, so the rule is simply a bottom border at the same point
  in the flow.

Everything else — the two-colour palette, the type, the running heads
and their gold rule, the forms with their gold-washed write-in cells,
the tick boxes, the answer panels, the Notes pages, the paired
advantage/disadvantage panels — is carried over.

The contents page uses live `PAGEREF` cross-references rather than
baked-in numbers, and the document is flagged to update its fields on
open, so the numbers are right for Word's own pagination rather than
paged.js's. Press Ctrl+A then F9 to refresh them after an edit.

## Two things Word gets wrong on its own

Both are worked around here, and both are easy to reintroduce:

- **Adjacent paragraphs carrying identical borders merge into one
  box.** A stack of ruled paragraphs prints as a single empty
  rectangle, so every ruled area — Notes pages, write-in areas,
  prompt boxes — is a table with one row per line instead.
- **`docx` stamps `w:id="1"` on every bookmark it writes.** Word needs
  them unique or cross-references resolve to the wrong target, so
  `renumber.js` rewrites the pairs in document order after packing.

## Fonts

Archivo and Source Serif 4 are named but not embedded — a reader
without them installed will see Word's substitutes. They are in
`themes/renofirst/fonts/` as woff2; Word needs TrueType to embed.
