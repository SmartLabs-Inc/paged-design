#!/usr/bin/env node

// Scaffold a new theme by copying an existing one.
//
//   node new-theme.js my-theme
//   node new-theme.js my-theme --from beatrix --title "My Theme"

const fs = require('fs')
const path = require('path')
const { requireRepoRoot, parseArgs, slugify } = require('./common')

const args = parseArgs(process.argv)

if (args.help || args._.length === 0) {
  console.log([
    'Usage: node new-theme.js <name> [--from <theme>] [--title "Display Name"]',
    '',
    '  <name>    Directory name for the new theme (lowercase, no spaces).',
    '  --from    Theme to copy. Default: beatrix.',
    '  --title   Name shown in the demo site’s theme switcher.',
    '',
    'Copies the source theme, rewrites its theme.json, and compiles the CSS.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const root = requireRepoRoot()
const name = slugify(args._[0])
const from = args.from || 'beatrix'
const title = args.title || args._[0]
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, function (c) { return c.toUpperCase() })

const sourceDir = path.join(root, 'themes', from)
const targetDir = path.join(root, 'themes', name)

if (!fs.existsSync(sourceDir)) {
  console.error('No such theme to copy from: ' + from)
  process.exit(1)
}
if (fs.existsSync(targetDir)) {
  console.error('Theme already exists: themes/' + name)
  process.exit(1)
}
if (name === '_defaults') {
  console.error('Refusing to overwrite the defaults.')
  process.exit(1)
}

// Copy everything except generated CSS and the source theme's screenshot.
function copyTree (source, target) {
  fs.mkdirSync(target, { recursive: true })
  fs.readdirSync(source, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'main.css' || entry.name === 'screenshot.jpg') return
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copyTree(from, to)
    } else {
      fs.copyFileSync(from, to)
    }
  })
}

copyTree(sourceDir, targetDir)

// main.scss in themes/_defaults imports its siblings without a path prefix.
// Every other theme imports ../_defaults/*, which is what a copy needs.
if (from === '_defaults') {
  const mainScss = path.join(targetDir, 'main.scss')
  fs.writeFileSync(mainScss, fs.readFileSync(mainScss, 'utf-8')
    .replace(/@import '(variables|selectors|styles)'/g, "@import '../_defaults/$1'"))
}

// Rewrite theme.json with the new display name, keeping any script config.
const themeJsonPath = path.join(targetDir, 'theme.json')
const themeJson = fs.existsSync(themeJsonPath)
  ? JSON.parse(fs.readFileSync(themeJsonPath, 'utf-8'))
  : {}
themeJson.name = title
fs.writeFileSync(themeJsonPath, JSON.stringify(themeJson, null, 2) + '\n')

console.log('Created themes/' + name + ' from ' + from)

// Compile it so the theme is immediately previewable.
const { execFileSync } = require('child_process')
try {
  execFileSync(process.execPath, [path.join(__dirname, 'build-css.js'), name], {
    stdio: 'inherit'
  })
} catch (error) {
  console.error('Theme created, but the initial CSS build failed.')
  process.exit(1)
}

console.log([
  '',
  'Next:',
  '  1. Edit themes/' + name + '/_variables.scss  (page size, fonts, spacing)',
  '  2. Edit themes/' + name + '/_selectors.scss  (only if the book’s HTML',
  '     uses different class names)',
  '  3. Edit themes/' + name + '/_styles.scss     (custom CSS)',
  '  4. npm start, then open http://localhost:5000/content/<book>/index.html?theme=' + name,
  '  5. Add a 400px-wide screenshot.jpg and a gallery entry in index.html',
  '     if the theme should appear on the demo site.'
].join('\n'))
