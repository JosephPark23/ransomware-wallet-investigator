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
        for addr, flags in direct[:5]:
            value = ctx.senders.get(addr, 0.0) + ctx.recipients.get(addr, 0.0)
            detail.append(
                {
                    "address": addr,
                    "flags": flags,
                    "description": _describe(flags),
                    "value_exchanged": round(value, 8),
                }
            )
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
                    + f". A total of {btc(first['value_exchanged'])} moved between this "
                    f"address and that counterparty in the transactions we retrieved."
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
        detail = [
            {"address": addr, "flags": flags, "description": _describe(flags)}
            for addr, flags in two_hop[:5]
        ]
        paths = [p.model_dump() for p in graph_result.taint_paths if p.hops == 2][:3]
        signals.append(
            make_signal(
                rule_id="counterparty.two_hop",
                label=(
                    f"Within two hops of {len(two_hop)} flagged "
                    f"address{'es' if len(two_hop) != 1 else ''}"
                ),
                explanation=(
                    f"Funds can be traced from this address, through one intermediary, "
                    f"to {short(detail[0]['address'])}, which is "
                    f"{detail[0]['description']}. Two-hop proximity is suggestive rather "
                    f"than conclusive: the intermediary may be an exchange or mixer "
                    f"serving unrelated customers."
                ),
                evidence={
                    "flagged_at_two_hops": detail,
                    "total_two_hop_flagged": len(two_hop),
                    "example_paths": paths,
                },
                source={
                    "name": "Counterparty analysis (OFAC + Ransomwhere over Esplora)",
                    "url": None,
                    "retrieved_at": graph_result.retrieved_at,
                },
            )
        )

    return signals
