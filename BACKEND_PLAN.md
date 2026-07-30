# Backend Plan — Monday PM through Thursday

Joseph (backend). Deadline Thursday. This plan assumes the code in `backend/`
as delivered Monday afternoon: 10 rules, 21 passing tests, offline pipeline
verified, real OFAC data committed.

---

## Where things actually stand

**Done and verified:**

- All 10 signal rules implemented (the plan called for 6 by Day 3, the rest stretch)
- 21 tests passing, covering every rule, the traversal caps, and contract validity
- Bounded BFS with all five hard caps, taint path reconstruction verified against
  a real OFAC address with no mocking
- Disk cache, offline mode, graceful degradation on every failure path
- `/api/analyze` returns 200 in contract shape for garbage, nulls, path traversal,
  and out-of-range hops — verified, not assumed
- Real OFAC data committed: 522 Bitcoin addresses
- `fixtures/sample.json` with 9 signals across all five categories
- `scripts/scoring_reference.py` with golden numbers, all presets summing exactly

**Not done, and honest about it:**

- **The chain client has never touched a live API.** It was written and tested in
  a sandbox that could not reach mempool.space. This is risk #1, and Tuesday
  morning is built around it.
- Behavioral thresholds (rules 5–9) are tuned against *synthetic* fixtures. Real
  Bitcoin addresses will not behave like the factories. Expect to recalibrate.
- Rules 2 and 10 have never fired — they need `data/ransomwhere.json`.
- No demo address set yet. The interesting ones cannot be picked automatically.

---

## Monday PM — unblock everyone (about 2 hours)

Priority order. Do not reorder; step 2 unblocks Aum for the entire week.

1. **`python scripts/refresh_data.py`.** Verify the Ransomwhere export in the
   first hour, per your own risk table. If `api.ransomwhe.re/export` is down or
   wants a key, download `ransomwhere.json` from the Zenodo mirror by hand and
   drop it in `data/`. Do not let this become a Wednesday problem.
2. **Send Aum `contract.md` and `fixtures/sample.json`.** He can build the score
   dial, all five weight sliders, the waterfall, the evidence cards, and the
   counterfactual line against that file without you. Tell him the scoring
   correction explicitly — the denominator change is the difference between an
   OFAC hit reading "High" and reading "Low."
3. **`python -m pytest tests/ -v` and `python scripts/smoke_test.py`** on your own
   machine. Confirm 21 passing and 5/5 fixtures producing signals.
4. **`git add . && git commit`.** Commit `data/` — the intel snapshots belong in
   the repo. Loading from disk at startup is the whole reason the demo survives a
   bad network.
5. Start the shared integration list. One file, `INTEGRATION.md`, or a pinned
   message. Every contract mismatch goes there with the field name and what was
   expected vs. received.

---

## Tuesday — make it work on real data

This is the day the project either becomes real or you find out why it can't.

**AM — validate the chain client (before anything else)**

- `python scripts/check_chain_api.py`. It checks response *shape*, not just
  status codes: satoshi-to-BTC conversion, whether inputs carry addresses,
  whether timestamps parse. A 200 with unexpected fields is the failure mode that
  silently corrupts every behavioral rule.
- If it fails, fix `sources/chain.py::_normalize_tx` and nothing else until it
  passes. Everything downstream depends on that shape being right.
- Then run a real OFAC address end to end and read the output by hand. Do the
  sender and recipient counts match what mempool.space shows for the same address
  in a browser? If they disagree, believe the browser.

**PM — calibrate the behavioral rules**

- Rules 5–9 were tuned on synthetic data. Run them against 15–20 real addresses:
  some OFAC, some Ransomwhere, some exchange hot wallets, some random.
- Watch for the two failure modes: a rule that fires on *everything* (threshold
  too loose, worthless signal) and one that fires on *nothing* (too tight, dead
  code on your poster). Adjust the constants at the top of `rules/profile.py` and
  `rules/obfuscation.py`.
- Record what you changed and why. "We raised the peel-chain threshold from 4 to 6
  links after it fired on 80% of exchange addresses" is a *great* poster sentence
  — it shows methodology, not just code.

**End of Tuesday you should have:** real end-to-end output for at least three
real addresses, with behavioral rules firing at defensible rates.

---

## Wednesday — the demo set and the graph

**AM — curate demo addresses**

- `python scripts/pick_demo_addresses.py --propose` to see candidates, then
  `--write` for a starting file. Edit `data/demo_addresses.json` by hand.
- Target composition: 2 OFAC, 2 Ransomwhere with a named family, 1–2
  near-flagged-but-unlisted, 1–2 benign controls.
