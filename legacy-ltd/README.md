# Legacy.Ltd — Exit Value Simulator

A single, fully self-contained HTML page: `index.html`.

No build step, no dependencies, no external requests of any kind — CSS, JavaScript and
the logo are all inline. Drop it on any host, open it from a USB stick, or email it as an
attachment and it works identically. Verified in headless Chromium: zero console errors,
zero network requests, zero horizontal overflow at 390 / 768 / 1440px.

## What the page does

A landing page built around a working **exit-value simulator** that runs entirely in the
visitor's browser. Nothing is transmitted or stored.

**Inputs**

- Sector (11 options, each with its own base multiple and diligence note)
- TTM revenue, EBITDA margin, owner add-backs, debt at close
- **Exit horizon** — under 12 months / 12–24 months / 2–3 years / 3–5 years / 5+ years
- The **ten value drivers** from the valuation workbook, scored 0–10 with plain-language
  anchor text at every level

**Outputs**

- Weighted exit-readiness score (0–100) with a grade band
- A verdict that tests the score *against the chosen horizon* — on track / at risk / off track
- Enterprise value today vs. projected value at the exit date
- Value at stake, expressed per month of delay
- Full multiple breakdown: sector base × scale adjustment × readiness adjustment
- Net-to-owner waterfall: fees, debt retired, effective tax, and the amount **kept** by
  fixing structure and tax posture
- The four highest-leverage moves, ranked by weight × shortfall, each priced in dollars
- "Save as PDF" (print stylesheet) and an "Email my simulation" mailto that carries the
  whole result set

## The ten drivers

| # | Driver | Weight |
|---|---|---|
| 01 | Owner independence | 1.5 |
| 02 | Revenue quality & recurrence | 1.4 |
| 03 | Customer & supplier concentration | 1.0 |
| 04 | Financial hygiene & reporting | 1.2 |
| 05 | Systems, process & automation | 1.1 |
| 06 | Management depth & key-person risk | 1.1 |
| 07 | Margin discipline & cash conversion | 1.2 |
| 08 | Legal, IP & contract integrity | 0.9 |
| 09 | Growth story & market position | 1.0 |
| 10 | Structure, tax & net-proceeds readiness | 0.6 |

## Before it goes live — swap these

Every one is marked with a `REPLACE:` comment in the source.

1. **Logo — ONE line.** The wordmark in place is a **placeholder vector
   reconstruction**, not the official artwork. It is defined exactly once per file, in a
   `<symbol id="lg-mark">` at the top of `<body>`; every placement is a `<use>` reference.
   Two ways to swap it, both single edits:

   - **A raster or SVG file** — set `LOGO_SRC` at the top of the `<script>` block to a
     data URI: `var LOGO_SRC = "data:image/png;base64,iVBORw0KG…";`
     Every logo slot on the page then renders that image instead. The CSS already sizes
     an `<img>` identically to the `<svg>`, hero included.
   - **Official SVG paths** — replace the elements inside `<symbol id="lg-mark">` with the
     paths from the real file and set the symbol's `viewBox` to match.

   Do it in both `index.html` and `problem-audit.html`.
2. **Email address.** `buildMail()` → `var to = "hello@legacy.ltd";`
3. **Booking link.** `<a … id="cta-book">` and the nav `Book a Review` button both point
   at `#book`. Repoint them at the real scheduler.
4. **Sector multiples.** `SECTORS[]` carries market-range base multiples. Replace with
   your own comparable-transaction data where you have it.
5. **Model constants.** `FEE_RATE`, `TAX_HIGH`, `TAX_LOW`, `ORGANIC_G`, `CEILING` and the
   per-horizon `close` factors sit together at the top of the script block.
6. **Hero statistics.** The four figures in `.hero__stats` are widely-cited market ranges.
   Substitute sourced numbers or your own book of transactions before publishing.

## Positioning

The page is deliberately built around three levers, not one:

1. **Keep more of it** — margin leakage, working capital, entity structure, deal-stage tax
2. **Automate the systems** — documented, instrumented process as proof of transferability
3. **Become acquirable** — acquirability treated as a manufactured condition, not luck

## Disclaimer

The simulator is an educational planning tool. It is not a certified business valuation,
an offer, investment advice, or tax advice. That language appears both under the results
panel and in the footer — keep it there.

---

# The Honest Audit

`problem-audit.html` — a second self-contained page, and `problems-126.csv` — the
classified problem table behind it.

Built from the **200 Evergreen Problems** vault. Two things about that source you should
know before trusting anything downstream of it.

## Finding 1: the vault's `EASE` score is inverted

It is a **difficulty** score, not an ease score. Every low-scoring item is trivially
fixable (`Weak testimonials` 3, `Slow invoicing process` 3, `Too many meetings` 3) and
every high-scoring one is genuinely hard (`No evergreen lead engine` 7,
`Paid traffic not profitable` 7, `No exit or long-term plan` 7). It correlates
**+0.72 with INCOME** — harder problems pay more, which is only coherent if high = hard.
Read the other way round, the "easy wins" list is upside down.

Everything in `problems-126.csv` is stated as `difficulty_1_10`, high = hard.

## Finding 2: the vault's scores cannot rank anything

