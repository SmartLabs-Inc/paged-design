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
  const tStyle = strong ? Object.assign({}, K.TYPE.node, { fill: K.TOKENS.navy }) : K.TYPE.node
  const sStyle = K.TYPE.sub
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
  let y = y0, svg = '', boxes = {}, bottom = y0
  for (const raw of rows) {
    const row = Array.isArray(raw) ? { cells: raw } : raw
    if (row.gapBefore) y += row.gapBefore
    if (row.heading !== undefined) {
      const lines = await K.wrap(row.heading, K.TYPE.title, width)
      svg += '\n' + K.textBlock(lines, x, y + K.TYPE.title.size, K.TYPE.title, 'start')
      y += lines.length * K.TYPE.title.size * 1.26 + 2.4
      bottom = Math.max(bottom, y)
      continue
    }
    if (row.panel !== undefined) {
      const inner = await buildRows(row.rows, x + PANEL_PAD, width - PANEL_PAD * 2,
                                    y + PANEL_PAD + (row.panel ? 4.6 : 0))
      const h = inner.y - y + PANEL_PAD
      svg = K.box(x, y, width, h, row.dashed ? 'open' : 'ghost') + '\n' +
            (row.panel
              ? K.textBlock([row.panel], x + PANEL_PAD, y + PANEL_PAD + K.TYPE.label.size,
                            row.quiet
                              ? Object.assign({}, K.TYPE.label, { fill: K.TOKENS.mid })
                              : K.TYPE.label, 'start') + '\n'
              : '') + svg + inner.svg
      Object.assign(boxes, inner.boxes)
      if (row.id) boxes[row.id] = { x, y, w: width, h }
      bottom = Math.max(bottom, y + h)
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
    bottom = Math.max(bottom, y + tallest)
    y += tallest + GAP_Y
  }
  return { svg, boxes, y: bottom }
}

