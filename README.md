# Explainable Ransomware Wallet Risk Enrichment

A Bitcoin address goes in; a risk score comes out with every number traceable to
a source. Ten rules across five categories, a bounded two-hop counterparty
graph, and a waterfall chart where the bars sum exactly to the dial.

```
backend/    FastAPI + Python. Chain data, intel lists, rule evaluation.
frontend/   React + Vite. Scoring, weighting, and the whole UI.
tools/      Cross-checks that keep the two halves honest.
```

## Run it

```bash
./run.sh              # backend on :8000, frontend on :5173, offline fixtures
OFFLINE_MODE=0 ./run.sh   # same, but live Esplora lookups
```

Open <http://localhost:5173>.

`OFFLINE_MODE=1` is the default and makes zero network calls — every demo
address has a committed chain fixture. Use it unless the network is proven good.

First run needs `pip install -r backend/requirements.txt` and
`npm install --prefix frontend`.

## Check it

```bash
./check.sh
```

Runs the backend suite (49 tests), the frontend suite (178 tests), the
scoring-parity check, and a production build.

## How the two halves connect

The frontend proxies `/api` to the backend (`frontend/vite.config.js`), so the
browser stays on one origin and no CORS negotiation happens in dev. The backend
still ships a CORS allow-list, read from `CORS_ORIGINS`, for the cross-origin
case. Point the frontend at another machine with `VITE_API_BASE_URL`; set
`VITE_USE_FIXTURE=1` to bypass the network entirely.

`backend/contract.md` is the single source of truth for the response shape and
is copied verbatim into `frontend/`. `frontend/fixtures/sample.json` is a
complete instance of it — build against that file, not against the prose.

### Scoring lives in the browser, and is checked against Python

The contract puts weighting client-side: severity is intrinsic to a finding,
weighting is the user's opinion, and the two must not be conflated. So
`frontend/src/lib/scoring.js` is the implementation and
`backend/scripts/scoring_reference.py` is the reference.

Two implementations of one formula in two languages will drift, and drift here
is invisible — both sides keep producing plausible numbers that are no longer
the same number. `tools/check_scoring_parity.py` compares every user-visible
value (final score, band, category scores, per-signal contributions) across all
four presets and fails the build on any mismatch.

This is not hypothetical. The backend's cross-category operator was rewritten
from a weighted average to a probabilistic OR after the average was found to be
non-monotone: an OFAC-sanctioned address scored 100 on the sanctions hit alone
and **dropped to 46** once four further incriminating signals arrived, because
each new category pulled the mean down. The frontend kept the average for two
more rounds — which meant the corrected backend maths did nothing for the app,
since the dial the user reads was still computed from the broken formula. The
parity check exists so that cannot recur silently.

**Weights are attenuation factors in `[0, 1]`.** 1.0 counts a category in full,
0 removes it. There is no way to amplify past full: the cross-category operator
is only monotone and bounded while every effective score stays inside `[0, 1]`,
and "count this more than fully" has no meaning for evidence. A stronger opinion
is expressed by turning the other categories down, which is what the presets do.

**A confirmed OFAC designation saturates the score at 100** under any weighting
that leaves sanctions switched on. That is intended, not a bug: it is a
maximum-risk finding and no amount of additional or absent evidence should move
it. The counterfactual line under the dial answers the useful question instead —
how much of the score survives if you discount the listing entirely.

## What the numbers mean

**Lifetime versus window.** The backend retrieves at most the 50 most recent
transactions, so `profile` carries two kinds of number. `tx_count`,
`total_received`, `total_sent` and `balance` are lifetime, from the address-stats
call. Everything prefixed `window_` is derived from the retrieved transactions
only. On a busy address these are wildly different: a 2013-era wallet with
10,000 transactions has a `window_first_seen` from last month. The UI groups
them separately and says so when the window is a sample.

**Taint paths record adjacency, not flow.** `direction_sequence` distinguishes
three topologies that look identical in the `path` array: value moving out from
the analysed address, value moving in toward it, and the two addresses merely
sharing a counterparty. The third is the most common two-hop shape on Bitcoin —
both parties deposited to the same exchange — and no value moved between them at
all. It is labelled as co-occurrence, scored at severity 15 with low confidence,
and rendered without an amount, because quoting the bottleneck there would be
the same false claim in numeric form.

**`bottleneck_value` is a ceiling.** Over one hop it is the transfer. Over two it
is the most that *could* have flowed end to end; nothing proves the same coins
made the trip.

## Known limitations

Stated plainly because a tool that overclaims is worse than one that finds less:

- No wallet clustering and no CoinJoin detection.
- Behavioural thresholds are calibrated on synthetic fixtures, not real chain
  data. `backend/scripts/calibrate.py --run` is the harness and is wired up
  correctly — it reads the current rule set, including the renamed
  `obfuscation.self_peel` and the new `counterparty.shared_counterparty` — but
  it needs network access to an Esplora host to produce anything meaningful. It
  now refuses to print a separation table when the run retrieved no chain data,
  and exits 2, rather than reporting nine untested rules as "never fires,
  loosen the threshold". Running it for real is the next piece of work, and the
  demo set shows why.
  The "Collection wallet" address scores **78.55 (High)** on three behavioural
  heuristics at severity 45/40/35, while "One hop from a sanctioned address"
  scores **70 (Elevated)** on a single high-confidence observation that it
  transacted directly with an OFAC-designated entity. Probabilistic OR is doing
  exactly what it should — three pieces of evidence do accumulate — but three
  *uncalibrated* heuristics currently outrank one confirmed fact, which is a
  statement about the thresholds, not the operator. Until those severities are
  set against real base rates, read the behavioural band with that in mind.
- `obfuscation.self_peel` detects repeated self-change spends. It is deliberately
  *not* named `peel_chain`: it does not follow a bulk that moves to fresh
  addresses, and the rule text no longer claims to.
- The chain client has not been validated against a live Esplora instance.
- The shipped intel snapshots carry no recorded retrieval time
  (`data/manifest.json` has `retrieved_at: null` with an honest note). Analyses
  say so in a warning; `/api/health` reports `degraded`. Run
  `backend/scripts/refresh_data.py` once to replace this with real provenance.
