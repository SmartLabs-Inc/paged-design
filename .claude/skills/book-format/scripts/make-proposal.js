#!/usr/bin/env node

// Build a client proposal from a deal file and a proposal template.
//
// The template is the last proposal that shipped, with the deal-specific
// strings replaced by {{tokens}}. A deal file supplies the names, dates and
// money; this fills them in and writes a book the rest of the skill can
// render like any other.
//
//   node make-proposal.js --deal deals/acme.json
//   node make-proposal.js --example > deals/acme.json
//
// Dates are the part worth automating. A rush schedule is counted backward
// from the delivery date, and doing that by hand is where the mistakes live:
// a Tuesday written as a Wednesday, a week range that overlaps the one above
// it. Give it `start` and the week numbers and it computes every range.

const fs = require('fs')
const path = require('path')
const { parseArgs, slugify } = require('./common')

const args = parseArgs(process.argv)
const TEMPLATE_DIR = path.join(__dirname, '..', 'proposals')

if (args.example) {
  process.stdout.write(
    fs.readFileSync(path.join(TEMPLATE_DIR, 'example-deal.json'), 'utf-8')
  )
  process.exit(0)
}

if (args.help || !args.deal) {
  console.log([
    'Usage: node make-proposal.js --deal <file.json> [options]',
    '',
    '  --deal <file>      The deal file. See --example for a starting point.',
    '  --example          Print a blank deal file to fill in.',
    '  --template <name>  Template in proposals/. Default: textbook-launch.',
    '  --out <dir>        Where to write. Default: content/proposal-<slug>.',
    '  --force            Overwrite an existing directory.',
    '',
    'Then render it like any other book:',
    '',
    '  node check-layout.js --content <dir> --theme aalai-screen --strict',
    '  node render-pdf.js  --content <dir> --theme aalai-screen --out proposal.pdf'
  ].join('\n'))
  process.exit(args.help ? 0 : 1)
}

// --- dates -----------------------------------------------------------------
// Everything is computed in UTC from a plain YYYY-MM-DD, so a machine in a
// different timezone cannot shift a date by a day.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
const SHORT = MONTHS.map(function (m) { return m.slice(0, 3) })

function parseDate (value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!match) {
    throw new Error(label + ' must be a date as YYYY-MM-DD, got: ' + value)
  }
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
  if (isNaN(date.getTime())) throw new Error(label + ' is not a real date: ' + value)
  return date
}

function addDays (date, days) {
  return new Date(date.getTime() + days * 86400000)
}

function longDate (date) {
  return MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate() + ', ' + date.getUTCFullYear()
}

function dayAndDate (date) {
  return DAYS[date.getUTCDay()] + ', ' + MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate()
}

function monthDay (date) {
  return SHORT[date.getUTCMonth()] + ' ' + date.getUTCDate()
}

// "Aug 10–16", or "Aug 31–Sep 6" when the range crosses a month.
// Hair spaces around the dash, as the rest of the design uses.
function range (from, to) {
  const dash = '&#8202;–&#8202;'
  const left = monthDay(from)
  const right = from.getUTCMonth() === to.getUTCMonth()
    ? String(to.getUTCDate())
    : monthDay(to)
  return left + dash + right
}

// Week 1 is the week of `start`. Week N runs Monday to Sunday from there,
// except that a row may name several weeks and gets one range across them.
function weekRange (start, weeks) {
  const first = Math.min.apply(null, weeks)
  const last = Math.max.apply(null, weeks)
  return range(addDays(start, (first - 1) * 7), addDays(start, (last - 1) * 7 + 6))
}

function weekLabel (weeks) {
  if (weeks.length === 1) return String(weeks[0])
  return Math.min.apply(null, weeks) + '&#8202;–&#8202;' + Math.max.apply(null, weeks)
}

function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// A schedule row either names week numbers, which are turned into dates, or
// carries a literal `dates` string for the stages after the press deadline
// that do not fall on the production week grid.
function scheduleRows (rows, start, label) {
  if (!Array.isArray(rows)) throw new Error(label + ' must be an array')
  return rows.map(function (row, index) {
    const where = label + '[' + index + ']'
    if (!row.what) throw new Error(where + ' needs a "what"')
    let weeks = ''
    let dates = row.dates || ''
    if (row.weeks) {
      if (!Array.isArray(row.weeks)) throw new Error(where + '.weeks must be an array')
      weeks = weekLabel(row.weeks)
      if (!dates) dates = weekRange(start, row.weeks)
    }
    if (!dates) throw new Error(where + ' needs "weeks" or "dates"')
    return '                    <tr><td>' + (weeks || '&#160;') + '</td><td>' +
      dates + '</td><td>' + row.what + '</td></tr>'
  }).join('\n')
}

// --- template --------------------------------------------------------------

function lookup (context, dotted) {
  return dotted.split('.').reduce(function (node, key) {
    return (node === undefined || node === null) ? undefined : node[key]
  }, context)
}

