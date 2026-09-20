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
# book asks for is copied in on the way past.
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

echo "== 1/10 prepare the Markdown"
python3 "$HERE/prep-aet-markdown.py" "$SRC" "$PREPPED"

echo "== 2/10 convert to book HTML"
node "$HERE/md-to-book.js" --src "$PREPPED" --out "$CONTENT" --split h1 --slug aet-md

echo "== 3/10 front matter"
node "$HERE/front-matter.js" --content "$CONTENT" \
    --sponsor-page --dedication --acknowledgements --drop-generated-contents \
    --acknowledgement-from "grateful to my son Thomas"

echo "== 4/10 design"
node "$HERE/design-md.js" --content "$CONTENT" --report

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
