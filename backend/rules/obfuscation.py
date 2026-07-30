"""Obfuscation rules.

Rule 8 — obfuscation.peel_chain    (severity 50, medium)
Rule 9 — obfuscation.rapid_forward (severity 35, medium)

A peel chain is the classic laundering shape: a large balance moves along a
chain of transactions, shedding a small amount at each step while the bulk
carries forward. We detect the local signature of it — transactions with exactly
two outputs, one large and one small — rather than trying to walk the whole
chain, which would blow the API budget.
"""

from datetime import timedelta

from models import Signal
from rules.base import btc, make_signal

PEEL_RATIO = 0.85  # larger output holds ≥85% of the value
PEEL_MIN_LINKS = 4
RAPID_FORWARD_WINDOW = timedelta(hours=1)
RAPID_FORWARD_SHARE = 0.6

_HEURISTIC_SOURCE = {
    "name": "Behavioral heuristic (this tool)",
    "url": None,
    "retrieved_at": None,
}


def _looks_like_peel(tx: dict) -> dict | None:
    outputs = [o for o in tx.get("outputs", []) if o.get("value", 0) > 0]
    if len(outputs) != 2:
        return None
    total = sum(o["value"] for o in outputs)
    if total <= 0:
        return None
    large, small = sorted(outputs, key=lambda o: -o["value"])
    if large["value"] / total < PEEL_RATIO:
        return None
    return {
        "txid": tx.get("txid"),
        "timestamp": tx.get("timestamp"),
        "carried_forward": large["value"],
        "peeled_off": small["value"],
        "carry_ratio": round(large["value"] / total, 4),
    }


def _peel_chain(ctx) -> Signal | None:
    links = []
    for tx in ctx.txs:
        link = _looks_like_peel(tx)
        if link:
            links.append(link)

    if len(links) < PEEL_MIN_LINKS:
        return None

    return make_signal(
        rule_id="obfuscation.peel_chain",
        label=f"Peel-chain signature across {len(links)} transactions",
        explanation=(
            f"{len(links)} transactions involving this address each split funds into one "
            f"large and one small output, with the large output carrying at least "
            f"{PEEL_RATIO * 100:.0f}% of the value forward. Repeated, this pattern is a "
            f"peel chain: a laundering technique that sheds small amounts at each step "
            f"while the bulk moves on, making the trail tedious to follow manually."
        ),
        evidence={
            "links": links[:10],
            "link_count": len(links),
            "threshold": f"≥{PEEL_MIN_LINKS} transactions with one output holding "
            f"≥{PEEL_RATIO * 100:.0f}% of value",
        },
        source=_HEURISTIC_SOURCE,
    )


def _rapid_forward(ctx) -> Signal | None:
    dated_in = [i for i in ctx.incoming if i.get("timestamp")]
    dated_out = [o for o in ctx.outgoing if o.get("timestamp")]
    if not dated_in or not dated_out:
        return None

    total_received = sum(i["amount"] for i in dated_in)
    if total_received <= 0:
        return None

    forwarded = 0.0
    examples = []
    for receipt in dated_in:
        window_end = receipt["timestamp"] + RAPID_FORWARD_WINDOW
        for spend in dated_out:
            if receipt["timestamp"] <= spend["timestamp"] <= window_end:
                forwarded += min(receipt["amount"], spend["amount"])
                if len(examples) < 5:
                    delay = (spend["timestamp"] - receipt["timestamp"]).total_seconds()
                    examples.append(
                        {
                            "received_tx": receipt["tx"].get("txid"),
                            "forwarded_tx": spend["tx"].get("txid"),
                            "amount": round(min(receipt["amount"], spend["amount"]), 8),
                            "delay_minutes": round(delay / 60, 1),
                        }
                    )
                break

    share = forwarded / total_received
    if share < RAPID_FORWARD_SHARE:
        return None

    return make_signal(
        rule_id="obfuscation.rapid_forward",
        label=f"{share * 100:.0f}% of received funds forwarded within one hour",
        explanation=(
            f"Roughly {btc(forwarded)} of the {btc(total_received)} this address received "
            f"was sent onward within an hour of arriving. Pass-through behaviour like this "
            f"suggests the address is a relay rather than a destination — typical of "
            f"automated laundering infrastructure, though also of custodial hot wallets."
        ),
        evidence={
            "forwarded_value": round(forwarded, 8),
            "total_received": round(total_received, 8),
            "forwarded_share": round(share, 4),
            "examples": examples,
            "threshold": "≥60% of received value forwarded within 1 hour",
        },
        source=_HEURISTIC_SOURCE,
    )


def evaluate(ctx, graph_result=None) -> list[Signal]:
    if not ctx.has_chain_data():
        return []
    found = [_peel_chain(ctx), _rapid_forward(ctx)]
    return [s for s in found if s is not None]
