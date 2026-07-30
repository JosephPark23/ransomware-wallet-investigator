"""Builders for synthetic chain data.

These let every rule be tested without a network call, which matters because the
rules are the part most likely to have a subtle bug — a threshold off by one
produces no error, just a quietly wrong number on your poster.
"""

from datetime import datetime, timedelta, timezone

BASE = datetime(2024, 3, 1, 12, 0, tzinfo=timezone.utc)


def tx(
    txid: str,
    inputs: list[tuple[str, float]],
    outputs: list[tuple[str, float]],
    when: datetime | None = None,
    fee: float = 0.0001,
) -> dict:
    when = when or BASE
    return {
        "txid": txid,
        "timestamp": when.isoformat(),
        "block_time": int(when.timestamp()),
        "inputs": [{"address": a, "value": v} for a, v in inputs],
        "outputs": [{"address": a, "value": v} for a, v in outputs],
        "fee": fee,
    }


def stats(received: float, sent: float, tx_count: int) -> dict:
    return {
        "chain_stats": {
            "funded_txo_sum": int(received * 1e8),
            "spent_txo_sum": int(sent * 1e8),
            "tx_count": tx_count,
            "funded_txo_count": tx_count,
            "spent_txo_count": tx_count,
        },
        "mempool_stats": {
            "funded_txo_sum": 0,
            "spent_txo_sum": 0,
            "tx_count": 0,
        },
    }


def collector(address: str = "1CollectorTestAddressAAAAAAAAAAAAAA", senders: int = 15):
    """Many senders, two recipients, drained balance, round values, burst+dormant.

    Deliberately triggers rules 5, 6 and 7 at once.
    """
    txs = []
    total = 0.0
    for i in range(senders):
        amount = [0.5, 1.0, 0.1][i % 3]
        total += amount
        txs.append(
            tx(
                f"in{i:03d}",
                [(f"1Sender{i:03d}XXXXXXXXXXXXXXXXXXXXXX", amount + 0.01)],
                [(address, amount)],
                when=BASE + timedelta(days=i % 20, hours=i),
            )
        )

    # Sweep out everything, 200 days later -> dormancy after the burst
    txs.append(
        tx(
            "sweep001",
            [(address, total)],
            [("1RecipientAAAAAAAAAAAAAAAAAAAAAAAAA", total * 0.6)],
            when=BASE + timedelta(days=220),
        )
    )
    txs.append(
        tx(
            "sweep002",
            [(address, total * 0.4)],
            [("1RecipientBBBBBBBBBBBBBBBBBBBBBBBBB", total * 0.4)],
            when=BASE + timedelta(days=221),
        )
    )
    return address, stats(total, total, len(txs)), txs


def peeler(address: str = "1PeelerTestAddressAAAAAAAAAAAAAAAAA", links: int = 5):
    """Every transaction has one large and one small output -> rule 8."""
    txs = []
    carried = 10.0
    for i in range(links):
        peeled = 0.2
        txs.append(
            tx(
                f"peel{i:03d}",
                [(address, carried)],
                [(address, carried - peeled), (f"1Peel{i:03d}YYYYYYYYYYYYYYYYYYYYYYY", peeled)],
                when=BASE + timedelta(hours=i * 3),
            )
        )
        carried -= peeled
    return address, stats(10.0, 10.0 - carried, len(txs)), txs


def forwarder(address: str = "1ForwarderTestAddressAAAAAAAAAAAAAA", rounds: int = 4):
    """Receives and re-sends within minutes -> rule 9."""
    txs = []
    for i in range(rounds):
        arrival = BASE + timedelta(days=i)
        txs.append(
            tx(
                f"recv{i:03d}",
                [(f"1Source{i:03d}ZZZZZZZZZZZZZZZZZZZZZZ", 2.01)],
                [(address, 2.0)],
                when=arrival,
            )
        )
        txs.append(
            tx(
                f"fwd{i:03d}",
                [(address, 2.0)],
                [(f"1Onward{i:03d}WWWWWWWWWWWWWWWWWWWWW", 1.99)],
                when=arrival + timedelta(minutes=12),
            )
        )
    return address, stats(rounds * 2.0, rounds * 2.0, len(txs)), txs


def neighbour_of_flagged(
    address: str = "1NeighbourTestAddressAAAAAAAAAAAAAA",
    flagged: str = "1FlaggedAddressAAAAAAAAAAAAAAAAAAAA",
):
    """On no list itself, but transacts directly with a flagged address -> rule 3."""
    txs = [
        tx("nb001", [(flagged, 3.01)], [(address, 3.0)], when=BASE),
        tx(
            "nb002",
            [(address, 3.0)],
            [("1OnwardAddressAAAAAAAAAAAAAAAAAAAAA", 2.99)],
            when=BASE + timedelta(days=2),
        ),
    ]
    return address, stats(3.0, 3.0, len(txs)), txs


class FakeChainClient:
    """Serves a dict of {address: (stats, txs)}. Same interface as ChainClient."""

    def __init__(self, data: dict[str, tuple[dict, list[dict]]]):
        self.data = data
        self.calls = 0

    def bundle(self, address: str):
        self.calls += 1
        if address not in self.data:
            return None, [], []
        stats_, txs = self.data[address]
        return stats_, txs, []

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass
