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
// changed the result; changing the height of the block did, and the page then
// stayed right when the height was put back. A tenth of a pixel is not
// enough — measured, it left the page as it was — and one pixel is. So before
// a heading is judged stranded its height is changed by a pixel and restored,
// and the overflow is found again. Usually the text comes back under it and
// there is nothing to move.
//
// A third: headings above something that cannot be divided and is too tall to
// share a page with them — a full-page table. No page can hold both, so the
// headings stay where they fell and the table opens the next page.
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

  // Change a block's height by a pixel so its layout is redone, and put it
  // back unless told to leave it.
  function relayout (block, leave) {
    var was = block.style.paddingBottom
    var now = parseFloat(window.getComputedStyle(block).paddingBottom) || 0
    block.style.paddingBottom = (now + 1) + 'px'
    void block.offsetHeight
    if (leave) return
    block.style.paddingBottom = was
    void block.offsetHeight
  }

  function sameStart (a, b) {
    return a.compareBoundaryPoints(Range.START_TO_START, b) === 0
  }

  // What follows the headings is one piece that cannot be divided, and it is
  // too tall to share a page with them. Moving the headings then gains
  // nothing: they would open a page that the piece still cannot join, and
  // leave white on two pages instead of one. A section title and its box
  // above a full-page table is the case in this book.
  //
  // The piece is measured while it is still arriving: Paged.js looks for an
  // overflow every so many characters, and a long table is a third rendered
  // the first time it is found over the edge. Its height then says nothing,
  // so the height it will reach is estimated from how much of its text has
  // been set so far against how much the book holds.
  function tooTallToFollow (range, run, bounds, source) {
    if (!bounds || !bounds.height) return false
    var next = range.startContainer.nodeType === 1
      ? range.startContainer.childNodes[range.startOffset]
      : null
    while (next && (next.nodeType !== 1 || !next.getBoundingClientRect().height)) next = next.nextSibling
    if (!next) return false
    var solid = next.matches('table, figure, img, svg, .table-figure') ||
      window.getComputedStyle(next).breakInside === 'avoid'
    if (!solid) return false
    var heads = run[0].getBoundingClientRect().bottom - run[run.length - 1].getBoundingClientRect().top
    var height = next.getBoundingClientRect().height
    var ref = next.getAttribute('data-ref')
    var whole = ref && source && source.querySelector ? source.querySelector('[data-ref="' + ref + '"]') : null
    var set = next.textContent.length
    if (whole && set > 40 && whole.textContent.length > set) height = height * whole.textContent.length / set
    return heads + height > bounds.height - 8
  }

  function onPage (block, rendered) {
    var page = rendered.getBoundingClientRect()
    var box = block.getBoundingClientRect()
    return box.height > 0 && box.left < page.right - 1 && box.top < page.bottom - 1
  }

  // Where the overflow really begins. Paged.js has a keep of its own: a block
  // marked to stay with the one before it takes that one along, so the
  // overflow it reports can begin at a heading block that is sitting on the
  // page with room to spare. That keep does not chain — it took the shaded
  // box to its table and left the section title behind, which is one of the
  // faults this file is here for. Heading blocks that are on the page are on
  // the page; what happens to them is decided below, for the whole run.
  function pastPulled (range, rendered) {
    var out = range
    for (var guard = 0; guard < 6; guard += 1) {
      if (out.startContainer.nodeType !== 1) break
      var node = out.startContainer.childNodes[out.startOffset]
      while (node && ((node.nodeType === 3 && !node.textContent.trim()) ||
        node.nodeType === 8 ||
        (node.nodeType === 1 && node.tagName === 'A' && !node.textContent.trim()))) node = node.nextSibling
      if (!node || node.nodeType !== 1 || !node.matches(HEADING) || !onPage(node, rendered)) break
      out = out.cloneRange()
      out.setStartAfter(node)
    }
    return out
  }

  class KeepHeadings extends window.Paged.Handler {
    onOverflow (overflow, rendered, bounds, layout) {
      if (!overflow || !rendered) return
      var range = pastPulled(overflow, rendered)
      var run = runAbove(range, rendered)
      if (!run.length) return

      if (layout && typeof layout.findOverflow === 'function') {
        run.forEach(function (block) { relayout(block) })
        var again = layout.findOverflow(rendered, bounds)
        if (again) again = pastPulled(again, rendered)
        if (again && sameStart(again, range)) {
          // Restoring the height can restore the fault with it. Then the
          // pixel stays: it cannot be seen, and a blank page can.
          run.forEach(function (block) { relayout(block, true) })
          again = layout.findOverflow(rendered, bounds)
          if (again) again = pastPulled(again, rendered)
        }
        // Everything fits after all: no break here, carry on filling the page.
        if (!again) return null
        // Only a later start is an improvement. An earlier one means the
        // fresh layout has pulled a heading block over to sit with a table
        // too tall to follow it, which is the fault this exists to prevent;
        // the break stays where it was first found.
        if (again.compareBoundaryPoints(Range.START_TO_START, range) > 0) {
          range = again
          run = runAbove(range, rendered)
          if (!run.length) return range
        }
      }

      // Still the last thing on the page. Take the whole run over — unless
      // it starts the page, where moving it would change nothing.
      var top = run[run.length - 1]
      if (!firstOnPage(top, rendered) && !tooTallToFollow(range, run, bounds, this.chunker && this.chunker.source)) {
        var moved = range.cloneRange()
        moved.setStartBefore(top)
        range = moved
      }
      if (range !== overflow) return range
    }
  }

  window.Paged.registerHandlers(KeepHeadings)
}
