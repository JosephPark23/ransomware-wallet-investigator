# Intelligence-Enriched Ransomware Wallet Investigator

**NYU CS4CS capstone.** An explainable risk-enrichment tool for Bitcoin
addresses. Given an address, it gathers evidence from sanctions lists,
ransomware payment datasets, and the blockchain itself, then reports what it
found — with a plain-English justification and a source citation for every
single finding.

Team: Joseph (backend, data, APIs) · Aum (frontend, visualization, UX)

---

## What it does

Most blockchain tools show you transactions. This one adds **context**: whether
an address is sanctioned, whether it collected ransoms, which ransomware group
it's associated with, whether it behaves like a collection wallet, and whether
it sits near anything already known to be bad.

The design constraint that shapes everything: **every score must be able to
explain itself.** A trained classifier can't cite its reasoning in an
investigative report, so the scoring is rule-based by choice, not by
limitation.

## The architecture in one line

The **backend** decides *what we found*. The **browser** decides *what it's
worth*. Severity is intrinsic to a finding and never weighted server-side, so
the frontend's weight sliders recompute the score instantly with no network
call.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python scripts/refresh_data.py     # download intel snapshots (once)
python scripts/smoke_test.py       # full pipeline, no network needed
python -m pytest tests/ -v         # 21 tests

python main.py                     # http://127.0.0.1:8000
OFFLINE_MODE=1 python main.py      # zero network calls
```

## Documentation

| File | What's in it |
|---|---|
| [`backend/contract.md`](backend/contract.md) | The frozen API contract between the two halves. Start here |
| [`backend/README.md`](backend/README.md) | Backend internals, the ten rules, hard caps |
| [`BACKEND_PLAN.md`](BACKEND_PLAN.md) | Build schedule, open risks, things to be ready to explain |

## The ten detection rules

| Category | Rules |
|---|---|
| `sanctions` | Direct OFAC SDN match |
| `ransomware` | Known ransomware payment address; ransomware group context |
| `counterparty` | Transacted directly with a flagged address; flagged address within two hops |
| `transaction_profile` | Collection/funnel pattern; burst then dormancy; round-value payments |
| `obfuscation` | Peel-chain signature; rapid forwarding |

Rules 1–4 tell you an address is connected to something known. Rules 5–9 fire on
addresses that appear on **no list at all**, which is the point of behavioral
analysis.

## Data sources and attribution

This repository redistributes snapshots of publicly available datasets so the
tool works offline. All credit belongs to the original publishers:

| Source | Provider | Notes |
|---|---|---|
| Sanctioned addresses | US Treasury OFAC, via [0xB10C's extracted lists](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) | Public government data |
| Ransomware payments | [Ransomwhere](https://ransomwhe.re/) | Crowdsourced, screenshot-verified |
| Group profiles | [ransomware.live](https://www.ransomware.live/) | Leak-site monitoring |
| Chain data | [mempool.space](https://mempool.space/) / [blockstream.info](https://blockstream.info/) | Esplora API, keyless |

If you fork this, please check each provider's terms before redistributing their
data further.

## Limitations — read before drawing conclusions

This is a semester project, not an investigative product. Known limits:

- **Addresses, not wallets.** Real forensics tools cluster many addresses into
  one entity using the co-spend heuristic. This tool analyzes single addresses,
  so it does not see the full picture of any actor.
- **No CoinJoin awareness.** Traversal through a mixing transaction can produce
  counterparty relationships that don't reflect any real connection.
- **Two-hop proximity is weak evidence.** An intermediary may be an exchange
  serving millions of unrelated customers. Rule 4 is scored and labelled
  accordingly.
- **Behavioral heuristics produce false positives.** Exchange and donation
  addresses legitimately look like collection wallets.
- **Bitcoin only.** Multi-chain is future work.

Findings are investigative leads, not accusations. Nothing here establishes who
controls an address.

## License

MIT for the code. Data snapshots in `backend/data/` remain the property of their
original publishers and are redistributed for research and educational use.
