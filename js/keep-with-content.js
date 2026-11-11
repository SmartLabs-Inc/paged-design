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
// the overflow is extended back to take the heading with it — and every
// heading block directly above it, because a section title is often followed
// by a shaded box that is itself a heading block.
//
// Two things it has to get right, both learned from pages that came out wrong.
//
// The first version moved the blocks one at a time and stopped at one that
// was first on its page. So a title and its box at the top of a page, with
// their text overleaf, lost the box and kept the title: a page holding one
// line. The run of headings is now taken as a whole, and a run that reaches
// the top of the page is left alone — there is nowhere better for it.
//
// The second is why a title and box at the top of a page had their text
// overleaf at all, with most of a page free beneath them. Chromium keeps the
// layout of a block that spans the columns and reuses it; when the block has
// been moved to a fresh page, the reused layout sends the whole column row
// after it to the next page instead of starting it underneath. Measured on
// the page: nothing about breaks, orphans, margins or the amount of text
// changed the result, and changing the height of the block by a tenth of a
// pixel did. So before a heading is judged stranded, it is nudged by that
// much and the overflow is found again. Usually the text comes back under it
// and there is nothing to move.
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

  // The heading blocks stacked directly above the overflow, nearest first.
  function runAbove (range, rendered) {
    var run = []
    var at = range
    for (var guard = 0; guard < 6; guard += 1) {
      var heading = headingBefore(at, rendered)
      if (!heading) break
      // A block the page break already runs through is another matter.
      if (heading.hasAttribute('data-split-to')) break
      if (!emptyBetween(heading, at)) break
      run.push(heading)
      at = document.createRange()
      at.setStartBefore(heading)
      at.collapse(true)
    }
    return run
  }

  // Change a block's height by a tenth of a pixel, so its layout is redone.
  function nudge (block) {
    var now = parseFloat(window.getComputedStyle(block).paddingBottom) || 0
    var up = block.getAttribute('data-nudged') !== 'up'
    block.style.paddingBottom = (now + (up ? 0.1 : -0.1)) + 'px'
    block.setAttribute('data-nudged', up ? 'up' : 'down')
  }

  class KeepHeadings extends window.Paged.Handler {
    onOverflow (overflow, rendered, bounds, layout) {
      if (!overflow || !rendered) return
      var range = overflow
      var run = runAbove(range, rendered)
      if (!run.length) return

      if (layout && typeof layout.findOverflow === 'function') {
        run.forEach(nudge)
        var again = layout.findOverflow(rendered, bounds)
        // Everything fits after all: no break here, carry on filling the page.
        if (!again) return null
        if (again.compareBoundaryPoints(Range.START_TO_START, range) !== 0) {
          range = again
          run = runAbove(range, rendered)
          if (!run.length) return range
        }
      }

      // Still the last thing on the page. Take the whole run over — unless
      // it starts the page, where moving it would change nothing.
      var top = run[run.length - 1]
      if (!firstOnPage(top, rendered)) {
        var moved = range.cloneRange()
        moved.setStartBefore(top)
        range = moved
      }
      if (range !== overflow) return range
    }
  }

  window.Paged.registerHandlers(KeepHeadings)
}
