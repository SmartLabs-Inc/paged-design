# House rules for the AALAI reference books

Every rule here came from an edit note on a proof. They are written down
because the same faults kept coming back, and because "read the notes again"
is not a process. Check a proof against this list before sending it.

`proof-check.js` tests the ones a machine can test. The rest need eyes, and
the column on the right says which.

## Never

| Rule | Where it is enforced |
| --- | --- |
| Never a widow — one line of a paragraph at the top of a page or column | `widows: 2` in the theme, then `fix-widows.js` for what CSS cannot reach across a Paged.js page break; `proof-check.js` reports what is left |
| Never a widow in a title, and never a heading alone at the foot of a page | keep boxes in `design-pass.js`; `proof-check.js` reports stranded headings |
| Never split a person's name across two lines | `protectNames()` in `design-pass.js`, display type only |
| Never truncate the section name in the running head | full name into `<h6 class="run-head">`, and the top margin row is widened to the full measure |
| Never leave an orphan just to balance columns — finishing the entry in column one comes first | `column-fill: auto` on the body; eyes |
| Never let a keep-together box grow taller than its column | character budget in `design-pass.js`; a breach stops pagination silently |
| Never put two spanning elements in a row | `design-pass.js` folds a section head into the box below it; found three more in the index |

## Always

| Rule | Where it is enforced |
| --- | --- |
| Running head: the full sub-section name, in caps, in the footer grey | `.pagedjs_margin-top-left .pagedjs_margin-content` |
| Footer: the book title centred on the recto, the part name centred on the verso | `$recto-bottom` / `$verso-bottom`; needs `.title-page-title` on the title, which the style map supplies |
| Legal wording goes on the page after the title page, never on it | `splitTitlePage()` in `design-pass.js` |
| Air above a treatment or sub-section heading, so it separates from the columns above | `.keep-lead` margins |
| An entry's air sits at the foot of the entry, not above its name, so a name at the top of a column aligns with the column beside it | `.entry { margin-bottom }`, `.entry > h5 { padding-top: 0 }` |
| A parenthetical in an entry name moves to the next line whole, unless it would wrap twice anyway | `holdParenthetical()` and `.entry-paren` |
| A full-width sub-section title with a paragraph under it gets the shaded panel | `.keep-lead.lead-section` |
| A table sits under the entries it belongs to, not on a page of its own, when it fits | `table-place` behaviour — **not yet rebuilt**, see gaps |
| The abbreviations glossary sets as a flowing two-column list, not a table | `abbreviationList()` in `design-pass.js` |
| Citations set as superscripts, not as bracketed numbers in the text | `superscriptCitations()` |
| Heading numerals the design does not use are stripped, and "N. Introduction" stubs are dropped | pre-pass in `designBody()` |

## Still open

These are known, and saying so is part of the proof.

- **Index locators are the author's Word page numbers.** They need a pass that
  reads the folios back from the paginated book. Until then the index numbers
  point at nothing.
- **Four tables run to several pages.** Paged.js reports `Unable to layout
  item` on their cells. They need landscape pages or an appendix at a smaller
  trim — a decision, not a bug to fix.
- **Tables are not yet placed under the entries they belong to.**
- **Part-opener figures are empty slots.**
- **The licensed display face is not in the repository**, so a fresh container
  renders part titles in the fallback. Convert it with `otf-to-ttf.py` before a
  press proof: Chromium embeds a CFF web font as Type 3, which is drawing
  procedures rather than a font program.
