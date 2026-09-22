<!--
A four-page book that exercises the passes a full build would otherwise take
half an hour to reach: the title page, the copyright replacement, and a part
opener with its banner and its list of sections.

    node scripts/md-to-book.js   --src samples/front-matter.md \
                                 --out content/test-front --split h1 --slug test-front
    node scripts/front-matter.js --content content/test-front \
                                 --drop-generated-contents --copyright-from <file>
    node scripts/design-md.js    --content content/test-front --part-art <art-dir> --report
    node scripts/figure-slots.js --content content/test-front --art <art-dir>
    node scripts/render-pdf.js   --content content/test-front --theme aalai-textbook \
                                 --out front-test.pdf

`content/test-*` is ignored, so the built copy stays out of the repository.

It has already earned its keep. The copyright replacement matched the body
after an `h1`, which is what the copyright page carries *after* the heading
promotion at the end of the same script — so it worked perfectly on a file
that had been through the script once and did nothing at all on a fresh
build, where the heading is still an `h2`. Four pages found that in a minute.
-->

# The Book's Title Goes Here

A subtitle long enough to wrap, so that the title page shows what a real one does

An Author, M.D.

# Copyright

Placeholder copy. A real build replaces all of this with `--copyright-from`.

# Part I. The First Part

## I. The First Section

A paragraph of ordinary running text, here only so that the columns have
something to balance and the section head has something to sit above. It needs
to be long enough to fill a few lines across both columns, because a section
head with one line under it tells you nothing about how the two of them break.

### A Sub-Section

Sub-sections are set in a tinted panel with the opening of the paragraph held
inside it, so this text is here to be split.

## II. The Second Section

Two more sections, so the part opener's list of contents has three lines in it
and the rules under them can be seen.

## III. The Third Section

The last one.
