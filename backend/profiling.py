"""Turns raw chain data into a Profile plus the derived facts every rule needs.

Deliberately computed once and shared. If each rule re-derived "which
transactions were incoming," they would drift apart and you would spend Day 4
finding out why two panels disagree.

Note this module is not in the original repo layout — it was split out of
engine.py because five separate rule modules all needed the same derived facts.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from config import SATS_PER_BTC
from models import Profile


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@dataclass
class AddressContext:
    """Everything a rule is allowed to look at. Rules receive this and nothing else."""

    address: str
    stats: dict | None
    txs: list[dict]
    profile: Profile

    # Derived, in the same units the rules reason about (BTC, UTC datetimes)
    incoming: list[dict] = field(default_factory=list)  # {tx, amount, timestamp}
    outgoing: list[dict] = field(default_factory=list)
    senders: dict[str, float] = field(default_factory=dict)  # address -> BTC in
    recipients: dict[str, float] = field(default_factory=dict)  # address -> BTC out

    def counterparties(self) -> set[str]:
        return set(self.senders) | set(self.recipients)

    def has_chain_data(self) -> bool:
        return bool(self.txs) or self.stats is not None


def classify(
    tx: dict, address: str
) -> tuple[dict[str, float], dict[str, float], float, float]:
    """Return counterparty maps plus net inbound/outbound BTC for one transaction.

    Inbound value from a multi-input transaction is attributed pro rata by each
    input address's contribution. Bitcoin does not encode input-to-output
    lineage, so this is explicitly an attribution heuristic.
    """
    inputs = tx.get("inputs", [])
    outputs = tx.get("outputs", [])
    input_addrs = {i.get("address") for i in inputs if i.get("address")}
    if address in input_addrs:
        outbound: dict[str, float] = {}
        for output in outputs:
            counterparty = output.get("address")
            if counterparty and counterparty != address:
                outbound[counterparty] = (
                    outbound.get(counterparty, 0.0) + output.get("value", 0.0)
                )
        total_out = sum(outbound.values())
        return {}, outbound, 0.0, total_out

    credited = sum(
        output.get("value", 0.0)
        for output in outputs
        if output.get("address") == address
    )
    if credited <= 0:
        return {}, {}, 0.0, 0.0

    contributions: dict[str, float] = {}
    for item in inputs:
        counterparty = item.get("address")
        if counterparty and counterparty != address:
            contributions[counterparty] = (
                contributions.get(counterparty, 0.0) + item.get("value", 0.0)
            )
    total_in = sum(contributions.values())
    if total_in <= 0:
        # Coinbase and undecodable inputs still transfer value even though no
        # sender address can be attributed.
        return {}, {}, credited, 0.0
    inbound = {
        counterparty: credited * contributed / total_in
        for counterparty, contributed in contributions.items()
    }
    return inbound, {}, credited, 0.0


def build_context(address: str, stats: dict | None, txs: list[dict]) -> AddressContext:
    incoming: list[dict] = []
    outgoing: list[dict] = []
    senders: dict[str, float] = {}
    recipients: dict[str, float] = {}
    active_dates: set[str] = set()
    timestamps: list[datetime] = []

    for tx in txs:
        when = _parse(tx.get("timestamp"))
        if when:
            timestamps.append(when)
            active_dates.add(when.date().isoformat())

        inbound, outbound, credited, sent = classify(tx, address)
        for counterparty, amount in inbound.items():
            senders[counterparty] = senders.get(counterparty, 0.0) + amount
        for counterparty, amount in outbound.items():
            recipients[counterparty] = recipients.get(counterparty, 0.0) + amount

        if credited > 0:
            incoming.append(
                {"tx": tx, "amount": round(credited, 8), "timestamp": when}
            )

        if sent > 0:
            outgoing.append({"tx": tx, "amount": round(sent, 8), "timestamp": when})

    chain_stats = (stats or {}).get("chain_stats") or {}
    mempool_stats = (stats or {}).get("mempool_stats") or {}

    funded = chain_stats.get("funded_txo_sum", 0) + mempool_stats.get("funded_txo_sum", 0)
    spent_sum = chain_stats.get("spent_txo_sum", 0) + mempool_stats.get("spent_txo_sum", 0)
    tx_count = chain_stats.get("tx_count", 0) + mempool_stats.get("tx_count", 0)

    if not tx_count:
        tx_count = len(txs)

    total_received = round(funded / SATS_PER_BTC, 8)
    total_sent = round(spent_sum / SATS_PER_BTC, 8)
    window_received = round(sum(i["amount"] for i in incoming), 8)
    window_sent = round(sum(o["amount"] for o in outgoing), 8)

    # Fall back to transaction-derived totals when the stats call failed.
    if not total_received and incoming:
        total_received = window_received
    if not total_sent and outgoing:
        total_sent = window_sent

    profile = Profile(
        tx_count=tx_count,
        total_received=total_received,
        total_sent=total_sent,
        balance=round(total_received - total_sent, 8),
        window_txs=len(txs),
        window_complete=tx_count <= len(txs),
        window_first_seen=min(timestamps).isoformat() if timestamps else None,
        window_last_seen=max(timestamps).isoformat() if timestamps else None,
        window_received=window_received,
        window_sent=window_sent,
        window_unique_senders=len(senders),
        window_unique_recipients=len(recipients),
        window_active_days=len(active_dates),
    )

    return AddressContext(
        address=address,
        stats=stats,
        txs=txs,
        profile=profile,
        incoming=incoming,
        outgoing=outgoing,
        senders=senders,
        recipients=recipients,
    )
