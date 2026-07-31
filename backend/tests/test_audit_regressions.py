"""Regression coverage for findings reproduced in AUDIT.md."""

import itertools
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import graph as graph_module  # noqa: E402
import cache  # noqa: E402
import engine  # noqa: E402
from bitcoin import canonicalize  # noqa: E402
from graph import GraphResult, _edges_from_txs, traverse  # noqa: E402
from models import TaintPath  # noqa: E402
from profiling import build_context  # noqa: E402
from rules import counterparty, obfuscation, profile  # noqa: E402
from scripts import scoring_reference  # noqa: E402
from sources import ofac, ransomware_live  # noqa: E402
from sources.chain import OfflineChainClient  # noqa: E402
from tests import factories  # noqa: E402


def test_uppercase_bech32_is_canonicalized_before_ofac_lookup():
    ofac.load()
    sanctioned = next(address for address in ofac._addresses if address.startswith("bc1"))
    assert canonicalize(sanctioned.upper()) == sanctioned
    assert ofac.is_sanctioned(sanctioned.upper())


def test_unknown_provenance_is_informational_and_cache_remains_live(
    monkeypatch, tmp_path
):
    address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    client = factories.FakeChainClient(
        {address: (factories.stats(0.0, 0.0, 0), [])}
    )
    monkeypatch.setattr(engine, "OFFLINE_MODE", False)
    monkeypatch.setattr(engine, "RULE_MODULES", ())
    monkeypatch.setattr(engine, "make_client", lambda *args, **kwargs: client)
    monkeypatch.setattr(engine, "_sources_used", lambda: [])
    monkeypatch.setattr(
        engine,
        "source_status",
        lambda: {
            "ofac": {
                "loaded": True,
                "retrieved_at": None,
                "stale": None,
            },
            "chain": {"mode": "test"},
        },
    )
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)

    first = engine.analyze(address, max_hops=0, use_cache=True)
    assert not first.degraded
    assert "no recorded retrieval time" in first.warnings[0]
    assert list(tmp_path.glob("*.json"))
    second = engine.analyze(address, max_hops=0, use_cache=True)
    assert second.cached
    assert "no recorded retrieval time" in second.warnings[0]


def test_scoring_is_monotone_for_every_signal_subset():
    signals = [
        {"id": "s", "category": "sanctions", "severity": 100},
        {"id": "r", "category": "ransomware", "severity": 95},
        {"id": "o", "category": "obfuscation", "severity": 35},
        {"id": "p", "category": "transaction_profile", "severity": 40},
        {"id": "c", "category": "counterparty", "severity": 20},
    ]
    weights = scoring_reference.PRESETS["Balanced"]
    for length in range(len(signals) + 1):
        for subset in itertools.combinations(signals, length):
            base = scoring_reference.score(list(subset), weights)["final_score"]
            for extra in signals:
                if extra not in subset:
                    enriched = scoring_reference.score(
                        [*subset, extra], weights
                    )["final_score"]
                    assert enriched >= base


def test_equal_category_evidence_receives_equal_contributions():
    result = scoring_reference.score(
        [
            {"id": "s", "category": "sanctions", "severity": 50},
            {"id": "r", "category": "ransomware", "severity": 50},
        ],
        scoring_reference.PRESETS["Balanced"],
    )
    contributions = {item["id"]: item["contribution"] for item in result["contributions"]}
    assert contributions["s"] == pytest.approx(contributions["r"])


def test_all_preset_weights_use_attenuation_range():
    for preset in scoring_reference.PRESETS.values():
        assert all(0 <= weight <= 1 for weight in preset.values())


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (24.999, "Low"),
        (25.0, "Moderate"),
        (49.999, "Moderate"),
        (50.0, "Elevated"),
        (74.999, "Elevated"),
        (75.0, "High"),
        (100.0, "High"),
    ],
)
def test_fractional_score_bands_have_no_gaps(value, expected):
    assert scoring_reference.band_for(value) == expected


def test_node_cap_never_emits_dangling_edges(monkeypatch):
    monkeypatch.setattr(graph_module, "MAX_TOTAL_NODES", 3)
    address, stats, txs = factories.collector(senders=10)
    result = traverse(
        address, txs, factories.FakeChainClient({address: (stats, txs)}), max_hops=1
    )
    node_ids = {node.id for node in result.nodes}
    endpoints = {edge.source for edge in result.edges} | {
        edge.target for edge in result.edges
    }
    assert endpoints <= node_ids


