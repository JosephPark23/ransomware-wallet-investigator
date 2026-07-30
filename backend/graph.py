"""Bounded BFS over counterparties, plus taint path reconstruction.

The caps were written before the traversal, deliberately. Without them a single
query against a high-traffic address fans out to thousands of API calls and
hangs — and it will be a high-traffic address, because the interesting ones
always are.

Every cap degrades gracefully: hitting one appends a warning and returns what we
have. No cap ever raises to the caller.
"""

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from config import (
    MAX_NEIGHBORS_PER_NODE,
    MAX_TOTAL_NODES,
    TRAVERSAL_TIMEOUT_SECONDS,
)
from models import GraphEdge, GraphNode, TaintPath
from rules.base import short
from sources import ofac, ransomwhere
from sources.chain import BudgetExceeded


@dataclass
class GraphResult:
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    taint_paths: list[TaintPath] = field(default_factory=list)
    flags_by_address: dict[str, list[str]] = field(default_factory=dict)
    hop_by_address: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    retrieved_at: str | None = None
    truncated: bool = False


def flags_for(address: str) -> list[str]:
    """The only place an address gets labelled. Keep it that way."""
    flags: list[str] = []
    if ofac.is_sanctioned(address):
        flags.append("ofac")
    if ransomwhere.is_known(address):
        family = ransomwhere.family_for(address)
        flags.append(f"ransomware:{family}" if family else "ransomware")
    return flags


def _edges_from_txs(address: str, txs: list[dict]) -> list[tuple[str, str, float, str, str | None]]:
    """(source, target, value, txid, timestamp) for every counterparty link."""
    out = []
    for tx in txs:
        txid = tx.get("txid", "")
        timestamp = tx.get("timestamp")
        input_addrs = {i.get("address") for i in tx.get("inputs", []) if i.get("address")}
        outputs = [o for o in tx.get("outputs", []) if o.get("address")]

        if address in input_addrs:
            for o in outputs:
                if o["address"] != address:
                    out.append((address, o["address"], o.get("value", 0.0), txid, timestamp))
        else:
            for sender in input_addrs:
                if sender == address:
                    continue
                credited = sum(
                    o.get("value", 0.0) for o in outputs if o["address"] == address
                )
                out.append((sender, address, credited, txid, timestamp))
    return out


def traverse(target: str, target_txs: list[dict], client, max_hops: int = 2) -> GraphResult:
    result = GraphResult(retrieved_at=datetime.now(timezone.utc).isoformat())
    started = time.monotonic()

    def timed_out() -> bool:
        return time.monotonic() - started > TRAVERSAL_TIMEOUT_SECONDS

    seen: dict[str, int] = {target: 0}
    parent: dict[str, tuple[str, str, float]] = {}  # child -> (parent, txid, value)
    edge_keys: set[tuple[str, str, str]] = set()

    result.flags_by_address[target] = flags_for(target)
    result.hop_by_address[target] = 0

    frontier: list[tuple[str, list[dict]]] = [(target, target_txs)]

    for hop in range(max_hops):
        next_frontier: list[str] = []

        for address, txs in frontier:
            if timed_out():
                result.warnings.append(
                    f"Traversal stopped after {TRAVERSAL_TIMEOUT_SECONDS:.0f}s; "
                    "the counterparty graph is incomplete."
                )
                result.truncated = True
                break

            links = _edges_from_txs(address, txs)
            # Highest-value edges first, then cap. Cheap addresses are noise.
            links.sort(key=lambda link: -link[2])
            kept = links[:MAX_NEIGHBORS_PER_NODE]
            if len(links) > MAX_NEIGHBORS_PER_NODE:
                result.truncated = True

            for src, dst, value, txid, timestamp in kept:
                key = (src, dst, txid)
                if key not in edge_keys:
                    edge_keys.add(key)
                    result.edges.append(
                        GraphEdge(
                            source=src,
                            target=dst,
                            value=round(value, 8),
                            tx_hash=txid,
                            timestamp=timestamp,
                        )
                    )

                neighbor = dst if src == address else src
                if neighbor == address or neighbor in seen:
                    continue
                if len(seen) >= MAX_TOTAL_NODES:
                    result.truncated = True
                    continue

                seen[neighbor] = hop + 1
                parent[neighbor] = (address, txid, value)
                result.hop_by_address[neighbor] = hop + 1
                result.flags_by_address[neighbor] = flags_for(neighbor)
                next_frontier.append(neighbor)

        if result.truncated and timed_out():
            break

        # Expand the next hop, budget permitting. Flagged and high-value nodes first.
        if hop + 1 >= max_hops:
            break

        expanded: list[tuple[str, list[dict]]] = []
        next_frontier.sort(
            key=lambda a: (
                0 if result.flags_by_address.get(a) else 1,
                -(parent.get(a, ("", "", 0.0))[2]),
            )
        )
        for neighbor in next_frontier:
            if timed_out():
                result.truncated = True
                break
            try:
                _, neighbor_txs, warns = client.bundle(neighbor)
            except BudgetExceeded:
                result.warnings.append(
                    "API call budget reached; the counterparty graph is incomplete."
                )
                result.truncated = True
                break
            except Exception:
                continue
            result.warnings.extend(warns)
            expanded.append((neighbor, neighbor_txs))

        frontier = expanded

    for address, hop in seen.items():
        result.nodes.append(
            GraphNode(
                id=address,
                label=short(address),
                type="target" if address == target else "counterparty",
                flags=result.flags_by_address.get(address, []),
                hop=hop,
            )
        )

    result.taint_paths = _build_taint_paths(target, parent, result.flags_by_address)
    return result


def _build_taint_paths(
    target: str,
    parent: dict[str, tuple[str, str, float]],
    flags_by_address: dict[str, list[str]],
) -> list[TaintPath]:
    """Walk parent pointers back from each flagged node to the target."""
    paths: list[TaintPath] = []

    for address, flags in flags_by_address.items():
        if address == target or not flags:
            continue

        chain: list[str] = [address]
        tx_hashes: list[str] = []
        values: list[float] = []
        cursor = address
        guard = 0

        while cursor in parent and guard < 10:
            prev, txid, value = parent[cursor]
            chain.append(prev)
            tx_hashes.append(txid)
            values.append(value)
            cursor = prev
            guard += 1

        if cursor != target:
            continue  # not actually reachable from the target

        chain.reverse()
        tx_hashes.reverse()

        paths.append(
            TaintPath(
                target_flag=flags[0],
                hops=len(chain) - 1,
                path=chain,
                total_value=round(min(values) if values else 0.0, 8),
                tx_hashes=tx_hashes,
            )
        )

    # Shortest, then highest value — the most defensible paths lead the panel.
    paths.sort(key=lambda p: (p.hops, -p.total_value))
    return paths[:10]
