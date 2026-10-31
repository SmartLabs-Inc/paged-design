'use strict'
//
// Draw a diagram in the book's own voice.
//
// The figures that came with this manuscript were drawn somewhere else: grey
// boxes, rounded corners, Arial, black rules. Dropped into a page set in
// Charis SIL with a teal accent they read as screenshots of another document,
// which is what "match the book" is asking to fix. So nothing here invents a
// colour or a face — every value is read from the compiled theme, and a
// figure is built from the same vocabulary as the page around it: the tinted
// panel with a teal left rule, the hairline neutral box, the tracked-out
// label, the caption grey.
//
// Output is SVG meant to be inlined into the book HTML rather than linked as
// an <img>. An <img> renders in its own context and cannot see the document's
// @font-face, so the labels would silently fall back to a system sans — the
// exact failure this is meant to end. Inlined, the figure inherits the book's
// fonts and prints as vector at whatever resolution the press wants.
//
// Text is measured, not estimated. A character-width table for a face you do
// not have is a guess, and a guess puts a label over a rule.

const TOKENS = {
  navy:    '#0D2035',   // headings, the emphasised node
  teal:    '#137C7A',   // the accent: rules, the subject of the figure
  text:    '#17202A',   // body
  mid:     '#66717C',   // captions, secondary lines
  foot:    '#4A5560',   // connectors — a shade darker than a caption
  tint:    '#EAF3F3',   // callout wash, as the page uses it
  panel:   '#F4F6F7',   // neutral panel
  pale:    '#EEF3F7',
  line:    '#C9D2D8',   // hairline border
  sans:    "'Source Sans 3', Aptos, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  serif:   "'Charis SIL', Georgia, 'Times New Roman', serif"
}

// The page is 7in wide with 18mm margins, so the text block spans 152mm and a
// single column is 64mm. A figure is drawn in millimetres at 1 unit = 1mm and
// scaled by the viewBox, so it is resolution-free and the stroke weights stay
// in the printer's units rather than the screen's.
const SPAN_MM = 152
const COL_MM = 64

const TYPE = {
  title:  { size: 3.6, weight: 600, fill: TOKENS.navy,  font: TOKENS.sans },
  node:   { size: 3.2, weight: 600, fill: TOKENS.text,  font: TOKENS.sans },
  sub:    { size: 2.9, weight: 400, fill: TOKENS.mid,   font: TOKENS.sans },
  label:  { size: 2.5, weight: 600, fill: TOKENS.teal,  font: TOKENS.sans,
            track: 0.28, upper: true },
  edge:   { size: 2.7, weight: 400, fill: TOKENS.foot,  font: TOKENS.sans },
  note:   { size: 2.7, weight: 400, fill: TOKENS.mid,   font: TOKENS.sans }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const n = v => Math.round(v * 1000) / 1000

// --- measuring ------------------------------------------------------------
// One browser, one canvas, for the whole run. Opening a page per string turns
// a two-second build into a two-minute one.
let _browser = null, _page = null

async function openMeasurer (fontDir) {
  if (_page) return _page
  const { chromium } = require('playwright')
  const fs = require('fs'), path = require('path')
  const face = (file, weight, style) => {
    const p = path.join(fontDir, file)
    if (!fs.existsSync(p)) return ''
    return '@font-face{font-family:"Source Sans 3";src:url(data:font/ttf;base64,' +
      fs.readFileSync(p).toString('base64') + ');font-weight:' + weight +
      ';font-style:' + style + ';}'
  }
  const css = face('SourceSans3-Regular.ttf', 400, 'normal') +
              face('SourceSans3-Semibold.ttf', 600, 'normal') +
              face('SourceSans3-Bold.ttf', 700, 'normal') +
              face('SourceSans3-It.ttf', 400, 'italic')
  _browser = await chromium.launch({ args: ['--no-sandbox'] })
  _page = await _browser.newPage()
  await _page.setContent('<!doctype html><meta charset="utf-8"><style>' + css +
    '</style><canvas id="c"></canvas>')
  await _page.evaluate(() => document.fonts.ready)
  return _page
}

async function closeMeasurer () {
  if (_browser) { await _browser.close(); _browser = null; _page = null }
}

// Widths come back in millimetres, measured at a large size and divided down,
// because a canvas measuring 3mm of text rounds away the difference between
// "ii" and "mm".
async function widths (strings, style) {
  const page = await openMeasurer(require('path').join(__dirname, '../../../../../fonts'))
  const spec = (style.weight || 400) + ' 100px ' + style.font
  const out = await page.evaluate(({ list, spec }) => {
    const ctx = document.getElementById('c').getContext('2d')
    ctx.font = spec
    return list.map(s => ctx.measureText(s).width / 100)
  }, { list: strings, spec })
  const track = style.track || 0
  return out.map((w, i) => w * style.size + track * Math.max(0, strings[i].length - 1))
}

async function wrap (text, style, maxMm) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const lines = []
  let cur = words[0]
  for (let i = 1; i < words.length; i += 1) {
    const test = cur + ' ' + words[i]
    const [w] = await widths([style.upper ? test.toUpperCase() : test], style)
    if (w <= maxMm) cur = test
    else { lines.push(cur); cur = words[i] }
  }
  lines.push(cur)
  return lines
}

