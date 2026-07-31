# Frontend redesign — change log

Drop-in replacement for `frontend/`. Nothing in `backend/` is touched, and the
API contract is unchanged.

```
cp -r frontend/ /path/to/ransomware-wallet-investigator/frontend/
cd /path/to/ransomware-wallet-investigator/frontend
npm install
npm run verify   # tests + headless render + production build
npm run dev
```

`npm install` is required: `recharts` was removed and `jsdom` added.

---

## Verification

All three pass from a clean checkout:

| Command | Result |
|---|---|
| `npm test` | 205 passing (178 pre-existing, unchanged, + 27 new) |
| `npm run smoke` | 27 checks — boots the real app in jsdom, walks a full session |
| `npm run build` | 313 KB / 98.9 KB gzipped |

**Not verified:** I had no browser available, so nothing here has been seen
rendered. Layout, spacing and the score arc's geometry are compile-correct and
render-correct but visually unreviewed.

---

## Files

### New — pure logic (no React, unit-tested)

| File | Purpose |
|---|---|
| `src/lib/interpretation.js` | Plain-English notes per rule, influence banding, verdict, evidence-key glosses |
| `src/lib/graphRelevance.js` | Counterparty ranking, per-hop capping, clustering, table rows |
| `src/lib/progress.js` | Staged loading model |

### New — components

`src/components/` — `ui.jsx` (all shared primitives), `ScoreArc.jsx`,
`Launch.jsx`, `Chrome.jsx` (top bar + scrollspy), `Progress.jsx`,
`Assessment.jsx`, `Evidence.jsx`, `Composition.jsx`, `Network.jsx`,
`Profile.jsx`, `Method.jsx`.

### Rewritten

- `src/App.jsx` — launch/running/results modes, URL state, focus management, live region
- `src/index.css` — full token system, both themes, motion, focus, print
- `index.html` — fonts, metadata, flash-free theme bootstrap
- `package.json` — `recharts` removed, `jsdom` added, `smoke` + `verify` scripts

### Modified (two lines each)

- `src/lib/categories.js` — `CATEGORY_COLORS` values became `var(--cat-*, #fallback)`
- `src/lib/flags.js` — `UNFLAGGED_COLOR` likewise

Theme switching then needs no React state and no re-render. Existing tests
compare by reference and still pass; the literal fallback is the original dark
value, so `tools/export-figures.mjs` still renders in colour outside the app's
stylesheet.

### Untouched

`scoring.js`, `waterfall.js`, `graphLayout.js`, `taint.js`, `format.js`,
`degraded.js`, `presets.js`, `counterfactual.js`, `address.js`, `api.js`,
`demos.js`, `vite.config.js`, `contract.md`, all nine original test files.

### Deleted (superseded, functionality absorbed)

`AddressInput`, `AnalysisSkeleton`, `Counterfactual`, `DegradedBanner`,
`DemoPicker`, `NetworkGraph`, `NoSignals`, `ProfileStats`, `ScoreDial`,
`SignalCard`, `SignalList`, `SourcePanel`, `TaintPath`, `Waterfall`,
`WeightSliders`.

---

## Behaviour preserved

Every honesty guarantee the previous build made is still made, most of it by the
same code:

- request superseding via `AbortController`
- fixture fallback, and the notice when the fixture's address differs from the
  one submitted (now a prominent note rather than a small amber footnote)
- strict `=== true` reads of `degraded` and `cached`
- the lifetime-vs-window split in the wallet profile, including the relabelling
  when the window is a sample
- tri-state source staleness (fresh / stale / age unknown)
- "no observed flow" on shared-counterparty taint paths
- "not proof the address is clean"
- the wheel-blocking weight slider
- structural evidence rendering — dispatch on JS type, never on key name

## Behaviour changed, deliberately

| Change | Reason |
|---|---|
| No analysis runs until one is requested | The old build analysed a hard-coded demo address on mount, which is why the address input could never be primary |
| Evidence sorts by contribution, not category | Category order could place a low-confidence heuristic above a decisive OFAC hit |
| Weight sliders moved to Method; presets sit by the score | Sliders silently altered the headline number; any non-neutral weighting now marks the score "adjusted lens" |
| Taint paths live inside Network | Same question as the graph — where did the money touch |
| Graph caps drawn counterparties and clusters the tail | A 60-counterparty wallet produced a 5,008px canvas; it is now 648px |

**Invariant:** a flagged counterparty is never capped, filtered or clustered.
Enforced in `graphRelevance.js`, asserted in both test files, and stated on
screen next to the cluster legend.

---

## Accessibility

Every token pair computed against all three surface levels in both themes; all
meet **WCAG AA (≥ 4.5:1)**. Reaching that required moving four values —
`ink-faint`, `band-moderate`/`warn` (light) and `cat-obfuscation` (dark) sat at
4.07–4.49 on the sunken surface.

Also: skip link; one focus treatment app-wide, including SVG graph nodes, which
previously had none despite being tabbable; arrow-key navigation between nodes;
focus moved to the results heading on arrival; a single polite live region
announcing score and finding count; `aria-valuetext` on the progress bar
carrying the *estimate* caveat; `prefers-reduced-motion` honoured wholesale;
print styles that force disclosures open.

---

## One bug found during review, worth flagging

The first version of `influence()` labelled findings with bare adjectives —
Decisive / Major / Moderate / Minor. Against the fixture that labelled the
**OFAC sanctions listing "Moderate"**: it carries 24.9% of the points, a whisker
under the 25% cut.

The arithmetic was right and the sentence was misleading. A bare adjective next
to a finding reads as a claim about how much that finding *matters*, while the
number underneath measures only how the total was divided up.

Three changes, all in `src/lib/interpretation.js`:

1. Every label now says "share" — it describes what it measures.
2. The largest contributor is named by **rank**, never by threshold, so the
   strongest finding cannot be demoted by a cut point it happens to sit beneath.
3. When the score is saturated at 100 the interface says so, because that is
   *why* the shares look flat: the points get divided among everything that
   contributed, so five categories of evidence produce five modest percentages.

Both regressions are pinned by tests.
