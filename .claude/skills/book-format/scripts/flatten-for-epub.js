#!/usr/bin/env node
//
// Take the print book back to plain structure, so an EPUB can be built from it.
//
// `make-epub.js` says the EPUB must be built from the converter's output and
// never from the designed book, and it is right about why: the print book is
// full of scaffolding for a page of a fixed size. This script exists because
// that rule stopped being followable. Once a book has been through proof
// correction, the corrections are in the designed copy and nowhere else — on
// this book, 2,897 restored full stops, a rebuilt contents, twelve redrawn
// figures, the ISBN. The converter's output is the manuscript as it arrived.
//
// So this undoes the scaffolding, mechanically, and hands `make-epub.js` the
// shape it expects:
//
//   split paragraphs      The design pass cuts a paragraph in two so its first
//                         lines hold to the heading above. The halves are
//                         rejoined. Every seam in this book falls between two
//                         words, so a space goes between them — checked, not
//                         assumed: the script counts seams that end in a
//                         hyphen and reports them.
//   soft hyphens          Removed. They were placed for one measure in one
//                         face; a reader's device hyphenates for its own.
//   running heads         Removed, with the hidden duplicate of each entry
//                         name that fed them.
//   keep-together boxes   Unwrapped.
//   headings              Renumbered so each file's outline is honest: part,
//                         section, topic, entry, label.
//   parts                 Cut into one component per section. A part of three
//                         hundred pages in one file is slow to open on every
//                         reader and refused by some.
//   figures               Drawn to PNG. Inline SVG with embedded type is the
//                         one thing readers disagree about most; a picture
//                         is a picture everywhere.
//   citations             Left as numbers. The reference list is published
//                         apart from the book, so in the book they are keys,
//                         not links; a link that goes nowhere is worse.
//   contents              Kept as a marker only. An EPUB has real navigation.
//
// It writes a new directory and never touches the book it reads.
'use strict'

