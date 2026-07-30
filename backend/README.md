# Backend — Explainable Ransomware Wallet Risk Enrichment

Rule-based, explainable risk enrichment for Bitcoin addresses. The backend
answers **"what did we find"**; the frontend answers **"what is it worth."**
Severity is intrinsic to a finding and never weighted here — all weighting
happens in the browser so the sliders recompute instantly with no network call.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python scripts/refresh_data.py        # download intel snapshots (once)
python scripts/make_sample_fixture.py # regenerate fixtures/sample.json
python scripts/smoke_test.py          # full pipeline, no network needed
python -m pytest tests/ -v            # 21 tests

python main.py                        # http://127.0.0.1:8000
OFFLINE_MODE=1 python main.py         # zero network — how you present
```

## What each piece does

| Path | Responsibility |
|---|---|
| `main.py` | FastAPI routes, CORS, the handlers that guarantee no 5xx |
| `models.py` | Pydantic mirrors of `contract.md` — the contract, enforced |
| `engine.py` | Orchestration. Always returns a response; failures become warnings |
| `profiling.py` | Raw chain data → `Profile` plus derived facts shared by all rules |
| `graph.py` | Bounded BFS over counterparties, taint path reconstruction |
| `cache.py` | Disk cache and fixture loading |
| `sources/` | One module per external dataset. Loaded from disk at startup |
| `rules/` | One module per category. Each exposes `evaluate(ctx, graph_result)` |
| `scripts/` | Data refresh, cache warming, demo curation, scoring reference |

## The ten rules

| # | ID | Category | Severity | Confidence |
|---|---|---|---|---|
| 1 | `sanctions.direct_hit` | sanctions | 100 | high |
| 2 | `ransomware.known_address` | ransomware | 95 | high |
| 3 | `counterparty.flagged_neighbor` | counterparty | 70 | high |
| 4 | `counterparty.two_hop` | counterparty | 40 | medium |
| 5 | `profile.collection_pattern` | transaction_profile | 45 | medium |
| 6 | `profile.burst_then_dormant` | transaction_profile | 40 | medium |
| 7 | `profile.round_value_payments` | transaction_profile | 35 | low |
| 8 | `obfuscation.peel_chain` | obfuscation | 50 | medium |
| 9 | `obfuscation.rapid_forward` | obfuscation | 35 | medium |
| 10 | `ransomware.group_context` | ransomware | 20 | medium |

Rules 1–4 make the demo work — that is the enrichment story. Rules 5–9 make it
interesting, because they fire on addresses that are on no list at all, which is
the entire point of behavioral analysis.

Severities and confidences live in one table, `rules/base.py: RULE_SPECS`, so the
count on your poster and the count in the code cannot disagree.

## Adding a rule

1. Add its ID to `RULE_SPECS` in `rules/base.py` with category, severity, confidence.
2. Write the detection in the right `rules/*.py` module, returning `make_signal(...)`.
3. Add a factory in `tests/factories.py` that produces data triggering it.
4. Add a test asserting it fires, and assert the contract with `assert_contract_valid`.
5. Update the rule count in `README.md`, `contract.md`, and the poster.

If the rule cannot explain itself in one or two plain sentences, it does not ship.
The tests enforce a minimum explanation length for exactly this reason.

## Hard caps

All in `config.py`, all enforced in `graph.py`, no exceptions:

- `MAX_HOPS = 2`
- `MAX_NEIGHBORS_PER_NODE = 25` (highest-value edges kept)
- `MAX_TOTAL_NODES = 150`
- `MAX_API_CALLS_PER_ANALYSIS = 40`
- `TRAVERSAL_TIMEOUT_SECONDS = 20`

Every cap degrades gracefully: hitting one appends a warning, sets
`degraded: true`, and returns what we have. None of them raise.

## Data sources

| Source | Endpoint | Auth | Notes |
|---|---|---|---|
| OFAC | `raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses` | none | 522 BTC addresses. Pre-extracted — avoids parsing Treasury's 80MB XML |
| Ransomwhere | `api.ransomwhe.re/export` | none | Zenodo mirror as fallback |
| ransomware.live | `api.ransomware.live/v2` | none | **1 req/min** anonymous. Snapshot only, never called live |
| Chain data | `mempool.space/api`, `blockstream.info/api` | none | Esplora. Rate-limited; cache aggressively |

Everything is downloaded once into `data/` and **committed to the repo**. Loaded
from disk at startup. Do not fetch these per request — it is slow, it is rude to
people hosting free research infrastructure, and it breaks the day one of them
has an outage.

## Offline mode

`OFFLINE_MODE=1` makes zero network calls, serving `fixtures/`. Run
`scripts/warm_cache.py` on Wednesday evening, commit `fixtures/`, and present
with `OFFLINE_MODE=1` unless the network is provably good.

A demo that depends on a live API call at 2 p.m. on presentation day will fail
at 2 p.m. on presentation day.
