#!/bin/sh
# Build the AET proof, end to end.
#
# Seven passes, in this order, each of which has broken when run out of order:
# the front-matter pass looks for the contents the converter generated, the
# design pass looks for the headings the converter made, and the audit marks
# are painted last so that nothing after them can move a mark off its word.
#
#   usage: build-aet.sh <source.md> <work-dir> [<out.pdf>]
#
# <source.md> is the manuscript as delivered — not the prepared copy. The
# prepared copy is written into <work-dir> and is regenerable from this.
set -e

SRC="$1"
WORK="$2"
OUT="${3:-$WORK/aet-proof.pdf}"
[ -n "$SRC" ] && [ -n "$WORK" ] || { echo "usage: build-aet.sh <source.md> <work-dir> [<out.pdf>]" >&2; exit 2; }

HERE=$(dirname "$0")
REPO=$(cd "$HERE/../../../.." && pwd)
CONTENT="$REPO/content/aet-md"

mkdir -p "$WORK"
PREPPED="$WORK/aet.md"

echo "== 1/7 prepare the Markdown"
python3 "$HERE/prep-aet-markdown.py" "$SRC" "$PREPPED"

echo "== 2/7 convert to book HTML"
node "$HERE/md-to-book.js" --src "$PREPPED" --out "$CONTENT" --split h1 --slug aet-md

echo "== 3/7 front matter"
node "$HERE/front-matter.js" --content "$CONTENT" \
    --sponsor-page --dedication --acknowledgements --drop-generated-contents

echo "== 4/7 design"
node "$HERE/design-md.js" --content "$CONTENT" --report

echo "== 5/7 audit marks"
python3 "$HERE/highlight-audit.py" --content "$CONTENT" --manuscript "$SRC"

# After the marks, not before: the blocks are measured with everything that
# will print in them.
echo "== 6/7 reference blocks"
node "$HERE/chunk-references.js" --content "$CONTENT"

echo "== 7/7 render"
# Pagination of this book takes about half an hour. The renderer's default
# wait is five minutes, which reports a timeout on a build that was working.
node "$HERE/render-pdf.js" --content "$CONTENT" --theme aalai-textbook \
    --out "$OUT" --timeout 3600000
