"""Turns raw chain data into a Profile plus the derived facts every rule needs.

Deliberately computed once and shared. If each rule re-derived "which
transactions were incoming," they would drift apart and you would spend Day 4
finding out why two panels disagree.

Note this module is not in the original repo layout — it was split out of
engine.py because five separate rule modules all needed the same derived facts.
"""

from dataclasses import dataclass, field
from datetime import datetime

from config import SATS_PER_BTC
from models import Profile


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
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


def build_context(address: str, stats: dict | None, txs: list[dict]) -> AddressContext:
    incoming: list[dict] = []
    outgoing: list[dict] = []
    senders: dict[str, float] = {}
    recipients: dict[str, float] = {}
    active_dates: set[str] = set()
    timestamps: list[datetime] = []

    for tx in txs:
        input_addrs = {i.get("address") for i in tx.get("inputs", []) if i.get("address")}
        output_addrs = {o.get("address") for o in tx.get("outputs", []) if o.get("address")}

        when = _parse(tx.get("timestamp"))
        if when:
            timestamps.append(when)
            active_dates.add(when.date().isoformat())

        is_input = address in input_addrs
        is_output = address in output_addrs

        if is_output:
            # Value credited to us in this transaction.
            amount = sum(
                o.get("value", 0.0)
                for o in tx.get("outputs", [])
                if o.get("address") == address
            )
            if not is_input:  # pure receive, not a self-spend with change
                for addr in input_addrs:
                    if addr != address:
                        senders[addr] = senders.get(addr, 0.0) + amount
                incoming.append(
                    {"tx": tx, "amount": round(amount, 8), "timestamp": when}
                )

        if is_input:
            spent = sum(
                i.get("value", 0.0)
                for i in tx.get("inputs", [])
                if i.get("address") == address
            )
            change = sum(
                o.get("value", 0.0)
                for o in tx.get("outputs", [])
                if o.get("address") == address
            )
            net_out = max(0.0, spent - change)
            for addr in output_addrs:
                if addr != address:
                    value = sum(
                        o.get("value", 0.0)
                        for o in tx.get("outputs", [])
                        if o.get("address") == addr
                    )
                    recipients[addr] = recipients.get(addr, 0.0) + value
            outgoing.append({"tx": tx, "amount": round(net_out, 8), "timestamp": when})

    chain_stats = (stats or {}).get("chain_stats") or {}
    mempool_stats = (stats or {}).get("mempool_stats") or {}

    funded = chain_stats.get("funded_txo_sum", 0) + mempool_stats.get("funded_txo_sum", 0)
    spent_sum = chain_stats.get("spent_txo_sum", 0) + mempool_stats.get("spent_txo_sum", 0)
    tx_count = chain_stats.get("tx_count", 0) + mempool_stats.get("tx_count", 0)

    if not tx_count:
        tx_count = len(txs)

    total_received = round(funded / SATS_PER_BTC, 8)
    total_sent = round(spent_sum / SATS_PER_BTC, 8)

    # Fall back to transaction-derived totals when the stats call failed.
    if not total_received and incoming:
        total_received = round(sum(i["amount"] for i in incoming), 8)
    if not total_sent and outgoing:
        total_sent = round(sum(o["amount"] for o in outgoing), 8)

    profile = Profile(
        first_seen=min(timestamps).isoformat() if timestamps else None,
        last_seen=max(timestamps).isoformat() if timestamps else None,
        tx_count=tx_count,
        total_received=total_received,
        total_sent=total_sent,
        balance=round(total_received - total_sent, 8),
        unique_senders=len(senders),
        unique_recipients=len(recipients),
        active_days=len(active_dates),
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
