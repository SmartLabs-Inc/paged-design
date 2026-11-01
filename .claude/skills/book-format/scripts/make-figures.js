#!/usr/bin/env node
'use strict'
//
// Build the book's diagrams from a spec file, using figure-kit's tokens.
//
// The spec says what the diagram means — rows of nodes, and the relations
// between them. It does not say where anything goes. Coordinates are the
// program's job: a figure whose spec carries pixel positions has to be
// re-measured by hand every time a label changes, and the labels in this
// book change.
//
//   node   { id, title, sub?, kind?, span? }   kind: key | plain | strong | ghost
//   link   { from, to, kind?, label?, accent?, route? }
//              kind:  arrow (default) | inhibit | dashed
//              route: auto (default) | up | side
//   panel  a row may instead be { panel: <label>, id?, rows: [...] } — an id
//          makes the panel itself a link target, which is what a figure that
//          draws an arrow from one stage to the next actually means
//   head   a row may be { heading: "..." } to title a half of the figure
//   kinds  key | plain | strong | ghost | open (provisional) | void (spacer)
//   a row may also be { cells: [...], width: 0.45, align: "center" } to take
//   part of the measure — a lone node under a three-node chain should not be
//   three nodes wide just because nothing sits beside it
//
// Usage: node make-figures.js --spec <file.json> --out <dir> [--only <id>]

const fs = require('fs')
const path = require('path')
const K = require('./lib/figure-kit')

const args = {}
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('--')) args[a.slice(2)] = (all[i + 1] || '').startsWith('--') ? true : all[i + 1]
})

