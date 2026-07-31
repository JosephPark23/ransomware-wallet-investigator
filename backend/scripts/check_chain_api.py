"""Validate the chain client against the live Esplora API. Run this FIRST on Day 2.

    python scripts/check_chain_api.py

Why this exists: every other part of the backend has been tested offline against
synthetic fixtures. The chain client is the one module whose real behaviour has
never been observed — the sandbox it was written in could not reach
mempool.space. If Esplora's response shape differs from what `_normalize_tx`
expects, every behavioral rule silently produces garbage rather than throwing.

This script checks the shape, not just the status code. A 200 with unexpected
fields is the failure mode that costs you Tuesday.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import CHAIN_API_BASE, CHAIN_API_FALLBACK  # noqa: E402
from profiling import build_context  # noqa: E402
from sources.chain import ApiBudget, ChainClient  # noqa: E402

# Genesis coinbase: ancient, huge, heavily donated to. If pagination or capping
# is broken, this is the address that exposes it.
BUSY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

CHECKS: list[tuple[str, str]] = []


def check(name: str, condition: bool, detail: str = "") -> bool:
    CHECKS.append((name, "PASS" if condition else "FAIL"))
    marker = "  ok  " if condition else " FAIL "
    print(f"[{marker}] {name}" + (f"  — {detail}" if detail else ""))
    return condition


def main() -> int:
    print(f"Primary : {CHAIN_API_BASE}")
    print(f"Fallback: {CHAIN_API_FALLBACK}\n")

    budget = ApiBudget(limit=20)
    with ChainClient(budget=budget) as client:
        print("--- address stats ---")
        stats = client.address_stats(BUSY)
        if not check("stats endpoint reachable", stats is not None):
            print("\nBoth hosts unreachable. Check the network, then re-run.")
            return 1

        chain_stats = (stats or {}).get("chain_stats") or {}
        check(
            "chain_stats present with expected keys",
            {"funded_txo_sum", "spent_txo_sum", "tx_count"} <= set(chain_stats),
            f"got keys: {sorted(chain_stats)[:6]}",
        )
        check(
            "values look like satoshis (integers)",
            isinstance(chain_stats.get("funded_txo_sum"), int),
            f"funded_txo_sum={chain_stats.get('funded_txo_sum')}",
        )

        print("\n--- transactions ---")
        txs = client.address_txs(BUSY)
        if not check("transaction list returned", bool(txs), f"{len(txs)} txs"):
            return 1

        sample = txs[0]
        check("tx has txid", bool(sample.get("txid")))
        check(
            "tx has parsed timestamp",
            sample.get("timestamp") is not None,
            str(sample.get("timestamp")),
        )
        check("tx has inputs list", isinstance(sample.get("inputs"), list))
        check("tx has outputs list", isinstance(sample.get("outputs"), list))

        addressed = [
            o for t in txs for o in t.get("outputs", []) if o.get("address")
        ]
        check(
            "outputs carry addresses (prevout parsing works)",
            len(addressed) > 0,
            f"{len(addressed)} addressed outputs across {len(txs)} txs",
        )
        check(
            "values converted to BTC, not left as satoshis",
            all(o["value"] < 1_000_000 for o in addressed[:50]),
            f"max seen: {max((o['value'] for o in addressed[:50]), default=0)}",
        )

        inputs_with_addresses = [
            i for t in txs for i in t.get("inputs", []) if i.get("address")
        ]
        check(
            "inputs carry addresses (needed for sender counting)",
            len(inputs_with_addresses) > 0,
            f"{len(inputs_with_addresses)} addressed inputs",
        )

        print("\n--- profile assembly ---")
        ctx = build_context(BUSY, stats, txs)
        p = ctx.profile
        print(
            f"       tx_count={p.tx_count}  received={p.total_received}  "
            f"sent={p.total_sent}  balance={p.balance}"
        )
        print(
            f"       window_senders={p.window_unique_senders}  "
            f"window_recipients={p.window_unique_recipients}  "
            f"window_active_days={p.window_active_days}"
        )
        check(
            "profile window has a first_seen date",
            p.window_first_seen is not None,
            str(p.window_first_seen),
        )
        check("total_received is non-zero", p.total_received > 0)
        check("balance is not wildly negative", p.balance > -0.001, str(p.balance))
        check("senders were counted", p.window_unique_senders > 0)

        print(f"\n--- budget ---")
        check("stayed within call budget", budget.used <= budget.limit,
              f"used {budget.used}/{budget.limit}")

    failures = [name for name, result in CHECKS if result == "FAIL"]
    print("\n" + "=" * 60)
    if failures:
        print(f"{len(failures)} FAILED:")
        for name in failures:
            print(f"  - {name}")
        print("\nFix sources/chain.py::_normalize_tx before touching anything else.")
        print("Every behavioral rule depends on this shape being right.")
        return 1

    print(f"All {len(CHECKS)} checks passed. The chain client works against live data.")
    print("Next: python scripts/pick_demo_addresses.py --propose")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
