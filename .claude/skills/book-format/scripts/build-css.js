#!/usr/bin/env node

// Compile a theme's Sass to CSS, and refresh js/themes.json.
//
//   node build-css.js               # every theme
//   node build-css.js my-theme      # one theme
//   node build-css.js --watch my-theme

const fs = require('fs')
const path = require('path')
const { requireRepoRoot, parseArgs } = require('./common')

const args = parseArgs(process.argv)

if (args.help) {
  console.log([
    'Usage: node build-css.js [theme] [--watch]',
    '',
    '  theme    Name of a directory in themes/. Omit to build all themes.',
    '  --watch  Rebuild whenever a .scss file under the theme changes.',
    '',
    'Also regenerates js/themes.json, which populates the demo site’s',
    'theme switcher.'
  ].join('\n'))
  process.exit(0)
}

const root = requireRepoRoot()
const themesDir = path.join(root, 'themes')

let sass
try {
  sass = require(path.join(root, 'node_modules', 'node-sass'))
} catch (error) {
  try {
    sass = require(path.join(root, 'node_modules', 'sass'))
  } catch (fallbackError) {
    console.error('No Sass compiler found. Run `npm install` in ' + root + '.')
    process.exit(1)
  }
}

function listThemes () {
  return fs.readdirSync(themesDir, { withFileTypes: true })
    .filter(function (entry) {
      return entry.isDirectory() &&
        fs.existsSync(path.join(themesDir, entry.name, 'main.scss'))
    })
    .map(function (entry) { return entry.name })
}

function compile (scssFile, cssFile) {
  return new Promise(function (resolve) {
    // node-sass and dart-sass share the render() signature we use here.
    sass.render({ file: scssFile, outFile: cssFile }, function (error, result) {
      if (error) {
        console.error('✗ ' + path.relative(root, scssFile))
        console.error('  ' + (error.formatted || error.message).trim())
        resolve(false)
        return
      }
      fs.writeFileSync(cssFile, result.css)
      console.log('✓ ' + path.relative(root, cssFile))
      resolve(true)
    })
  })
}

// Regenerate js/themes.json from each theme's theme.json.
function writeThemeData () {
  const data = {}
  listThemes().forEach(function (theme) {
    const themeJson = path.join(themesDir, theme, 'theme.json')
    if (fs.existsSync(themeJson)) {
      data[theme] = JSON.parse(fs.readFileSync(themeJson, 'utf-8'))
    }
  })
  fs.writeFileSync(path.join(root, 'js', 'themes.json'), JSON.stringify(data))
  console.log('✓ js/themes.json (' + Object.keys(data).length + ' themes)')
}

async function build (themeNames) {
  let ok = true
  for (const theme of themeNames) {
    const scssFile = path.join(themesDir, theme, 'main.scss')
    if (!fs.existsSync(scssFile)) {
      console.error('No such theme: ' + theme)
      ok = false
      continue
    }
    const built = await compile(scssFile, path.join(themesDir, theme, 'main.css'))
    ok = ok && built
  }
  return ok
}

async function main () {
  const requested = args._[0]
  const themeNames = requested ? [requested] : listThemes()

  const ok = await build(themeNames)
  writeThemeData()

  if (args.watch) {
    const watchDirs = requested
      ? [path.join(themesDir, requested), path.join(themesDir, '_defaults')]
      : [themesDir]
    console.log('\nWatching for changes. Ctrl+C to stop.')
    let pending = null
    watchDirs.forEach(function (dir) {
      fs.watch(dir, { recursive: true }, function (event, filename) {
        if (!filename || !filename.endsWith('.scss')) return
        clearTimeout(pending)
        pending = setTimeout(function () { build(themeNames) }, 150)
      })
    })
    return
  }

  process.exit(ok ? 0 : 1)
}

main()
