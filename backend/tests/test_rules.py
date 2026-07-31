"""Rule and contract tests.

Run: python -m pytest tests/ -v

If a rule stops firing, this is where you find out — not on Thursday.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import graph as graph_module  # noqa: E402
from graph import traverse  # noqa: E402
from models import AnalyzeResponse, Signal  # noqa: E402
from profiling import build_context  # noqa: E402
from rules import counterparty as counterparty_rules  # noqa: E402
from rules import obfuscation as obfuscation_rules  # noqa: E402
from rules import profile as profile_rules  # noqa: E402
from rules import sanctions as sanctions_rules  # noqa: E402
from rules.base import RULE_SPECS  # noqa: E402
from sources import ofac  # noqa: E402
from tests import factories  # noqa: E402


def ctx_for(builder):
    address, stats, txs = builder()
    return build_context(address, stats, txs)


# --- Contract invariants ------------------------------------------------

VALID_CATEGORIES = {
    "sanctions",
    "ransomware",
    "obfuscation",
    "transaction_profile",
    "counterparty",
}


def assert_contract_valid(signal: Signal):
    assert signal.category in VALID_CATEGORIES, f"bad category: {signal.category}"
    assert 0 <= signal.severity <= 100
    assert signal.confidence in {"high", "medium", "low"}
    assert signal.explanation.strip(), f"{signal.id} has an empty explanation"
    assert len(signal.explanation.split()) >= 8, (
        f"{signal.id} explanation is too short to be useful in a report"
    )
    assert signal.source.name


def test_every_declared_rule_has_a_valid_spec():
    for rule_id, spec in RULE_SPECS.items():
        assert spec["category"] in VALID_CATEGORIES, rule_id
        assert 0 <= spec["severity"] <= 100, rule_id
        assert spec["confidence"] in {"high", "medium", "low"}, rule_id


def test_rule_count_matches_the_poster():
    """The poster claims a rule count. Keep them in sync."""
    assert len(RULE_SPECS) == 11


# --- Rule 1: sanctions --------------------------------------------------


def test_sanctions_hit_fires_on_a_real_ofac_address():
    ofac.load()
    assert ofac.count() > 100, "OFAC list did not load — check data/"
    sanctioned = next(iter(_ofac_sample()))
    ctx = build_context(sanctioned, None, [])
    signals = sanctions_rules.evaluate(ctx)
    assert len(signals) == 1
    assert signals[0].severity == 100
    assert signals[0].confidence == "high"
    assert_contract_valid(signals[0])


def test_sanctions_rule_silent_on_clean_address():
    ofac.load()
    ctx = build_context("1CleanAddressAAAAAAAAAAAAAAAAAAAAAA", None, [])
    assert sanctions_rules.evaluate(ctx) == []


def _ofac_sample():
    from config import DATA_DIR

    path = DATA_DIR / "sanctioned_addresses_XBT.txt"
    return [ln.strip() for ln in path.read_text().splitlines() if ln.strip()][:5]


# --- Rules 5, 6, 7: behavioral profile ----------------------------------


def test_collection_pattern_fires():
    ctx = ctx_for(factories.collector)
    ids = {s.id for s in profile_rules.evaluate(ctx)}
    assert "profile.collection_pattern" in ids


def test_round_value_payments_fires():
    ctx = ctx_for(factories.collector)
    signals = [s for s in profile_rules.evaluate(ctx) if s.id == "profile.round_value_payments"]
    assert signals, "round-value rule did not fire on round-value fixture"
    assert signals[0].confidence == "low"
    assert signals[0].evidence["match_count"] >= 3


def test_burst_then_dormant_fires():
    ctx = ctx_for(factories.collector)
    ids = {s.id for s in profile_rules.evaluate(ctx)}
    assert "profile.burst_then_dormant" in ids


def test_profile_rules_silent_without_chain_data():
    ctx = build_context("1EmptyAddressAAAAAAAAAAAAAAAAAAAAAA", None, [])
    assert profile_rules.evaluate(ctx) == []


def test_profile_stats_are_computed():
    ctx = ctx_for(factories.collector)
    assert ctx.profile.window_unique_senders >= 10
    assert ctx.profile.window_unique_recipients <= 3
    assert ctx.profile.tx_count > 0
    assert ctx.profile.window_active_days > 0


# --- Rules 8, 9: obfuscation --------------------------------------------


def test_peel_chain_fires():
    ctx = ctx_for(factories.peeler)
    ids = {s.id for s in obfuscation_rules.evaluate(ctx)}
    assert "obfuscation.self_peel" in ids


def test_rapid_forward_fires():
    ctx = ctx_for(factories.forwarder)
    signals = [s for s in obfuscation_rules.evaluate(ctx) if s.id == "obfuscation.rapid_forward"]
    assert signals
    assert signals[0].evidence["forwarded_share"] >= 0.6


def test_obfuscation_silent_on_ordinary_activity():
    address, stats, txs = factories.neighbour_of_flagged()
    ctx = build_context(address, stats, txs)
    assert obfuscation_rules.evaluate(ctx) == []


# --- Rules 3, 4: counterparty + traversal -------------------------------


def test_counterparty_rule_fires_on_flagged_neighbour(monkeypatch):
    flagged = "1FlaggedAddressAAAAAAAAAAAAAAAAAAAA"
    monkeypatch.setattr(
        graph_module, "flags_for", lambda a: ["ofac"] if a == flagged else []
    )

    address, stats, txs = factories.neighbour_of_flagged(flagged=flagged)
    ctx = build_context(address, stats, txs)
    client = factories.FakeChainClient({address: (stats, txs)})
    result = traverse(address, txs, client, max_hops=2)

    assert result.flags_by_address.get(flagged) == ["ofac"]
    assert result.hop_by_address.get(flagged) == 1

    signals = counterparty_rules.evaluate(ctx, result)
    ids = {s.id for s in signals}
    assert "counterparty.flagged_neighbor" in ids
    for signal in signals:
        assert_contract_valid(signal)


def test_counterparty_rule_silent_without_graph():
    ctx = ctx_for(factories.collector)
    assert counterparty_rules.evaluate(ctx, None) == []


def test_traversal_respects_node_cap(monkeypatch):
    monkeypatch.setattr(graph_module, "MAX_TOTAL_NODES", 5)
    address, stats, txs = factories.collector(senders=40)
    client = factories.FakeChainClient({address: (stats, txs)})
    result = traverse(address, txs, client, max_hops=2)
    assert len(result.nodes) <= 5
    assert result.truncated
    node_ids = {node.id for node in result.nodes}
    assert {edge.source for edge in result.edges} | {
        edge.target for edge in result.edges
    } <= node_ids


def test_traversal_respects_neighbour_cap(monkeypatch):
    monkeypatch.setattr(graph_module, "MAX_NEIGHBORS_PER_NODE", 3)
    address, stats, txs = factories.collector(senders=30)
    client = factories.FakeChainClient({address: (stats, txs)})
    result = traverse(address, txs, client, max_hops=1)
    assert result.truncated


def test_taint_path_reconstructs_to_target(monkeypatch):
    flagged = "1FlaggedAddressAAAAAAAAAAAAAAAAAAAA"
    monkeypatch.setattr(
        graph_module, "flags_for", lambda a: ["ofac"] if a == flagged else []
    )
    address, stats, txs = factories.neighbour_of_flagged(flagged=flagged)
    client = factories.FakeChainClient({address: (stats, txs)})
    result = traverse(address, txs, client, max_hops=2)

    assert result.taint_paths
    path = result.taint_paths[0]
    assert path.path[0] == address
    assert path.path[-1] == flagged
    assert path.hops == 1
    assert path.tx_hashes
    assert path.direction_sequence == ["in"]


# --- Every rule that fires must satisfy the contract --------------------


@pytest.mark.parametrize(
    "builder,module",
    [
        (factories.collector, profile_rules),
        (factories.peeler, obfuscation_rules),
        (factories.forwarder, obfuscation_rules),
    ],
)
def test_all_emitted_signals_are_contract_valid(builder, module):
    ctx = ctx_for(builder)
    signals = module.evaluate(ctx)
    assert signals, "fixture produced no signals — the test proves nothing"
    for signal in signals:
        assert_contract_valid(signal)


def test_response_model_accepts_assembled_output():
    """The contract is only real if a full response validates against it."""
    ctx = ctx_for(factories.collector)
    signals = profile_rules.evaluate(ctx) + obfuscation_rules.evaluate(ctx)
    response = AnalyzeResponse(
        address=ctx.address,
        analyzed_at="2026-07-27T12:00:00+00:00",
        profile=ctx.profile,
        signals=signals,
    )
    assert response.chain == "bitcoin"
    assert isinstance(response.signals, list)
