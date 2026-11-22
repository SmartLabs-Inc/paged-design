#!/usr/bin/env python3
"""Make a rendered book PDF pleasant to read on a screen.

A PDF straight out of the renderer is right for a printer and awkward for a
person. Three things are wrong with it for someone reading and making notes:

  the page box    A viewer numbers pages from 1. The book numbers its front
                  matter i-xxii and starts again at 1, so the viewer says
                  "69 of 705" on the page printed 47, and a note that says
                  "page 69" is twenty-two pages out. Page labels make the
                  viewer show the printed number.

  no bookmarks    Seven hundred pages with no way in but scrolling.

  no title        The window says the file name.

This puts all three in. It reads the outline that `render-pdf.js --outline`
wrote beside the PDF, and changes nothing on any page.

    render-pdf.js --content <book> --renumber --outline --out book.pdf
    finish-pdf.py book.pdf --title "..." --author "..."
"""
import argparse
import json
import os
import sys

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    sys.exit("finish-pdf.py needs pypdf:  python3 -m pip install pypdf")

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("pdf")
parser.add_argument("--outline", help="Default: <pdf>.outline.json beside the PDF.")
parser.add_argument("--out", help="Default: the PDF is replaced.")
parser.add_argument("--title")
parser.add_argument("--author")
parser.add_argument("--depth", type=int, default=4,
                    help="Deepest bookmark level to keep. 4 keeps every entry.")
args = parser.parse_args()

outline_file = args.outline or os.path.splitext(args.pdf)[0] + ".outline.json"
with open(outline_file, encoding="utf-8") as handle:
    outline = json.load(handle)

reader = PdfReader(args.pdf)
writer = PdfWriter(clone_from=reader)
count = len(writer.pages)
if count != outline["sheets"]:
    sys.exit("The outline is for a %d-page book and this PDF has %d pages. "
             "Render them together." % (outline["sheets"], count))

# The viewer's page box shows what is printed on the page.
front = outline["frontMatterPages"]
if front:
    writer.set_page_label(0, front - 1, "/r")
    writer.set_page_label(front, count - 1, "/D")

# Bookmarks, nested by level. A level with no parent yet hangs from the
# nearest level above it that has appeared.
parents = {}
kept = 0
for item in outline["items"]:
    level = item["level"]
    if level > args.depth:
        continue
    parent = None
    for above in range(level - 1, 0, -1):
        if above in parents:
            parent = parents[above]
            break
    node = writer.add_outline_item(item["title"], item["sheet"] - 1, parent=parent)
    parents[level] = node
    for deeper in [k for k in parents if k > level]:
        del parents[deeper]
    kept += 1

meta = {}
if args.title:
    meta["/Title"] = args.title
if args.author:
    meta["/Author"] = args.author
if meta:
    writer.add_metadata(meta)
# Open with the bookmarks showing.
writer.page_mode = "/UseOutlines"

target = args.out or args.pdf
with open(target + ".tmp", "wb") as handle:
    writer.write(handle)
os.replace(target + ".tmp", target)
print("Finished %s — %d pages, %d bookmarks, page box showing %s"
      % (os.path.basename(target), count, kept,
         ("i-%s then 1-%d" % (["", "i", "ii", "iii"][front] if front < 4 else "…", count - front)) if front else "sheet numbers"))
