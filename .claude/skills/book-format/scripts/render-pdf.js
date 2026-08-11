#!/usr/bin/env node

// Render book HTML to a paginated PDF with headless Chromium and Paged.js.
//
//   node render-pdf.js --content content/my-book --theme my-theme --out book.pdf

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
    'Usage: node render-pdf.js --content <dir> [--theme <name>] [--out <file>]',
    '',
    '  --content <dir>   Directory holding the book’s index.html,',
    '                    e.g. content/my-book.',
    '  --theme <name>    Theme to render with. Default: template.',
    '  --out <file>      Output PDF. Default: <content>/<dir-name>.pdf.',
    '  --timeout <ms>    How long to wait for pagination. Default: 300000.',
    '  --no-build        Skip rebuilding the theme CSS first.',
    '  --allow-remote    Let the page fetch remote resources (web fonts).',
    '                    Off by default: an unreachable font host hangs',
    '                    pagination, and production books should embed fonts.',
    '',
    'For a press-ready file, set $bleed, $trim and $crop-marks in the theme’s',
    '_variables.scss and rebuild — the PDF picks up the CSS page size.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

async function main () {
  const root = requireRepoRoot()
  const contentDir = path.resolve(args.content)
  const indexFile = path.join(contentDir, 'index.html')
  const theme = args.theme || 'template'

  if (!fs.existsSync(indexFile)) {
    console.error('No index.html in ' + args.content)
    process.exit(1)
  }
  if (!contentDir.startsWith(root)) {
    console.error('The content directory must live inside the repo, so that\n' +
      'its relative links to js/ and themes/ resolve.')
    process.exit(1)
  }

  const themeDir = path.join(root, 'themes', theme)
  if (!fs.existsSync(themeDir)) {
    console.error('No such theme: ' + theme)
    process.exit(1)
  }

  if (!args['no-build']) {
    execFileSync(process.execPath, [path.join(__dirname, 'build-css.js'), theme], {
      stdio: 'inherit'
    })
  }

  const outFile = path.resolve(
    args.out || path.join(contentDir, path.basename(contentDir) + '.pdf')
  )

  const { chromium } = requirePlaywright()
  const server = await serveDirectory(root)
  const relativePath = path.relative(root, indexFile).split(path.sep).join('/')
  const url = server.url + '/' + relativePath + '?theme=' + theme

  const browser = await chromium.launch()
  const page = await browser.newPage()

  const problems = []
  page.on('pageerror', function (error) { problems.push(error.message) })

  let blockedHosts = new Set()
  if (!args['allow-remote']) {
    blockedHosts = await blockRemoteResources(page, server.url)
  } else {
    page.on('requestfailed', function (request) {
      problems.push('Failed to load ' + request.url())
    })
  }

  console.log('Rendering ' + relativePath + ' with theme “' + theme + '” …')
  await watchForPagedJs(page)
  await page.goto(url, { waitUntil: 'load', timeout: 120000 })

  let pageCount
  try {
    pageCount = await waitForPagedJs(page, Number(args.timeout) || 300000)
  } catch (error) {
    await browser.close()
    await server.close()
    console.error('Paged.js did not finish paginating within the timeout.')
    if (problems.length) console.error(problems.slice(0, 10).join('\n'))
    process.exit(1)
  }

  await page.pdf({
    path: outFile,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  })

  await browser.close()
  await server.close()

  const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2)
  console.log('Wrote ' + path.relative(process.cwd(), outFile) +
    ' — ' + pageCount + ' pages, ' + size + ' MB')

  if (blockedHosts.size) {
    console.log('Remote resources were blocked, so any web fonts they serve ' +
      'fell back to\nlocal faces: ' + Array.from(blockedHosts).join(', ') +
      '.\nEmbed the fonts in the theme, or pass --allow-remote.')
  }

  if (problems.length) {
    console.log('\nWarnings while rendering:')
    problems.slice(0, 10).forEach(function (problem) {
      console.log('  ' + problem)
    })
    if (problems.length > 10) {
      console.log('  … and ' + (problems.length - 10) + ' more')
    }
  }
}

main().catch(function (error) {
  console.error(error)
  process.exit(1)
})