def test_ransomware_family_matching_rejects_ambiguous_substrings(monkeypatch):
    monkeypatch.setattr(
        ransomware_live,
        "_groups",
        {
            "nevada": {"name": "Nevada"},
            "j": {"name": "J"},
            "revil": {"name": "REvil"},
        },
    )
    assert ransomware_live.lookup("NotNevada") == {}
    assert ransomware_live.lookup("JigSaw") == {}
    assert ransomware_live.lookup("REvil / Sodinokibi")["name"] == "REvil"


def test_merchant_receiving_payments_with_change_is_not_a_peel_chain():
    merchant = "1MerchantAddressAAAAAAAAAAAAAAAAAAAA"
    txs = [
        factories.tx(
            f"payment-{index}",
            [(f"1Customer{index}AAAAAAAAAAAAAAAAAAAAAA", 5.02)],
            [(merchant, 0.02), (f"1Change{index}AAAAAAAAAAAAAAAAAAAAAAAA", 5.0)],
            when=factories.BASE + timedelta(days=index),
        )
        for index in range(6)
    ]
    ctx = build_context(merchant, factories.stats(0.12, 0, 6), txs)
    assert obfuscation._peel_chain(ctx) is None


def test_disjoint_self_peel_runs_do_not_merge():
    address = "1SelfPeelAddressAAAAAAAAAAAAAAAAAAA"
    txs = [
        factories.tx(
            f"self-{index}",
            [(address, 10.0 - index)],
            [(address, 9.0 - index), (f"1Payee{index}AAAAAAAAAAAAAAAAAAAAAAAAA", 0.2)],
            when=factories.BASE + timedelta(hours=index),
        )
        for index in (0, 1)
    ]
    txs.append(
        factories.tx(
            "separator",
            [(address, 8.0)],
            [
                ("1ASeparatorAAAAAAAAAAAAAAAAAAAAAAAA", 2.0),
                ("1BSeparatorAAAAAAAAAAAAAAAAAAAAAAAA", 2.0),
                ("1CSeparatorAAAAAAAAAAAAAAAAAAAAAAAA", 2.0),
            ],
            when=factories.BASE + timedelta(hours=2),
        )
    )
    txs.extend(
        factories.tx(
            f"self-{index}",
            [(address, 10.0 - index)],
            [(address, 9.0 - index), (f"1Payee{index}AAAAAAAAAAAAAAAAAAAAAAAAA", 0.2)],
            when=factories.BASE + timedelta(hours=index),
        )
        for index in (3, 4)
    )
    ctx = build_context(address, factories.stats(10.0, 4.0, len(txs)), txs)
    assert obfuscation._peel_chain(ctx) is None


def test_rapid_forward_conserves_spend_capacity():
    address = "1ForwardCapacityAAAAAAAAAAAAAAAAAAA"
    txs = [
        factories.tx(
            f"receipt-{index}",
            [(f"1Sender{index}AAAAAAAAAAAAAAAAAAAAAAAA", 1.0)],
            [(address, 1.0)],
            when=factories.BASE + timedelta(minutes=index),
        )
        for index in range(3)
    ]
    txs.append(
        factories.tx(
            "only-spend",
            [(address, 1.0)],
            [("1RecipientAAAAAAAAAAAAAAAAAAAAAAAAA", 1.0)],
            when=factories.BASE + timedelta(minutes=10),
        )
    )
    ctx = build_context(address, factories.stats(3.0, 1.0, 4), txs)
    assert obfuscation._rapid_forward(ctx) is None


def test_genuinely_dormant_complete_address_fires_without_a_straggler():
    address = "1DormantAddressAAAAAAAAAAAAAAAAAAAA"
    txs = [
        factories.tx(
            f"receipt-{index}",
            [(f"1Sender{index}AAAAAAAAAAAAAAAAAAAAAAAA", 1.0)],
            [(address, 1.0)],
            when=factories.BASE + timedelta(days=index),
        )
        for index in range(3)
    ]
    ctx = build_context(address, factories.stats(3.0, 0.0, 3), txs)
    assert profile._burst_then_dormant(ctx) is not None


