"""Generate fixtures/sample.json — the fixture Dev B builds the whole frontend against.

    python scripts/make_sample_fixture.py

This must contain at least one signal in every one of the five categories, so
Dev B can build all five weight sliders, the waterfall colouring, and the
confidence badge treatments on Day 1 without waiting for the real backend.

Signals here are real output from the real rule modules wherever possible. The
two ransomware signals are hand-constructed because the Ransomwhere dataset has
to be downloaded first — they match the shape the rules emit exactly, so
swapping in real data changes nothing on the frontend.
"""

import json
import os
import sys
from pathlib import Path

os.environ["OFFLINE_MODE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import engine  # noqa: E402
from config import DATA_DIR, FIXTURES_DIR  # noqa: E402
from models import AnalyzeResponse, Signal, Source  # noqa: E402
from profiling import build_context  # noqa: E402
from rules import obfuscation as obfuscation_rules  # noqa: E402
from rules import profile as profile_rules  # noqa: E402
from rules import sanctions as sanctions_rules  # noqa: E402
from rules.base import make_signal  # noqa: E402
from tests import factories  # noqa: E402

SAMPLE_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"


def ransomware_signals() -> list[Signal]:
    """Shape-accurate placeholders until data/ransomwhere.json exists."""
    return [
        make_signal(
            rule_id="ransomware.known_address",
            label="Known ransomware payment address (Conti)",
            explanation=(
                "This address appears in the Ransomwhere crowdsourced dataset of "
                "confirmed ransomware payment addresses, attributed to the Conti "
                "family. Reports in that dataset require a screenshot of the ransom "
                "demand and are reviewed before publication."
            ),
            evidence={
                "matched_address": SAMPLE_ADDRESS,
                "family": "Conti",
                "reported_transactions": 14,
                "first_reported_payment": "2021-06-02T09:14:00+00:00",
                "last_reported_payment": "2021-11-18T22:03:00+00:00",
                "dataset_size": 26000,
            },
            source={
                "name": "Ransomwhere",
                "url": "https://api.ransomwhe.re/export",
                "retrieved_at": "2026-07-27T09:00:00+00:00",
            },
        ),
        make_signal(
            rule_id="ransomware.group_context",
            label="Group intelligence available for Conti",
            explanation=(
                "The Conti family has a tracked group profile on ransomware.live, with "
                "812 recorded victims. Conti operated a ransomware-as-a-service model "
                "and was among the most prolific extortion operations before its "
                "public breakup."
            ),
            evidence={
                "group": "Conti",
                "matched_from_family": "Conti",
                "victim_count": 812,
                "first_seen": "2020-02-25",
                "last_seen": "2022-06-22",
                "profile_url": "https://www.ransomware.live/group/conti",
            },
            source={
                "name": "ransomware.live",
                "url": "https://www.ransomware.live/",
                "retrieved_at": "2026-07-27T09:00:00+00:00",
            },
        ),
    ]


def counterparty_signal(graph_result) -> Signal:
    return make_signal(
        rule_id="counterparty.flagged_neighbor",
        label="Transacted directly with 2 flagged addresses",
        explanation=(
            "This address exchanged funds directly with 1CoUnT…9xQ2, which is "
            "OFAC-sanctioned, and with 1 other flagged address. A total of 4.2 BTC "
            "moved between this address and that counterparty in the transactions we "
            "retrieved."
        ),
        evidence={
            "flagged_counterparties": [
                {
                    "address": "1CoUnTerPartyExampleAddress009xQ2",
                    "flags": ["ofac"],
                    "description": "OFAC-sanctioned",
                    "value_exchanged": 4.2,
                },
                {
                    "address": "1SecondFlaggedCounterparty00003Kd",
                    "flags": ["ransomware:REvil"],
                    "description": "attributed to the REvil ransomware family",
                    "value_exchanged": 0.85,
                },
            ],
            "total_flagged_neighbors": 2,
        },
        source={
            "name": "Counterparty analysis (OFAC + Ransomwhere over Esplora)",
            "url": None,
            "retrieved_at": "2026-07-27T09:00:00+00:00",
        },
    )


def main() -> int:
    engine.load_all_sources()

    address, stats, txs = factories.collector()
    ctx = build_context(address, stats, txs)

    signals: list[Signal] = []

    # sanctions — real rule, real OFAC list
    ofac_path = DATA_DIR / "sanctioned_addresses_XBT.txt"
    if ofac_path.exists():
        real = [ln.strip() for ln in ofac_path.read_text().splitlines() if ln.strip()][0]
        signals += sanctions_rules.evaluate(build_context(real, None, []))

    signals += ransomware_signals()
    signals.append(counterparty_signal(None))
    signals += profile_rules.evaluate(ctx)

    _, p_stats, p_txs = factories.peeler()
    signals += obfuscation_rules.evaluate(build_context("1H58yfjY9skCz2qYT3NaANvYk5A2x2mn4H", p_stats, p_txs))

    _, f_stats, f_txs = factories.forwarder()
    signals += [
        s
        for s in obfuscation_rules.evaluate(
            build_context("1ForwarderTestAddressAAAAAAAAAAAAAA", f_stats, f_txs)
        )
        if s.id == "obfuscation.rapid_forward"
    ]

    # Deduplicate by rule id, keep highest severity first
    seen = set()
    unique = []
    for signal in sorted(signals, key=lambda s: -s.severity):
        if signal.id in seen:
            continue
        seen.add(signal.id)
        unique.append(signal)

    response = AnalyzeResponse(
        address=SAMPLE_ADDRESS,
        chain="bitcoin",
        analyzed_at="2026-07-27T09:00:00+00:00",
        cached=False,
        degraded=False,
        profile=ctx.profile,
        signals=unique,
        graph={
            "nodes": [
                {"id": SAMPLE_ADDRESS, "label": "1A1zP1…ivfNa", "type": "target", "flags": [], "hop": 0},
                {"id": "1CoUnTerPartyExampleAddress009xQ2", "label": "1CoUnT…9xQ2", "type": "counterparty", "flags": ["ofac"], "hop": 1},
                {"id": "1SecondFlaggedCounterparty00003Kd", "label": "1Secon…03Kd", "type": "counterparty", "flags": ["ransomware:REvil"], "hop": 1},
                {"id": "1IntermediaryAddressExample0000Wq", "label": "1Inter…00Wq", "type": "counterparty", "flags": [], "hop": 1},
                {"id": "1TwoHopFlaggedAddressExample00Zz", "label": "1TwoHo…00Zz", "type": "counterparty", "flags": ["ransomware:Conti"], "hop": 2},
            ],
            "edges": [
                {"source": SAMPLE_ADDRESS, "target": "1CoUnTerPartyExampleAddress009xQ2", "value": 4.2, "tx_hash": "abc123def4567890abc123def4567890abc123def4567890abc123def4567890", "timestamp": "2021-06-04T02:11:00+00:00"},
                {"source": SAMPLE_ADDRESS, "target": "1SecondFlaggedCounterparty00003Kd", "value": 0.85, "tx_hash": "bbb222def4567890abc123def4567890abc123def4567890abc123def4567890", "timestamp": "2021-06-09T14:52:00+00:00"},
                {"source": SAMPLE_ADDRESS, "target": "1IntermediaryAddressExample0000Wq", "value": 2.1, "tx_hash": "ccc333def4567890abc123def4567890abc123def4567890abc123def4567890", "timestamp": "2021-07-01T08:20:00+00:00"},
                {"source": "1IntermediaryAddressExample0000Wq", "target": "1TwoHopFlaggedAddressExample00Zz", "value": 2.0, "tx_hash": "ddd444def4567890abc123def4567890abc123def4567890abc123def4567890", "timestamp": "2021-07-01T09:05:00+00:00"},
            ],
        },
        taint_paths=[
            {
                "target_flag": "ofac",
                "hops": 1,
                "path": [SAMPLE_ADDRESS, "1CoUnTerPartyExampleAddress009xQ2"],
                "bottleneck_value": 4.2,
                "direction_sequence": ["out"],
                "tx_hashes": ["abc123def4567890abc123def4567890abc123def4567890abc123def4567890"],
            },
            {
                "target_flag": "ransomware:Conti",
                "hops": 2,
                "path": [SAMPLE_ADDRESS, "1IntermediaryAddressExample0000Wq", "1TwoHopFlaggedAddressExample00Zz"],
                "bottleneck_value": 2.0,
                "direction_sequence": ["out", "out"],
                "tx_hashes": [
                    "ccc333def4567890abc123def4567890abc123def4567890abc123def4567890",
                    "ddd444def4567890abc123def4567890abc123def4567890abc123def4567890",
                ],
            },
        ],
        sources_used=[
            {"name": "OFAC SDN List", "records": 522, "retrieved_at": "2026-07-27T09:00:00+00:00", "stale": False},
            {"name": "Ransomwhere", "records": 26000, "retrieved_at": "2026-07-27T09:00:00+00:00", "stale": False},
            {"name": "ransomware.live", "records": 312, "retrieved_at": "2026-07-27T09:00:00+00:00", "stale": False},
        ],
        warnings=[],
    )

    path = FIXTURES_DIR / "sample.json"
    path.write_text(json.dumps(response.model_dump(), indent=2))

    categories = {s.category for s in response.signals}
    print(f"Wrote {path}")
    print(f"  {len(response.signals)} signals across {len(categories)} categories")
    for signal in response.signals:
        print(f"    [{signal.confidence:6}] {signal.severity:3}  {signal.category:20} {signal.id}")
    missing = {"sanctions", "ransomware", "obfuscation", "transaction_profile", "counterparty"} - categories
    if missing:
        print(f"  !! MISSING CATEGORIES: {missing} — Dev B cannot build those sliders")
        return 1
    print("  all five categories present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
