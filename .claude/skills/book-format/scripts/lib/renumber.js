'use strict'
//
// Number the book the way a book is numbered: front matter in roman, the body
// restarting at 1.
//
// This cannot be done in CSS here. Paged.js numbers pages with one cumulative
// counter — `.pagedjs_pages { counter-reset: page 0 }` and
// `.pagedjs_page { counter-increment: page var(--pagedjs-page-counter-increment) }`
// — and three ways of restarting it were tried and measured:
//
//   counter-reset: page 1    on the body element   i ii iii 1 4 5
//   the same, injected after pagination            i ii iii 1 4 5
//   counter-increment: page 0 on the front matter  no effect at all
//
// The reset takes on the page that carries it and the next page resumes the
// old count, which is worse than not restarting at all. So the folio is set
// after pagination instead, from the page's position in the finished book,
// which is the only point at which the answer is actually known.
//
// Every page reference in the contents and the index is resolved the same way
// and for the same reason: those print `target-counter(attr(href), page)`,
// which reads the counter this is overriding, so left alone they would name
// pages by numbers the pages no longer show.
//
// Runs inside the browser, after Paged.js has finished and before anything is
// printed. Returns a report rather than logging, so the caller can fail loudly.

const ROMAN = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],
               [50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']]

// The body of the function is sent to the page as a string, so it carries its
// own helpers and takes no closure.
function inBrowser (opts) {
  var ROMAN = opts.roman
  function roman (n) {
    var out = ''
    for (var i = 0; i < ROMAN.length; i += 1) {
      while (n >= ROMAN[i][0]) { out += ROMAN[i][1]; n -= ROMAN[i][0] }
    }
    return out
  }

  var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'))
  if (!pages.length) return { ok: false, reason: 'no pages' }

  // The body begins at the first page of the first part. Asking the page for
  // its named-page class is steadier than counting components, because a
  // blank verso inserted before a part belongs to neither.
  var bodyStart = -1
  for (var i = 0; i < pages.length; i += 1) {
    if (/pagedjs_part\d+_page/.test(pages[i].className)) { bodyStart = i; break }
  }
  if (bodyStart < 0) return { ok: false, reason: 'no part pages found' }

  function folioFor (index) {           // index is 0-based
    return index < bodyStart ? roman(index + 1) : String(index - bodyStart + 1)
  }

  // --- the folio on each page -------------------------------------------
  // Which margin box holds it differs by side, so it is found by what it
  // prints rather than by where it sits.
  var stamped = 0
  pages.forEach(function (pg, idx) {
    var label = folioFor(idx)
    pg.setAttribute('data-folio', label)
    var boxes = pg.querySelectorAll('.pagedjs_margin-content')
    Array.prototype.forEach.call(boxes, function (box) {
      var c = window.getComputedStyle(box, '::after').content
      if (/counter\(\s*page/.test(c)) {
        box.setAttribute('data-folio', label)
        stamped += 1
      }
    })
  })

  // --- every page reference ---------------------------------------------
  // The id may sit on an empty anchor the build emitted, so the page is taken
  // from whatever element carries it, wherever Paged.js put it.
  var pageOf = new Map()
  pages.forEach(function (pg, idx) { pageOf.set(pg, idx) })
  function pageIndexOf (el) {
    var pg = el.closest ? el.closest('.pagedjs_page') : null
    return pg && pageOf.has(pg) ? pageOf.get(pg) : -1
  }

  // An empty anchor marks whatever comes after it, and that is not always on
  // the anchor's own page. The build puts the anchors in front of a heading,
  // often as the last thing in the block before it; when the heading opens a
  // page — by falling there, or because it was taken over with its content —
  // the anchors stay at the foot of the page before. Read literally, twenty
  // contents entries in this book gave the page before the one their section
  // starts on. So an empty anchor is followed forward to the first thing a
  // reader would see, and that is the page given.
  var flow = document.querySelector('.pagedjs_pages') || document.body
  function landing (el) {
    if (el.tagName !== 'A' || el.children.length || el.textContent.trim()) return el
    var walker = document.createTreeWalker(flow, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    walker.currentNode = el
    for (var steps = 0; steps < 600; steps += 1) {
      var node = walker.nextNode()
      if (!node) break
      var holder = node.nodeType === 3 ? node.parentElement : node
      if (!holder || !holder.closest('.pagedjs_page_content')) continue
      if (node.nodeType === 3) {
        if (node.textContent.trim() && holder.getBoundingClientRect().height > 0) return holder
      } else if (node.matches('img, svg, table, hr')) {
        return node
      }
    }
    return el
  }

  var links = document.querySelectorAll(opts.refSelector)
  var resolved = 0, unresolved = []
  Array.prototype.forEach.call(links, function (a) {
    var href = a.getAttribute('href') || ''
    if (href.charAt(0) !== '#') return
    var id = href.slice(1)
    var target = document.getElementById(id) ||
                 document.querySelector('[data-id="' + CSS.escape(id) + '"]')
    if (!target) { unresolved.push(id); return }
    var idx = pageIndexOf(landing(target))
    if (idx < 0) idx = pageIndexOf(target)
    if (idx < 0) { unresolved.push(id); return }
    a.setAttribute('data-folio', folioFor(idx))
    resolved += 1
  })

  var style = document.createElement('style')
  style.id = 'pagedjs-renumber'
  style.textContent =
    '.pagedjs_margin-content[data-folio]::after{content:attr(data-folio)!important}\n' +
    'a[data-folio]::after{content:attr(data-folio)!important}\n' +
    '.index a[data-folio]::before,.reference-index a[data-folio]::before' +
      '{content:attr(data-folio)!important}\n' +
    '.index.index li > a[href][data-folio]::after{content:"  "attr(data-folio)!important}'
  document.head.appendChild(style)

  return {
    ok: true,
    pages: pages.length,
    bodyStartsAtPage: bodyStart + 1,
    frontMatterPages: bodyStart,
    bodyPages: pages.length - bodyStart,
    foliosStamped: stamped,
    refsResolved: resolved,
    refsUnresolved: unresolved.length,
    unresolvedSample: unresolved.slice(0, 8)
  }
}

module.exports = {
  ROMAN,
  // The caller does: page.evaluate(renumber.source, renumber.options())
  source: inBrowser,
  options: function (refSelector) {
    return {
      roman: ROMAN,
      refSelector: refSelector ||
        '.contents-page a[href^="#"], .toc-list a[href^="#"], ' +
        '.index a[href^="#"], .reference-index a[href^="#"]'
    }
  }
}