// {{#if path}} … {{/if}} and {{#unless path}} … {{/unless}}, then {{{raw}}},
// then {{escaped}}. Conditionals first so a dropped section never leaves
// unresolved tokens behind it.
function render (template, context) {
  const unresolved = []

  function conditionals (text) {
    const pattern = /\{\{#(if|unless)\s+([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/
    let match
    while ((match = pattern.exec(text)) !== null) {
      const truthy = Boolean(lookup(context, match[2]))
      const keep = (match[1] === 'if') === truthy
      text = text.slice(0, match.index) + (keep ? conditionals(match[3]) : '') +
        text.slice(match.index + match[0].length)
    }
    return text
  }

  let output = conditionals(template)

  output = output.replace(/\{\{\{([\w.]+)\}\}\}/g, function (_, key) {
    const value = lookup(context, key)
    if (value === undefined) { unresolved.push(key); return '' }
    return String(value)
  })

  output = output.replace(/\{\{([\w.]+)\}\}/g, function (_, key) {
    const value = lookup(context, key)
    if (value === undefined) { unresolved.push(key); return '' }
    return escapeHtml(value)
  })

  return { html: output, unresolved: Array.from(new Set(unresolved)) }
}

// --- build -----------------------------------------------------------------

function main () {
  const dealFile = path.resolve(args.deal)
  if (!fs.existsSync(dealFile)) {
    console.error('No such deal file: ' + args.deal)
    process.exit(1)
  }

  let deal
  try {
    deal = JSON.parse(fs.readFileSync(dealFile, 'utf-8'))
  } catch (error) {
    console.error('Deal file is not valid JSON: ' + error.message)
    process.exit(1)
  }

  const templateName = args.template || 'textbook-launch'
  const templateFile = path.join(TEMPLATE_DIR, templateName + '.html')
  if (!fs.existsSync(templateFile)) {
    console.error('No such template: ' + templateName)
    console.error('Available: ' + fs.readdirSync(TEMPLATE_DIR)
      .filter(function (f) { return f.endsWith('.html') })
      .map(function (f) { return f.replace(/\.html$/, '') })
      .join(', '))
    process.exit(1)
  }

  const dates = deal.dates || {}
  const start = parseDate(dates.start, 'dates.start')
  if (start.getUTCDay() !== 1) {
    console.warn('Note: dates.start is a ' + DAYS[start.getUTCDay()] +
      '. Week ranges read best when it is a Monday.')
  }
  const printer = parseDate(dates.printer, 'dates.printer')
  const delivery = parseDate(dates.delivery, 'dates.delivery')
  const proposal = parseDate(dates.proposal, 'dates.proposal')
  const validUntil = parseDate(dates.validUntil, 'dates.validUntil')

  if (printer >= delivery) {
    throw new Error('dates.printer must fall before dates.delivery')
  }
  if (start >= printer) {
    throw new Error('dates.start must fall before dates.printer')
  }
  if (validUntil < proposal) {
    throw new Error('dates.validUntil must not fall before dates.proposal')
  }

  const schedule = deal.schedule || {}
  const context = Object.assign({}, deal, {
    dates: Object.assign({}, dates, {
      proposal: longDate(proposal),
      validUntil: dayAndDate(validUntil) + ', ' + validUntil.getUTCFullYear(),
      delivery: MONTHS[delivery.getUTCMonth()] + ' ' + delivery.getUTCDate(),
      deliveryLong: dayAndDate(delivery),
      printer: MONTHS[printer.getUTCMonth()] + ' ' + printer.getUTCDate(),
      printerLong: dayAndDate(printer)
    }),
    schedule: Object.assign({}, schedule, {
      bookRows: scheduleRows(schedule.book, start, 'schedule.book'),
      launchRows: scheduleRows(schedule.launch, start, 'schedule.launch')
    })
  })

  const result = render(fs.readFileSync(templateFile, 'utf-8'), context)

  if (result.unresolved.length) {
    console.error('The deal file is missing values the template needs:')
    result.unresolved.forEach(function (key) { console.error('  ' + key) })
    process.exit(1)
  }

  const slug = deal.slug || slugify(deal.client && deal.client.signatory ? deal.client.signatory : 'client')
  const outDir = path.resolve(args.out || path.join('content', 'proposal-' + slug))
  if (fs.existsSync(outDir) && !args.force) {
    console.error(outDir + ' already exists. Pass --force to overwrite.')
    process.exit(1)
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), result.html)

  const weeksToPrinter = Math.round((printer - start) / (7 * 86400000))
  console.log('Wrote ' + path.relative(process.cwd(), path.join(outDir, 'index.html')))
  console.log('  ' + deal.client.signatory + ' · ' + deal.book.title)
  console.log('  Dated ' + longDate(proposal) + ', valid to ' + longDate(validUntil))
  console.log('  ' + weeksToPrinter + ' weeks to the printer, delivery ' + longDate(delivery))
  console.log('')
  console.log('Next:')
  console.log('  node ' + path.join(__dirname, 'check-layout.js') +
    ' --content ' + path.relative(process.cwd(), outDir) + ' --theme aalai-screen --strict')
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
