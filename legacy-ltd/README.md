# Legacy.Ltd — Exit Value Simulator

A single HTML page: `index.html`.

No build step and no dependencies. CSS, JavaScript and the fallback artwork are all
embedded. Two external requests remain — the hosted wordmark and the Alatsi webfont — and
both degrade cleanly: an identical embedded copy replaces the wordmark, and the display
stack falls through to Futura PT → Futura → Century Gothic → Avenir → system. Drop it on
any host, open it from a USB stick, or email it as an attachment and it works. Verified in
headless Chromium: zero console errors, no horizontal overflow at 390 / 768 / 1440px.

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

## The logo

On screen the wordmark is a real `<img>` pointing at the hosted file:

```
https://legacy.ltd/wp-content/uploads/2025/01/legacy-white.png
```

so the pages always show whatever is live at that URL — update the logo there and these
pages follow, with no edit here. If it cannot load (offline, opened from a USB stick,
emailed as a single file), `lgFallback()` swaps in an identical embedded copy, so the
mark is never missing and never a redraw.

Both variants are also embedded as base64 PNG inside two `<symbol>` elements
immediately after `<body>`:

| Symbol | Artwork | Used for |
|---|---|---|
| `#lg-mark` | white wordmark | offline fallback for the hosted `<img>` |
| `#lg-mark-dark` | black wordmark | printing onto white |

Every placement — nav, footer, and the audit's header — carries the same pair: an
`<img class="lg lg--light">` at the hosted URL, and an `<svg class="lg lg--dark">`
referencing `#lg-mark-dark`. The black variant is stored once per file however many times
it appears, and the hosted white one is fetched once and cached across all placements.
`.logo .lg--dark` is `display:none` on screen and the print block inverts the pair, which
replaced the old `.logo{color:#000}` print rule: the mark is a raster, so it cannot be
recoloured by `currentColor`.

To change the logo, replace the file at that URL — no edit here. To repoint the pages at
a different URL, change the `src` on the `.lg--light` images (two in the simulator, one
in the audit); to refresh the fallback and the print variant, swap the two `href` data
URIs in the symbols.

Two notes on how the bytes are stored:

- **Re-encoded to grayscale + alpha.** Every pixel in both source files is neutral
  (measured: R = G = B for all 61,800 pixels of each), so dropping the two redundant
  colour channels is bit-exact for this artwork. It takes each file from ~37 KB to
  ~20 KB, which matters when it is inlined as base64 in two documents.
- **The hero carries no wordmark.** An earlier draft opened the hero with a full-width
  LEGACY lockup, which collided with the mark already in the sticky header. Both it and
  its `Exit Architecture & Enterprise Value` sub-line are gone, so the hero now opens on
  the eyebrow and headline and the wordmark appears once per screen, in the nav.

The unmodified source files are committed alongside the pages at `brand/legacy-white.png`
and `brand/legacy-black.png` — the pages do not load them, they are there so the masters
live with the work.



## Typography

Headings, the wordmark-adjacent eyebrows, buttons and all figures use **Alatsi**, loaded
from Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alatsi&display=swap">
```

Alatsi ships **one weight, 400**. The pages set `font-weight:700` on headings anyway, so
the browser synthesises the bold. That is deliberate: at 400 the hero headline is too
light to hold the dark ground, and the synthesised weight reads as intended at every size
the pages use. If a real bold is ever wanted, it needs a different family — there is no
700 file to load.

`display:swap` means text paints immediately in the fallback and reflows when Alatsi
arrives, so a slow or blocked font request never leaves the page blank. The fallback chain
(`--display`) is geometric-sans throughout, so the layout does not jump.

Body copy is unchanged and uses the system stack.

## Deploying — the pages are independent

There are three pages, and **none of them needs the others in order to run**:

| File | Runs on its own? | Needs anything alongside it? |
|---|---|---|
| `index.html` | yes | no |
| `calculator.html` | yes | no |
| `problem-audit.html` | yes | no |
| `problems-126.csv` | n/a | **not loaded by either page** — it is reference data for you |

Each page is a complete application in one file. There is no shared library, no data
fetch, no build output. You can publish one, the other, or both.

The only thing connecting them is a single hyperlink each way — the simulator's footer
links to `problem-audit.html`, and the audit's header links back to `index.html`. Those
links assume the two files sit **in the same folder**. `calculator.html` links to neither
and is linked from neither. If you publish only one page,
that one link will 404; delete it, or point it at wherever the other page lives. Nothing
else breaks, and no functionality is lost.

## Embedding the pages

**Do not paste these files into a Custom HTML / Custom Code block.** They are complete
HTML documents, and every page builder — WordPress, GoHighLevel, Squarespace — strips the
`<!DOCTYPE>`, `<html>`, `<head>` and `<body>` wrappers and leaves the `<style>` block
applying to the *whole* host page. The page's own resets and its `body`, `:root`, `h1`,
`a` and `.wrap` rules then fight the builder's, in both directions: the dark background
never reaches the builder's own section wrappers, so their white shows through and over
the top of the content, and the sticky header collides with the builder's header. That is
what "does not embed well" and "the button is under a white bar" both look like, and no
amount of tidying the markup fixes it — the CSS has to be isolated.

Use an `<iframe>`. It gives complete CSS and JavaScript isolation, so the page renders
exactly as designed and cannot disturb the host page — or be disturbed by it.

**1 — Upload the files** somewhere the site can serve them, keeping them in the same
folder so the cross-links work. Confirm the file loads directly in a browser, on its own,
before embedding it:

- **WordPress** — SFTP into `/wp-content/uploads/legacy/`. The Media Library blocks
  `.html` uploads by default, so use SFTP, your host's file manager, or a plugin that
  permits HTML. → `https://legacy.ltd/wp-content/uploads/legacy/index.html`
