// A heading goes with its content.
//
// Paged.js has no keep-with-next. It strips break-after, and a heading that
// spans the columns stalls pagination if it is told to start a page. So a
// section title, or the shaded box under one, could be left as the last thing
// on a page with everything it introduces overleaf.
//
// Two ways of fixing that in the stylesheet were measured on the whole book
// and failed. Reserving a fixed space under every heading left 20 stranded
// against 22 with no rule: the heading kept its space, the box after it
// needed more and went overleaf anyway. Reserving each heading the measured
// height of what follows it sent the headings over correctly and then left
// the rest of their new page blank, because the reserved space was taken out
// of the columns beneath.
//
// This does it where the break is decided. When Paged.js has found what
// overflows a page, and the last thing left on the page is a heading block,
// the overflow is extended back to take the heading with it. Then it looks
// again, because a section title is often followed by a shaded box that is
// itself a heading block. A heading that is the first thing on its page is
// never moved: there is nowhere better for it, and moving it would loop.
//
// It reads nothing from the book but the class the build already puts on
// heading blocks, so the markup is untouched and a book with none of them is
// paginated exactly as before.

window.keepHeadingsWithContent = function () {
  'use strict'
  if (!window.Paged || window.keepHeadingsWithContent.registered) return
  window.keepHeadingsWithContent.registered = true

  var HEADING = '.keep-lead'
  var SOLID = 'img, svg, table, hr'

  function emptyBetween (startAfter, range) {
    var gap = document.createRange()
    gap.setStartAfter(startAfter)
    gap.setEnd(range.startContainer, range.startOffset)
    if (gap.toString().trim() !== '') return false
    return !gap.cloneContents().querySelector(SOLID)
  }

  function firstOnPage (heading, rendered) {
    var before = document.createRange()
    before.setStart(rendered, 0)
    before.setEndBefore(heading)
    if (before.toString().trim() !== '') return false
    return !before.cloneContents().querySelector(SOLID)
  }

  // The last heading block that ends at or before the point where the
  // overflow begins.
  function headingBefore (range, rendered) {
    var heads = rendered.querySelectorAll(HEADING)
    var point = document.createRange()
    for (var i = heads.length - 1; i >= 0; i -= 1) {
      point.setStartAfter(heads[i])
      point.collapse(true)
      if (point.compareBoundaryPoints(Range.START_TO_START, range) <= 0) return heads[i]
    }
    return null
  }

  class KeepHeadings extends window.Paged.Handler {
    onOverflow (overflow, rendered) {
      if (!overflow || !rendered) return
      var range = overflow
      for (var guard = 0; guard < 4; guard += 1) {
        var heading = headingBefore(range, rendered)
        if (!heading) break
        // A block the page break already runs through is another matter.
        if (heading.hasAttribute('data-split-to')) break
        if (!emptyBetween(heading, range)) break
        if (firstOnPage(heading, rendered)) break
        var moved = range.cloneRange()
        moved.setStartBefore(heading)
        range = moved
      }
      if (range !== overflow) return range
    }
  }

  window.Paged.registerHandlers(KeepHeadings)
}
