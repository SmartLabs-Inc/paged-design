# From a Word manuscript to a print PDF and an EPUB

One command:

```bash
node .claude/skills/book-format/scripts/build-book.js \
  --src Manuscript.docx --slug aet --map aet --theme aalai-textbook \
  --restyle --out-dir ~/books
```

That is the whole process. The rest of this page is what each stage does, why
the order is what it is, and the three ways it has actually failed.

## The shape of it

```
manuscript.docx
    │
 1. restyle       one style, one meaning                    restyle-aet.py
    │
 2. convert       styles → semantic HTML                    docx-to-book.js
    │
    ├── 3. EPUB   reflowable, from the semantic HTML         make-epub.js
    │
 4. design        part openers, entries, keep boxes          design-pass.js
 5. CSS           theme → main.css                           build-css.js
 6. render        paginate and print                         render-pdf.js
 7. check         widows, orphans, overflow, dead links      check-layout.js
```

Every stage is a script that runs on its own. `build-book.js` only sequences
them, so when something goes wrong, run the stage that failed by hand.

## The one thing to get right: the EPUB forks early

The EPUB is built at step 3, **before** the design pass, and this is not an
optimisation — it is the difference between an EPUB that works and one that is
subtly broken.

A print page and a reflowing screen want opposite things. The design pass
splits an opening paragraph in two so its first three lines can be locked to
the heading above them. It wraps headings in boxes that must not break. It
plants zero-height running heads to feed the page margins. On a phone, in a
font and at a size the reader chose, there is no page for any of that to hold
to: the split paragraph is two paragraphs with a gap down the middle of a
sentence.

So the two formats fork from the same source and never from each other. What
print says with page geometry, the EPUB says with document structure — which
is why the closed style vocabulary in the manuscript is load-bearing.

## Stage 1: one style, one meaning

A manuscript that arrives with seven Word styles doing sixteen jobs makes every
downstream tool guess, and each guesses differently. `restyle-aet.py` rewrites
the style on every paragraph so the name states the role, defines the new
styles so the author can see the structure in Word, and changes no wording.

Skip `--restyle` for a manuscript already written against a house template.
Run `docx-to-book.js --dump-styles` first, always: it says what the file
actually uses, which is rarely what anyone remembers.

The vocabulary this book uses: `Heading 1`–`Heading 4` for the hierarchy, then
`Entry Name`, `Standfirst`, `Body Text`, `Bullet`, `Table Text`,
`References Heading`, `Reference`, `Index Letter`, `Index Entry`.

Hierarchy stays on the built-in heading names on purpose. A converter that
matches style names — pandoc, most likely, since it probably produced the file
— turns an unrecognised custom name into a plain paragraph, and a part title
demoted to body text in the EPUB is worse than a text convention. So three
distinctions are carried by the text: a Heading 1 beginning `Part `, one
reading `Alphabetical Index`, and anything before the first part.

## Stage 4: the rule the design pass exists to enforce

**No element with `break-inside: avoid` may be taller than its column.**

Paged.js cannot place one that is. It pushes to the next column, measures,
pushes again, and after a few rounds gives up with `Layout repeated at:` in the
console and *silently stops paginating the rest of the document*. It then
writes a PDF that looks finished. The last build died fifteen per cent from the
end: 302 pages, no error, no index, and a contents page listing the index at
page 0.

Every keep box the pass creates is therefore budgeted in characters — three
lines of an opening paragraph — and `--report` says what it capped.

Budgeting rather than measuring is deliberate. Measuring needs the paginated
page: the same paragraph at the same width, font and metrics sets in three
lines in a probe and four inside the real page. That discrepancy cost more time
than anything else in the previous build.

The second hazard is two spanners in a row. A section head spans both columns
and takes a page break; the box below it spans too. Paged.js sets the first and
pushes the second to the next page, leaving the section opener four per cent
full. The pass folds the two into one box where they meet.

## How to tell whether it worked

Not from the log. A book that stops paginating still writes a plausible PDF.

- `check-layout.js` runs automatically at step 7. **Read the dead-link list
  first**: a link with no target means that component never paginated.
- Open the last page. If it ends mid-sentence with no folio and no running
  head, that is an abort, not an ending.
- Page count against expectation. A book that should be 340 pages and renders
  44 has not been trimmed; it has died.

## Known gaps

- **Index locators** are the author's Word page numbers, not ours. They need a
  pass that reads them back from the paginated book.
- **Oversized tables** — four of them run to several pages. Paged.js reports
  `Unable to layout item` for their cells. They need landscape pages or an
  appendix at a smaller trim.
- **Licensed display font.** `fonts/Windorse-*` is gitignored, so a fresh
  container renders part titles in the fallback face. Restore the file before
  a press proof, and convert it with `otf-to-ttf.py` first — Chromium embeds a
  CFF web font as Type 3, which is drawing procedures rather than a font.
