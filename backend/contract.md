# API Contract — frozen

Both devs own this file. Any change goes in the shared integration list the
moment it happens, with the field name and what was expected vs. received.

Do not fix a mismatch by silently patching around it on one side. That is how
the two halves quietly diverge and you spend Thursday morning finding out.

Backend base URL in development: `http://127.0.0.1:8000`

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness plus which intel sources loaded and how many records |
| `GET` | `/api/demo` | Curated demo addresses with labels and expected outcomes |
| `POST` | `/api/analyze` | Full analysis — the only endpoint that matters |

---

## `POST /api/analyze`

### Request

```json
{ "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "max_hops": 2 }
```

`max_hops` is optional, defaults to 2, and is clamped server-side to 0–2. Send
anything you like; you will not get a validation error.

### Response

Always HTTP 200. Always the shape below. See `fixtures/sample.json` for a
complete, realistic instance with all five categories populated — build against
that file, not against this document.

```json
{
  "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  "chain": "bitcoin",
  "analyzed_at": "2026-07-27T09:00:00+00:00",
  "cached": false,
  "degraded": false,
  "profile": {
    "first_seen": "2019-03-04T11:22:00+00:00",
    "last_seen": "2019-04-01T08:15:00+00:00",
    "tx_count": 142,
    "total_received": 12.4031,
    "total_sent": 12.4031,
    "balance": 0.0,
    "unique_senders": 38,
    "unique_recipients": 3,
    "active_days": 28
  },
  "signals": [ /* see below */ ],
  "graph": { "nodes": [ /* ... */ ], "edges": [ /* ... */ ] },
  "taint_paths": [ /* ... */ ],
  "sources_used": [
    { "name": "OFAC SDN List", "records": 522, "retrieved_at": "..." }
  ],
  "warnings": []
}
```

### Signal

```json
{
  "id": "sanctions.direct_hit",
  "category": "sanctions",
  "label": "Address is on the OFAC SDN list",
  "severity": 100,
  "confidence": "high",
  "explanation": "This exact address appears on OFAC's list of sanctioned digital currency addresses. Transacting with it may carry legal consequences for U.S. persons and entities.",
  "evidence": { "matched_address": "...", "entity": null, "list_size": 522 },
  "source": {
    "name": "OFAC SDN List",
    "url": "https://ofac.treasury.gov/...",
    "retrieved_at": "2026-07-27T09:00:00+00:00"
  }
}
```

`evidence` is a free-form object whose keys differ per rule. Render it
generically — iterate the keys, prettify them, do not hardcode per-rule
layouts. Values may be strings, numbers, nulls, arrays of objects, or nested
objects. `source.url` may be `null` for behavioral heuristics, which have no
external source; render the name without a link in that case.

### Graph node / edge

```json
{ "id": "1A1zP...", "label": "1A1zP1…ivfNa", "type": "target", "flags": ["ofac"], "hop": 0 }
{ "source": "1A1zP...", "target": "3FZbg...", "value": 4.2, "tx_hash": "abc123...", "timestamp": "2019-03-05T02:11:00+00:00" }
```

`type` is `"target"` or `"counterparty"`. `hop` is 0, 1, or 2. `flags` is a
possibly-empty array of `"ofac"` or `"ransomware:{Family}"` — split on `:` to
get the family name. `timestamp` may be `null` for unconfirmed transactions.

### Taint path

```json
{
  "target_flag": "ransomware:Conti",
  "hops": 2,
  "path": ["1A1zP...", "3FZbg...", "bc1q..."],
  "total_value": 4.2,
  "tx_hashes": ["abc123...", "def456..."]
}
```

`path[0]` is always the analyzed address and `path[-1]` is always the flagged
one. `tx_hashes[i]` is the transaction linking `path[i]` to `path[i+1]`, so
`len(tx_hashes) == len(path) - 1`. `total_value` is the bottleneck — the
smallest transfer along the path, which is the most that could actually have
flowed end to end.

