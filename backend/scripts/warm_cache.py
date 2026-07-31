"""Run every demo address against the live APIs and commit the results.

    python scripts/warm_cache.py

Run this Wednesday evening and commit fixtures/. Then present with
OFFLINE_MODE=1 unless the network is provably good — a demo that depends on a
live API call at 2 p.m. on presentation day will fail at 2 p.m. on
presentation day.

Writes two things per address:
  fixtures/chain/{address}.json  — raw chain data, so OfflineChainClient can
                                   replay a full analysis including the graph
  fixtures/{address}.json        — the finished response, served directly
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cache  # noqa: E402
import engine  # noqa: E402
from config import DATA_DIR, MAX_HOPS  # noqa: E402
from sources.chain import ApiBudget, ChainClient, save_chain_fixture  # noqa: E402


def load_demo_addresses() -> list[dict]:
    path = DATA_DIR / "demo_addresses.json"
    if not path.exists():
        print(f"! {path} not found — run scripts/pick_demo_addresses.py first")
        return []
    return json.loads(path.read_text())


def main() -> int:
    engine.load_all_sources()
    demo = load_demo_addresses()
    if not demo:
        return 1

    print(f"Warming {len(demo)} demo addresses\n")
    failures = 0

    for index, entry in enumerate(demo, start=1):
        address = entry["address"]
        print(f"[{index}/{len(demo)}] {entry['label']}  {address}")

        # Save raw chain data for the target and its expanded neighbours so the
        # offline client can rebuild the whole graph, not just the profile.
        try:
            budget = ApiBudget(limit=60)
            with ChainClient(budget=budget) as client:
                stats, txs, _ = client.bundle(address)
                save_chain_fixture(address, stats, txs)

                neighbours = set()
                for tx in txs:
                    for side in ("inputs", "outputs"):
                        for item in tx.get(side, []):
                            if item.get("address") and item["address"] != address:
                                neighbours.add(item["address"])

                for neighbour in list(neighbours)[:20]:
                    if budget.remaining < 4:
                        break
                    n_stats, n_txs, _ = client.bundle(neighbour)
                    save_chain_fixture(neighbour, n_stats, n_txs)
        except Exception as exc:  # noqa: BLE001
            print(f"    ! chain fixture failed: {type(exc).__name__}: {exc}")
            failures += 1

        try:
            response = engine.analyze(address, max_hops=MAX_HOPS, use_cache=False)
            cache.put_fixture(address, response.model_dump())
            cache.put(address, MAX_HOPS, response.model_dump())
            band = "degraded" if response.degraded else "clean"
            print(
                f"    {len(response.signals)} signals, "
                f"{len(response.graph.nodes)} nodes, "
                f"{len(response.taint_paths)} taint paths  [{band}]"
            )
            for signal in response.signals:
                print(f"      - {signal.id} (sev {signal.severity})")
        except Exception as exc:  # noqa: BLE001
            print(f"    ! analysis failed: {type(exc).__name__}: {exc}")
            failures += 1

        time.sleep(1.0)
        print()

    print("=" * 60)
    print(f"Done. {failures} failure(s).")
    print("Now: git add fixtures/ .cache/ && git commit -m 'warmed demo fixtures'")
    print("Then verify:  OFFLINE_MODE=1 python main.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