const fs = require('fs')
const path = require('path')
const { requireRepoRoot, parseArgs, requirePlaywright, launchChromium } = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content || !args.out) {
  console.log([
    'Usage: node flatten-for-epub.js --content <dir> --out <dir> [--cover-title <t>]',
    '',
    '  --content <dir>  The designed book: the directory holding index.html.',
    '                   Never modified.',
    '  --out <dir>      Where the flattened book goes: index.html and images/.',
    '  --no-cover       Do not draw a cover image.',
    '',
    'Then: node make-epub.js --content <out dir> --css <stylesheet> --fonts <dir>'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const contentDir = path.resolve(args.content)
const outDir = path.resolve(args.out)
const source = path.join(contentDir, 'index.html')
if (!fs.existsSync(source)) {
  console.error('No index.html in ' + contentDir)
  process.exit(1)
}

// Runs in the browser. Returns the flattened components and the artwork.
function flatten () {
  const report = { seams: 0, seamsOnHyphen: 0, softHyphens: 0, citations: 0, deadLinks: 0 }
  const art = []
  const emblems = []

  // --- soft hyphens -------------------------------------------------------
  const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let text
  while ((text = texts.nextNode())) {
    if (text.nodeValue.indexOf('­') === -1) continue
    report.softHyphens += text.nodeValue.split('­').length - 1
    text.nodeValue = text.nodeValue.split('­').join('')
  }
  document.querySelectorAll('[title]').forEach(function (el) {
    el.setAttribute('title', el.getAttribute('title').split('­').join(''))
  })

  function unwrap (el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el)
    el.remove()
  }
  function rename (el, tag) {
    const fresh = document.createElement(tag)
    Array.prototype.forEach.call(el.attributes, function (a) { fresh.setAttribute(a.name, a.value) })
    while (el.firstChild) fresh.appendChild(el.firstChild)
    el.replaceWith(fresh)
    return fresh
  }
  function emptyAnchor (node) {
    return node && node.nodeType === 1 && node.tagName === 'A' && !node.textContent.trim() && !node.children.length
  }

  // --- things that exist only for the page ---------------------------------
  document.querySelectorAll('.run-head, .topic-head, h1.part-name').forEach(function (el) { el.remove() })

  // --- split paragraphs ------------------------------------------------------
  document.querySelectorAll('p.lead-head').forEach(function (head) {
    // The other half is the next paragraph after the box the first half is in.
    let holder = head
    while (holder.parentElement && !holder.nextElementSibling) holder = holder.parentElement
    let rest = holder.nextElementSibling
    while (emptyAnchor(rest)) rest = rest.nextElementSibling
    if (rest && rest.matches('p.lead-rest')) {
      if (/-$/.test(head.textContent)) report.seamsOnHyphen += 1
      head.appendChild(document.createTextNode(' '))
      while (rest.firstChild) head.appendChild(rest.firstChild)
      rest.remove()
      report.seams += 1
    }
    head.classList.remove('lead-head', 'lead-whole')
    if (!head.className) head.removeAttribute('class')
  })
  document.querySelectorAll('p.lead-rest').forEach(function (p) { p.removeAttribute('class') })

  // --- citations and links that land nowhere --------------------------------
  document.querySelectorAll('sup.cite').forEach(function (sup) {
    sup.querySelectorAll('a').forEach(unwrap)
    sup.className = 'cite'
    report.citations += 1
  })
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    const id = decodeURIComponent(a.getAttribute('href').slice(1))
    if (document.getElementById(id)) return
    report.deadLinks += 1
    unwrap(a)
  })

  // --- link targets that belong to what follows them ------------------------
  // An entry ends with the anchors for the heading after it. Left there, a
  // link to the next section lands at the foot of the previous file.
  document.querySelectorAll('.entry').forEach(function (entry) {
    const trailing = []
    let last = entry.lastElementChild
    while (emptyAnchor(last)) { trailing.unshift(last); last = last.previousElementSibling }
    trailing.reverse().forEach(function (a) { entry.after(a) })
  })

  // --- boxes and headings ----------------------------------------------------
  document.querySelectorAll('.keep-label, .entry-lead, .keep-index').forEach(unwrap)
  document.querySelectorAll('p.label').forEach(function (p) { rename(p, 'h5') })
  document.querySelectorAll('h5.entry-name').forEach(function (h) {
    const number = h.querySelector('.entry-number')
    if (number) number.after(document.createTextNode(' '))
    rename(h, 'h4')
  })
  let topic = 0
  document.querySelectorAll('.keep-lead.lead-section').forEach(function (box) {
    box.className = 'panel'
    const h = box.querySelector('h4')
    if (h) {
      const fresh = rename(h, 'h3')
      topic += 1
      if (!fresh.id) fresh.id = 'topic-' + topic
      fresh.setAttribute('data-nav', '')
    }
  })
  let section = 0
  document.querySelectorAll('.keep-lead.section-opener').forEach(function (box) {
    const h = box.querySelector('.section-head')
    if (h) {
      const fresh = rename(h, 'h2')
      fresh.removeAttribute('title')
      section += 1
      if (!fresh.id) fresh.id = 'section-' + section
    }
    box.setAttribute('data-section', '')
  })
  // A part's opener lists its sections. In print that is a list; here each
  // line can take the reader there.
  document.querySelectorAll('ol.part-contents').forEach(function (list) {
    const chapter = list.closest('.chapter')
    const heads = {}
    chapter.querySelectorAll('[data-section] h2').forEach(function (h) { heads[h.textContent.trim()] = h.id })
    list.querySelectorAll('li').forEach(function (li) {
      const id = heads[li.textContent.trim()]
      if (!id || li.querySelector('a')) return
      const a = document.createElement('a')
      a.setAttribute('href', '#' + id)
      while (li.firstChild) a.appendChild(li.firstChild)
      li.appendChild(a)
    })
  })
  document.querySelectorAll('.across').forEach(function (p) {
    p.classList.remove('across')
    if (!p.className) p.removeAttribute('class')
  })
  document.querySelectorAll('.abbrev').forEach(unwrap)

  // --- the index: one list under each letter ---------------------------------
  const index = document.querySelector('.chapter.index')
  if (index) {
    index.querySelectorAll('h3').forEach(function (h) { rename(h, 'h2').className = 'index-letter' })
    let open = null
    Array.prototype.slice.call(index.querySelectorAll('ul')).forEach(function (list) {
      let before = list.previousElementSibling
      while (emptyAnchor(before)) before = before.previousElementSibling
      if (open && before === open) {
        // Bring the row's anchor along, inside the item it marks.
        let a = list.previousElementSibling
        const anchors = []
        while (emptyAnchor(a)) { anchors.unshift(a); a = a.previousElementSibling }
        Array.prototype.slice.call(list.children).forEach(function (li) {
          anchors.forEach(function (x) { li.insertBefore(x, li.firstChild) })
          open.appendChild(li)
        })
        list.remove()
      } else {
        list.className = 'index-list'
        open = list
      }
    })
  }

  // --- artwork ---------------------------------------------------------------
  document.querySelectorAll('svg.figure-art').forEach(function (svg, i) {
    const name = 'images/figure-' + String(i + 1).padStart(2, '0') + '.png'
    const title = svg.querySelector('title')
    const box = svg.viewBox.baseVal
    art.push({ name: name, svg: new XMLSerializer().serializeToString(svg), ratio: box.height / box.width })
    const img = document.createElement('img')
    img.setAttribute('src', name)
    img.setAttribute('alt', title ? title.textContent.trim() : '')
    img.className = 'figure-art'
    const holder = svg.parentElement
    svg.replaceWith(img)
    // The drawing sat in a paragraph of its own; a picture needs no paragraph.
    if (holder.tagName === 'P' && holder.children.length === 1 && !holder.textContent.trim()) unwrap(holder)
  })

  // --- part openers ------------------------------------------------------------
  document.querySelectorAll('.part-opener').forEach(function (opener) {
    const chapter = opener.closest('.chapter')
    const n = (/part-(\d+)/.exec(chapter.className) || [])[1] || '1'
    const svg = opener.querySelector('svg.part-emblem')
    if (svg) {
      const name = 'images/part-' + n + '.png'
      emblems.push({ name: name, svg: new XMLSerializer().serializeToString(svg) })
      const img = document.createElement('img')
      img.setAttribute('src', name)
      img.setAttribute('alt', '')
      img.setAttribute('role', 'presentation')
      img.className = 'part-emblem'
      svg.replaceWith(img)
    }
    opener.className = 'part-opener part-' + n
    const eyebrow = opener.querySelector('.chapter-eyebrow')
    if (eyebrow) eyebrow.className = 'part-eyebrow'
    const title = opener.querySelector('.part-title')
    if (title) { const fresh = rename(title, 'h1'); fresh.removeAttribute('title') }
  })

  // --- build attributes --------------------------------------------------------
  document.querySelectorAll('[data-new], [data-wrap]').forEach(function (el) {
    el.removeAttribute('data-new'); el.removeAttribute('data-wrap')
  })

  // --- components --------------------------------------------------------------
  const out = []
  function serialize (nodes) {
    const box = document.createElement('div')
    nodes.forEach(function (n) { box.appendChild(n.cloneNode(true)) })
    return box.innerHTML
  }
  function push (classes, title, nodes, level) {
    const body = serialize(nodes)
    if (!body.replace(/<a id="[^"]*"><\/a>/g, '').trim()) return
    out.push({ classes: classes, title: title, level: level || 1, html: body })
  }

  Array.prototype.forEach.call(document.body.children, function (component) {
    if (component.tagName !== 'DIV') return
    const names = Array.prototype.filter.call(component.classList, function (c) { return c !== 'aet-md' })
    const inner = component.querySelector(':scope > div > div') || component
    const kids = Array.prototype.slice.call(inner.childNodes)
    const own = component.querySelector('h1')
    const header = component.getAttribute('data-header') || ''
    const title = own ? own.textContent.trim() : header

    if (names.indexOf('contents-page') !== -1) {
      out.push({ classes: ['chapter', 'contents-page'], title: 'Contents', level: 1, html: '<h1>Contents</h1>' })
      return
    }
    const part = /^part-\d+$/
    if (!names.some(function (c) { return part.test(c) })) {
      push(names, title, kids, 1)
      return
    }

    // A part: its opener, then one component for each section.
    let run = []
    let runTitle = header || title
    let level = 1
    let classes = ['chapter', 'part']
    function close () {
      // Anchors at the end of a run mark the section that follows it.
      const carry = []
      while (run.length) {
        const last = run[run.length - 1]
        if (last.nodeType === 3 && !last.nodeValue.trim()) { carry.unshift(run.pop()); continue }
        if (emptyAnchor(last)) { carry.unshift(run.pop()); continue }
        break
      }
      push(classes, runTitle, run, level)
      run = carry
    }
    kids.forEach(function (node) {
      if (node.nodeType === 1 && node.hasAttribute('data-section')) {
        close()
        const h = node.querySelector('h2')
        runTitle = h ? h.textContent.trim() : 'Section'
        level = 2
        classes = ['chapter', 'section']
        node.removeAttribute('data-section')
        node.removeAttribute('class')
        // The box around a section title held it to its text. Nothing to hold.
        while (node.firstChild) run.push(node.firstChild) && node.removeChild(node.firstChild)
        return
      }
      run.push(node)
    })
    // The last run keeps whatever anchors end it.
    push(classes, runTitle, run, level)
  })

  const titlePage = document.querySelector('.title-page')
  return {
    report: report,
    components: out,
    art: art,
    emblems: emblems,
    lang: document.documentElement.getAttribute('lang') || 'en',
    title: titlePage ? (titlePage.querySelector('h1') || {}).textContent || '' : '',
    subtitle: titlePage ? (titlePage.querySelector('.title-page-subtitle') || {}).textContent || '' : '',
    author: titlePage ? (titlePage.querySelector('.title-page-author') || {}).textContent || '' : ''
  }
}

function fontFaces () {
  const dir = path.join(root, 'fonts')
  const faces = [
    ['Source Sans 3', 400, 'normal', 'SourceSans3-Regular.ttf'],
    ['Source Sans 3', 600, 'normal', 'SourceSans3-Semibold.ttf'],
    ['Source Sans 3', 700, 'normal', 'SourceSans3-Bold.ttf'],
    ['Charis SIL', 400, 'normal', 'CharisSIL-Regular.ttf'],
    ['Charis SIL', 400, 'italic', 'CharisSIL-Italic.ttf'],
    ['Charis SIL', 700, 'normal', 'CharisSIL-Bold.ttf'],
    // The display face is licensed. It is used here only to draw the cover,
    // which is a picture; the font file itself never goes into the EPUB.
    ['Windorse', 400, 'normal', 'Windorse-Regular.ttf']
  ]
  return faces.filter(function (f) { return fs.existsSync(path.join(dir, f[3])) }).map(function (f) {
    const data = fs.readFileSync(path.join(dir, f[3])).toString('base64')
    return '@font-face{font-family:"' + f[0] + '";font-weight:' + f[1] + ';font-style:' + f[2] +
      ';src:url(data:font/ttf;base64,' + data + ') format("truetype")}'
  }).join('\n')
}

;(async function () {
  const { chromium } = requirePlaywright()
  const browser = await launchChromium(chromium)

  // The book is read as a document, not run: its script would paginate it.
  const reader = await browser.newContext({ javaScriptEnabled: false })
  const page = await reader.newPage()
  await page.goto('file://' + source, { waitUntil: 'domcontentloaded' })
  const book = await page.evaluate(flatten)
  await reader.close()

  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true })

  // --- the drawings ------------------------------------------------------------
  const faces = fontFaces()
  const studio = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1100, height: 1400 } })
  const easel = await studio.newPage()
  for (const figure of book.art) {
    await easel.setContent('<style>' + faces + ' html,body{margin:0;background:#fff} #f{width:1000px;padding:20px;background:#fff} svg{display:block;width:100%;height:auto}</style><div id="f">' + figure.svg + '</div>')
    await easel.evaluate(function () { return document.fonts.ready })
    await (await easel.$('#f')).screenshot({ path: path.join(outDir, figure.name) })
  }
  for (const emblem of book.emblems) {
    await easel.setContent('<style>html,body{margin:0;background:transparent} #f{width:450px;color:#fff} svg{display:block;width:100%;height:auto}</style><div id="f">' + emblem.svg + '</div>')
    await (await easel.$('#f')).screenshot({ path: path.join(outDir, emblem.name), omitBackground: true })
  }
  await studio.close()

  // --- a cover -------------------------------------------------------------------
  // A stand-in, in the book's own colours and type, so the file has a face in a
  // library. The designed cover replaces it: same name, same place.
  let cover = ''
  if (!args['no-cover']) {
    const frame = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1600, height: 2560 } })
    const sheet = await frame.newPage()
    const esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;') }
    await sheet.setContent('<style>' + faces + `
      html,body{margin:0}
      body{width:1600px;height:2560px;background:#137C7A;color:#fff;display:flex;flex-direction:column;
        justify-content:space-between;box-sizing:border-box;padding:190px 150px 170px}
      .rule{width:220px;height:6px;background:#B79A5B;margin-bottom:70px}
      h1{font-family:"Windorse","Charis SIL",Georgia,serif;font-weight:400;font-size:176px;line-height:1.04;margin:0 0 70px;letter-spacing:-1px}
      .sub{font-family:"Charis SIL",Georgia,serif;font-style:italic;font-size:56px;line-height:1.32;max-width:1150px;opacity:.94}
      .who{font-family:"Source Sans 3",Arial,sans-serif;font-weight:600;font-size:58px;letter-spacing:5px;text-transform:uppercase}
    </style><div><div class="rule"></div><h1>` + esc(book.title) + '</h1><div class="sub">' + esc(book.subtitle) +
      '</div></div><div class="who">' + esc(book.author) + '</div>')
    await sheet.evaluate(function () { return document.fonts.ready })
    cover = 'images/cover.jpg'
    await sheet.screenshot({ path: path.join(outDir, cover), type: 'jpeg', quality: 90 })
    await frame.close()
  }
  await browser.close()

  // --- the flat book ---------------------------------------------------------------
  const esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }
  const body = book.components.map(function (c) {
    return '<div class="' + c.classes.join(' ') + '" data-header="' + esc(c.title) + '"' +
      (c.level > 1 ? ' data-level="' + c.level + '"' : '') + '>\n' + c.html.trim() + '\n</div>'
  }).join('\n\n')
  fs.writeFileSync(path.join(outDir, 'index.html'),
    '<!DOCTYPE html>\n<html lang="' + book.lang + '">\n<head>\n<meta charset="utf-8">\n<title>' +
    esc(book.title) + '</title>\n' + (cover ? '<meta name="cover" content="' + cover + '">\n' : '') +
    '</head>\n<body>\n' + body + '\n</body>\n</html>\n')

  const r = book.report
  console.log('Flattened ' + path.relative(root, source) + ' → ' + path.relative(root, outDir))
  console.log('  components           ' + book.components.length + ' (' +
    book.components.filter(function (c) { return c.level > 1 }).length + ' sections cut out of the parts)')
  console.log('  paragraphs rejoined  ' + r.seams + (r.seamsOnHyphen ? '  (' + r.seamsOnHyphen + ' at a hyphen — read these)' : ''))
  console.log('  soft hyphens removed ' + r.softHyphens)
  console.log('  citation marks       ' + r.citations + ' left as numbers')
  console.log('  links to nowhere     ' + r.deadLinks + ' unlinked, text kept')
  console.log('  figures drawn        ' + book.art.length + ', part emblems ' + book.emblems.length + (cover ? ', cover' : ''))
})()