---

## Contract rules

1. **`/api/analyze` never returns a 5xx, and never returns a non-conforming
   body.** Invalid addresses, malformed JSON, missing fields, garbage — all
   return 200 with `degraded: true` and an explanation in `warnings`. This is
   enforced by an exception handler and a validation handler in `main.py` and is
   covered by tests. A partial answer is a demo; an error page is not.

2. **`signals` is always an array, possibly empty.** Empty means "nothing
   found," which is itself a result worth rendering. Do not show a blank panel —
   show "No risk indicators detected."

3. **`severity` is 0–100 and intrinsic to the finding.** It is never weighted.
   Weighting happens in the browser, and only in the browser.

4. **`confidence` is `high`, `medium`, or `low`** and reflects source authority.
   An authoritative list match is `high`; a behavioral heuristic is `medium` or
   `low`. A low-confidence heuristic must not look like an OFAC hit on screen.

5. **Categories are exactly these five strings, fixed forever:** `sanctions`,
   `ransomware`, `obfuscation`, `transaction_profile`, `counterparty`.

6. **Every signal has a non-empty `explanation` in plain English.** If a rule
   cannot explain itself in one or two sentences, it does not ship. Tested.

7. **`degraded: true` means something failed but we answered anyway.** Show the
   banner and list `warnings`. It does not mean the results are worthless.

---

## Scoring — owned by the frontend

Implemented in `src/lib/scoring.js`. `scripts/scoring_reference.py` is the
Python reference implementation and prints golden numbers for
`fixtures/sample.json`. Assert against those in a frontend unit test on Day 1,
before the waterfall chart exists.

**Step 1 — combine within a category (saturating):**

```
categoryScore(c) = 100 × (1 − Π over signals i in c of (1 − severity_i / 100))
```

Two mixer hits do not score 160. Diminishing returns on repeated evidence of the
same kind.

**Step 2 — weighted average across categories:**

```
finalScore = Σ (weight_c × categoryScore_c) / Σ weight_c
             over categories that produced at least one signal
```

> **Correction to the original technical plan.** The plan summed all five
> weights in the denominator. That makes an OFAC-sanctioned address with one
> signal and default weights score 100/5 = **20 — "Low"**. The denominator must
> only include categories that actually produced a signal. Absent evidence is
> not evidence of low risk, and it must not dilute the score.
>
> This also breaks the waterfall if you get it wrong: contributions will not sum
> to the dial. `scoring_reference.py` asserts they do.

**Step 3 — bands.** 0–24 Low, 25–49 Moderate, 50–74 Elevated, 75–100 High.
Always display the number alongside the band.

**Per-signal contribution, for the waterfall:**

```
contribution_i = finalScore × (marginal share of i within its category)
                            × (weight_c / Σ active weights)
```

Marginal share uses the probabilistic-OR decomposition: sort the category's
signals by descending severity, give signal *i* credit `running × severity_i`
where `running` starts at 1 and is multiplied by `(1 − severity_i)` after each
step, then normalise so the shares sum to 1. Bars then sum exactly to the final
score. If they do not sum, the chart is lying and someone will notice.

**Weights:** 0–3 scale, default 1.0. Setting a category to 0 removes it
entirely — from both numerator and denominator.

---

## Notes for the frontend

- Analysis takes 10–20 seconds live and is near-instant against cache or
  fixtures. Show a skeleton with a "this can take 10–20 seconds" note.
- `cached: true` is worth a small badge. Cached responses return in milliseconds
  and that is a nice thing to point at during the demo.
- The counterfactual line reads best where one category dominates. On the
  balanced preset with many signals the delta is small, and removing a
  below-average category can *raise* the score, which is mathematically correct
  but confusing. Prefer wording like "With sanctions weighted as a compliance
  officer would, this address scores 91 instead of 82."
