#!/bin/sh
# Build the AET proof, end to end.
#
# Ten passes, in this order, each of which has broken when run out of order:
# the front-matter pass looks for the contents the converter generated, the
# design pass looks for the headings the converter made, and the audit marks
# are painted last so that nothing after them can move a mark off its word.
#
#   usage: build-aet.sh [--clean] <source.md> <work-dir> [<out.pdf>]
#
# Set ART to a folder of figure artwork and whatever matches a filename the
# book asks for is copied in on the way past. The same folder supplies the
# part opener banners, which are named `part-1`, `part-2` and so on.
#
# Set COPYRIGHT to a file of copyright-page copy and it replaces what the
# manuscript carries. The manuscript ships with a short placeholder; the real
# page — imprint, ISBN, rights, the text-and-data-mining reservation — arrives
# from the publisher separately and late, and editing it into a delivered
# manuscript would mean re-editing it on the next delivery.
#
# End to end this takes about twenty-five minutes. Every pass is idempotent,
# so a build that stops part way can be continued one pass at a time from
# where it left off rather than started again.
#
# When a build does stop, read the whole output before diagnosing it. Twice
# the lead-cut pass refused to run — it counts the lead paragraphs in the page
# against the ones in the file and will not touch anything if they disagree —
# and said so clearly on stderr, and twice that line was filtered out of view
# by a grep looking for the words it expected. The build was blamed on a time
# limit it never hit.
#
# <source.md> is the manuscript as delivered — not the prepared copy. The
# prepared copy is written into <work-dir> and is regenerable from this.
set -e

# --clean leaves the audit marks off: a proof for a printer rather than one
# for the author to argue with. It is the same book either way.
MARKS=yes
if [ "$1" = "--clean" ]; then MARKS=no; shift; fi

SRC="$1"
WORK="$2"
OUT="${3:-$WORK/aet-proof.pdf}"
[ -n "$SRC" ] && [ -n "$WORK" ] || { echo "usage: build-aet.sh [--clean] <source.md> <work-dir> [<out.pdf>]" >&2; exit 2; }

HERE=$(dirname "$0")
REPO=$(cd "$HERE/../../../.." && pwd)
CONTENT="$REPO/content/aet-md"

mkdir -p "$WORK"
PREPPED="$WORK/aet.md"

# The old PDF goes first. A build that stops in the middle leaves whatever was
# there before, and a stale proof that looks plausible is worse than no proof
# at all — that is how a book got reported as finished when pagination had
# stopped eleven pages from the end.
rm -f "$OUT"

echo "== 1/10 prepare the Markdown"
python3 "$HERE/prep-aet-markdown.py" "$SRC" "$PREPPED"

echo "== 2/10 convert to book HTML"
node "$HERE/md-to-book.js" --src "$PREPPED" --out "$CONTENT" --split h1 --slug aet-md

echo "== 3/10 front matter"
node "$HERE/front-matter.js" --content "$CONTENT" \
    --sponsor-page --dedication --acknowledgements --drop-generated-contents \
    --acknowledgement-from "grateful to my son Thomas" \
    ${COPYRIGHT:+--copyright-from "$COPYRIGHT"}

echo "== 4/10 design"
node "$HERE/design-md.js" --content "$CONTENT" --report \
    ${ART:+--part-art "$ART" --part-credit "Illustration: AALAI / OpenAI, 2026"}

if [ "$MARKS" = yes ]; then
    echo "== 5/10 audit marks"
    python3 "$HERE/highlight-audit.py" --content "$CONTENT" --manuscript "$SRC"
else
    echo "== 5/10 audit marks — skipped (--clean)"
fi

# After the marks, so the marker never paints inside a slot; before the
# hyphens, so the slot's description is hyphenated like everything else.
echo "== 6/10 figure slots"
node "$HERE/figure-slots.js" --content "$CONTENT" ${ART:+--art "$ART"}

# Before the blocks are measured, because hyphenation changes how many lines
# an entry takes.
echo "== 7/10 hyphens"
node "$HERE/hyphenate.js" --content "$CONTENT"

# After the marks and the hyphens, not before: the blocks are measured with
# everything that will print in them.
# After the hyphens, because hyphenation changes where a line ends, and this
# is the pass that puts each lead cut on one. It costs a pagination.
echo "== 8/10 lead cuts"
node "$HERE/fix-lead-splits.js" --content "$CONTENT" --theme aalai-textbook

echo "== 9/10 reference blocks"
node "$HERE/chunk-references.js" --content "$CONTENT"

echo "== 10/10 render"
# Pagination of this book takes about half an hour. The renderer's default
# wait is five minutes, which reports a timeout on a build that was working.
node "$HERE/render-pdf.js" --content "$CONTENT" --theme aalai-textbook \
    --out "$OUT" --timeout 3600000

# And say so plainly if it is not there. `set -e` stops the script on a failed
# step but says nothing, and the last thing printed is the step that started
# rather than the one that failed.
[ -s "$OUT" ] || { echo "FAILED: no proof was written to $OUT" >&2; exit 1; }
echo "Done: $OUT"