// A few figures are about where things are, not what follows what. A box
// diagram of two membranes with a gap between them loses the only thing the
// figure asserts — that the membranes stay separate — so those are drawn
// rather than laid out. Positions are fractions of the frame, so the drawing
// is still resolution-free and still re-flows if the measure changes.
async function buildScene (spec) {
  const W = spec.width === 'column' ? K.COL_MM : K.SPAN_MM
  const H = spec.height
  const px = v => v * W, py = v => v * H
  let svg = ''
  for (const sh of spec.shapes) {
    if (sh.type === 'membrane') {
      // Two leaflets, bowed, so it reads as a membrane and not as a rule.
      const x1 = px(sh.from), x2 = px(sh.to), y = py(sh.y), bow = py(sh.curve || 0)
      for (const off of [-sh.gap / 2, sh.gap / 2]) {
        svg += '\n<path d="M ' + K.n(x1) + ' ' + K.n(y + off) +
          ' Q ' + K.n((x1 + x2) / 2) + ' ' + K.n(y + off + bow * 2) +
          ' ' + K.n(x2) + ' ' + K.n(y + off) + '" fill="none" stroke="' +
          K.TOKENS.mid + '" stroke-width="0.7"/>'
      }
    } else if (sh.type === 'embedded') {
      const x = px(sh.x) - sh.w / 2, y = py(sh.y) - sh.h / 2
      svg += '\n' + K.box(x, y, sh.w, sh.h, sh.kind || 'strong')
    } else if (sh.type === 'curve') {
      svg += '\n<path d="M ' + K.n(px(sh.from[0])) + ' ' + K.n(py(sh.from[1])) +
        ' C ' + K.n(px(sh.c1[0])) + ' ' + K.n(py(sh.c1[1])) + ' ' +
        K.n(px(sh.c2[0])) + ' ' + K.n(py(sh.c2[1])) + ' ' +
        K.n(px(sh.to[0])) + ' ' + K.n(py(sh.to[1])) +
        '" fill="none" stroke="' + (sh.accent ? K.TOKENS.teal : K.TOKENS.foot) +
        '" stroke-width="0.45" stroke-dasharray="1.6 1.1"/>'
    } else if (sh.type === 'leader') {
      svg += '\n<path d="M ' + K.n(px(sh.from[0])) + ' ' + K.n(py(sh.from[1])) +
        ' L ' + K.n(px(sh.to[0])) + ' ' + K.n(py(sh.to[1])) +
        '" fill="none" stroke="' + K.TOKENS.line + '" stroke-width="0.3"/>'
    } else if (sh.type === 'text') {
      const style = Object.assign({}, K.TYPE[sh.style || 'node'])
      const lines = await K.wrap(sh.text, style, sh.wrap ? px(sh.wrap) : W)
      svg += '\n' + K.textBlock(lines, px(sh.x), py(sh.y), style, sh.anchor || 'middle')
    } else if (sh.type === 'frame') {
      svg = K.box(px(sh.x), py(sh.y), px(sh.w), py(sh.h), sh.kind || 'ghost') + svg
    }
  }
  let bottom = H
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

async function build (spec) {
  if (spec.kind === 'scene') return buildScene(spec)
  const W = spec.width === 'column' ? K.COL_MM : K.SPAN_MM
  const body = await buildRows(spec.rows, INSET, W - INSET * 2, INSET)
  let svg = body.svg
  let bottom = body.y

  // Two arrows arriving at the same edge of the same box land on the same
  // point and draw over each other. Spread them across that edge instead.
  const arrivals = {}
  for (const l of spec.links || []) {
    const a = body.boxes[l.from], b = body.boxes[l.to]
    if (!a || !b) continue
    const key = l.to + (a.y < b.y ? ':top' : a.y > b.y ? ':bottom' : ':side')
    ;(arrivals[key] = arrivals[key] || []).push(l)
  }
  const departures = {}
  for (const l of spec.links || []) {
    const a = body.boxes[l.from], b = body.boxes[l.to]
    if (!a || !b) continue
    const key = l.from + (a.y < b.y ? ':bottom' : a.y > b.y ? ':top' : ':side')
    ;(departures[key] = departures[key] || []).push(l)
  }
  const nth = (group, l) => {
    const g = group || []
    return { i: g.indexOf(l), of: g.length }
  }
  const spread = (box, slot) => slot.of < 2 ? box.x + box.w / 2
    : box.x + box.w * (slot.i + 1) / (slot.of + 1)

  const labelBoxes = []
  for (const l of spec.links || []) {
    const a = body.boxes[l.from], b = body.boxes[l.to]
    if (!a || !b) { console.warn('  ! link skipped, unknown node: ' + l.from + '->' + l.to); continue }
    const vertical = Math.abs(a.y - b.y) >= Math.min(a.h, b.h) && l.route !== 'side'
    const pts = route(a, b, l.kind === 'inhibit' ? 'inhibit' : l.route)
    if (vertical && pts.length >= 2) {
      const aKey = l.from + (a.y < b.y ? ':bottom' : ':top')
      const bKey = l.to + (a.y < b.y ? ':top' : ':bottom')
      const ax = spread(a, nth(departures[aKey], l))
      const bx = spread(b, nth(arrivals[bKey], l))
      pts[0][0] = ax
      pts[pts.length - 1][0] = bx
      if (pts.length === 4) { pts[1][0] = ax; pts[2][0] = bx }
      else if (Math.abs(ax - bx) > 0.6) {
        const mid = (pts[0][1] + pts[1][1]) / 2
        pts.splice(1, 0, [ax, mid], [bx, mid])
      }
    }
    svg += '\n' + K.link(pts, l.kind || 'arrow', l.accent)

    if (l.label) {
      const lines = await K.wrap(l.label, K.TYPE.edge, 34)
      const lw = Math.max(...(await K.widths(lines, K.TYPE.edge)))
      const lh = lines.length * K.TYPE.edge.size * 1.26
      // Hang the label off the longest straight leg, clear of the line, and
      // give it a ground of its own so a connector never runs through a word.
      let best = null
      for (let i = 1; i < pts.length; i += 1) {
        const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        if (!best || len > best.len) best = { len, a: pts[i - 1], b: pts[i] }
      }
      const horiz = Math.abs(best.a[1] - best.b[1]) < 0.6
      const cx = horiz ? (best.a[0] + best.b[0]) / 2 : Math.max(best.a[0], best.b[0]) + 1.6 + lw / 2
      const cy = horiz ? best.a[1] - 1.5 - lh / 2 : (best.a[1] + best.b[1]) / 2
      labelBoxes.push({ x: cx - lw / 2 - 0.8, y: cy - lh / 2 - 0.5, w: lw + 1.6, h: lh + 1 })
      svg += '\n<rect x="' + K.n(cx - lw / 2 - 0.8) + '" y="' + K.n(cy - lh / 2 - 0.5) +
             '" width="' + K.n(lw + 1.6) + '" height="' + K.n(lh + 1) + '" fill="#FFFFFF"/>'
      svg += '\n' + K.textBlock(lines, cx,
        cy - lh / 2 + K.TYPE.edge.size * 0.92, K.TYPE.edge, 'middle')
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