def test_dormancy_is_suppressed_for_a_truncated_window():
    address = "1TruncatedAddressAAAAAAAAAAAAAAAAAA"
    _, _, txs = factories.collector(address=address, senders=3)
    ctx = build_context(address, factories.stats(3.0, 0.0, 100), txs[:3])
    assert not ctx.profile.window_complete
    assert profile._burst_then_dormant(ctx) is None


def test_mixed_two_hop_path_is_described_as_shared_counterparty(monkeypatch):
    target = "1VictimAddressAAAAAAAAAAAAAAAAAAAAA"
    intermediary = "1IntermediaryAAAAAAAAAAAAAAAAAAAAAA"
    sanctioned = "1SanctionedAAAAAAAAAAAAAAAAAAAAAAAA"
    target_txs = [
        factories.tx("target-deposit", [(target, 1.0)], [(intermediary, 1.0)])
    ]
    intermediary_txs = [
        factories.tx(
            "sanctioned-deposit", [(sanctioned, 1.0)], [(intermediary, 1.0)]
        )
    ]
    monkeypatch.setattr(
        graph_module, "flags_for", lambda address: ["ofac"] if address == sanctioned else []
    )
    client = factories.FakeChainClient(
        {
            target: (factories.stats(1, 1, 1), target_txs),
            intermediary: (factories.stats(2, 0, 2), intermediary_txs),
        }
    )
    result = traverse(target, target_txs, client, max_hops=2)
    path = next(path for path in result.taint_paths if path.path[-1] == sanctioned)
    assert path.direction_sequence == ["out", "in"]
    signal = next(
        item
        for item in counterparty.evaluate(
            build_context(target, factories.stats(1, 1, 1), target_txs), result
        )
        if item.id == "counterparty.shared_counterparty"
    )
    assert signal.evidence["topology"] == "shared_counterparty"
    assert signal.severity == 15
    assert "No direct flow of funds" in signal.explanation


def test_two_hop_topologies_emit_separate_supported_signals():
    target = "1TargetAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    shared = "1SharedFlagAAAAAAAAAAAAAAAAAAAAAAAA"
    inbound = "1InboundFlagAAAAAAAAAAAAAAAAAAAAAAA"
    graph = GraphResult(
        flags_by_address={shared: ["ofac"], inbound: ["ofac"]},
        hop_by_address={target: 0, shared: 2, inbound: 2},
        taint_paths=[
            TaintPath(
                target_flag="ofac",
                hops=2,
                path=[target, "1SharedMiddleAAAAAAAAAAAAAAAAAAAAAA", shared],
                bottleneck_value=50.0,
                direction_sequence=["out", "in"],
            ),
            TaintPath(
                target_flag="ofac",
                hops=2,
                path=[target, "1InboundMiddleAAAAAAAAAAAAAAAAAAAAA", inbound],
                bottleneck_value=0.4,
                direction_sequence=["in", "in"],
            ),
        ],
    )
    signals = counterparty.evaluate(build_context(target, None, []), graph)
    by_id = {signal.id: signal for signal in signals}
    assert set(by_id) == {
        "counterparty.shared_counterparty",
        "counterparty.two_hop",
    }
    assert (
        by_id["counterparty.shared_counterparty"]
        .evidence["flagged_at_two_hops"][0]["address"]
        == shared
    )
    assert (
        by_id["counterparty.two_hop"]
        .evidence["flagged_at_two_hops"][0]["address"]
        == inbound
    )


def test_multi_input_inbound_value_is_apportioned_not_duplicated():
    target = "1TargetAddressAAAAAAAAAAAAAAAAAAAAA"
    tx = factories.tx(
        "multi-input",
        [(f"1Cosigner{index}AAAAAAAAAAAAAAAAAAAAA", 1.0) for index in range(5)],
        [(target, 1.0), ("1ChangeAAAAAAAAAAAAAAAAAAAAAAAAAAA", 4.0)],
    )
    edges = _edges_from_txs(target, [tx])
    assert sum(edge[2] for edge in edges) == pytest.approx(1.0)
    ctx = build_context(target, factories.stats(1.0, 0.0, 1), [tx])
    assert sum(ctx.senders.values()) == pytest.approx(1.0)