- **GoHighLevel** — GHL will not host a raw `.html` file. Upload the two files anywhere
  that serves them over HTTPS (the WordPress site above, an S3 bucket, Netlify Drop,
  GitHub Pages) and point the iframe at that URL. Cross-origin is fine; the bridge below
  is written for it.

**2 — Add this to the host page** in a Custom HTML / Custom Code block. In GHL that is
Add Element → Custom JS/HTML, dropped into a full-width section (Row width: Full, section
padding 0) so the page is not squeezed into a narrow column.

```html
<iframe id="legacy-simulator"
        src="https://YOUR-HOST/legacy/index.html"
        title="Exit Value Simulator"
        style="width:100%;border:0;display:block;height:1200px"
        scrolling="no" loading="lazy"></iframe>
<script>
(function(){
  /* Set this to the height of your site's fixed/sticky header, in pixels.
     0 if the header scrolls away with the page. */
  var HEADER_OFFSET = 0;

  /* Must match the iframe src origin exactly, scheme included. */
  var FRAME_ORIGIN = 'https://YOUR-HOST';

  var f = document.getElementById('legacy-simulator');
  window.addEventListener('message', function(e){
    if (e.origin !== FRAME_ORIGIN) return;
    var d = e.data || {};
    if (d.legacyEmbedHeight) f.style.height = d.legacyEmbedHeight + 'px';
    if (typeof d.legacyEmbedScrollTo === 'number'){
      var top = f.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({top: top + d.legacyEmbedScrollTo - HEADER_OFFSET,
                       behavior: 'smooth'});
    }
  });
})();
</script>
```

Two values to set: `FRAME_ORIGIN` (scheme + host of the iframe `src`, no path, no
trailing slash) and `HEADER_OFFSET`. The `height:1200px` is only what shows before the
script runs; it is replaced within a frame of load.

**Why this works.** Each page carries an *embed bridge* — a short script that runs only
when the page is inside an iframe. It posts the document's height to the parent, and the
snippet above resizes the frame to match. The result is a frame exactly as tall as its
content: the host page does the scrolling, there is no scrollbar-inside-a-scrollbar, and
no height to guess or maintain. It re-posts whenever the content height changes —
advancing an audit stage, resizing the window — so the frame keeps tracking.

Because an auto-sized frame never scrolls itself, two things follow. `position:sticky`
could never engage inside it, so the bridge marks the document `is-embedded` and the
sticky header and results rail become static. And the in-page links — *Run My Numbers*,
*See the 10 Drivers*, the nav — would have nothing to scroll, so the bridge intercepts
them, measures the target inside the frame, and posts its position; the snippet above
scrolls the host page there instead. `HEADER_OFFSET` is what stops the target landing
underneath a fixed site header. Standalone, none of this runs and both behave normally.

**If the button is under a white bar.** That is the raw-paste failure above, or a fixed
site header sitting over the top of the frame. The iframe fixes the first; `HEADER_OFFSET`
fixes the second. If the header still covers the top of the embed on first load, give the
section holding the iframe top padding equal to the header height.

**If the script is stripped.** Some WordPress configurations remove `<script>` from post
content for non-administrator authors. If the frame stays at 1200px, that is what
happened: put the snippet in the theme (or a small plugin) instead, or set a fixed height
tall enough for the content and drop `scrolling="no"`. GHL's Custom JS/HTML element does
not strip scripts.

## The calculator on its own — `calculator.html`

`index.html` is the whole landing page. `calculator.html` is **only the calculator**, for
the case where the static copy around it is built somewhere else — a GoHighLevel page,
say — and all that needs embedding is the working part.

What is in it: the three input cards (business, exit horizon, ten drivers), the full
model, and the results rail. What is gone: nav, hero, the three-levers band, the horizon
playbooks, the driver reference, the keep-more and process sections, the FAQ, the CTA and
the footer. Same engine, same numbers, same dark treatment — it is the identical simulator
code, sliced out rather than rewritten, so the two pages cannot drift apart.

