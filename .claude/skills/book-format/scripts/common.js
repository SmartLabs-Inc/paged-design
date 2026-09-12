// Shared helpers for the book-format skill scripts.

const fs = require('fs')
const path = require('path')

// Walk up from a starting directory to find the paged-design repo root,
// i.e. the nearest ancestor that has both themes/_defaults and js/build.js.
function findRepoRoot (startDir) {
  let dir = path.resolve(startDir || process.cwd())
  while (true) {
    if (fs.existsSync(path.join(dir, 'themes', '_defaults')) &&
        fs.existsSync(path.join(dir, 'js', 'build.js'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// Find the repo root or exit with a useful message.
function requireRepoRoot () {
  const root = findRepoRoot(__dirname) || findRepoRoot(process.cwd())
  if (!root) {
    console.error(
      'Could not find the paged-design repo root (a directory containing\n' +
      'themes/_defaults and js/build.js). Run this script from inside the repo.'
    )
    process.exit(1)
  }
  return root
}

// Minimal argument parser: --key value, --key=value, --flag, and positionals.
function parseArgs (argv) {
  const args = { _: [] }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eq = body.indexOf('=')
      if (eq > -1) {
        args[body.slice(0, eq)] = body.slice(eq + 1)
      } else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) {
        args[body] = rest[i + 1]
        i += 1
      } else {
        args[body] = true
      }
    } else {
      args._.push(arg)
    }
  }
  return args
}

// Resolve the playwright module, which may only be installed globally.
function requirePlaywright () {
  try {
    return require('playwright')
  } catch (error) {
    try {
      const { execSync } = require('child_process')
      const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim()
      return require(path.join(globalRoot, 'playwright'))
    } catch (globalError) {
      console.error(
        'Playwright is required to render or check pages, and was not found.\n' +
        'Install it with:  npm install -g playwright\n' +
        '(Chromium itself may already be present; if not, run: npx playwright install chromium)'
      )
      process.exit(1)
    }
  }
}

// Serve a directory over HTTP so Paged.js can fetch CSS, fonts and images.
// Returns { url, close }.
function serveDirectory (rootDir) {
  const http = require('http')

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf'
  }

  const server = http.createServer(function (request, response) {
    const urlPath = decodeURIComponent(request.url.split('?')[0])
    let filePath = path.join(rootDir, path.normalize(urlPath))

    // Never serve outside the served root.
    if (!filePath.startsWith(path.resolve(rootDir))) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }

    fs.readFile(filePath, function (error, data) {
      if (error) {
        response.writeHead(404)
        response.end('Not found: ' + urlPath)
        return
      }
      const type = mimeTypes[path.extname(filePath).toLowerCase()] ||
        'application/octet-stream'
      response.writeHead(200, { 'Content-Type': type })
      response.end(data)
    })
  })

  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port
      resolve({
        url: 'http://127.0.0.1:' + port,
        close: function () {
          return new Promise(function (resolve) { server.close(resolve) })
        }
      })
    })
  })
}

// Stop remote resources (typically web fonts) from stalling pagination.
// Paged.js waits for @import-ed stylesheets, so an unreachable font host can
// hang the render indefinitely. Every remote request is answered locally with
// an empty 200. Returns the set of hosts that were intercepted, so the caller
// can tell the user which resources the page did without.
async function blockRemoteResources (page, localOrigin) {
  const blockedHosts = new Set()

  await page.route('**/*', function (route) {
    const url = route.request().url()
    if (url.startsWith(localOrigin) || url.startsWith('data:') ||
        url.startsWith('blob:') || url.startsWith('about:')) {
      return route.continue()
    }
    try {
      blockedHosts.add(new URL(url).host)
    } catch (error) { /* not a parseable URL; drop it anyway */ }

    // Answer with an empty 200 rather than aborting. Paged.js fetches the
    // stylesheets named in @import rules itself, and a rejected fetch stops
    // pagination before it starts.
    const isStylesheet = route.request().resourceType() === 'stylesheet' ||
      /\.css(\?|$)/.test(url)
    return route.fulfill({
      status: 200,
      contentType: isStylesheet ? 'text/css' : 'text/plain',
      body: ''
    })
  })

  return blockedHosts
}

// Install a listener for Paged.js's 'rendered' event. Paged.js is loaded
// asynchronously by pager.js, so poll for it rather than assuming it exists.
// Call this before navigating.
async function watchForPagedJs (page) {
  await page.addInitScript(function () {
    window.__pagedRendered = false
    const check = setInterval(function () {
      if (window.PagedPolyfill && typeof window.PagedPolyfill.on === 'function') {
        clearInterval(check)
        window.PagedPolyfill.on('rendered', function () {
          window.__pagedRendered = true
        })
      }
    }, 100)

    // pager.js holds pagination back until MathJax reports it has finished
    // typesetting. If MathJax cannot load — no network, or its CDN blocked —
    // that signal never arrives. Release it so the rest of the book renders.
    setTimeout(function () {
      if (!document.body) return
      if (document.querySelector('.pagedjs_page')) return
      if (document.body.getAttribute('data-mathjax-ready-for-pagedjs')) return
      if (!document.querySelector('script[src*="mathjax" i], #MathJax-script')) return
      window.__mathjaxSkipped = true
      document.body.setAttribute('data-mathjax-ready-for-pagedjs', true)
    }, 8000)
  })
}

// Wait for Paged.js to finish paginating, then tidy the demo-site chrome away.
// Returns the number of pages rendered.
async function waitForPagedJs (page, timeout) {
  await page.waitForFunction(
    function () {
      const pages = document.querySelectorAll('.pagedjs_page')
      if (pages.length === 0) return false
      if (window.__pagedRendered === true) return true

      // Fall back to watching the page count settle, in case the
      // 'rendered' event was missed or is unavailable.
      if (window.__pagedCount === pages.length) {
        window.__pagedStable = (window.__pagedStable || 0) + 1
      } else {
        window.__pagedCount = pages.length
        window.__pagedStable = 0
      }
      return window.__pagedStable >= 3
    },
    null,
    { timeout: timeout || 180000, polling: 1000 }
  )

  return page.evaluate(function () {
    const controls = document.getElementById('pagerControls')
    if (controls) controls.remove()
    const home = document.getElementById('pagerGoHome')
    if (home) home.remove()
    return document.querySelectorAll('.pagedjs_page').length
  })
}

// Turn a string into a filename- and class-safe slug.
function slugify (text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

module.exports = {
  findRepoRoot,
  requireRepoRoot,
  parseArgs,
  requirePlaywright,
  serveDirectory,
  blockRemoteResources,
  watchForPagedJs,
  waitForPagedJs,
  slugify
}
