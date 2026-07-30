"""Full-pipeline smoke test using synthetic data. No network required.

    python scripts/smoke_test.py

Writes synthetic chain fixtures shaped to trigger each rule, then runs the real
engine over them in OFFLINE_MODE and prints the assembled response.

Why this exists: it lets you develop and demo the entire backend before the
Ransomwhere download finishes, and it proves the offline path works — which is
the path you will actually present on.

The synthetic fixtures go in fixtures/chain/ alongside real ones. They are
prefixed 1Synthetic so you can tell them apart, and they must NOT end up in your
demo address set. Real addresses only on the poster.
"""

import json
import os
import sys
from pathlib import Path

os.environ["OFFLINE_MODE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import engine  # noqa: E402
from config import DATA_DIR, FIXTURES_DIR  # noqa: E402
from sources.chain import save_chain_fixture  # noqa: E402
from tests import factories  # noqa: E402


def real_ofac_address() -> str | None:
    path = DATA_DIR / "sanctioned_addresses_XBT.txt"
    if not path.exists():
        return None
    lines = [ln.strip() for ln in path.read_text().splitlines() if ln.strip()]
    return lines[0] if lines else None


def build_fixtures() -> list[tuple[str, str]]:
    """Returns [(address, what_it_should_demonstrate)]."""
    built = []
    flagged = real_ofac_address()

    for name, builder in (
        ("funnel wallet: rules 5, 6, 7", factories.collector),
        ("peel chain: rule 8", factories.peeler),
        ("rapid forwarder: rule 9", factories.forwarder),
    ):
        address, stats, txs = builder()
        save_chain_fixture(address, stats, txs)
        for tx in txs:
            for side in ("inputs", "outputs"):
                for item in tx[side]:
                    other = item["address"]
                    if other != address:
                        save_chain_fixture(other, None, [])
        built.append((address, name))

    if flagged:
        address, stats, txs = factories.neighbour_of_flagged(flagged=flagged)
        save_chain_fixture(address, stats, txs)
        save_chain_fixture(flagged, None, [])
        save_chain_fixture("1OnwardAddressAAAAAAAAAAAAAAAAAAAAA", None, [])
        built.append((address, "unlisted neighbour of a real OFAC address: rules 3, 4"))

        ctx_addr, ctx_stats, ctx_txs = factories.collector(address=flagged)
        save_chain_fixture(flagged, ctx_stats, ctx_txs)
        built.append((flagged, "real OFAC-sanctioned address: rule 1"))

    return built


def main() -> int:
    engine.load_all_sources()
    print("Sources:", json.dumps(engine.source_status(), indent=2))

    fixtures = build_fixtures()
    print(f"\nBuilt {len(fixtures)} synthetic chain fixtures in {FIXTURES_DIR / 'chain'}\n")

    failures = 0
    for address, purpose in fixtures:
        print("=" * 70)
        print(f"{purpose}\n  {address}")
        response = engine.analyze(address, max_hops=2, use_cache=False)

        print(
            f"  profile: {response.profile.tx_count} txs, "
            f"{response.profile.unique_senders} senders, "
            f"{response.profile.unique_recipients} recipients, "
            f"balance {response.profile.balance}"
        )
        print(
            f"  graph: {len(response.graph.nodes)} nodes, "
            f"{len(response.graph.edges)} edges, "
            f"{len(response.taint_paths)} taint paths"
        )
        print(f"  degraded={response.degraded}  warnings={len(response.warnings)}")

        if not response.signals:
            print("  !! NO SIGNALS — this fixture is not proving anything")
            failures += 1
        for signal in response.signals:
            print(
                f"    [{signal.confidence.upper():6}] sev={signal.severity:3} "
                f"{signal.id}"
            )
            print(f"       {signal.label}")
        for warning in response.warnings:
            print(f"    warning: {warning}")
        print()

    print("=" * 70)
    print(f"{len(fixtures) - failures}/{len(fixtures)} fixtures produced signals.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