It embeds exactly like the others (see **Embedding the pages**) — same auto-height bridge,
same host snippet. There are no in-page anchors on it, so `HEADER_OFFSET` only affects
where the frame itself lands.

### The two buttons

**Download PDF** builds the report and downloads it. No email asked for, nothing sent.

**Send Me the Report** opens a four-field capture (name and email required, company and
phone optional), then does both things at once: the PDF downloads for the prospect, and
every figure is posted to your CRM.

The PDF is drawn with [jsPDF](https://github.com/parallax/jsPDF), fetched from cdnjs on
first use rather than at page load, so the calculator stays instant and still works with
the library blocked — in that case it falls back to the browser's own print-to-PDF, which
produces the same figures. It is a real vector PDF, not a screenshot: masthead, who it is
for, readiness score and verdict, the full valuation and net-proceeds tables, the ranked
moves with what each is worth, and the disclaimer.

One trap worth knowing if you edit it: jsPDF's built-in Helvetica is WinAnsi-encoded and
**silently drops en dashes, em dashes and curly quotes**, which turns `12–24 mo` into
`1224 mo`. Every string is folded to ASCII at the boundary (`ascii()`), so no call site
has to remember.

## The GoHighLevel handoff

Set one line at the top of the script in `calculator.html`:

```js
var GHL_WEBHOOK_URL = "";   /* REPLACE: https://services.leadconnectorhq.com/hooks/... */
```

In GHL: **Automation → Workflows → new workflow → trigger "Inbound Webhook"**. Copy the
URL it gives you and paste it above. Then add a **Create/Update Contact** step and a
**Send Email** step. Left empty, the calculator still runs and the PDF still downloads —
nothing reaches your CRM, and the page does not claim otherwise.

The POST body is flat JSON, one level deep, so every key maps straight onto a GHL field:

| Key | Example |
|---|---|
| `name`, `email`, `phone`, `companyName` | what they typed |
| `source` | `Exit Value Calculator` |
| `sector` | `Professional & B2B services` |
| `exitHorizon` | `12–24 mo` |
| `readinessScore` / `readinessGrade` | `37` / `High Risk` |
| `verdict` | `Off track for a 12–24 month exit` |
| `adjustedEbitda`, `effectiveMultiple` | `$768K`, `2.87x` |
| `enterpriseValueToday`, `projectedValueAtExit` | `$2.21M`, `$3.36M` |
| `valueAtStake`, `valueAtStakePerMonth` | `$1.15M`, `$64K` |
| `estimatedNetToOwner`, `keptByStructureAndTax` | `$2.27M`, `$137K` |
| `priorityMove1` … `priorityMove4` | the ranked moves; empty string when there are fewer than four |
| `reportSummary` | the whole report as one pre-formatted text block |
| `submittedAt` | ISO 8601 |

**`reportSummary` is the one to reach for first.** Map it to a single custom field, drop
that field into your email template, and the email carries the entire report without you
mapping twenty others.

Values arrive pre-formatted as they read on screen (`$2.21M`, `2.87x`) rather than as raw
numbers, so they can go straight into an email with no formatting step. The PDF and this
payload are built from the same snapshot of the run, so what the prospect reads and what
lands in your CRM cannot disagree.

**What the page will and will not claim.** The POST is tried twice: first as normal JSON,
which returns a readable status if the endpoint sends CORS headers; and if that throws —
almost always a refused preflight rather than a real network problem — again in `no-cors`
mode, which needs no preflight and goes out regardless, but whose reply is opaque. That
gives three honest states, and the confirmation wording differs between them: sent and
confirmed, sent but unconfirmable, and a genuine failure, where the page says only that
the PDF downloaded. It deliberately does not use `navigator.sendBeacon`, which returns
`true` the moment the browser *queues* a request — a dead endpoint would come back looking
like a success, and the prospect would be told their report was on its way when it was not.

## Before it goes live — swap these

Every one is marked with a `REPLACE:` comment in the source.

1. ~~**Logo**~~ — **done.** The official artwork is in place; see *The logo* below.
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

1. ~~**Logo**~~ — **done.** Same official artwork as the simulator.
2. **Email** — `buildExports()` → `var to = "hello@legacy.ltd";`
3. **Cost bands** — `COST_$` and the revenue scaling in `sizeFactor()`.
3b. **Unit economics** — `UNITS` (what each kind of loss is worth) and `FREQ` (how many
   times a year each band means), plus the two ceilings in `unitEconomics()`.
4. **Confidence weights** — `CONF` (measured 1.0 / estimated 0.7 / gut 0.4) and the 30%
   Blind Spot discount in `globalConfidence()`.
5. **Multiple deltas** — the `md` value per family, in the injected `FAM` table. These are
   the most opinionated numbers in the model; tune them against your own transaction data.