if (args.help || !args.spec) {
  console.log([
    'Usage: node make-figures.js --spec <file.json> --out <dir> [--only <id>]',
    '',
    '  --spec <file>  JSON list of figure specs.',
    '  --out <dir>    Where the .svg files are written.',
    '  --only <id>    Build one figure.',
    '',
    'Writes one SVG per figure, sized in millimetres at the book\'s measure.'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

const INSET = 0.2        // so a hairline border is not clipped by the viewBox
const PAD = 2.2          // inside a node
const GAP_X = 5          // between nodes in a row
const GAP_Y = 7          // between rows — room for a connector and its label
const PANEL_PAD = 3.2

async function sizeNode (node, w) {
  if (node.kind === 'void') return { title: [], sub: [], tStyle: K.TYPE.node, sStyle: K.TYPE.sub, h: 0 }
  const inner = w - PAD * 2 - 1.2
  const strong = node.kind === 'strong'
  const tStyle = strong ? Object.assign({}, K.TYPE.node, { fill: '#FFFFFF' }) : K.TYPE.node
  const sStyle = strong ? Object.assign({}, K.TYPE.sub, { fill: '#C6D2DA' }) : K.TYPE.sub
  const title = await K.wrap(node.title, tStyle, inner)
  const sub = node.sub ? await K.wrap(node.sub, sStyle, inner) : []
  const h = PAD * 2 + title.length * tStyle.size * 1.26 +
            (sub.length ? 0.7 + sub.length * sStyle.size * 1.26 : 0)
  return { title, sub, tStyle, sStyle, h: Math.max(h, 9) }
}

function drawNode (node, box, laid) {
  if (node.kind === 'void') return ''
  let s = K.box(box.x, box.y, box.w, box.h, node.kind || 'plain')
  const cx = box.x + box.w / 2 + (node.kind === 'key' ? 0.45 : 0)
  let y = box.y + PAD + laid.tStyle.size * 0.92
  s += '\n' + K.textBlock(laid.title, cx, y, laid.tStyle)
  if (laid.sub.length) {
    y += laid.title.length * laid.tStyle.size * 1.26 + 0.7
    s += '\n' + K.textBlock(laid.sub, cx, y, laid.sStyle)
  }
  return s
}

// Where a connector leaves and arrives, from the boxes' relative position.
function route (a, b, hint) {
  const EPS = 0.4
  if (hint === 'side' || (Math.abs(a.y - b.y) < a.h && Math.abs(a.x - b.x) > 1)) {
    const left = a.x < b.x
    const y = Math.min(a.y + a.h, b.y + b.h) - Math.min(a.h, b.h) / 2
    return [[left ? a.x + a.w + EPS : a.x - EPS, y], [left ? b.x - EPS : b.x + b.w + EPS, y]]
  }
  const down = a.y < b.y
  const ax = a.x + a.w / 2, bx = b.x + b.w / 2
  const ay = down ? a.y + a.h + EPS : a.y - EPS
  // An inhibition bar sits off the edge it blocks, not on it.
  const stand = hint === 'inhibit' ? 1.5 : 0
  const by = down ? b.y - EPS - stand : b.y + b.h + EPS + stand
  if (Math.abs(ax - bx) < 0.6) return [[ax, ay], [bx, by]]
  const mid = (ay + by) / 2
  return [[ax, ay], [ax, mid], [bx, mid], [bx, by]]
}

async function buildRows (rows, x, width, y0) {
  let y = y0, svg = '', boxes = {}
  for (const raw of rows) {
    const row = Array.isArray(raw) ? { cells: raw } : raw
    if (row.gapBefore) y += row.gapBefore
    if (row.heading !== undefined) {
      const lines = await K.wrap(row.heading, K.TYPE.title, width)
      svg += '\n' + K.textBlock(lines, x, y + K.TYPE.title.size, K.TYPE.title, 'start')
      y += lines.length * K.TYPE.title.size * 1.26 + 2.4
      continue
    }
    if (row.panel !== undefined) {
      const inner = await buildRows(row.rows, x + PANEL_PAD, width - PANEL_PAD * 2,
                                    y + PANEL_PAD + (row.panel ? 4.6 : 0))
      const h = inner.y - y + PANEL_PAD
      svg = K.box(x, y, width, h, 'ghost') + '\n' +
            (row.panel
              ? K.textBlock([row.panel], x + PANEL_PAD, y + PANEL_PAD + K.TYPE.label.size,
                            K.TYPE.label, 'start') + '\n'
              : '') + svg + inner.svg
      Object.assign(boxes, inner.boxes)
      if (row.id) boxes[row.id] = { x, y, w: width, h }
      y += h + GAP_Y * 0.8
      continue
    }
    const cells = row.cells
    const rowW = width * (row.width || 1)
    const offset = row.align === 'center' ? (width - rowW) / 2
                 : row.align === 'right' ? width - rowW : 0
    const units = cells.reduce((t, c) => t + (c.span || 1), 0)
    const unitW = (rowW - GAP_X * (cells.length - 1)) / units
    let cx = x + offset, tallest = 0
    const laidOut = []
    for (const node of cells) {
      const w = unitW * (node.span || 1)
      const laid = await sizeNode(node, w)
      laidOut.push({ node, laid, box: { x: cx, y, w, h: laid.h } })
      tallest = Math.max(tallest, laid.h)
      cx += w + GAP_X
    }
    for (const it of laidOut) {
      it.box.h = tallest
      boxes[it.node.id] = it.box
      svg += '\n' + drawNode(it.node, it.box, it.laid)
    }
    y += tallest + GAP_Y
  }
  return { svg, boxes, y: y - GAP_Y }
}

async function build (spec) {
  const W = spec.width === 'column' ? K.COL_MM : K.SPAN_MM
  const body = await buildRows(spec.rows, INSET, W - INSET * 2, INSET)
  let svg = body.svg
  let bottom = body.y

  for (const l of spec.links || []) {
    const a = body.boxes[l.from], b = body.boxes[l.to]
    if (!a || !b) { console.warn('  ! link skipped, unknown node: ' + l.from + '->' + l.to); continue }
    const pts = route(a, b, l.kind === 'inhibit' ? 'inhibit' : l.route)
    svg += '\n' + K.link(pts, l.kind || 'arrow', l.accent)
    if (l.label) {
      const mid = pts[Math.floor(pts.length / 2)]
      const horiz = pts.length === 2 && Math.abs(pts[0][1] - pts[1][1]) < 0.6
      const lines = await K.wrap(l.label, K.TYPE.edge, 30)
      svg += '\n' + K.textBlock(lines,
        horiz ? (pts[0][0] + pts[1][0]) / 2 : mid[0] + 2.2,
        horiz ? pts[0][1] - 1.6 : mid[1] + K.TYPE.edge.size * 0.35,
        K.TYPE.edge, horiz ? 'middle' : 'start')
    }
  }

  if (spec.legend) {
    bottom += 3.4
    let lx = 0
    for (const item of spec.legend) {
      svg += '\n' + K.link([[lx, bottom], [lx + 8, bottom]], item.kind || 'arrow')
      const [w] = await K.widths([item.text], K.TYPE.edge)
      svg += '\n' + K.textBlock([item.text], lx + 9.6,
                                 bottom + K.TYPE.edge.size * 0.36, K.TYPE.edge, 'start')
      lx += 9.6 + w + 11
    }
    bottom += 2.6
  }
  if (spec.note) {
    const lines = await K.wrap(spec.note, K.TYPE.note, W)
    bottom += 3.2
    svg += '\n<path d="M 0 ' + K.n(bottom) + ' L ' + K.n(W) + ' ' + K.n(bottom) +
           '" stroke="' + K.TOKENS.hair + '" stroke-width="0.25"/>'
    bottom += 2.6 + K.TYPE.note.size * 0.3
    svg += '\n' + K.textBlock(lines, 0, bottom, K.TYPE.note, 'start')
    bottom += (lines.length - 1) * K.TYPE.note.size * 1.26 + 1
  }
  return K.open(W, bottom + 0.6) + svg + K.close()
}

;(async () => {
  const specs = JSON.parse(fs.readFileSync(path.resolve(args.spec), 'utf8'))
  const outDir = path.resolve(args.out || '.')
  fs.mkdirSync(outDir, { recursive: true })
  let made = 0
  for (const spec of specs) {
    if (args.only && spec.id !== args.only) continue
    const svg = await build(spec)
    const file = path.join(outDir, spec.id + '.svg')
    fs.writeFileSync(file, svg)
    const mm = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    console.log('  ' + spec.id + '.svg  ' + mm[1] + ' x ' + mm[2] + ' mm')
    made += 1
  }
  await K.closeMeasurer()
  console.log(made + ' figure' + (made === 1 ? '' : 's') + ' written to ' + outDir)
})().catch(async e => { await K.closeMeasurer(); console.error(e); process.exit(1) })
