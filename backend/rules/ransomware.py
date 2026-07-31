"""Ransomware rules.

Rule 2  — ransomware.known_address  (severity 95, high)
Rule 10 — ransomware.group_context  (severity 0, medium; informational)

Rule 10 is the enrichment story in miniature: the address match tells you *that*
it is ransomware, the group profile tells you *who* and *what they do*. Low
severity on purpose — the context does not itself make the address riskier, it
makes the finding legible. Say that out loud at the poster; someone will ask why
a ransomware signal is only worth 20.
"""

from models import Signal
from rules.base import make_signal
from sources import ransomware_live, ransomwhere


def evaluate(ctx, graph_result=None) -> list[Signal]:
    signals: list[Signal] = []

    if not ransomwhere.is_known(ctx.address):
        return signals

    record = ransomwhere.lookup(ctx.address)
    family = record.get("family") or "an unidentified family"

    signals.append(
        make_signal(
            rule_id="ransomware.known_address",
            label=f"Known ransomware payment address ({family})",
            explanation=(
                f"This address appears in the Ransomwhere crowdsourced dataset of "
                f"confirmed ransomware payment addresses, attributed to the {family} "
                f"family. Reports in that dataset require a screenshot of the ransom "
                f"demand and are reviewed before publication."
            ),
            evidence={
                "matched_address": ctx.address,
                "family": record.get("family"),
                "reported_transactions": record.get("tx_count"),
                "first_reported_payment": record.get("first_seen"),
                "last_reported_payment": record.get("last_seen"),
                "dataset_size": ransomwhere.count(),
            },
            source=ransomwhere.source_dict(),
        )
    )

    profile = ransomware_live.lookup(record.get("family"))
    if profile:
        description = profile.get("description") or ""
        gloss = description[:400].strip()
        victim_count = profile.get("victim_count")
        explanation = (
            f"The {profile['name']} family has a tracked group profile on "
            f"ransomware.live"
            + (f", with {victim_count} recorded victims" if victim_count else "")
            + ". "
            + (gloss if gloss else "This provides operational context for the attribution.")
        )
        signals.append(
            make_signal(
                rule_id="ransomware.group_context",
                label=f"Group intelligence available for {profile['name']}",
                explanation=explanation,
                evidence={
                    "group": profile["name"],
                    "matched_from_family": record.get("family"),
                    "victim_count": victim_count,
                    "first_seen": profile.get("first_seen"),
                    "last_seen": profile.get("last_seen"),
                    "profile_url": profile.get("url"),
                },
                source=ransomware_live.source_dict(),
            )
        )

    return signals
