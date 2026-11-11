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
// The second is why a heading block could have its text overleaf at all, with
// most of a page free beneath it. After a block that spans the columns,
// Chromium sometimes sends the whole column row that follows to the next page
// instead of starting it underneath and breaking it. Measured on two pages
// where it happened: nothing about breaks, orphans, margins or the amount of
// text changed the result — the row stayed away with four more paragraphs
// added to it — and changing the height of the spanning block did. How much
// it takes varies: a tenth of a pixel was never enough, one pixel cleared one
// page and not the other, five cleared both, in either direction. Putting the
// height back brought the fault back.
//
// So before a heading is judged stranded, the block nearest the break is
// tried a few pixels taller and shorter, smallest change first, until the
// text starts under it; that height is kept. Usually something works and
// there is nothing to move. A shaded box three pixels deeper than its
// neighbours cannot be seen, and a page that stops after six lines can.
//
// A third: headings above a table too tall to share a page with them. No
// page can hold both whole. Leaving the headings where they fell left the
// fault; moving them only moved it to the top of the next page, a box alone
// with its table overleaf. The table is allowed to divide instead, and begins
// directly under its headings.
//
// A fourth: Paged.js has a keep-with-previous of its own, and it does not
// chain. See `pastPulled`.
//
// It reads nothing from the book but the class the build already puts on
// heading blocks, so the markup is untouched and a book with none of them is
// paginated exactly as before.

