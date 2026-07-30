"""Shared plumbing for rule modules.

Every rule module exposes the same function:

    evaluate(ctx: AddressContext, graph_result) -> list[Signal]

Uniform signature, so engine.py can loop over modules without special cases.
Modules ignore the argument they don't need — only counterparty.py uses the graph.

The one non-negotiable rule about rules: if it cannot explain itself in one or
two plain-English sentences, it does not ship. An investigator has to be able to
paste the explanation into a report.
"""

from models import Signal, Source

# Severity and confidence are declared here, in one table, so the poster's
# "number of rules" figure and the code can never disagree.
RULE_SPECS: dict[str, dict] = {
    "sanctions.direct_hit": {"category": "sanctions", "severity": 100, "confidence": "high"},
    "ransomware.known_address": {"category": "ransomware", "severity": 95, "confidence": "high"},
    "counterparty.flagged_neighbor": {"category": "counterparty", "severity": 70, "confidence": "high"},
    "counterparty.two_hop": {"category": "counterparty", "severity": 40, "confidence": "medium"},
    "profile.collection_pattern": {"category": "transaction_profile", "severity": 45, "confidence": "medium"},
    "profile.burst_then_dormant": {"category": "transaction_profile", "severity": 40, "confidence": "medium"},
    "profile.round_value_payments": {"category": "transaction_profile", "severity": 35, "confidence": "low"},
    "obfuscation.peel_chain": {"category": "obfuscation", "severity": 50, "confidence": "medium"},
    "obfuscation.rapid_forward": {"category": "obfuscation", "severity": 35, "confidence": "medium"},
    "ransomware.group_context": {"category": "ransomware", "severity": 20, "confidence": "medium"},
}


def make_signal(
    rule_id: str,
    label: str,
    explanation: str,
    evidence: dict,
    source: dict,
    severity_override: int | None = None,
) -> Signal:
    spec = RULE_SPECS[rule_id]
    return Signal(
        id=rule_id,
        category=spec["category"],
        label=label,
        severity=spec["severity"] if severity_override is None else severity_override,
        confidence=spec["confidence"],
        explanation=explanation,
        evidence=evidence,
        source=Source(**source),
    )


def short(address: str, head: int = 6, tail: int = 4) -> str:
    """1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa -> 1A1zP1…ivfNa"""
    if len(address) <= head + tail + 1:
        return address
    return f"{address[:head]}…{address[-tail:]}"


def btc(value: float) -> str:
    return f"{value:.8f}".rstrip("0").rstrip(".") + " BTC"
