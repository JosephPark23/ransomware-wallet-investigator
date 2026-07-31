"""Calibration harness — Tuesday's job. Run it, read the separation, tune thresholds.

    python scripts/calibrate.py --build-cohorts    # sample addresses from real data
    python scripts/calibrate.py --run              # analyze them, print the matrix
    python scripts/calibrate.py --run --offline    # replay from cache, no network

Every behavioral threshold in rules/ was validated against synthetic fixtures
built to trigger it. That proves the code works. It proves nothing about whether
the thresholds are right on real Bitcoin data.

What you are looking for is SEPARATION: does a rule fire more on the criminal
cohorts than on the benign one? A rule that fires on everything carries no
information. Neither does a rule that fires on nothing. Both need their
threshold moved.

The output table is a poster figure. It is the difference between "we built a
tool" and "we evaluated a tool" — and the second one wins.
"""

import argparse
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import engine  # noqa: E402
from config import DATA_DIR  # noqa: E402
from rules.base import RULE_SPECS  # noqa: E402
from sources import ofac, ransomwhere  # noqa: E402

COHORT_FILE = DATA_DIR / "calibration_cohorts.json"

# Publicly documented, non-criminal addresses. Expand this list — the benign
# cohort is the one that tells you about false positives, and it is the one
# people will ask about.
BENIGN_SEED = [
    ("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "Genesis block coinbase"),
    ("1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY", "Internet Archive donations"),
    ("1Archive1n2C579dMsAu3iC6tWzuQJz8dN", "Internet Archive (vanity)"),
    ("3D2oetdNuZUqQHPJmcMDDHYoqkyNVsFk9r", "Bitfinex hot wallet"),
    ("bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97", "Binance cold wallet"),
]


def build_cohorts(per_cohort: int = 10) -> dict:
    """Sample real addresses into three labelled cohorts."""
    engine.load_all_sources()

    ofac_path = DATA_DIR / "sanctioned_addresses_XBT.txt"
    ofac_addrs = []
    if ofac_path.exists():
        candidates = [
            ln.strip()
            for ln in ofac_path.read_text().splitlines()
            if ln.strip() and ln.strip()[0] in "13b"
        ]
        random.Random(20260730).shuffle(candidates)
        ofac_addrs = candidates[:per_cohort]

    ransom_addrs = []
    families = ransomwhere.families()
    if families:
        # Spread across families rather than taking N from one — a single
        # family's addresses may all share one operator's habits.
        family_names = list(families)
        random.Random(20260730).shuffle(family_names)
        for family in family_names[: per_cohort * 2]:
            picks = ransomwhere.sample_addresses(family=family, limit=1)
            if picks:
                ransom_addrs.append(picks[0])
            if len(ransom_addrs) >= per_cohort:
                break

    cohorts = {
        "ofac": [{"address": a, "note": "OFAC sanctioned"} for a in ofac_addrs],
        "ransomware": [{"address": a, "note": "Ransomwhere listed"} for a in ransom_addrs],
        "benign": [{"address": a, "note": n} for a, n in BENIGN_SEED],
    }

    COHORT_FILE.write_text(json.dumps(cohorts, indent=2))
    print(f"Wrote {COHORT_FILE}")
    for name, entries in cohorts.items():
        print(f"  {name:12} {len(entries)} addresses")
    if not ransom_addrs:
        print("\n  ! ransomware cohort is empty — run scripts/refresh_data.py first")
    print("\nAdd more benign addresses by hand. That cohort decides your false-positive story.")
    return cohorts


def run(delay: float = 1.5) -> int:
    if not COHORT_FILE.exists():
        print("Run --build-cohorts first")
        return 1

    engine.load_all_sources()
    cohorts = json.loads(COHORT_FILE.read_text())

    # cohort -> rule_id -> count
    fired: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    totals: dict[str, int] = defaultdict(int)
    per_address: list[dict] = []

    for cohort, entries in cohorts.items():
        for entry in entries:
            address = entry["address"]
            totals[cohort] += 1
            try:
                response = engine.analyze(address, max_hops=2)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! {address}: {type(exc).__name__}")
                continue

            ids = [s.id for s in response.signals]
            for rule_id in ids:
                fired[cohort][rule_id] += 1

            per_address.append(
                {
                    "cohort": cohort,
                    "address": address,
                    "note": entry.get("note"),
                    "signals": ids,
                    "tx_count": response.profile.tx_count,
                    "degraded": response.degraded,
                }
            )
            flag = " DEGRADED" if response.degraded else ""
            print(f"  [{cohort:10}] {address[:16]}… {len(ids)} signals{flag}")
            time.sleep(delay)

    quality = _data_quality(per_address)
    _print_matrix(fired, totals)
    if quality["usable"]:
        _print_separation(fired, totals)
    else:
        _print_unusable(quality)

    out = DATA_DIR / "calibration_results.json"
    out.write_text(json.dumps(per_address, indent=2))
    print(f"\nPer-address detail written to {out}")
    return 0 if quality["usable"] else 2


# Below this share of addresses carrying transactions, the run measured the
# network rather than the rules and the separation table is not evidence.
MIN_ADDRESSES_WITH_CHAIN_DATA = 0.5


def _data_quality(per_address: list[dict]) -> dict:
    """Did this run actually retrieve enough chain data to judge a threshold?

    Nine of the eleven rules read transactions. If the chain client returned
    nothing -- a blocked host, a rate limit, an outage -- those rules cannot
    fire, and a naive report then prints "never fires, loosen the threshold"
    for every one of them. That advice is confidently backwards: the thresholds
    were never exercised. Someone acting on it would loosen nine rules to fix a
    network problem, and the resulting false positives would look like a
    calibration result.

    So the separation table is gated on the run having chain data to calibrate
    against, and the failure is reported as a failure rather than as a finding.
    """
    total = len(per_address)
    with_txs = sum(1 for r in per_address if r.get("tx_count"))
    degraded = sum(1 for r in per_address if r.get("degraded"))
    share = (with_txs / total) if total else 0.0
    return {
        "total": total,
        "with_txs": with_txs,
        "degraded": degraded,
        "share": share,
        "usable": total > 0 and share >= MIN_ADDRESSES_WITH_CHAIN_DATA,
    }


def _print_unusable(quality: dict) -> None:
    print("\n" + "=" * 78)
    print("SEPARATION SUPPRESSED — this run did not retrieve enough chain data")
    print("=" * 78)
    print(
        f"  {quality['with_txs']} of {quality['total']} addresses returned any "
        f"transactions ({quality['share']:.0%}); "
        f"{quality['degraded']} responses were degraded."
    )
    print()
    print("  Nine of the eleven rules read transactions, so with no chain data they")
    print("  cannot fire. Printing a separation table here would report every one of")
    print("  them as 'never fires — loosen the threshold', which is the opposite of")
    print("  the truth: the thresholds were never exercised at all.")
    print()
    print("  Only the two list-based rules (sanctions.direct_hit,")
    print("  ransomware.known_address) are meaningful above; they need no chain data.")
    print()
    print("  Check network access to the Esplora hosts in config.py, then re-run.")


def _print_matrix(fired, totals) -> None:
    cohorts = list(totals)
    print("\n" + "=" * 78)
    print("FIRING RATE BY COHORT (% of addresses in cohort where the rule fired)")
    print("=" * 78)
    header = f"{'rule':38}" + "".join(f"{c:>13}" for c in cohorts)
    print(header)
    print("-" * len(header))

    for rule_id in RULE_SPECS:
        row = f"{rule_id:38}"
        for cohort in cohorts:
            total = totals[cohort] or 1
            pct = 100 * fired[cohort].get(rule_id, 0) / total
            row += f"{pct:>12.0f}%"
        print(row)


def _print_separation(fired, totals) -> None:
    """The number that matters: criminal firing rate minus benign firing rate."""
    print("\n" + "=" * 78)
    print("SEPARATION  (criminal cohorts − benign cohort, in percentage points)")
    print("=" * 78)

    benign_total = totals.get("benign", 0) or 1
    criminal_total = (totals.get("ofac", 0) + totals.get("ransomware", 0)) or 1

    verdicts = []
    for rule_id in RULE_SPECS:
        benign_pct = 100 * fired["benign"].get(rule_id, 0) / benign_total
        criminal_pct = (
            100
            * (fired["ofac"].get(rule_id, 0) + fired["ransomware"].get(rule_id, 0))
            / criminal_total
        )
        separation = criminal_pct - benign_pct

        if criminal_pct == 0 and benign_pct == 0:
            verdict = "never fires — threshold too tight, or loosen it"
        elif benign_pct >= 80 and criminal_pct >= 80:
            verdict = "fires on everything — carries no information"
        elif separation >= 30:
            verdict = "good separation — keep"
        elif separation <= -10:
            verdict = "INVERTED — fires more on benign, investigate"
        else:
            verdict = "weak separation — consider tightening"

        verdicts.append((separation, rule_id, criminal_pct, benign_pct, verdict))

    for separation, rule_id, criminal_pct, benign_pct, verdict in sorted(
        verdicts, key=lambda v: -v[0]
    ):
        print(
            f"  {separation:+6.0f}pp  {rule_id:36} "
            f"(criminal {criminal_pct:3.0f}%, benign {benign_pct:3.0f}%)  {verdict}"
        )

    print(
        "\nA rule firing on 100% of both cohorts is not evidence, it is noise.\n"
        "A benign address scoring high is an honest limitations finding — keep it\n"
        "in the demo and say so. Judges trust a team that found its own false\n"
        "positive more than one showing six cherry-picked wins."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-cohorts", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--per-cohort", type=int, default=10)
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()

    if args.build_cohorts:
        build_cohorts(args.per_cohort)
        return 0
    if args.run:
        return run(args.delay)

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