window.keepHeadingsWithContent = function () {
  'use strict'
  if (!window.Paged || window.keepHeadingsWithContent.registered) return
  window.keepHeadingsWithContent.registered = true

  var HEADING = '.keep-lead'
  // Artwork and tables that span the columns. They are not headings and are
  // never moved, but the text after them goes missing the same way.
  var ARTWORK = '.figure, .table-figure'
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
  function headingBefore (range, rendered, which) {
    var heads = rendered.querySelectorAll(which || HEADING)
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

  // Try the block a little taller and a little shorter until the overflow
  // begins later than it did. Returns the new overflow, `null` when nothing
  // overflows any more, or nothing when no height helped — in which case the
  // block is left exactly as it was.
  var STEPS = [1, -1, 2, -2, 3, -3, 5, -5, 7, -7]

  function settle (block, range, rendered, bounds, layout) {
    var was = block.style.paddingBottom
    var base = parseFloat(window.getComputedStyle(block).paddingBottom) || 0
    for (var i = 0; i < STEPS.length; i += 1) {
      if (base + STEPS[i] < 0) continue
      block.style.paddingBottom = (base + STEPS[i]) + 'px'
      void block.offsetHeight
      var again = layout.findOverflow(rendered, bounds)
      if (!again) return null
      again = pastPulled(again, rendered)
      if (again === null) return null
      if (again.compareBoundaryPoints(Range.START_TO_START, range) > 0) return again
    }
    block.style.paddingBottom = was
    void block.offsetHeight
  }

  // What follows the headings is one piece that cannot be divided, and it is
  // too tall to share a page with them: a table that fills a page or runs to
  // several. Returns that piece, or nothing.
  //
  // No page can hold both whole. Moving the headings gains nothing — they
  // open a page the piece still cannot join. Leaving them leaves the fault.
  // So the piece is allowed to divide, and begins under its headings.
  //
  // The piece is measured while it is still arriving: Paged.js looks for an
  // overflow every so many characters, and a long table is a third rendered
  // the first time it is found over the edge. Its height then says nothing,
  // so the height it will reach is estimated from how much of its text has
  // been set so far against how much the book holds.
  function tooTallToFollow (range, run, bounds, source) {
    if (!bounds || !bounds.height) return null
    var next = range.startContainer.nodeType === 1
      ? range.startContainer.childNodes[range.startOffset]
      : null
    while (next && (next.nodeType !== 1 || !next.getBoundingClientRect().height)) next = next.nextSibling
    if (!next) return null
    var solid = next.matches('table, .table-figure') ||
      window.getComputedStyle(next).breakInside === 'avoid'
    if (!solid || next.matches(HEADING) || next.querySelector('svg, img')) return null
    var heads = run[0].getBoundingClientRect().bottom - run[run.length - 1].getBoundingClientRect().top
    var height = next.getBoundingClientRect().height
    var ref = next.getAttribute('data-ref')
    var whole = ref && source && source.querySelector ? source.querySelector('[data-ref="' + ref + '"]') : null
    var set = next.textContent.length
    if (whole && set > 40 && whole.textContent.length > set) height = height * whole.textContent.length / set
    return heads + height > bounds.height - 8 ? next : null
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
  //
  // The same keep can take a figure. An entry continued onto a new page
  // opens with its figure; the text after the figure is sent overleaf whole
  // (see the note on Chromium at the top); the first paragraph is marked to
  // stay with the figure before it; and the overflow Paged.js reports is the
  // entire page. It then starts the next page from the entry's first line
  // rather than from where the page before stopped. Two entries in this book
  // came out with an empty page and their opening printed twice. So a block
  // that only wraps other blocks is looked into, and artwork that is on the
  // page counts as on the page too.
  //
  // And a block that only wraps other blocks can mislead on its own. An entry
  // continued onto a page that so far holds a figure and a table — both of
  // which span the columns — has no height: everything in it has been lifted
  // out to span. Chromium places that empty box in the next column, Paged.js
  // sees a block over the edge, and again the whole page is overflow. So a
  // wrapper is always looked into, wherever its own box is; what counts is
  // where its contents are.
  //
  // Returns the range to break at; the range it was given when nothing here
  // applies; or `null` when everything rendered so far is on the page and
  // there is no overflow at all.
  function wrapper (node) {
    return node.tagName === 'DIV' && (!node.className || node.matches('.entry, .chapter'))
  }

  function idle (node) {
    return (node.nodeType === 3 && !node.textContent.trim()) || node.nodeType === 8 ||
      (node.nodeType === 1 && node.tagName === 'A' && !node.textContent.trim())
  }

  function pastPulled (range, rendered) {
    if (range.startContainer.nodeType !== 1) return range
    var holder = range.startContainer
    var index = range.startOffset
    var passed = false
    for (var guard = 0; guard < 60; guard += 1) {
      var node = holder.childNodes[index]
      while (node && idle(node)) { index += 1; node = holder.childNodes[index] }
      if (!node) {
        // Ran off the end of a wrapper: carry on after it.
        if (!passed) return range
        if (holder === rendered || !rendered.contains(holder) || !holder.parentNode) return null
        index = Array.prototype.indexOf.call(holder.parentNode.childNodes, holder) + 1
        holder = holder.parentNode
        continue
      }
      if (node.nodeType !== 1) break
      if (wrapper(node) && node.firstChild) { holder = node; index = 0; continue }
      if ((node.matches(HEADING) || node.matches(ARTWORK)) && onPage(node, rendered)) {
        passed = true
        index += 1
        continue
      }
      break
    }
    // Looking inside wrappers and finding nothing to pass is not a reason to
    // break anywhere but where Paged.js said.
    if (!passed) return range
    var out = range.cloneRange()
    out.setStart(holder, index)
    return out
  }

  // The artwork or heading block the overflow begins with, when the overflow
  // is the whole page: nothing has been left on the page at all.
  function pageOpener (range, rendered) {
    var before = document.createRange()
    before.setStart(rendered, 0)
    before.setEnd(range.startContainer, range.startOffset)
    if (before.toString().trim() !== '' || before.cloneContents().querySelector(SOLID)) return null
    var node = range.startContainer.nodeType === 1 ? range.startContainer.childNodes[range.startOffset] : null
    for (var guard = 0; guard < 8 && node; guard += 1) {
      while (node && (node.nodeType !== 1 || (node.tagName === 'A' && !node.textContent.trim()))) node = node.nextSibling
      if (!node) return null
      if (node.matches(ARTWORK) || node.matches(HEADING)) return node
      if (node.tagName !== 'DIV') return null
      node = node.firstChild
    }
    return null
  }

  class KeepHeadings extends window.Paged.Handler {
    onOverflow (overflow, rendered, bounds, layout) {
      if (!overflow || !rendered) return
      var range = pastPulled(overflow, rendered)
      // Everything is on the page: Paged.js was looking at an empty wrapper.
      if (range === null) return null
      var run = runAbove(range, rendered)
      if (!run.length) {
        // Not a heading. Artwork with nothing after it on the page is the
        // other case: it stays where it is, and the text is brought back
        // under it if a change of height will do that.
        var art = headingBefore(range, rendered, ARTWORK)
        if (!art || !emptyBetween(art, range)) {
          // Or the page is empty: the artwork that should open it has gone
          // overleaf with the text it was taking along.
          var opener = pageOpener(range, rendered)
          if (!opener || !layout || typeof layout.findOverflow !== 'function') return
          var back = settle(opener, range, rendered, bounds, layout)
          if (back === null) return null
          if (back) return back
          return
        }
        if (layout && typeof layout.findOverflow === 'function') {
          var under = settle(art, range, rendered, bounds, layout)
          if (under === null) return null
          if (under) return under
        }
        if (range !== overflow) return range
        return
      }

      if (layout && typeof layout.findOverflow === 'function') {
        var settled = settle(run[0], range, rendered, bounds, layout)
        // Everything fits after all: no break here, carry on filling the page.
        if (settled === null) return null
        if (settled) {
          range = settled
          run = runAbove(range, rendered)
          if (!run.length) return range
        }
      }

      var top = run[run.length - 1]
      var canFind = layout && typeof layout.findOverflow === 'function'

      // A table too tall to share any page with these headings: let it
      // divide, so that it starts beneath them.
      var tall = tooTallToFollow(range, run, bounds, this.chunker && this.chunker.source)
      if (tall && canFind) {
        tall.style.breakInside = 'auto'
        void tall.offsetHeight
        var divided = layout.findOverflow(rendered, bounds)
        if (!divided) return null
        divided = pastPulled(divided, rendered)
        if (divided === null) return null
        if (divided.compareBoundaryPoints(Range.START_TO_START, range) > 0) return divided
        tall.style.breakInside = ''
      }

      // Still the last thing on the page. Take the whole run over — unless
      // it starts the page, where moving it would change nothing.
      if (!firstOnPage(top, rendered)) {
        if (!tall) {
          var moved = range.cloneRange()
          moved.setStartBefore(top)
          range = moved
        }
      } else if (run.length === 1 && range !== overflow) {
        // One heading block, first on its page, that Paged.js means to take
        // along with what follows it: that is the whole page, and Paged.js
        // has its own way out of that. Leave it to it.
        var before = document.createRange()
        before.setStartBefore(top)
        before.collapse(true)
        if (overflow.compareBoundaryPoints(Range.START_TO_START, before) <= 0) return
      }
      if (range !== overflow) return range
    }
  }

  window.Paged.registerHandlers(KeepHeadings)
}
