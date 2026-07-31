"""Curate the demo set: proposes candidates, you approve them by hand.

    python scripts/pick_demo_addresses.py --propose     # see candidates
    python scripts/pick_demo_addresses.py --write       # write data/demo_addresses.json

Target composition (from the technical plan):
  2   OFAC-sanctioned            -> very high, sanctions-driven
  2   Ransomwhere, named family  -> high, ransomware-driven
  1-2 near-flagged but unlisted  -> the best demo: score comes from counterparty
                                    proximity and behaviour, showing enrichment work
  1-2 benign controls            -> should score low

The near-flagged ones cannot be picked automatically — you find them by running
an OFAC address, looking at its counterparty graph, and choosing a neighbour
that is itself on no list. Do that on Day 3 once traversal works.

A control that scores high is an honest limitations finding for the poster, not
a bug to hide. Leave it in and say so out loud.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import engine  # noqa: E402
from config import DATA_DIR  # noqa: E402
from sources import ofac, ransomwhere  # noqa: E402

# Well-known, publicly documented addresses that are not criminal.
# Controls exist to show the tool does not just flag everything.
BENIGN_CONTROLS = [
    {
        "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
        "label": "Genesis block coinbase (Satoshi)",
        "expectation": "Low — famous, heavily donated-to, on no watchlist",
        "category": "control",
    },
    {
        "address": "1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY",
        "label": "Internet Archive donation address",
        "expectation": "Low — legitimate nonprofit donation address",
        "category": "control",
    },
]


def propose() -> dict:
    engine.load_all_sources()

    sanctioned = sorted(
        addr for addr in _ofac_addresses() if addr.startswith(("1", "3", "bc1"))
    )[:10]

    families = ransomwhere.families()
    ransomware_picks = []
    for family, _count in list(families.items())[:6]:
        for address in ransomwhere.sample_addresses(family=family, limit=2):
            ransomware_picks.append({"address": address, "family": family})

    return {
        "ofac_candidates": sanctioned,
        "ransomware_candidates": ransomware_picks,
        "families_by_volume": dict(list(families.items())[:15]),
        "controls": BENIGN_CONTROLS,
    }


def _ofac_addresses() -> set[str]:
    path = DATA_DIR / "sanctioned_addresses_XBT.txt"
    if not path.exists():
        return set()
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip()}


def write_default() -> None:
    """Writes a starting demo file. Replace the placeholders by hand."""
    data = propose()
    entries = []

    for address in data["ofac_candidates"][:2]:
        entries.append(
            {
                "address": address,
                "label": "OFAC-sanctioned address",
                "expectation": "High — direct sanctions hit dominates the score",
                "category": "sanctions",
            }
        )

    for pick in data["ransomware_candidates"][:2]:
        entries.append(
            {
                "address": pick["address"],
                "label": f"{pick['family']} ransomware payment address",
                "expectation": "High — known ransomware payment address",
                "category": "ransomware",
            }
        )

    entries.extend(BENIGN_CONTROLS)

    path = DATA_DIR / "demo_addresses.json"
    path.write_text(json.dumps(entries, indent=2))
    print(f"Wrote {len(entries)} demo addresses to {path}")
    print("\nSTILL TO DO BY HAND: add 1-2 near-flagged-but-unlisted addresses.")
    print("Find them by analysing an OFAC address and picking an unlisted neighbour.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--propose", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    if args.write:
        write_default()
        return 0

    data = propose()
    print(json.dumps(data, indent=2)[:4000])
    print(f"\nOFAC list size: {ofac.count()}")
    print(f"Ransomwhere records: {ransomwhere.count()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
