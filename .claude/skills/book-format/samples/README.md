# Sample documents

## `front-matter.md`

A four-page book that exercises the passes a full build would otherwise take
half an hour to reach: the title page, the copyright replacement, and a part
opener with its banner, its credit and its list of sections. From the repo
root:

```sh
S=.claude/skills/book-format/scripts
node $S/md-to-book.js   --src .claude/skills/book-format/samples/front-matter.md \
                        --out content/test-front --split h1 --slug test-front
node $S/front-matter.js --content content/test-front \
                        --drop-generated-contents --copyright-from <copy.md>
node $S/design-md.js    --content content/test-front --part-art <art-dir> \
                        --part-credit "Illustration: ..." --report
node $S/figure-slots.js --content content/test-front --art <art-dir>
node $S/render-pdf.js   --content content/test-front --theme aalai-textbook \
                        --out front-test.pdf
```

`content/test-*` is ignored, so the built copy stays out of the repository.

It has already earned its keep twice.

The copyright replacement matched the body after an `h1`, which is what the
copyright page carries *after* the heading-promotion pass at the end of the
same script — so it worked on a file that had been through the script once,
which is what it was tested against, and did nothing at all on a fresh build,
where the heading is still the `h2` the converter wrote.

Then the usage notes above, which were briefly kept inside this sample as an
HTML comment, were converted as Markdown: the indented commands came out as
paragraphs and `<copy.md>` opened an element that never closed. The book
rendered as **one page, 10 KB**, with no error. That is the failure this
whole pipeline is careful about — Paged.js writing a plausible PDF that stops
— and it is why notes about a sample live beside it rather than inside it.