- **The near-flagged ones are your best demo and must be found manually.** Analyze
  an OFAC address, look at its counterparty graph, pick a neighbour that is on no
  list itself. Its score then comes entirely from counterparty proximity and
  behaviour — enrichment visibly doing work no list lookup could do. Budget real
  time for this; it is the moment the project justifies itself.
- If a benign control scores high, **leave it in**. That is an honest limitations
  finding for the poster, not a bug to hide. Judges respect it.

**PM — harden, then freeze the data**

- Verify taint paths render sensibly on real addresses: `path[0]` is always the
  target, `path[-1]` always the flagged address, `len(tx_hashes) == len(path)-1`.
- Read the warnings your real runs produce and make sure they read like English an
  investigator would accept. The engine already wraps every failure path; what
  needs checking is the wording, not the plumbing.
- **`python scripts/warm_cache.py`, then commit `fixtures/`.** Wednesday evening,
  not Thursday. It writes both raw chain fixtures and finished responses, so
  `OFFLINE_MODE=1` replays complete analyses including the graph.
- **Verify the offline path:** `OFFLINE_MODE=1 python main.py`, then hit every demo
  address. If one returns nothing offline, the warm-up missed it and you fix it
  tonight rather than tomorrow.

---

## Thursday — freeze and rehearse

**AM — bug fixes only. Freeze at noon.**

- Work only from Aum's integration list. No new rules, no new thresholds, no
  "quick improvements." Every remaining bug is in code you already wrote; none are
  in code you haven't written yet.
- Final check: `pytest`, `smoke_test.py`, `scoring_reference.py`, and one run of
  each demo address in both online and offline modes.

**PM — numbers, then rehearsal**

Export for the poster:

- Rule count: **10** (from `rules/base.py: RULE_SPECS` — one source of truth)
- Records per source: OFAC **522**, Ransomwhere and ransomware.live from
  `/api/health`
- Validation results: which rules fired on which demo addresses, and your control
  results including any honest false positive
- The threshold changes you made Tuesday, and the reasoning

**Rehearse explaining Aum's half.** Judges ask whoever is standing there. You need
to be able to say what the waterfall shows and why the sliders change the
ordering, at least at a basic level.

---

## Things to be ready to say out loud

**"Why rule-based and not machine learning?"** A trained classifier cannot cite
its reasoning in an investigative report. Explainability is the entire claim of
the project — a feature to defend, not a compromise to apologize for.

**"Why is the scoring denominator dynamic?"** Because absent evidence is not
evidence of low risk. Summing all five weights would make a confirmed OFAC hit
score 20 out of 100 and display as "Low."

**"Isn't two-hop proximity meaningless?"** Partly, and that is why it is severity
40 at medium confidence, and why the explanation text says the intermediary may be
an exchange or mixer serving unrelated customers. The tool's credibility rests on
not overclaiming.

**"Couldn't you just use Chainalysis?"** Yes, and investigators do. The gap here is
different: analysts have data but spend their time gathering context and
connecting disparate pieces. This is a workflow argument, not a capability one.

---

## Risk table, updated

| Risk | Status | Mitigation |
|---|---|---|
| Chain client shape mismatch | **OPEN — highest** | `check_chain_api.py`, Tuesday AM, before anything else |
| Behavioral thresholds wrong on real data | **OPEN** | Tuesday PM calibration against 15–20 real addresses |
| Ransomwhere endpoint down or keyed | Open | Verify Monday PM; Zenodo fallback wired in |
| Demo set not curated | Open | Wednesday AM; the near-flagged ones need manual work |
| ransomware.live rate limit (1/min) | Handled | Snapshot only, never called at request time |
| Scoring formula dilutes real hits | Handled | Denominator corrected; reference implementation + golden numbers |
| Contract drift between devs | Handled | Frozen `contract.md`, pydantic validation, 422s eliminated |
| Waterfall bars don't sum | Handled | `scoring_reference.py` asserts it across all four presets |
| BFS hangs on a busy address | Handled | Five hard caps plus a 20s timeout, all tested |
| API rate-limits mid-demo | Handled | Disk cache, `OFFLINE_MODE=1`, warmed fixtures |
| Scope creep into Ethereum | Watch it | It is on the poster as Future Work. That is the deal |
| Nobody can explain the other half | Open | Thursday PM rehearsal, both directions |

---

## The one-line version

Monday: download data, unblock Aum. Tuesday: prove it works on real chain data and
recalibrate. Wednesday: curate demo addresses and freeze fixtures offline.
Thursday: fix only what is on the list, freeze at noon, rehearse.
