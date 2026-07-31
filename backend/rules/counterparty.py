"""Counterparty proximity rules.

Rule 3 — counterparty.flagged_neighbor (severity 70, high)
Rule 4 — counterparty.two_hop         (severity 40, medium)

These two are the enrichment payoff. An address that is on no list at all can
still light up here, because we walked its neighbourhood and found something.
That is the demo moment worth rehearsing.

Note the deliberate asymmetry: a direct counterparty is high confidence because
we observed the transaction ourselves; two hops out is only medium, because an
intermediary may be an exchange or a mixer with no relationship to either end.
Do not let anyone talk you into raising rule 4's confidence — the whole
credibility of the tool rests on not overclaiming.
"""

from models import Signal
from rules.base import btc, make_signal, short


def _describe(flags: list[str]) -> str:
    parts = []
    for flag in flags:
        if flag == "ofac":
            parts.append("OFAC-sanctioned")
        elif flag.startswith("ransomware:"):
            parts.append(f"attributed to the {flag.split(':', 1)[1]} ransomware family")
        elif flag == "ransomware":
            parts.append("a known ransomware payment address")
    return ", ".join(parts) if parts else "flagged"


def _topology(directions: list[str]) -> str:
    if directions and all(direction == "in" for direction in directions):
        return "inbound_flow"
    if directions and all(direction == "out" for direction in directions):
        return "outbound_flow"
    return "shared_counterparty"


def _two_hop_signals(graph_result) -> list[Signal]:
    by_topology: dict[str, list] = {}
    for path in graph_result.taint_paths:
        if path.hops == 2:
            by_topology.setdefault(_topology(path.direction_sequence), []).append(path)

    found: list[Signal] = []
    for topology, paths in by_topology.items():
        addresses = list(dict.fromkeys(path.path[-1] for path in paths))
        detail = [
            {
                "address": address,
                "flags": graph_result.flags_by_address.get(address, []),
                "description": _describe(
                    graph_result.flags_by_address.get(address, [])
                ),
            }
            for address in addresses[:5]
        ]
        if not detail:
            continue
        example = paths[0]
        first = detail[0]
        if topology == "inbound_flow":
            claim = (
                f"Funds reaching this address can be traced back to "
                f"{short(first['address'])}, which is {first['description']}."
            )
            rule_id = "counterparty.two_hop"
        elif topology == "outbound_flow":
            claim = (
                f"This address sent funds that reached {short(first['address'])}, "
                f"which is {first['description']}."
            )
            rule_id = "counterparty.two_hop"
        else:
            claim = (
                f"This address and {short(first['address'])}, which is "
                f"{first['description']}, share a common counterparty "
                f"({short(example.path[1])}). No direct flow of funds between them "
                "was observed."
            )
            rule_id = "counterparty.shared_counterparty"

        found.append(
            make_signal(
                rule_id=rule_id,
                label=(
                    f"{'Shares counterparties with' if topology == 'shared_counterparty' else 'Within two hops of'} "
                    f"{len(addresses)} flagged address"
                    f"{'es' if len(addresses) != 1 else ''}"
                ),
                explanation=(
                    f"{claim} Two-hop proximity is suggestive rather than conclusive: "
                    "an intermediary may be an exchange or mixer serving unrelated customers."
                ),
                evidence={
                    "flagged_at_two_hops": detail,
                    "total_two_hop_flagged": len(addresses),
                    "example_paths": [path.model_dump() for path in paths[:3]],
                    "topology": topology,
                },
                source={
                    "name": "Counterparty analysis (OFAC + Ransomwhere over Esplora)",
                    "url": None,
                    "retrieved_at": graph_result.retrieved_at,
                },
            )
        )
    return found


def evaluate(ctx, graph_result=None) -> list[Signal]:
    if graph_result is None:
        return []

    signals: list[Signal] = []

    direct = [
        (addr, flags)
        for addr, flags in graph_result.flags_by_address.items()
        if flags and graph_result.hop_by_address.get(addr) == 1
    ]
    two_hop = [
        (addr, flags)
        for addr, flags in graph_result.flags_by_address.items()
        if flags and graph_result.hop_by_address.get(addr) == 2
    ]

    if direct:
        detail = []
        for addr, flags in direct:
            value = ctx.senders.get(addr, 0.0) + ctx.recipients.get(addr, 0.0)
            detail.append(
                {
                    "address": addr,
                    "flags": flags,
                    "description": _describe(flags),
                    "value_exchanged": round(value, 8),
                }
            )
        detail.sort(
            key=lambda item: (
                0 if "ofac" in item["flags"] else 1,
                -item["value_exchanged"],
            )
        )
        detail = detail[:5]
        first = detail[0]
        signals.append(
            make_signal(
                rule_id="counterparty.flagged_neighbor",
                label=(
                    f"Transacted directly with {len(direct)} flagged "
                    f"address{'es' if len(direct) != 1 else ''}"
                ),
                explanation=(
                    f"This address exchanged funds directly with "
                    f"{short(first['address'])}, which is {first['description']}"
                    + (
                        f", and with {len(direct) - 1} other flagged "
                        f"address{'es' if len(direct) - 1 != 1 else ''}"
                        if len(direct) > 1
                        else ""
                    )
                    + (
                        f". An attributed {btc(first['value_exchanged'])} moved between "
                        f"this address and that counterparty in the retrieved transactions; "
                        "multi-input receipts are apportioned pro rata."
                        if first["value_exchanged"] > 0
                        else ". The value could not be determined from the retrieved transactions."
                    )
                ),
                evidence={
                    "flagged_counterparties": detail,
                    "total_flagged_neighbors": len(direct),
                },
                source={
                    "name": "Counterparty analysis (OFAC + Ransomwhere over Esplora)",
                    "url": None,
                    "retrieved_at": graph_result.retrieved_at,
                },
            )
        )

    if two_hop:
        signals.extend(_two_hop_signals(graph_result))

    return signals
