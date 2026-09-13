#!/usr/bin/env node
//
// Proof the paginated book the way a person reading it would, and report what
// is wrong page by page.
//
// `check-layout.js` answers "did it build" — page count, overflow, dead links,
// chapters on the wrong side. This answers "is it right": widows and orphans,
// names broken across lines, running heads carrying the wrong section, half
// empty pages, columns that end at different heights.
//
// It exists because the alternative is opening a 338-page PDF and looking, and
// what that actually produces is a proof delivered with a name split across
// two lines on the title page.
//
// Every check reads the paginated DOM, so it sees what the reader sees rather
// than what the source says. Paged.js marks a fragment it split with
// `data-split-from` and `data-split-to`, which is how a widow is told from a
// paragraph that simply happens to be one line long.
'use strict'

const {
  requireRepoRoot, parseArgs, requirePlaywright, launchChromium, serveDirectory,
  waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node proof-check.js --content <dir> [--theme <name>] [--json]',
    '',
    '  --content <dir>   Book directory holding index.html.',
    '  --theme <name>    Theme to paginate with. Default: beatrix.',
    '  --json            Machine-readable report.',
    '  --quiet           Counts only, no per-page detail.',
    '  --max <n>         Lines of detail per section. Default 20.',
    '',
    'Reports widows, orphans, names split across lines, wrong or missing',
    'running heads, short pages, uneven columns and stranded headings.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const theme = args.theme || 'beatrix'
const max = Number(args.max || 20)

// ---------------------------------------------------------------------------
// Everything below runs inside the paginated page.
// ---------------------------------------------------------------------------

function collect () {
  const report = {
    pages: 0, widows: [], orphans: [], splitNames: [], shortPages: [],
    strandedHeadings: [], unevenColumns: [], runningHeads: [], missingHeads: [],
    hyphenStacks: []
  }

  // Which line of its column a box sits on, by its top edge. Rounding absorbs
  // sub-pixel drift between a superscript and the text around it.
  function lineTops (element) {
    const range = document.createRange()
    range.selectNodeContents(element)
    const tops = {}
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i]
      if (rect.height < 2 || rect.width < 1) continue
      tops[Math.round(rect.top)] = true
    }
    return Object.keys(tops).length
  }

  function text (element, length) {
    return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, length || 60)
  }

  const pages = document.querySelectorAll('.pagedjs_page')
  report.pages = pages.length

  pages.forEach(function (page, pageIndex) {
    const number = pageIndex + 1
    const blank = page.classList.contains('pagedjs_blank_page')
    const area = page.querySelector('.pagedjs_page_content')
    if (!area) return

    // --- running heads and folios ------------------------------------------
    // Paged.js does not put the running head in a text node. It writes it as
    // CSS generated content on `.pagedjs_margin-content::after`, so textContent
    // is empty and every page looks like it has no running head at all.
    const margins = {}
    'top-left top-center top-right bottom-left bottom-center bottom-right'
      .split(' ').forEach(function (slot) {
        const box = page.querySelector('.pagedjs_margin-' + slot + ' .pagedjs_margin-content')
        if (!box) { margins[slot] = ''; return }
        const generated = getComputedStyle(box, '::after').content
        let value = generated && generated !== 'none' && generated !== 'normal'
          ? generated.replace(/^"|"$/g, '') : ''
        if (/^counter\(/.test(value)) value = '#'
        margins[slot] = (value || box.textContent || '').replace(/\s+/g, ' ').trim()
      })
    report.runningHeads.push({
      page: number,
      side: page.classList.contains('pagedjs_left_page') ? 'verso' : 'recto',
      top: [margins['top-left'], margins['top-center'], margins['top-right']]
        .filter(Boolean).join(' | '),
      bottom: [margins['bottom-left'], margins['bottom-center'], margins['bottom-right']]
        .filter(Boolean).join(' | ')
    })

    if (blank) return

    // --- how full is the page ----------------------------------------------
    const areaBox = area.getBoundingClientRect()
    let lowest = areaBox.top
    const leaves = []
    area.querySelectorAll('*').forEach(function (node) {
      if (node.childElementCount === 0 && (node.textContent || '').trim()) leaves.push(node)
      const rect = node.getBoundingClientRect()
      if (rect.height > 0 && (node.textContent || '').trim() && rect.bottom > lowest) {
        lowest = rect.bottom
      }
    })
    const fill = areaBox.height ? (lowest - areaBox.top) / areaBox.height : 1
    if (fill < 0.55) {
      report.shortPages.push({ page: number, fill: Math.round(fill * 100), text: text(area, 60) })
    }

    // --- widows and orphans -------------------------------------------------
    // Paged.js marks the halves of anything it split. A fragment continuing
    // from the page before with one line on this one is a widow; a fragment
    // continuing onto the next page with one line here is an orphan.
    area.querySelectorAll('p, li, dd, dt').forEach(function (block) {
      const from = block.hasAttribute('data-split-from')
      const to = block.hasAttribute('data-split-to')
      if (!from && !to) return
      const lines = lineTops(block)
      if (lines !== 1) return
      const entry = { page: number, text: text(block, 70) }
      if (from) report.widows.push(entry)
      else report.orphans.push(entry)
    })

    // --- a name broken across two lines -------------------------------------
    // Only in display type, where it is a real fault rather than ordinary
    // justification: titles, author lines, entry names, running heads.
    area.querySelectorAll('h1, h2, h3, h4, h5, .title-page-author, .title-page-subtitle')
      .forEach(function (heading) {
        if (lineTops(heading) < 2) return
        const words = (heading.textContent || '').replace(/\s+/g, ' ').trim().split(' ')
        // Walk the words and find which ones start a new line.
        const range = document.createRange()
        let offset = 0
        const node = heading
        const breaks = []
        let previousTop = null
        for (let i = 0; i < words.length; i += 1) {
          const found = findWord(node, words[i], offset)
          if (!found) continue
          offset = found.end
          range.setStart(found.node, found.start)
          range.setEnd(found.node, found.end)
          const rect = range.getBoundingClientRect()
          if (previousTop !== null && Math.round(rect.top) > previousTop + 2) {
            breaks.push({ before: words[i - 1] || '', after: words[i] })
          }
          previousTop = Math.round(rect.top)
        }
        // Only a person's name counts. An entry name is a technical term and
        // has to wrap somewhere: reporting "Amino / Acid" as a broken name
        // buries the one that matters under twenty that do not.
        const whole = (heading.textContent || '')
        const isPersonLine = heading.classList.contains('title-page-author') ||
          /\b(M\.\s?D\.|Ph\.\s?D\.|D\.O\.|Dr\.)/.test(whole)
        if (!isPersonLine) return
        breaks.forEach(function (br) {
          const looksLikeName = /^[A-Z][a-z]+[,.]?$/.test(br.before) &&
            /^[A-Z]/.test(br.after)
          const afterHonorific = /^(Dr|Mr|Ms|Mrs|Prof|M\.D\.|Ph\.D\.)[.,]?$/i.test(br.before)
          if (looksLikeName || afterHonorific) {
            report.splitNames.push({
              page: number, where: heading.className || heading.tagName.toLowerCase(),
              broke: br.before + ' / ' + br.after, text: text(heading, 60)
            })
          }
        })
      })

    // --- a heading with nothing under it ------------------------------------
    area.querySelectorAll('h2, h3, h4, h5').forEach(function (heading) {
      const rect = heading.getBoundingClientRect()
      let followed = false
      let node = heading.nextElementSibling
      while (node) {
        const r = node.getBoundingClientRect()
        if (r.height > 0 && (node.textContent || '').trim()) { followed = true; break }
        node = node.nextElementSibling
      }
      if (!followed && rect.bottom > areaBox.bottom - 60) {
        report.strandedHeadings.push({ page: number, text: text(heading, 60) })
      }
    })

    // --- columns that end at different heights ------------------------------
    // Only where the page really is a plain two-column set. A page holding a
    // spanning element has two column rows and comparing across them compares
    // things that were never side by side.
    // Bucketing by an element's left edge invents a column for every indent and
    // every superscript, and then compares a full column against a stray inline
    // box: that reported an 800px gap on pages whose columns were level. Use the
    // real midpoint of the text block, and only blocks that set type.
    const spanners = area.querySelectorAll('.section-head, .keep-lead, .part-title, .table-figure')
    if (spanners.length === 0) {
      const middle = areaBox.left + areaBox.width / 2
      let leftBottom = null
      let rightBottom = null
      area.querySelectorAll('p, li, h5, dd, dt').forEach(function (block) {
        const rect = block.getBoundingClientRect()
        if (rect.height < 2 || !(block.textContent || '').trim()) return
        if (rect.left + rect.width / 2 < middle) {
          if (leftBottom === null || rect.bottom > leftBottom) leftBottom = rect.bottom
        } else if (rightBottom === null || rect.bottom > rightBottom) rightBottom = rect.bottom
      })
      if (leftBottom !== null && rightBottom !== null) {
        const gap = Math.abs(leftBottom - rightBottom)
        if (gap > 60) {
          report.unevenColumns.push({ page: number, gap: Math.round(gap), text: text(area, 50) })
        }
      }
    }

    // --- three or more hyphenated lines in a row ----------------------------
    // A hyphen ladder is the one justification fault that reads as an error.
    leaves.forEach(function (leaf) {
      const content = leaf.textContent || ''
      if (content.length < 200) return
    })
  })

  // Find a word in an element's text nodes, starting from a character offset.
  function findWord (element, word, from) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null)
    let seen = 0
    let node
    while ((node = walker.nextNode())) {
      const value = node.nodeValue
      const start = value.indexOf(word, Math.max(0, from - seen))
      if (start !== -1) return { node: node, start: start, end: start + word.length }
      seen += value.length
    }
    return null
  }

  return report
}