`DEMAND` averages **9.15** across all 126 items, barely varies, and is uncorrelated with
`INCOME` (−0.03). `EASE` only ever spans 3–7. So the vault carries roughly one
discriminating signal, and it is an editorial judgement about problems in general, not
about any particular business. **All the ranking information has to come from the survey.**
That is what the instrument exists to produce.

## Finding 3: the PDF contains 126 problems, not 200

The category counts stated in the document itself — 56 + 27 + 18 + 12 + 13 — sum to 126,
and 126 problem blocks parse out of it. Either the title is aspirational or this is a
partial export. If a fuller vault exists, the classifier will absorb it: extend the
`FAM` regex table and re-run.

## The classification

Every one of the 126 is mapped to one of **26 fix-families**. A family carries the four
things the vault doesn't: what it costs, how long it takes, which lever it pulls, and one
falsifiable probe that settles whether the problem is actually present.

| Field | Meaning |
|---|---|
| `cost_band` | Typical spend to fix — scaled by client revenue at runtime |
| `time_band` | Typical elapsed time, days through two quarters |
| `lever` | **Earnings** (lifts EBITDA), **Multiple** (re-rates the business), or **Both** |
| `multiple_delta` | Estimated movement in the exit multiple once resolved |
| `falsifiable_probe` | The question whose answer proves the problem is real |

The lever split is the whole point: **48 earnings levers, 49 multiple levers, 29 both.**
A $3k fix that lifts EBITDA $20k is worth $80k at a 4× multiple. A $3k fix that moves the
multiple 0.25× on $500k of EBITDA is worth $125k — on the same spend. Ranking by cash
impact alone systematically buries the second kind.

## How the instrument gets honest answers

Eight stages, each with a mechanism that makes shading the truth costly, useless, or
impossible.

| Stage | Mechanism | Why it works |
|---|---|---|
| 1 · The Wager | Consequence framing | The output is a spend recommendation, so overstating costs real money |
| 2 · Nine Numbers | Evidence over opinion | Asks for figures from memory with a first-class "I'd have to look" — inability to answer *is* the finding. One of the nine, what a customer is worth in a year, also supplies the unit economics stage 6 runs on |
| 3 · The Understudy | Third-person projection + forced ordering | People are markedly more honest about their business when answering as someone else. Selection is **unlimited** — a real business has more than three broken things — but they must name the one their deputy leads with, so breadth and priority are both captured |
| 4 · One Hundred Chips | Forced ipsative allocation | Must total exactly 100, so nothing can be rated "important" for free |
| 5 · Triage | Scarcity constraint | "Bleeding" is hard-capped at six of 28, forcing revealed preference. This is the *only* stage that caps you — breadth is collected earlier, priority is forced here |
| 6 · Score the Bleed | Lived units, not dollar guesses | **Never asks for a dollar figure.** An owner who cannot state their own gross margin cannot price a problem in dollars, and asking produces confident fiction. Instead: how often does this bite (five frequency bands), and what does it cost each time in units they already think in (a lost deal, a day redoing work, a discount they had to give). The engine derives the dollars from the unit economics collected in stage 2 and shows its arithmetic on screen. Gut-feel frequencies weigh 0.4 against counted at 1.0 |
| 7 · Contradiction Desk | Cross-answer consistency check | Surfaces pairs that can't both be true and makes the respondent choose |
| 8 · The Ledger | — | Output |

**Blind Spot Index.** The share of the eight core numbers the owner couldn't produce.
It's a finding on its own, and it discounts every later self-assessment by up to 30% —
if you can't name your margin, your claim that pricing is fine carries less weight.

**Credibility flags.** Any fix showing better than a 25× return gets a visible
*Check this estimate* mark. A return that large almost always means the bleed estimate is
hot, not that the fix is miraculous.

**Two ceilings on the derived costs.** No single problem may claim more than 15% of
revenue, and the bleeding set together may not exceed 30% — six problems each claiming
whole lost deals are counting the same lost deals. When the portfolio ceiling binds, the
ledger says what the raw answers came to and what they were scaled back to, rather than
quietly shrinking them.

## Two uses, one instrument

- **Client-facing.** A business owner completes it and gets a ranked ledger for their
  business, priced in both cash and enterprise value.
- **Internal.** Pool the JSON exports across respondents to see which of the 126 problems
  are most commonly bleeding, most highly priced, and cheapest to serve — that is the
  product roadmap, evidenced rather than assumed.

The **Copy result data** button emits the full JSON: probes, chips, triage buckets,
contradiction resolutions, and the ledger with every intermediate figure.

## Before it goes live — swap these

1. **Logo** — same placeholder, same one-line swap: set `LOGO_SRC` at the top of the
   `<script>` block, or replace the paths inside `<symbol id="lg-mark">`.
2. **Email** — `buildExports()` → `var to = "hello@legacy.ltd";`
3. **Cost bands** — `COST_$` and the revenue scaling in `sizeFactor()`.
3b. **Unit economics** — `UNITS` (what each kind of loss is worth) and `FREQ` (how many
   times a year each band means), plus the two ceilings in `unitEconomics()`.
4. **Confidence weights** — `CONF` (measured 1.0 / estimated 0.7 / gut 0.4) and the 30%
   Blind Spot discount in `globalConfidence()`.
5. **Multiple deltas** — the `md` value per family, in the injected `FAM` table. These are
   the most opinionated numbers in the model; tune them against your own transaction data.