def test_coinbase_receipt_is_counted_without_an_attributed_sender():
    address = "1MinerAddressAAAAAAAAAAAAAAAAAAAAAAA"
    coinbase = factories.tx(
        "coinbase",
        [],
        [(address, 6.25)],
        when=factories.BASE,
    )
    ctx = build_context(address, None, [coinbase])
    assert ctx.profile.window_received == pytest.approx(6.25)
    assert len(ctx.incoming) == 1
    assert ctx.senders == {}


def test_window_sent_matches_classified_recipients():
    address, stats, txs = factories.collector()
    ctx = build_context(address, stats, txs)
    assert ctx.profile.window_sent == pytest.approx(sum(ctx.recipients.values()))
    assert ctx.profile.window_sent <= ctx.profile.window_received


def test_offline_fixture_loader_rejects_path_traversal():
    assert OfflineChainClient()._load("../../data/calibration_cohorts") is None


def test_every_offline_fixture_name_is_a_valid_address():
    fixture_dir = Path(__file__).resolve().parent.parent / "fixtures" / "chain"
    invalid = [
        path.name for path in fixture_dir.glob("*.json") if canonicalize(path.stem) is None
    ]
    assert invalid == []


def test_offline_traversal_discovers_second_hop_nodes():
    address, _, _ = factories.forwarder()
    client = OfflineChainClient()
    stats, txs, warnings = client.bundle(address)
    assert stats is not None and txs and not warnings
    result = traverse(address, txs, client, max_hops=2)
    assert any(node.hop == 2 for node in result.nodes)


def test_naive_and_aware_timestamps_can_share_a_profile():
    address = "1TimestampAddressAAAAAAAAAAAAAAAAAAA"
    txs = [
        factories.tx(
            "aware",
            [("1SenderAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1.0)],
            [(address, 1.0)],
        ),
        {
            **factories.tx(
                "naive",
                [("1SenderBBBBBBBBBBBBBBBBBBBBBBBBBBB", 1.0)],
                [(address, 1.0)],
            ),
            "timestamp": "2024-03-02T12:00:00",
        },
    ]
    ctx = build_context(address, factories.stats(2.0, 0.0, 2), txs)
    assert ctx.profile.window_first_seen
    assert ctx.profile.window_last_seen


def test_zero_hops_still_returns_the_target_node(monkeypatch):
    """max_hops=0 means "no counterparties", not "no graph".

    The analysed address is always a node in its own graph. `traverse` handled
    this correctly, but `engine.analyze` guarded the call on `max_hops > 0` and
    so skipped it entirely, leaving `graph.nodes` empty. The frontend renders
    that as an empty panel, which reads as missing data rather than as a
    deliberately unexplored graph.
    """
    monkeypatch.setattr(engine, "OFFLINE_MODE", True)
    address, _, _ = factories.forwarder()

    result = engine.analyze(address, max_hops=0, use_cache=False)

    assert len(result.graph.nodes) == 1
    node = result.graph.nodes[0]
    assert node.id == address
    assert node.type == "target"
    assert node.hop == 0
    # No exploration means no counterparties and nothing to draw between them.
    assert result.graph.edges == []
    assert result.taint_paths == []


def test_calibration_suppresses_advice_when_it_measured_nothing():
    """A calibration run with no chain data must not recommend loosening rules.

    Nine of the eleven rules read transactions. If the chain client returns
    nothing -- blocked host, rate limit, outage -- none of them can fire, and
    the separation table then labels every one "never fires, threshold too
    tight, or loosen it". That advice is confidently backwards: the thresholds
    were never exercised. Acting on it would loosen nine rules to compensate
    for a network fault, and the false positives that followed would look like
    a calibration finding rather than a self-inflicted wound.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import calibrate

    no_data = [{"tx_count": 0, "degraded": True} for _ in range(25)]
    assert calibrate._data_quality(no_data)["usable"] is False

    # A single lucky address is still not a calibration.
    mostly_empty = [{"tx_count": 0, "degraded": True} for _ in range(24)]
    mostly_empty.append({"tx_count": 40, "degraded": False})
    assert calibrate._data_quality(mostly_empty)["usable"] is False

    good = [{"tx_count": 40, "degraded": False} for _ in range(20)]
    good += [{"tx_count": 0, "degraded": True} for _ in range(5)]
    quality = calibrate._data_quality(good)
    assert quality["usable"] is True
    assert quality["with_txs"] == 20

    # An empty run is unusable rather than vacuously fine.
    assert calibrate._data_quality([])["usable"] is False
