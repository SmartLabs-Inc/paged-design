#!/usr/bin/env python3
"""Convert a CFF (PostScript-outline) font to TrueType so a PDF can embed it.

Chromium will not embed a CFF web font in the PDF it prints. It emits the
glyphs as a Type 3 font instead — drawing procedures rather than a font
program. Type 3 text is not a real embedded face: it prints unpredictably,
some RIPs refuse it, and a byte scan of the PDF still shows the font's name,
so the problem reads as solved when it is not.

The same outlines converted from cubic to quadratic curves embed as an
ordinary TrueType subset. This is a format conversion, not a redraw: the
glyph shapes, metrics, names and licence bits all carry through.

    python3 otf-to-ttf.py FONT [-o OUT]

FONT may be .otf, .woff or .woff2 as long as its outlines are CFF. The
output defaults to the input with a .ttf extension. Verify the result in a
rendered PDF: the font must appear as /Subtype /TrueType or /CIDFontType2,
never /Subtype /Type3.
"""

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import table__g_l_y_f
from fontTools.ttLib.tables._l_o_c_a import table__l_o_c_a
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen


def convert(src_path, out_path, error_per_em=1.0):
    font = TTFont(src_path)
    if "glyf" in font:
        raise SystemExit("%s already has TrueType outlines; nothing to convert"
                         % src_path)
    if "CFF " not in font and "CFF2" not in font:
        raise SystemExit("%s has neither CFF nor glyf outlines" % src_path)

    font.flavor = None                      # unwrap WOFF/WOFF2
    order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    upem = font["head"].unitsPerEm
    # The conversion error, in font units. A thousandth of the em is well
    # under a printing device's resolution at any size this book sets.
    max_err = upem * error_per_em / 1000.0

    glyf = table__g_l_y_f()
    glyf.glyphs = {}
    glyf.glyphOrder = order
    for name in order:
        pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(pen, max_err=max_err,
                                      reverse_direction=True))
        glyf[name] = pen.glyph()

    for tag in ("CFF ", "CFF2", "VORG"):
        if tag in font:
            del font[tag]
    font["glyf"] = glyf
    font["loca"] = table__l_o_c_a()
    font.sfntVersion = "\x00\x01\x00\x00"
    font["head"].indexToLocFormat = 0

    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for attr, value in (("maxZones", 1), ("maxTwilightPoints", 0),
                        ("maxStorage", 0), ("maxFunctionDefs", 0),
                        ("maxInstructionDefs", 0), ("maxStackElements", 0),
                        ("maxSizeOfInstructions", 0),
                        ("maxComponentElements", 0), ("maxComponentDepth", 0)):
        setattr(maxp, attr, value)

    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = order

    font.save(out_path)
    return font


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("font", help="the .otf/.woff/.woff2 file to convert")
    p.add_argument("-o", "--out", help="output path (default: the input as .ttf)")
    args = p.parse_args()

    src = Path(args.font)
    if not src.exists():
        raise SystemExit("no such file: %s" % src)
    out = Path(args.out) if args.out else src.with_suffix(".ttf")

    convert(str(src), str(out))

    check = TTFont(str(out))
    print("%s → %s" % (src, out))
    print("  %d glyphs, TrueType outlines, fsType %d"
          % (len(check.getGlyphOrder()), check["OS/2"].fsType))
    if check["OS/2"].fsType & 0x0002:
        print("  WARNING: this font's fsType forbids embedding. Check the "
              "licence before shipping a PDF that contains it.", file=sys.stderr)


if __name__ == "__main__":
    main()
