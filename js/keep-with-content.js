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

  // A heading block, and a label that the build did not manage to box with
  // the paragraph under it. Both introduce what follows and neither may be
  // the last thing on a page.
  var HEADING = '.keep-lead, p.label'
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
    var heads = run.length
      ? run[0].getBoundingClientRect().bottom - run[run.length - 1].getBoundingClientRect().top
      : 0
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

  // The block the overflow begins with, when the overflow is the whole page:
  // nothing has been left on the page at all.
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
      // Any block will do. The index opened on an empty page with its title
      // and every entry overleaf, and no artwork anywhere near it.
      if (!wrapper(node)) return node
      node = node.firstChild
    }
    return null
  }

  // --- A paragraph's last lines above a heading -----------------------------
  //
  // The other half of the three-line rule. A paragraph that breaks over a
  // page may carry as few as three lines, and when those lines are the last
  // text before a heading they are a row of their own at the top of the next
  // page: a scrap above the title. They also cannot be shared between the
  // columns — three lines each side of a break is the rule — so four go 3 and
  // 1 and five go 3 and 2. Six go 3 and 3.
  //
  // So when the text from the page break to the next thing that spans the
  // columns comes to fewer than six lines, the page before gives up enough of
  // the paragraph to make six, as long as three of its lines stay behind.
  // The page it leaves runs a line or two short; that is the trade a
  // compositor makes by hand.
  //
  // How much text follows is not on the page yet — Paged.js lays out a little
  // ahead of the break and no further — so it is read from the book and
  // turned into lines at the rate this paragraph is setting.
  var TAIL = 6
  var NOT_PROSE = '.label, .lead-head, .topic-head, .run-head, .table-caption, .figure-caption, .standfirst, .entry-name'
  var SPANS = HEADING + ', ' + ARTWORK + ', .references, .apparatus-head'

  function feetOf (rects) {
    var feet = []
    rects.map(function (r) { return r.bottom }).sort(function (a, b) { return a - b })
      .forEach(function (b) { if (!feet.length || b - feet[feet.length - 1] > 7) feet.push(b) })
    return feet
  }

  // Lines still to come between a point in the book and the next block that
  // spans the columns, counting no further than it needs to.
  function linesToNextSpan (from, perLine, sofar) {
    var lines = sofar
    var node = from
    for (var guard = 0; guard < 40 && lines < TAIL; guard += 1) {
      var next = node.nextSibling
      var up = node
      while (!next) {
        up = up.parentNode
        if (!up || up.nodeType !== 1 || up.matches('.chapter')) return lines
        next = up.nextSibling
      }
      node = next
      if (node.nodeType === 3) {
        if (node.textContent.trim()) lines += Math.ceil(node.textContent.length / perLine)
        continue
      }
      if (node.nodeType !== 1 || (node.tagName === 'A' && !node.textContent.trim())) continue
      if (node.matches(SPANS)) return lines
      var inner = node.querySelector(SPANS)
      if (inner) {
        var upTo = document.createRange()
        upTo.setStart(node, 0)
        upTo.setEndBefore(inner)
        return lines + Math.ceil(upTo.toString().trim().length / perLine)
      }
      // Each block ends its last line early; a label is a line of its own.
      var blocks = node.querySelectorAll('p').length || 1
      lines += Math.ceil(node.textContent.trim().length / perLine) + Math.floor(blocks / 2)
    }
    return lines
  }

  function shortTail (overflow, rendered, source) {
    if (!source || !source.querySelector) return
    var page = rendered.getBoundingClientRect()
    var mid = page.left + page.width / 2
    if (overflow.startContainer.nodeType !== 3) return
    var para = overflow.startContainer.parentNode.closest('p, li')
    if (!para || !rendered.contains(para) || para.matches(NOT_PROSE)) return
    if (para.closest(HEADING + ', ' + ARTWORK + ', table')) return

    var ref = para.getAttribute('data-ref')
    var whole = ref && source.querySelector('[data-ref="' + ref + '"]')
    if (!whole) return

    // The paragraph as it stands on this page, up to the break.
    var before = document.createRange()
    before.selectNodeContents(para)
    before.setEnd(overflow.startContainer, overflow.startOffset)
    var rects = Array.prototype.filter.call(before.getClientRects(), function (r) {
      return r.height >= 9 && r.width > 0 && r.left < page.right - 1
    })
    if (!rects.length) return
    var right = rects[rects.length - 1].left >= mid
    var here = feetOf(rects.filter(function (r) { return (r.left >= mid) === right }))
    var across = feetOf(rects.filter(function (r) { return r.left < mid })).length +
      feetOf(rects.filter(function (r) { return r.left >= mid })).length
    var set = before.toString()
    var perLine = Math.max(28, set.length / Math.max(1, across))

    // What is left of this paragraph.
    var key = set.slice(-48)
    var at = whole.textContent.indexOf(key)
    if (at < 0) return
    var rest = whole.textContent.length - (at + key.length)
    var left = Math.ceil(rest / perLine)

    // That is an estimate, and a run of reference numbers at the end of a
    // paragraph throws it: they are many characters and little width, so two
    // lines were counted as three and went over on their own. Paged.js lays
    // out a little past the edge of the page, and when the whole paragraph is
    // already there the lines can simply be counted.
    if (rest > 0 && para.textContent.length >= whole.textContent.length) {
      var beyond = document.createRange()
      beyond.selectNodeContents(para)
      beyond.setStart(overflow.startContainer, overflow.startOffset)
      var columns = {}
      Array.prototype.forEach.call(beyond.getClientRects(), function (r) {
        if (r.height < 14 || r.width <= 0) return
        var column = Math.floor((r.left - page.left + 2) / (page.width / 2 + 9))
        ;(columns[column] = columns[column] || []).push(r)
      })
      var counted = 0
      Object.keys(columns).forEach(function (c) { counted += feetOf(columns[c]).length })
      if (counted > 0) left = counted
    }

    // The start of the line that is `move` lines up from the break: walk back
    // from the break until a character is found on an earlier line.
    function cutAbove (move) {
      var foot = here[here.length - move]
      function stays (node, offset) {
        var one = document.createRange()
        one.setStart(node, offset)
        one.setEnd(node, offset + 1)
        // The last box, not the first: the letter after a hyphen that was
        // used has one where the hyphen is drawn as well as its own.
        var list = one.getClientRects()
        var r = list[list.length - 1]
        if (!r || (!r.width && !r.height)) return null
        if (right ? r.left >= page.right - 1 : r.left >= mid) return false
        if ((r.left >= mid) !== right) return true
        return r.bottom < foot - 4
      }
      var texts = []
      var all = document.createTreeWalker(para, NodeFilter.SHOW_TEXT)
      var each
      while ((each = all.nextNode())) {
        texts.push(each)
        if (each === overflow.startContainer) break
      }
      var scanned = 0
      for (var t = texts.length - 1; t >= 0; t -= 1) {
        var node = texts[t]
        var end = node === overflow.startContainer ? overflow.startOffset : node.textContent.length
        for (var i = end - 1; i >= 0; i -= 1) {
          scanned += 1
          if (scanned > 900) return
          if (stays(node, i) === true) {
            var out = overflow.cloneRange()
            out.setStart(node, i + 1)
            return out
          }
        }
      }
    }

    // First, the rule itself. Chromium keeps three lines either side of a
    // break when it can and breaks anyway when it cannot — a list item of
    // five lines at the foot of a page went over as four and one, the one
    // being a single word. Where fewer than three lines would be carried,
    // more are sent with them; where that would leave fewer than three
    // behind and the block is short, the whole block goes.
    if (rest > 0 && left < 3) {
      var more = 3 - left
      if (here.length - more >= 3) return cutAbove(more)
      if (here.length + left <= 6 && !para.hasAttribute('data-split-from') && across === here.length) {
        var first = document.createRange()
        first.setStart(rendered, 0)
        first.setEndBefore(para)
        // Not if it opens the page: there is nowhere to send it.
        if (first.toString().trim() !== '') {
          var all = overflow.cloneRange()
          all.setStartBefore(para)
          return all
        }
      }
      return
    }

    // Then the row above a heading, which is for paragraphs only.
    if (para.tagName !== 'P') return
    var tail = linesToNextSpan(whole, perLine, left)
    if (tail >= TAIL) return

    // As many lines as it takes, while three stay behind.
    var move = Math.min(TAIL - tail, here.length - 3)
    if (move < 1) return
    return cutAbove(move)
  }

  // A table too tall for any page, with no heading over it.
  //
  // Such a table has to divide somewhere. Held whole, it leaves the page it
  // was on and opens the next one — and takes along the paragraph that
  // introduces it, because Paged.js keeps a table with the block before it.
  // One page in the book stopped a quarter of the way down for that reason,
  // with a single word of the list above carried over to it. Allowed to
  // divide, the table starts where it falls, under its paragraph.
  function tallTable (range, rendered, bounds, source) {
    if (range.startContainer.nodeType !== 1) return null
    var node = range.startContainer.childNodes[range.startOffset]
    while (node && idle(node)) node = node.nextSibling
    if (!node || node.nodeType !== 1) return null
    var table = null
    if (node.matches('.table-figure')) {
      table = node
    } else if (onPage(node, rendered)) {
      // The block Paged.js is taking along with it.
      var after = node.nextSibling
      while (after && idle(after)) after = after.nextSibling
      if (after && after.nodeType === 1 && after.matches('.table-figure')) table = after
    }
    if (!table || table.style.breakInside === 'auto') return null
    var at = document.createRange()
    at.setStartBefore(table)
    at.collapse(true)
    return tooTallToFollow(at, [], bounds, source) === table ? table : null
  }

  // --- A word divided between two pages --------------------------------------
  //
  // When the last line of a page ends in a hyphenated word, Paged.js looks for
  // the first letter that is over the edge and breaks there. It asks each
  // letter for one box. The first letter after a hyphen that was used has
  // two — one where the hyphen was drawn, at the end of the line above, and
  // one where the letter is — and the box round both starts on the page. So
  // that letter is taken to be on the page, the break is put after it, and a
  // hyphen is added: a page ending "restit-" with "ution" overleaf, where
  // the word breaks resti-tution. Twenty-two page turns in the textbook.
  //
  // Two ways to put it right, and which is better depends on the line.
  //
  // The word can go over whole. Nobody then has to carry half a word across
  // a page turn. But the line it leaves is the last of its piece of the
  // paragraph, it is spread to the measure like the others, and it has just
  // lost a third of what was on it: tried on every case, this produced the
  // fourteen worst lines in the book, three words to a column.
  //
  // Or the break can be put where the hyphen is, which is simply correct.
  //
  // So the line decides. If the words left on it can be spread to the measure
  // with gaps of no more than an em, the word goes over whole; if not, it is
  // divided at its hyphen.
  //
  // A break after a real hyphen, in a compound, is not inside a word and is
  // left where it is.
  var SOFT_HYPHEN = '\u00AD'
  function inWord (ch) { return !!ch && (ch === SOFT_HYPHEN || /[A-Za-z\u00C0-\u024F]/.test(ch)) }

  function boxOf (node, offset, wide) {
    var one = document.createRange()
    one.setStart(node, offset)
    one.setEnd(node, offset + 1)
    var list = one.getClientRects()
    for (var i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].height > 0 && (wide ? list[i].width > 0.5 : list[i].width > 0)) return list[i]
    }
    return null
  }

  // Can the line spare the piece of a word that runs from `start` to the soft
  // hyphen at `soft`? True, false, or null when it cannot be measured.
  function absorbs (node, start, soft) {
    var text = node.textContent
    var para = node.parentNode && node.parentNode.closest ? node.parentNode.closest('p, li, dd') : null
    if (!para) return null
    var first = boxOf(node, start)
    var hyphen = boxOf(node, soft, true)
    if (!first || !hyphen) return null
    // The column this line is in.
    var column = null
    Array.prototype.forEach.call(para.getClientRects(), function (r) {
      if (first.left >= r.left - 1 && first.left <= r.right + 1 && first.top >= r.top - 2 && first.bottom <= r.bottom + 2) column = r
    })
    if (!column) return null
    var gaps = 0
    var gap = null
    for (var i = start - 1; i >= 0; i -= 1) {
      if (text[i] === SOFT_HYPHEN) continue
      var box = boxOf(node, i)
      if (/\s/.test(text[i])) {
        // a space on this line: the letter after it is on this line
        gaps += 1
        continue
      }
      if (!box) continue
      if (Math.abs(box.top - first.top) > 3) {
        // The line above: the space just counted ended it and is not a gap.
        if (i + 1 < start && /\s/.test(text[i + 1])) gaps -= 1
        var em = parseFloat(window.getComputedStyle(para).fontSize) || 12.8
        if (gap === null || gaps < 2) return false
        var wordsWidth = (first.left - column.left) - gaps * gap
        var spread = (column.width - wordsWidth) / (gaps - 1)
        return spread <= em
      }
      if (gap === null) gap = first.left - box.right
    }
    // Ran out of this run of text while still on the line.
    return null
  }

  function wholeWord (overflow) {
    var node = overflow.startContainer
    if (node.nodeType !== 3) return overflow
    var text = node.textContent
    var at = overflow.startOffset
    if (!inWord(text[at - 1]) || !inWord(text[at])) return overflow
    var start = at
    while (start > 0 && inWord(text[start - 1])) start -= 1
    var out = overflow.cloneRange()
    // The hyphen the browser used: the last one before the break.
    var soft = text.lastIndexOf(SOFT_HYPHEN, at - 1)
    if (soft > start && absorbs(node, start, soft) !== true) {
      out.setStart(node, soft + 1)
      return out
    }
    out.setStart(node, start)
    return out
  }

  class KeepHeadings extends window.Paged.Handler {
    // Whatever is decided below, a break that lands inside a word is put
    // right before it is handed back. Several of the paths ask Paged.js to
    // look for the overflow again, and it answers with the same mistake.
    onOverflow (overflow, rendered, bounds, layout) {
      var answer = this.decide(overflow, rendered, bounds, layout)
      if (answer && answer.startContainer && answer.startContainer.nodeType === 3) return wholeWord(answer)
      return answer
    }

    // Paged.js adds a hyphen to the foot of a page whenever the text there
    // ends in a letter or a figure — including when what ends there is a
    // reference number, and the page closes on "2588-". A hyphen it added
    // after anything but a word's own hyphenation point is taken off.
    afterPageLayout (pageElement) {
      if (!pageElement || !pageElement.querySelectorAll) return
      pageElement.querySelectorAll('.pagedjs_hyphen').forEach(function (el) {
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        var last = null
        var node
        while ((node = walker.nextNode())) if (node.textContent) last = node
        if (!last) return
        var text = last.textContent
        if (text[text.length - 1] !== '\u2011') return
        if (text[text.length - 2] === SOFT_HYPHEN) return
        last.textContent = text.slice(0, -1)
        el.classList.remove('pagedjs_hyphen')
      })
    }

    decide (overflow, rendered, bounds, layout) {
      if (!overflow || !rendered) return
      var source = this.chunker && this.chunker.source
      // A break inside a paragraph has no heading to keep; the one question
      // is whether too little of the paragraph is going over.
      if (overflow.startContainer.nodeType === 3) {
        var whole = wholeWord(overflow)
        var tail = shortTail(whole, rendered, source)
        if (tail) return wholeWord(tail)
        return whole !== overflow ? whole : undefined
      }
      var range = pastPulled(overflow, rendered)
      // Everything is on the page: Paged.js was looking at an empty wrapper.
      if (range === null) return null
      var run = runAbove(range, rendered)
      if (!run.length && layout && typeof layout.findOverflow === 'function') {
        var long = tallTable(range, rendered, bounds, source)
        if (long) {
          long.style.breakInside = 'auto'
          void long.offsetHeight
          var cut = layout.findOverflow(rendered, bounds)
          if (!cut) return null
          cut = pastPulled(cut, rendered)
          if (cut === null) return null
          if (cut.compareBoundaryPoints(Range.START_TO_START, range) > 0) return cut
          long.style.breakInside = ''
        }
      }
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

  // --- Page references are set before the page is broken ---------------------
  //
  // Paged.js fills in `target-counter(attr(href), page)` after a page has been
  // laid out and its break decided. Until then the reference prints as "0".
  // On the pages of an index that is every line: the page is broken with a
  // column of zeroes, the real numbers go in, the ones that are two digits
  // longer and sat on a nearly full line wrap, the column grows by a line or
  // two, and whatever was last in it is pushed past the foot of the page
  // where nothing prints. The break has already been made after it, so the
  // next page does not have it either. The textbook's index lost the letter O
  // and four entries that way, at three of its thirteen page breaks, and the
  // author found the first.
  //
  // So a reference to something already on an earlier page is given its
  // number as it is put on the page, not after. The number is the one
  // Paged.js will work out for itself a moment later, set the way it sets
  // it — a counter, named as its rewritten stylesheet names it — one level
  // up, on the link, where the generated text can see it. Nothing is changed
  // when Paged.js then sets the same value on the generated text itself.
  //
  // A reference to something on a later page cannot be done this way and is
  // left alone. A contents page is the usual case, and its numbers sit in
  // room kept for them at the end of the line, where their width moves
  // nothing.
  var COUNTER = /counter\(\s*(target-counter-[\w-]+)/

  class EarlyReferences extends window.Paged.Handler {
    constructor (chunker, polisher, caller) {
      super(chunker, polisher, caller)
      this.counts = []
    }

    // The page counter on each sheet, worked out as Paged.js does it and kept.
    countAt (index, pages) {
      for (var i = this.counts.length; i <= index; i += 1) {
        var styles = window.getComputedStyle(pages[i])
        var reset = styles.counterReset.replace('page', '').trim()
        var increment = styles.counterIncrement.replace('page', '').trim()
        var count = i ? this.counts[i - 1] : 0
        if (reset !== 'none' && !isNaN(parseInt(reset, 10))) count = parseInt(reset, 10)
        if (increment !== 'none' && !isNaN(parseInt(increment, 10))) count += parseInt(increment, 10)
        this.counts.push(count)
      }
      return this.counts[index]
    }

    // Paged.js puts a block on the page whole — a paragraph, a list — and
    // calls this once for it, so the links are looked for inside it.
    renderNode (node) {
      if (!node || node.nodeType !== 1 || !node.isConnected) return
      var area = this.chunker && this.chunker.pagesArea
      if (!area) return
      var links = node.tagName === 'A' ? [node] : node.querySelectorAll('a[href^="#"]')
      for (var i = 0; i < links.length; i += 1) this.number(links[i], area)
    }

    number (link, area) {
      var href = link.getAttribute('href')
      if (!href || href.charAt(0) !== '#' || href.length < 2) return
      var name = null
      var pseudos = ['::after', '::before']
      for (var p = 0; p < pseudos.length && !name; p += 1) {
        var found = COUNTER.exec(window.getComputedStyle(link, pseudos[p]).content || '')
        if (found) name = found[1]
      }
      if (!name) return
      var target = document.getElementById(href.slice(1))
      if (!target || !area.contains(target)) return
      var sheet = target.closest('.pagedjs_page')
      if (!sheet) return
      var pages = area.querySelectorAll('.pagedjs_page')
      var index = Array.prototype.indexOf.call(pages, sheet)
      // Not the page being laid out now: its place on that page is not
      // settled, and Paged.js will number it when it is.
      if (index < 0 || index >= pages.length - 1) return
      link.style.counterReset = name + ' ' + this.countAt(index, pages)
    }
  }

  window.Paged.registerHandlers(KeepHeadings, EarlyReferences)
}