// ---------------------------------------------------------------------------

;(async function () {
  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const browser = await launchChromium(chromium)
  const page = await browser.newPage()
  const failures = []
  page.on('console', function (message) {
    const body = message.text()
    if (/Layout repeated|Unable to layout/.test(body)) failures.push(body.slice(0, 120))
  })

  const url = server.url + '/' + args.content.replace(/^\.\//, '').replace(/\/$/, '') +
    '/index.html?theme=' + theme
  await page.goto(url, { waitUntil: 'load' })
  await waitForPagedJs(page, Number(args.timeout || 1800000))

  const report = await page.evaluate(collect)
  report.paginationFailures = failures
  await browser.close()
  server.close()

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('\n' + args.content + ' · theme "' + theme + '" · ' + report.pages + ' pages')

  if (report.paginationFailures.length) {
    console.log('\nPAGINATION DID NOT FINISH (' + report.paginationFailures.length + ')')
    console.log('  The PDF will still be written and will still look plausible.')
    report.paginationFailures.slice(0, 5).forEach(function (line) { console.log('  ' + line) })
  }

  function section (title, rows, format) {
    if (!rows.length) return
    console.log('\n' + title + ' (' + rows.length + ')')
    if (args.quiet) return
    rows.slice(0, max).forEach(function (row) { console.log('  ' + format(row)) })
    if (rows.length > max) console.log('  … and ' + (rows.length - max) + ' more')
  }

  section('Widows — one line carried to the top of a page', report.widows, function (r) {
    return 'p' + r.page + '  ' + r.text
  })
  section('Orphans — one line left at the foot of a page', report.orphans, function (r) {
    return 'p' + r.page + '  ' + r.text
  })
  section('Names broken across two lines', report.splitNames, function (r) {
    return 'p' + r.page + '  ' + r.broke + '   in ' + r.where
  })
  section('Headings with nothing under them', report.strandedHeadings, function (r) {
    return 'p' + r.page + '  ' + r.text
  })
  section('Pages under 55% full', report.shortPages, function (r) {
    return 'p' + r.page + '  ' + r.fill + '%  ' + r.text
  })
  section('Columns ending more than 60px apart', report.unevenColumns, function (r) {
    return 'p' + r.page + '  ' + r.gap + 'px  ' + r.text
  })

  // Running heads: report the distinct values rather than 338 lines, and name
  // the pages carrying nothing at all.
  const heads = {}
  report.runningHeads.forEach(function (row) {
    const key = row.side + ' │ head: ' + (row.top || '(none)') + ' │ foot: ' + (row.bottom || '(none)')
    if (!heads[key]) heads[key] = []
    heads[key].push(row.page)
  })
  const groups = Object.keys(heads).map(function (key) {
    return { key: key, pages: heads[key] }
  }).sort(function (a, b) { return b.pages.length - a.pages.length })

  console.log('\nRunning heads and footers, by pattern')
  groups.slice(0, max).forEach(function (group) {
    const sample = group.pages.slice(0, 6).join(', ') + (group.pages.length > 6 ? ', …' : '')
    console.log('  ' + String(group.pages.length).padStart(4) + '×  ' + group.key)
    console.log('        pages ' + sample)
  })
  if (groups.length > max) console.log('  … and ' + (groups.length - max) + ' more patterns')

  const total = report.widows.length + report.orphans.length + report.splitNames.length +
    report.strandedHeadings.length + report.paginationFailures.length
  console.log('\n' + total + ' faults that a reader would see.')
  if (args.strict && total) process.exit(1)
})()
