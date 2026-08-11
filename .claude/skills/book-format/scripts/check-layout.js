#!/usr/bin/env node

// Paginate a book with Paged.js and report layout problems that are invisible
// in the source HTML: overflow, bad chapter openings, widows, orphans,
// stranded headings and labels, and unintended blanks.
//
//   node check-layout.js --content content/my-book --theme my-theme

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const {
  requireRepoRoot, parseArgs, requirePlaywright, serveDirectory,
  blockRemoteResources, watchForPagedJs, waitForPagedJs
} = require('./common')

const args = parseArgs(process.argv)

if (args.help || !args.content) {
  console.log([
    'Usage: node check-layout.js --content <dir> [--theme <name>] [options]',
    '',
    '  --content <dir>  Directory holding the book’s index.html.',
    '  --theme <name>   Theme to check. Default: beatrix.',
    '  --json           Emit the report as JSON.',
    '  --strict         Exit non-zero if any problem is found.',
    '  --timeout <ms>   How long to wait for pagination. Default: 300000.',
    '  --no-build       Skip rebuilding the theme CSS first.',
    '  --allow-remote   Let the page fetch remote resources (web fonts).'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

// Runs inside the paginated page.
function collectReport () {
  const report = {
    pages: 0,
    blankPages: [],
    overflow: [],
    oversizedImages: [],
    wrongSideOpenings: [],
    orphans: [],
    widows: [],
    strandedHeadings: [],
    unresolvedReferences: []
  }

  const pages = Array.prototype.slice.call(
    document.querySelectorAll('.pagedjs_page')
  )
  report.pages = pages.length

  function pageNumberOf (element) {
    const pageElement = element.closest('.pagedjs_page')
    return pageElement ? pages.indexOf(pageElement) + 1 : null
  }

  function describe (element) {
    let description = element.tagName.toLowerCase()
    if (element.id) description += '#' + element.id
    const className = (element.getAttribute('class') || '')
      .split(/\s+/)
      .filter(function (name) { return name && name.indexOf('pagedjs') !== 0 })
      .slice(0, 3)
      .join('.')
    if (className) description += '.' + className
    const text = (element.textContent || '').trim().replace(/\s+/g, ' ')
    if (text) description += ' — “' + text.slice(0, 60) + '”'
    return description
  }

  function lineCount (element) {
    const styles = window.getComputedStyle(element)
    const lineHeight = parseFloat(styles.lineHeight)
    if (!lineHeight) return null
    return Math.round(element.getBoundingClientRect().height / lineHeight)
  }

  pages.forEach(function (pageElement, index) {
    const number = index + 1
    const area = pageElement.querySelector('.pagedjs_page_content')
    if (!area) return

    if (pageElement.classList.contains('pagedjs_blank_page')) {
      report.blankPages.push(number)
    }

    // Content escaping the page box. Only leaf elements and replaced or
    // unbreakable blocks are measured: wrappers report the union of their
    // fragments, which is not overflow.
    const box = area.getBoundingClientRect()
    Array.prototype.slice.call(area.querySelectorAll('*')).forEach(function (element) {
      const isLeaf = element.children.length === 0
      const isBlock = /^(IMG|PRE|TABLE|FIGURE|SVG|VIDEO)$/.test(element.tagName)
      if (!isLeaf && !isBlock) return

      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return

      // Measure the layout box. A client rect can union boxes an element
      // never occupies as one piece, which reads as enormous false overflow.
      const right = rect.left + (element.offsetWidth || rect.width)
      const bottom = rect.top + (element.offsetHeight || rect.height)
      const overflowsRight = right - box.right > 2
      const overflowsBottom = bottom - box.bottom > 2
      if (!overflowsRight && !overflowsBottom) return

      report.overflow.push({
        page: number,
        by: Math.round(Math.max(right - box.right, bottom - box.bottom)),
        direction: overflowsBottom ? 'below the text area' : 'past the outer edge',
        element: describe(element)
      })
    })

    Array.prototype.slice.call(area.querySelectorAll('img')).forEach(function (image) {
      const rect = image.getBoundingClientRect()
      if (rect.height > box.height + 2 || rect.width > box.width + 2) {
        report.oversizedImages.push({
          page: number,
          element: describe(image),
          size: Math.round(rect.width) + '×' + Math.round(rect.height) + 'px',
          area: Math.round(box.width) + '×' + Math.round(box.height) + 'px'
        })
      }
    })

    // Anything that introduces what follows it — a heading, or a paragraph
    // styled as a label — must not be the last thing on a page.
    //
    // The test is structural, not geometric: what matters is that nothing
    // follows it on this page, however much white space is left underneath.
    // A forced break can strand a label halfway up an otherwise empty page.
    const everything = Array.prototype.slice.call(area.querySelectorAll('*'))
    const introducers = everything.filter(function (element) {
      return element.matches(
        'h1, h2, h3, h4, h5, h6, .label, .callout-label, .chapter-eyebrow, ' +
        '.chapter-subtitle, .standfirst, caption'
      )
    })

    introducers.forEach(function (element) {
      const position = everything.indexOf(element)
      const somethingFollows = everything.slice(position + 1).some(function (later) {
        if (element.contains(later)) return false
        return (later.textContent || '').trim() !== '' || later.tagName === 'IMG'
      })
      if (somethingFollows) return
      report.strandedHeadings.push({ page: number, element: describe(element) })
    })
  })

  // Chapters and parts should open on the side the theme asked for.
  const openers = Array.prototype.slice.call(document.querySelectorAll(
    '.chapter, .part-page, [class*="component-body"]'
  )).filter(function (element) {
    return !element.hasAttribute('data-split-from')
  })

  openers.forEach(function (element) {
    const pageElement = element.closest('.pagedjs_page')
    if (!pageElement) return
    const side = pageElement.classList.contains('pagedjs_left_page')
      ? 'verso (left)'
      : 'recto (right)'
    report.wrongSideOpenings.push({
      page: pageNumberOf(element),
      side,
      element: describe(element)
    })
  })

  // Split paragraphs leaving a single line behind or carrying one over.
  Array.prototype.slice.call(document.querySelectorAll('p[data-split-to]'))
    .forEach(function (element) {
      const lines = lineCount(element)
      if (lines !== null && lines < 2) {
        report.orphans.push({ page: pageNumberOf(element), element: describe(element) })
      }
    })
  Array.prototype.slice.call(document.querySelectorAll('p[data-split-from]'))
    .forEach(function (element) {
      const lines = lineCount(element)
      if (lines !== null && lines < 2) {
        report.widows.push({ page: pageNumberOf(element), element: describe(element) })
      }
    })

  // Internal links whose target is not in the document print no page number.
  Array.prototype.slice.call(document.querySelectorAll('a[href^="#"]'))
    .forEach(function (link) {
      const id = decodeURIComponent(link.getAttribute('href').slice(1))
      if (!id) return
      if (document.getElementById(id)) return
      report.unresolvedReferences.push({
        page: pageNumberOf(link),
        href: '#' + id,
        text: (link.textContent || '').trim().slice(0, 40)
      })
    })

  return report
}

function summarise (report, expectedSide) {
  const lines = []
  const problems = []

  lines.push('Pages: ' + report.pages)

  const wrongSide = report.wrongSideOpenings.filter(function (entry) {
    return expectedSide && entry.side.indexOf(expectedSide) !== 0
  })

  function section (title, entries, format) {
    if (entries.length === 0) return
    problems.push(...entries)
    lines.push('')
    lines.push(title + ' (' + entries.length + ')')
    entries.slice(0, 15).forEach(function (entry) {
      lines.push('  ' + format(entry))
    })
    if (entries.length > 15) {
      lines.push('  … and ' + (entries.length - 15) + ' more')
    }
  }

  if (report.blankPages.length) {
    lines.push('Blank pages: ' + report.blankPages.join(', ') +
      ' (expected where chapters start on recto)')
  }

  section('Content overflowing the page', report.overflow, function (entry) {
    return 'p' + entry.page + '  ' + entry.by + 'px ' + entry.direction +
      ': ' + entry.element
  })

  section('Images larger than the text area', report.oversizedImages,
    function (entry) {
      return 'p' + entry.page + '  ' + entry.size + ' in ' + entry.area +
        ': ' + entry.element
    })

  section('Openings on the wrong side', wrongSide, function (entry) {
    return 'p' + entry.page + '  opens ' + entry.side + ': ' + entry.element
  })

  section('Orphans (one line stranded at the foot of a page)', report.orphans,
    function (entry) { return 'p' + entry.page + '  ' + entry.element })

  section('Widows (one line carried to the top of a page)', report.widows,
    function (entry) { return 'p' + entry.page + '  ' + entry.element })

  section('Headings and labels stranded at the foot of a page',
    report.strandedHeadings,
    function (entry) { return 'p' + entry.page + '  ' + entry.element })

  section('Links with no target (these print no page number)',
    report.unresolvedReferences, function (entry) {
      return 'p' + entry.page + '  ' + entry.href + ' — “' + entry.text + '”'
    })

  if (problems.length === 0) {
    lines.push('')
    lines.push('No layout problems found.')
  }

  return { text: lines.join('\n'), problemCount: problems.length }
}

// Read $chapters-start-on out of the compiled theme, so the check knows which
// side chapters are supposed to open on.
function expectedOpeningSide (themeDir) {
  const variablesFile = path.join(themeDir, '_variables.scss')
  const files = [variablesFile]
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const match = fs.readFileSync(file, 'utf-8')
      .match(/\$chapters-start-on\s*:\s*(\w+)/)
    if (match) return match[1]
  }
  return 'recto'
}

async function main () {
  const root = requireRepoRoot()
  const contentDir = path.resolve(args.content)
  const indexFile = path.join(contentDir, 'index.html')
  const theme = args.theme || 'beatrix'

  if (!fs.existsSync(indexFile)) {
    console.error('No index.html in ' + args.content)
    process.exit(1)
  }

  const themeDir = path.join(root, 'themes', theme)
  if (!fs.existsSync(themeDir)) {
    console.error('No such theme: ' + theme)
    process.exit(1)
  }

  if (!args['no-build']) {
    execFileSync(process.execPath, [path.join(__dirname, 'build-css.js'), theme], {
      stdio: args.json ? 'ignore' : 'inherit'
    })
  }

  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const relativePath = path.relative(root, indexFile).split(path.sep).join('/')

  const browser = await chromium.launch()
  const page = await browser.newPage()

  if (!args['allow-remote']) await blockRemoteResources(page, server.url)
  await watchForPagedJs(page)
  await page.goto(server.url + '/' + relativePath + '?theme=' + theme,
    { waitUntil: 'load', timeout: 120000 })

  try {
    await waitForPagedJs(page, Number(args.timeout) || 300000)
  } catch (error) {
    await browser.close()
    await server.close()
    console.error('Paged.js did not finish paginating within the timeout.')
    process.exit(1)
  }

  // Measure in the media Paged.js paginated in. The PDF uses the same page
  // boxes, and switching to print media re-lays out the preview scaffolding.
  const report = await page.evaluate(collectReport)

  await browser.close()
  await server.close()

  const side = expectedOpeningSide(themeDir)
  report.theme = theme
  report.content = relativePath
  report.chaptersStartOn = side

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const summary = summarise(report, side === 'auto' ? null : side)
    console.log('\n' + relativePath + ' · theme “' + theme +
      '” · chapters start on ' + side + '\n')
    console.log(summary.text)
    if (args.strict && summary.problemCount > 0) process.exit(1)
  }
}

main().catch(function (error) {
  console.error(error)
  process.exit(1)
})
