# Bitcoin Address Risk Scorer — frontend

Explainable risk scoring for Bitcoin addresses. React + Vite + Tailwind.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # scoring unit tests (node --test, no test-runner dependency)
npm run build
```

## Read this first

[contract.md](contract.md) is frozen and shared with the backend. Build against
`fixtures/sample.json`, which is a complete, realistic response with all five
categories populated. If the two sides disagree on a field, it goes in the shared
integration list — do not patch around it on one side.

## Layout

| Path | Role |
|---|---|
| `src/lib/scoring.js` | All scoring math. Pure functions — no React, no fetch. |
| `src/lib/waterfall.js` | Waterfall bar ordering and stacking geometry. Pure functions. |
| `src/lib/counterfactual.js` | The "what if sanctions were weighted up" re-score. |
| `src/lib/presets.js` | The four weight presets + which one is active. |
| `src/lib/address.js` | Client-side address format validation. |
| `src/lib/categories.js` | Category labels + the categorical colour palette. |
| `src/lib/demos.js` | Curated demo addresses (stands in for `GET /api/demo`). |
| `src/lib/api.js` | Fetch wrapper, falls back to the fixture. |
| `src/lib/format.js` | Display formatting — dates, counts, BTC rounding. Screen only. |
| `src/lib/degraded.js` | Reads `degraded` / `warnings` / `cached` off the envelope. |
| `src/lib/flags.js` | Node flag parsing (`ofac`, `ransomware:{Family}`), wording, colour. |
| `src/lib/graphLayout.js` | Counterparty graph geometry. Pure functions, no DOM. |
| `src/lib/taint.js` | Taint path view model + the plain-English gloss. |
| `src/lib/devOverrides.js` | **Temporary.** Dev-only `?degraded=1` / `?cached=1`. Delete before Thursday. |
| `src/components/AddressInput.jsx` | Address entry, validated before anything is sent. |
| `src/components/DemoPicker.jsx` | Demo address dropdown, driven off `lib/demos.js`. |
| `src/components/ScoreDial.jsx` | Score gauge, number always shown beside the band. |
| `src/components/Counterfactual.jsx` | The counterfactual line under the dial. |
| `src/components/WeightSliders.jsx` | Preset buttons + the five weight sliders. |
| `src/components/Waterfall.jsx` | Waterfall chart — how the score was assembled. |
| `src/components/SignalList.jsx` | Signals grouped by category. |
| `src/components/SignalCard.jsx` | One signal, incl. the generic evidence renderer. |
| `src/components/NoSignals.jsx` | Shared "no risk indicators detected" empty state. |
| `src/components/ProfileStats.jsx` | The `profile` object — on-chain activity behind the signals. |
| `src/components/SourcePanel.jsx` | Provenance: which datasets were used, how big, how fresh. |
| `src/components/DegradedBanner.jsx` | Partial-results banner, above the dial. |
| `src/components/AnalysisSkeleton.jsx` | Placeholder for dial + waterfall + signals while fetching. |
| `src/components/NetworkGraph.jsx` | Counterparty graph — hand-drawn SVG, no graph library. |
| `src/components/TaintPath.jsx` | Taint paths as address chains, with the gloss. |
| `tests/scoring.test.js` | 29 tests, including the contributions invariant. |
| `tests/waterfall.test.js` | 17 tests on the drawn geometry, incl. the rendered total. |
| `tests/presets.test.js` | 10 tests pinning the preset weights and the highlight rule. |
| `tests/counterfactual.test.js` | 12 tests, incl. the direction of the counterfactual. |
| `tests/address.test.js` | 14 tests on address format validation. |
| `tests/format.test.js` | 20 tests on date and BTC display formatting. |
| `tests/degraded.test.js` | 14 tests on degraded detection and warning-list hygiene. |
| `tests/taint.test.js` | 27 tests, incl. golden glosses for the fixture's two paths. |
| `tests/graphLayout.test.js` | 26 tests on the drawn graph geometry. |
| `tools/scoring_reference.py` | Second implementation, used to cross-check the JS. |
| `tools/export-figures.mjs` | Poster figures — four 300 DPI PNGs into `exports/`. |

Against the fixture: **82.41 / High**, with category scores sanctions 100,
ransomware 96, transaction_profile 78.55, counterparty 70, obfuscation 67.5.

`contract.md` names `scripts/scoring_reference.py` as the backend's reference
implementation. That file is not in this repo; `tools/scoring_reference.py` is a
separate implementation written here to cross-check the JS. When the backend's
lands, diff the two and delete ours.

## The scoring model

1. **Within a category** — saturating OR: `100 * (1 - Π(1 - severityᵢ/100))`.
   Two 50s give 75, not 100.
2. **Across categories** — weighted average over **only** the categories that produced
   at least one signal and carry a non-zero weight. Averaging over all five would score
   a lone OFAC hit at 20 instead of 100.
3. **Bands** — 0–24 Low, 25–49 Moderate, 50–74 Elevated, 75–100 High. The number is
   always displayed next to the band.

Per-signal contribution:

```
contribution_i = (weight_c * categoryScore_c / sum of active weights) * marginalShare_i
```

Each category hands out its own weighted score, split between its signals by marginal
share. So a category scoring 100 out-contributes one scoring 30 at the same weight,
while weight stays an independent lever. Contributions sum to the final score — asserted
in the tests, including across 500 randomised inputs. This is what the waterfall chart
consumes.

## The waterfall

One bar per signal, ordered by descending contribution, stacking from 0 up to the final
score. Recharts has no waterfall type, so each bar is a two-segment stack: an invisible
base holding the running total before that signal, and the visible contribution on top.

The geometry lives in `src/lib/waterfall.js` rather than in the component, so what the
chart actually draws can be asserted without a DOM. That separation is the point —
`tests/scoring.test.js` proves the *contributions* reconcile, and `tests/waterfall.test.js`
proves the *bars built from them* reconcile. A dropped bar, a stale sort, or a base
segment accumulating the wrong neighbour are all invisible to a sum over the
contributions array. Both mutations were checked: they fail the waterfall tests and pass
every scoring test.

The reference line is drawn at the dial's `finalScore`, not at the chart's own total, so
a mismatch between the two shows up as a visible gap instead of quietly agreeing with
itself.

Category colours are in `src/lib/categories.js` — the app's first *categorical* palette,
deliberately separate from the band and severity ramps, which encode magnitude rather
than identity. See that file's header for the validation results before changing a value.

## The counterfactual line

Under the dial: *"With sanctions weighted as a compliance officer would, this address
scores 87.44 instead of 82.41."*

It re-runs `scoreAddress` with **only** the sanctions weight raised to 3.0, leaving every
other weight where the user has it — so it tracks the sliders instead of pinning to a
fixed preset.

The original brief said to compute this by setting sanctions to **0**. That contradicted
the sentence beside it: a compliance officer weights sanctions *up*, not out. On the
fixture, zeroing gives 78.01 — a **drop** — so the line would have claimed a compliance
officer considers this address *safer*. `contract.md`'s own example reads "scores 91
instead of 82", i.e. the score rises. `tests/counterfactual.test.js` pins the direction so
the contradiction cannot quietly return.

The line hides itself when it would be meaningless: no sanctions signal to re-weight, or
sanctions already at 3.0 (both halves of the "instead of" would print the same number).

## Address validation

`src/lib/address.js` is a **format** check — prefix, length, alphabet — not a checksum
check, so a typo with a valid shape still passes. That is deliberate: `contract.md` rule 1
makes the backend the authority (garbage returns 200 with `degraded: true`), so this only
exists to save the user a 10–20 second round trip on an obvious mistake.

## Display formatting

`src/lib/format.js` rounds for the screen and nothing else. The fixture's
`total_received` is `7.99999999` — backend float accumulation, not precision — and
it renders as **8 BTC**. Scoring reads the raw payload; only components read this
module, so a rounded number cannot reach a severity or a weight.

The rounding widens rather than truncates: an amount that would round to zero at
four places is shown to the full satoshi instead. A dust balance displayed as
"0 BTC" would contradict the funnel-pattern signal on the same screen, which cites
a near-zero-but-nonzero balance as evidence.

## Degraded, cached, and the skeleton

`src/lib/degraded.js` owns every decision the banner renders, so they can be tested
without a DOM — the same split as `lib/waterfall.js` and the chart. Both flags are
read strictly (`=== true`): a stringified `"true"` must not paint an amber banner
over a good result, and a "Cached" badge on a fresh result is a lie about
provenance, which is the one thing this screen sells.

A degraded response with an **empty** `warnings` array is legal under the contract
and is the case the banner is most likely to get wrong — gating the banner on
`warnings.length` would hide that the analysis was incomplete. It renders with
"No detail was reported about what failed."

The skeleton replaces the dial, waterfall and signal list rather than overlaying
them: the previous address's dial left visible under a spinner is a wrong number on
screen. Against fixtures it flashes past — it exists for the real 10–20 second call.

`?degraded=1`, `?degraded=1&warnings=` and `?cached=1` force those states in a dev
build so the fixture never has to be edited to exercise them. `src/lib/devOverrides.js`
is temporary and `import.meta.env.DEV` gates it, so `npm run build` drops it
entirely — verified absent from the bundle. **Delete it before Thursday.**

## The counterparty graph

Hand-drawn SVG. **No graph library** — `react-force-graph-2d` and Cytoscape were both
considered and neither was added. `contract.md` clamps `max_hops` to 0–2 server-side,
so the graph is three columns forever (the fixture is five nodes, four edges), and a
force simulation would buy nothing at that size while costing determinism: the same
payload would draw differently on every render, and two screenshots of one address
would disagree.

Geometry lives in `src/lib/graphLayout.js` rather than the component, so the drawn
positions can be asserted without a DOM — the same split as `lib/waterfall.js`.
`tests/graphLayout.test.js` pins that hop maps to column, that columns are centred and
stay inside the viewBox, and that the layout is byte-identical across runs.

Three encodings, deliberately orthogonal:

| Channel | Carries |
|---|---|
| Colour | which flag — identity, reused from `categories.js` |
| Column | hops from the analysed address — magnitude |
| Node size | the same distance again, so it survives greyscale and CVD |

`ofac` maps to the **sanctions** colour and `ransomware:*` to the **ransomware**
colour, so a flagged node matches its waterfall bar — one entity, one colour, across
both charts. Hop is deliberately *not* coloured: `categories.js` is explicit that its
palette encodes identity and never magnitude, and a two-hop OFAC node cannot be two
colours at once. Using two of the five validated colours plus a neutral is a strict
subset, so CVD separation can only be wider than what was validated.

An edge pointing at a node that isn't in `nodes` is dropped **and counted**, and the
panel says so. Silently dropping it would just look like a sparser graph.

## Taint paths

Each path is a chain of address chips with the connecting `tx_hash` between them, under
a generated sentence. The gloss is the point — a row of truncated hashes means nothing
until something says what it is, and the sentence is what gets repeated to a colleague.

Wording is generated in `src/lib/taint.js` and pinned verbatim against the fixture's two
real paths, because overclaiming here is a correctness bug, not a copy tweak:

> This address sent 4.2 BTC directly to an OFAC-sanctioned address.

> This address sent 2 BTC to an intermediary, which forwarded funds to an address
> attributed to the Conti ransomware family.

`total_value` is the **bottleneck** — per `contract.md`, the most that *could* have
flowed end to end, not proof it arrived. Over one hop the bottleneck is the transfer, so
"sent 4.2 BTC directly to" is exact. Over two it is a ceiling: 2 BTC entered the
intermediary and 2 BTC left it, but nothing proves those were the same coins. So the
multi-hop gloss says funds were *forwarded* rather than asserting delivery, and states
the ceiling separately. A test pins that it never says "sent 2 BTC to \<the flagged
address\>".

The family name comes from splitting the flag on `:`, never from a lookup table, so a
backend that starts reporting LockBit needs no frontend change.

## Poster figures

```bash
npm run build                       # the evidence card needs the compiled CSS
node tools/export-figures.mjs       # -> exports/*.png (gitignored)
```

Four figures at **300 DPI**, all 2400px (8.00in) wide on one surface and one type
scale, so they stack on a board without looking mismatched. `exports/` is a build
artefact — gitignored, and nothing in it is imported by the app.

The figures are drawn from the **same pure geometry the app draws from** —
`lib/scoring.js`, `lib/waterfall.js`, `lib/graphLayout.js`, `lib/format.js` — not a
re-implementation. That is what those React-free modules are for. The script prints
the rendered bar total next to the dial's score on every run; if a poster ever
disagreed with the demo running beside it, that line is where it shows up.

Only the network graph is hand-drawn SVG in the app. The waterfall and the dial both
render via **Recharts**, and the evidence card is plain HTML/CSS, so each needs a
different export route:

| Figure | Route | Reused |
|---|---|---|
| Network graph | SVG | `buildGraphLayout` — near-direct port |
| Waterfall | SVG | `buildWaterfallRows`, `axisMax`, `truncateLabel`; axes redrawn |
| Score dial | SVG | none — arc recomputed from Recharts' 220°/−40° angles |
| Evidence card | HTML | the real compiled Tailwind CSS, at 3.125× |

Rasterizing goes through headless Chrome/Edge (`EXPORT_BROWSER` overrides the path)
— **no new dependency**. It is not a viewport screenshot: each chart is emitted as
standalone SVG with a viewBox in app-pixels and rasterized at 3.125× (300/96), so
every line is computed at final resolution rather than upscaled. The `.svg` files are
kept alongside the PNGs and are the better source if you can place vector.

Band colours are read out of the `@theme` tokens in `src/index.css` and converted
OKLCH→sRGB at export time, so the poster cannot drift from the app's palette. A
`pHYs` chunk is injected into each PNG, which is what makes InDesign or PowerPoint
place the file at 8in wide instead of treating it as a 25in 96 DPI image.

## Not built yet

The real API integration is still out of scope. There is no backend, so **every address
returns the same fixture** — when the analysed address differs from the one in the
response, the UI says so rather than quietly showing a different address than the one
submitted.

## Open question for the backend

In `fixtures/sample.json` the analysed address carries `flags: []` on its graph node,
while `signals` reports `ransomware.known_address` matching that same address to Conti.
So the graph draws the target as unflagged and the signal list calls it a known
ransomware address, on one screen.

That may be intentional — `flags` might only be populated for counterparties, with the
target's own status carried by `signals` — and `contract.md` doesn't say either way. It
is **not** patched around on the frontend: the graph renders exactly what the payload
says. Per `contract.md`, this belongs in the shared integration list rather than a
one-sided fix.
