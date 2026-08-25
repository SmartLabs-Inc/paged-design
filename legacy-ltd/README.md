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

1. **Logo.** The wordmark is a vector reconstruction so the file stays self-contained.
   To use the official artwork, replace the `<svg>` inside each `.logo` element (nav,
   hero, footer — three places) with
   `<img src="data:image/png;base64,…" alt="Legacy">`, or paste the official SVG paths
   over the ones in place.
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
