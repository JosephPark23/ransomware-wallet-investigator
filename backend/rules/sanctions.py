"""Sanctions rules.

Rule 1 — sanctions.direct_hit (severity 100, high confidence)
"""

from models import Signal
from rules.base import make_signal
from sources import ofac


def evaluate(ctx, graph_result=None) -> list[Signal]:
    if not ofac.is_sanctioned(ctx.address):
        return []

    entity = ofac.entity_for(ctx.address)
    entity_name = entity.get("entity")
    program = entity.get("program")

    if entity_name:
        explanation = (
            f"This exact address is designated by OFAC, listed under the entity "
            f"'{entity_name}'"
            + (f" in the {program} sanctions program" if program else "")
            + ". Transacting with it may carry legal consequences."
        )
    else:
        explanation = (
            "This exact address appears on OFAC's list of sanctioned digital "
            "currency addresses. Transacting with it may carry legal consequences "
            "for U.S. persons and entities."
        )

    return [
        make_signal(
            rule_id="sanctions.direct_hit",
            label="Address is on the OFAC SDN list",
            explanation=explanation,
            evidence={
                "matched_address": ctx.address,
                "entity": entity_name,
                "program": program,
                "listed_on": entity.get("listed_on"),
                "asset": "XBT",
                "list_size": ofac.count(),
            },
            source=ofac.source_dict(),
        )
    ]
