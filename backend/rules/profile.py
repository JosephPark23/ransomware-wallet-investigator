"""Behavioral transaction-profile rules. No list lookups — pure shape-of-activity.

Rule 5 — profile.collection_pattern    (severity 45, medium)
Rule 6 — profile.burst_then_dormant    (severity 40, medium)
Rule 7 — profile.round_value_payments  (severity 35, low)

These are the rules that fire on addresses appearing in no list anywhere, which
is the entire point of behavioral analysis. They are also the rules most likely
to produce a false positive on a benign exchange address — which is why one or
two benign controls belong in the demo set, and why a control scoring high is an
honest limitations finding rather than a bug to hide.
"""

from datetime import datetime, timedelta, timezone

from models import Signal
from rules.base import btc, make_signal

ROUND_VALUES = (0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0)
ROUND_TOLERANCE = 0.01  # ±1%

_HEURISTIC_SOURCE = {
    "name": "Behavioral heuristic (this tool)",
    "url": None,
    "retrieved_at": None,
}


def _collection_pattern(ctx) -> Signal | None:
    p = ctx.profile
    window_balance = p.window_received - p.window_sent
    near_zero = abs(window_balance) < max(0.001, p.window_received * 0.02)

    if not (
        p.window_unique_senders >= 10
        and p.window_unique_recipients <= 3
        and near_zero
    ):
        return None

    return make_signal(
        rule_id="profile.collection_pattern",
        label="Funnel pattern: many senders, few recipients, drained balance",
        explanation=(
            f"In the analyzed transaction window, this address received funds from "
            f"{p.window_unique_senders} distinct senders but paid out to only "
            f"{p.window_unique_recipients}, and the window has a near-zero net balance "
            f"({btc(window_balance)}). That many-in, few-out, drained shape is characteristic "
            f"of a collection or consolidation wallet rather than personal use. It is "
            f"also normal for some exchange deposit and donation addresses, so treat it "
            f"as supporting evidence, not proof."
        ),
        evidence={
            "window_unique_senders": p.window_unique_senders,
            "window_unique_recipients": p.window_unique_recipients,
            "window_balance": round(window_balance, 8),
            "window_received": p.window_received,
            "threshold": "≥10 senders, ≤3 recipients, balance under 2% of receipts",
        },
        source=_HEURISTIC_SOURCE,
    )


def _burst_then_dormant(ctx) -> Signal | None:
    if not ctx.profile.window_complete:
        return None
    dated = [i for i in ctx.incoming if i.get("timestamp")]
    if len(dated) < 3:
        return None

    dated.sort(key=lambda i: i["timestamp"])
    total = sum(i["amount"] for i in dated)
    if total <= 0:
        return None

    # Sliding 30-day window holding the largest share of received value.
    best = {"share": 0.0, "start": None, "end": None, "count": 0}
    for idx, start in enumerate(dated):
        cutoff = start["timestamp"] + timedelta(days=30)
        window = [i for i in dated[idx:] if i["timestamp"] <= cutoff]
        share = sum(i["amount"] for i in window) / total
        if share > best["share"]:
            best = {
                "share": share,
                "start": start["timestamp"],
                "end": window[-1]["timestamp"],
                "count": len(window),
            }

    if best["share"] < 0.8:
        return None

    dormancy = max(0, (datetime.now(timezone.utc) - best["end"]).days)
    if dormancy < 90:
        return None

    return make_signal(
        rule_id="profile.burst_then_dormant",
        label="Concentrated burst of receipts, then dormancy",
        explanation=(
            f"{best['share'] * 100:.0f}% of value in the complete analyzed history arrived "
            f"in a single 30-day window ({best['count']} payments starting "
            f"{best['start'].date()}), and the address has been inactive for "
            f"{dormancy} days as of this analysis. "
            f"Short intense collection followed by abandonment is a common shape for "
            f"campaign-specific payment addresses."
        ),
        evidence={
            "window_share": round(best["share"], 4),
            "window_start": best["start"].isoformat(),
            "window_end": best["end"].isoformat(),
            "payments_in_window": best["count"],
            "dormant_days": dormancy,
            "threshold": "≥80% of value in ≤30 days, then ≥90 days inactive",
        },
        source=_HEURISTIC_SOURCE,
    )


def _round_value_payments(ctx) -> Signal | None:
    matches = []
    for item in ctx.incoming:
        amount = item["amount"]
        for target in ROUND_VALUES:
            if abs(amount - target) <= target * ROUND_TOLERANCE:
                matches.append(
                    {
                        "txid": item["tx"].get("txid"),
                        "amount": amount,
                        "matched_value": target,
                        "timestamp": item["tx"].get("timestamp"),
                    }
                )
                break

    share = len(matches) / len(ctx.incoming) if ctx.incoming else 0.0
    if len(matches) < 3 or share < 0.3:
        return None

    values = sorted({m["matched_value"] for m in matches})
    return make_signal(
        rule_id="profile.round_value_payments",
        label=f"{len(matches)} incoming payments at round BTC amounts",
        explanation=(
            f"{len(matches)} separate incoming transactions landed within 1% of a round "
            f"figure ({', '.join(btc(v) for v in values)}). Organic payments rarely "
            f"cluster on round numbers; demanded amounts often do. This is a weak "
            f"indicator on its own and is flagged as low confidence."
        ),
        evidence={
            "matches": matches[:10],
            "match_count": len(matches),
            "match_share": round(share, 4),
            "round_values_checked": list(ROUND_VALUES),
            "tolerance": "±1%",
        },
        source=_HEURISTIC_SOURCE,
    )


def evaluate(ctx, graph_result=None) -> list[Signal]:
    if not ctx.has_chain_data():
        return []
    found = [
        _collection_pattern(ctx),
        _burst_then_dormant(ctx),
        _round_value_payments(ctx),
    ]
    return [s for s in found if s is not None]