// --- drawing --------------------------------------------------------------
function textBlock (lines, x, y, style, anchor) {
  const lh = style.size * 1.26
  return lines.map((ln, i) =>
    '<text x="' + n(x) + '" y="' + n(y + i * lh) + '" text-anchor="' +
    (anchor || 'middle') + '" font-family=' + JSON.stringify(style.font) +
    ' font-size="' + n(style.size) + '" font-weight="' + (style.weight || 400) +
    '" fill="' + style.fill + '"' +
    (style.track ? ' letter-spacing="' + style.track + '"' : '') +
    '>' + esc(style.upper ? ln.toUpperCase() : ln) + '</text>').join('\n')
}

// The page's own callout: a wash with a teal rule down the left edge. Square
// corners, because every panel in this book has square corners.
function box (x, y, w, h, kind) {
  const k = {
    key:     { fill: TOKENS.tint,  stroke: 'none',        rule: TOKENS.teal },
    plain:   { fill: TOKENS.panel, stroke: TOKENS.line,   rule: null },
    strong:  { fill: TOKENS.navy,  stroke: 'none',        rule: null },
    ghost:   { fill: '#FFFFFF',    stroke: TOKENS.line,   rule: null }
  }[kind] || { fill: TOKENS.panel, stroke: TOKENS.line, rule: null }
  let s = '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
    '" fill="' + k.fill + '"' +
    (k.stroke === 'none' ? '' : ' stroke="' + k.stroke + '" stroke-width="0.25"') + '/>'
  if (k.rule) s += '\n<rect x="' + n(x) + '" y="' + n(y) + '" width="0.9" height="' +
    n(h) + '" fill="' + k.rule + '"/>'
  return s
}

const ARROW_ID = 'aet-arrow', ARROW_TEAL = 'aet-arrow-teal'

function defs () {
  const head = (id, fill) =>
    '<marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" ' +
    'markerHeight="5" orient="auto-start-reverse">' +
    '<path d="M 0 1 L 10 5 L 0 9 z" fill="' + fill + '"/></marker>'
  return '<defs>' + head(ARROW_ID, TOKENS.foot) + head(ARROW_TEAL, TOKENS.teal) + '</defs>'
}

// Activation is an arrow, inhibition a crossbar. The distinction is carried by
// the head and not by colour, which is the convention in this literature and
// also the only version that survives the grayscale edition.
function link (pts, kind, accent) {
  const col = accent ? TOKENS.teal : TOKENS.foot
  const d = pts.map((p, i) => (i ? 'L ' : 'M ') + n(p[0]) + ' ' + n(p[1])).join(' ')
  const dash = kind === 'dashed' ? ' stroke-dasharray="1.6 1.1"' : ''
  let s = '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="0.35"' + dash
  if (kind !== 'inhibit') s += ' marker-end="url(#' + (accent ? ARROW_TEAL : ARROW_ID) + ')"'
  s += '/>'
  if (kind === 'inhibit') {
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]]
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len, bar = 1.7
    s += '\n<path d="M ' + n(b[0] - uy * bar) + ' ' + n(b[1] + ux * bar) +
         ' L ' + n(b[0] + uy * bar) + ' ' + n(b[1] - ux * bar) +
         '" stroke="' + col + '" stroke-width="0.45" fill="none"/>'
  }
  return s
}

function open (w, h) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n(w) + ' ' + n(h) +
    '" width="' + n(w) + 'mm" height="' + n(h) + 'mm" role="img">' + defs()
}
const close = () => '</svg>'

module.exports = {
  TOKENS, TYPE, SPAN_MM, COL_MM,
  widths, wrap, textBlock, box, link, open, close, esc, n, closeMeasurer
}
