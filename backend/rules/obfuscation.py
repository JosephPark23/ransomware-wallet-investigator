"""Obfuscation rules.

Rule 8 — obfuscation.self_peel     (severity 35, low)
Rule 9 — obfuscation.rapid_forward (severity 35, medium)

This bounded rule detects repeated dominant-output self-change spends by the
analyzed address. It does not claim to follow a classic multi-address peel chain
beyond the address-local transaction window.
"""

from datetime import datetime, timedelta, timezone

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
        "carry_address": large.get("address"),
        "peeled_off": small["value"],
        "carry_ratio": round(large["value"] / total, 4),
    }


def _peel_chain(ctx) -> Signal | None:
    ordered = sorted(
        ctx.outgoing,
        key=lambda item: item.get("timestamp")
        or datetime.min.replace(tzinfo=timezone.utc),
    )
    runs: list[list[dict]] = []
    current_run: list[dict] = []
    for item in ordered:
        link = _looks_like_peel(item["tx"])
        if link is None or link["carry_address"] != ctx.address:
            if current_run:
                runs.append(current_run)
                current_run = []
            continue
        if not current_run:
            current_run = [link]
            continue

        previous = current_run[-1]
        next_inputs = {
            tx_input.get("address") for tx_input in item["tx"].get("inputs", [])
        }
        comparable = (
            link["carried_forward"] <= previous["carried_forward"]
            and link["carried_forward"] >= previous["carried_forward"] * 0.5
        )
        if previous["carry_address"] in next_inputs and comparable:
            current_run.append(link)
        else:
            runs.append(current_run)
            current_run = [link]
    if current_run:
        runs.append(current_run)
    links = max(runs, key=len, default=[])

    if len(links) < PEEL_MIN_LINKS:
        return None

    return make_signal(
        rule_id="obfuscation.self_peel",
        label=f"Repeated dominant-output self-change across {len(links)} transactions",
        explanation=(
            f"{len(links)} contiguous spends by this address each split funds into one "
            f"large self-change output and one small output, with the self-change "
            f"retaining at least {PEEL_RATIO * 100:.0f}% of value. This address-local "
            "pattern can resemble incremental fund peeling, but does not establish a "
            "multi-address peel chain."
        ),
        evidence={
            "links": links[:10],
            "link_count": len(links),
            "threshold": f"≥{PEEL_MIN_LINKS} contiguous self-change spends with one "
            f"output holding ≥{PEEL_RATIO * 100:.0f}% of value",
        },
        source=_HEURISTIC_SOURCE,
    )


def _rapid_forward(ctx) -> Signal | None:
    dated_in = sorted(
        [i for i in ctx.incoming if i.get("timestamp")],
        key=lambda item: item["timestamp"],
    )
    dated_out = sorted(
        [o for o in ctx.outgoing if o.get("timestamp")],
        key=lambda item: item["timestamp"],
    )
    if not dated_in or not dated_out:
        return None

    total_received = sum(i["amount"] for i in dated_in)
    if total_received <= 0:
        return None

    forwarded = 0.0
    examples = []
    capacity = {id(spend): spend["amount"] for spend in dated_out}
    for receipt in dated_in:
        remaining = receipt["amount"]
        window_end = receipt["timestamp"] + RAPID_FORWARD_WINDOW
        for spend in dated_out:
            if not (receipt["timestamp"] <= spend["timestamp"] <= window_end):
                continue
            take = min(remaining, capacity[id(spend)])
            if take <= 0:
                continue
            forwarded += take
            capacity[id(spend)] -= take
            remaining -= take
            if len(examples) < 5:
                delay = (spend["timestamp"] - receipt["timestamp"]).total_seconds()
                examples.append(
                    {
                        "received_tx": receipt["tx"].get("txid"),
                        "forwarded_tx": spend["tx"].get("txid"),
                        "amount": round(take, 8),
                        "delay_minutes": round(delay / 60, 1),
                    }
                )
            if remaining <= 0:
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
