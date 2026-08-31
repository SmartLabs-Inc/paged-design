# Pre-press: what has to be true before a printer sees the PDF

A proof that reads correctly on screen is not a file a printer can use. These
are the checks that separate the two, in the order they have to be done —
because the first one changes the answer to everything after it.

## 1. Embed the fonts the design actually specifies

**Check this before anything that depends on page numbers.** Substituted fonts
change the measure, the measure changes the line breaks, the line breaks change
the pagination, and the pagination is what the index folios, the contents
folios and every cross-reference are computed from. Fix the fonts last and all
of that has to be regenerated.

What the check looks like — read the faces out of the rendered PDF, not out of
the stylesheet:

```bash
python3 - <<'PY'
import re
d = open('book.pdf','rb').read()
print(sorted(set(re.findall(rb'/BaseFont\s*/([A-Za-z0-9+\-,_]+)', d))))
print('embedded programs:', len(re.findall(rb'/FontFile\d?\s', d)))
PY
```

A headless Linux container has neither Georgia nor Aptos, and Chromium
substitutes silently. On one book the theme asked for Georgia and Aptos and the
PDF contained only `LiberationSerif`, `LiberationSans` and `DejaVuSans` — every
glyph in 290 pages was a substitute, and nothing in the render log said so.

Note that "embedded" and "correct" are different questions. That PDF had 25
embedded font programs and was perfectly self-contained; they were simply the
wrong faces. Check the names, not the count.

And do not assume a substitute is metric-compatible with what you asked for.
Liberation Serif is metric-compatible with Times New Roman — not with Georgia,
which has a larger x-height and different widths. Installing the real face will
move line breaks, not just change the shapes.

### The name in the PDF is not proof the face is embedded

Chromium will not embed a **CFF** (PostScript-outline) web font in the PDF it
prints — an `.otf`, or a `.woff`/`.woff2` wrapping CFF. It emits the glyphs as
a **Type 3** font instead: drawing procedures stored in the page, not a font
program. The text still looks right on screen and in a rasteriser, the font's
name is still in the file, and a scan for `/BaseFont` still finds it. It is not
an embedded face. Type 3 text prints unpredictably, is refused by some RIPs,
and does not subset, hint or scale like a real font.

So check the subtype, not just the name:

```bash
python3 -c '
import re
d = open("book.pdf","rb").read()
print([m.decode() for m in re.findall(rb"/FontName /([^\s/>]+)", d)])
print(sorted(set(x.decode() for x in re.findall(rb"/Subtype /(Type\d|TrueType|CIDFontType\d)", d))))
'
```

`Type3` in that list is a failure, whatever the names say. A licensed display
face went out in one proof exactly this way, and a scan for `/BaseFont`
reported it as present.

The fix is a format conversion, not a redraw or a different licence — the same
outlines converted from cubic to quadratic curves embed as an ordinary
TrueType subset:

```bash
python3 .claude/skills/book-format/scripts/otf-to-ttf.py fonts/Display.woff
```

Then point the `@font-face` at the `.ttf` and re-render. Glyphs, metrics, names
and the licence bits all carry through; the file the licence was granted for is
not modified.

Two other font-embedding failures worth checking at the same time:

- **`fsType` may forbid embedding.** Bits 1–3 of the OS/2 table say whether a
  PDF may carry the face at all. `otf-to-ttf.py` prints the value and warns;
  read the licence when it is not 0 or 8.
- **A face declared but never used prints nothing.** A rule that names a class
  the book's HTML does not carry matches nothing and fails silently — the
  display face is simply absent from the PDF with no error anywhere. Confirm
  each declared face actually appears in the rendered file.


**The fix** is the one the skill's rules already state: save the font files
into the project and `@font-face` them locally. Never link a web font in
production — a remote update reflows the whole book.

Be aware that no theme in this repository currently does this. There is no
`fonts/` directory and no `@font-face` rule anywhere in `themes/`, so every
book built here so far has rendered in whatever the host machine happened to
have. The instruction is right; it has simply never been exercised. Budget for
that when a book first goes to press.

Two routes, and which one applies is a licensing question, not a technical one:

- **The specified face.** Georgia and Aptos are Microsoft faces. A client may
  already hold the rights through Office or Windows, in which case the files
  can go in `fonts/` and be `@font-face`d. A build server cannot simply fetch
  them.
- **An open face chosen deliberately.** If the licence is not there, pick a
  substitute on purpose rather than letting the renderer pick one. Bitstream
  Charter is worth knowing about for a Georgia-based design: Matthew Carter
  drew both, it is open-licensed, and it holds up at text sizes in a reference
  book. It is *not* metrically identical, so the pagination still has to be
  regenerated — but that is a design decision made with open eyes rather than
  a silent substitution.

## 2. Set the trim, the bleed and the marks

`$bleed`, `$trim` and `$crop-marks` live in the theme's `_variables.scss`, not
on the renderer, because the marks are part of the page box. Confirm the trim
with the printer before generating anything: a book set at 7 × 10in and printed
at 6.14 × 9.21in is a reset, not an adjustment.

Verify the trim in the output rather than trusting the setting:

```bash
python3 -c "
import re; d=open('book.pdf','rb').read()
b=[float(x) for x in re.search(rb'/MediaBox\s*\[([^\]]+)\]',d).group(1).split()]
print('%.2f x %.2f in' % ((b[2]-b[0])/72, (b[3]-b[1])/72))"
```

## 3. Typewriter marks

A straight apostrophe or a straight double quote in a typeset book reads as an
unfinished proof. Convert to the curly forms — but look at where they occur
first. Blanket conversion is safe only when no apostrophe sits inside an
identifier, and in technical books they sometimes do.

## 4. Confirm the book is all there

Paged.js can stop paginating partway through and report a plausible page count
(see `troubleshooting.md`). Assert that the last anchor in the document
actually rendered, every time:

```js
!!document.querySelector('.pagedjs_page [id="the-last-anchor"]')
```

## 5. The order that follows from all this

1. Embed the fonts.
2. Set trim and bleed; confirm with the printer.
3. Re-render, and re-run every pass that reads pagination — index locators,
   contents folios, any measured break fixing.
4. Only then is a page number in the book a page number in the book.
