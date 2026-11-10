'use strict'
//
// One line drawing per part, in the weight of the book's figures.
//
// They are drawn in currentColor, so an emblem takes the colour of the type
// around it — white on a part opener's colour ground — and nothing in the
// drawing has to know which part it belongs to.
//
//   1  a peptide: residues hung on a backbone
//   2  a mitochondrion and its cristae
//   3  a marker read against a threshold
//   4  cells, one of them dividing
//   5  a double helix

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
const f = v => Math.round(v * 10) / 10

function peptide () {
  let d = '', beads = ''
  for (let i = 0; i < 9; i += 1) {
    const x = 22 + i * 32, y = f(100 + Math.sin(i * 0.95) * 38), up = i % 2 ? -1 : 1
    d += (i ? ' L ' : 'M ') + x + ' ' + y
    beads += '<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + f(y + up * 30) + '" ' + S + '/>' +
      '<circle cx="' + x + '" cy="' + f(y + up * 38) + '" r="8" ' +
      (i % 3 === 0 ? 'fill="currentColor"' : S) + '/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="currentColor"/>'
  }
  return '<path d="' + d + '" ' + S + '/>' + beads
}

function mitochondrion () {
  let cristae = 'M 62 100'
  for (let i = 0; i < 7; i += 1) cristae += ' q 13 ' + (i % 2 ? 46 : -46) + ' 26 0'
  return '<rect x="26" y="42" width="248" height="116" rx="58" ' + S + '/>' +
    '<rect x="40" y="56" width="220" height="88" rx="44" ' + S + ' opacity=".5"/>' +
    '<path d="' + cristae + '" ' + S + '/>'
}

function marker () {
  const pts = [[52, 150], [86, 138], [120, 142], [154, 112], [188, 96], [222, 70], [256, 58]]
  return '<path d="M 34 30 V 168 H 276" ' + S + '/>' +
    '<path d="M 34 104 H 276" ' + S + ' stroke-dasharray="5 6" opacity=".65"/>' +
    '<path d="' + pts.map((p, i) => (i ? 'L ' : 'M ') + p[0] + ' ' + p[1]).join(' ') + '" ' + S + '/>' +
    pts.map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (i === 4 ? 9 : 5) + '" ' +
      (i === 4 ? S : 'fill="currentColor"') + '/>').join('')
}

function cells () {
  const cell = (x, y, r, solid) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + S + '/>' +
    '<circle cx="' + x + '" cy="' + y + '" r="' + f(r * 0.32) + '" ' + (solid ? 'fill="currentColor"' : S) + '/>'
  return cell(92, 104, 44, true) + cell(150, 104, 44, true) + cell(226, 62, 26) + cell(238, 136, 30) +
    cell(40, 46, 18) + '<path d="M 121 72 V 136" ' + S + ' stroke-dasharray="4 6"/>'
}

function helix () {
  let a = '', b = '', rungs = ''
  for (let i = 0; i <= 60; i += 1) {
    const x = f(20 + i * 4.4), swing = Math.sin(i / 60 * Math.PI * 4) * 44
    const y1 = f(100 + swing), y2 = f(100 - swing)
    a += (i ? ' L ' : 'M ') + x + ' ' + y1
    b += (i ? ' L ' : 'M ') + x + ' ' + y2
    if (i % 4 === 2 && Math.abs(y1 - y2) > 16) {
      rungs += '<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2 + '" ' + S + ' opacity=".55"/>'
    }
  }
  return rungs + '<path d="' + a + '" ' + S + '/><path d="' + b + '" ' + S + '/>'
}

const DRAW = { 1: peptide, 2: mitochondrion, 3: marker, 4: cells, 5: helix }

module.exports = function emblem (part) {
  const draw = DRAW[part] || DRAW[1]
  return '<svg class="part-emblem" data-new="emblem" viewBox="0 0 300 200" aria-hidden="true">' + draw() + '</svg>'
}
