"""The analysis engine. Its one hard promise: it always returns a response.

Every source failure becomes a warning and a `degraded: true` flag, never an
exception that reaches the client. A partial answer is a demo; an error page is
not. If you are tempted to let something raise here, don't — put it in warnings
and let the frontend render it.
"""

import re
import traceback
from datetime import datetime, timezone

import cache
from config import MAX_HOPS, OFFLINE_MODE
from graph import GraphResult, traverse
from models import AnalyzeResponse, Profile, SourceUsed
from profiling import build_context
from rules import counterparty as counterparty_rules
from rules import obfuscation as obfuscation_rules
from rules import profile as profile_rules
from rules import ransomware as ransomware_rules
from rules import sanctions as sanctions_rules
from sources import ofac, ransomware_live, ransomwhere
from sources.chain import ApiBudget, make_client

RULE_MODULES = (
    sanctions_rules,
    ransomware_rules,
    counterparty_rules,
    profile_rules,
    obfuscation_rules,
)

_BASE58 = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,39}$")
_BECH32 = re.compile(r"^bc1[a-z0-9]{11,71}$")


def is_valid_bitcoin_address(address: str) -> bool:
    """Format check only — no checksum. Catches typos, not forgeries."""
    address = (address or "").strip()
    return bool(_BASE58.match(address) or _BECH32.match(address.lower()))


def load_all_sources() -> None:
    """Called once at startup. Everything is read from disk, nothing is fetched."""
    ofac.load()
    ransomwhere.load()
    ransomware_live.load()


def source_status() -> dict:
    return {
        "ofac": ofac.status(),
        "ransomwhere": ransomwhere.status(),
        "ransomware_live": ransomware_live.status(),
        "chain": {
            "mode": "offline (fixtures)" if OFFLINE_MODE else "live (Esplora)",
        },
    }


def _sources_used() -> list[SourceUsed]:
    used = [
        SourceUsed(name="OFAC SDN List", records=ofac.count(), retrieved_at=ofac.retrieved_at()),
    ]
    if ransomwhere.count():
        used.append(
            SourceUsed(
                name="Ransomwhere",
                records=ransomwhere.count(),
                retrieved_at=ransomwhere.status()["retrieved_at"],
            )
        )
    if ransomware_live.count():
        used.append(
            SourceUsed(
                name="ransomware.live",
                records=ransomware_live.count(),
                retrieved_at=ransomware_live.status()["retrieved_at"],
            )
        )
    return used


def analyze(address: str, max_hops: int = MAX_HOPS, use_cache: bool = True) -> AnalyzeResponse:
    address = (address or "").strip()
    max_hops = max(0, min(max_hops, MAX_HOPS))
    warnings: list[str] = []
    degraded = False

    if OFFLINE_MODE:
        fixture = cache.get_fixture(address, max_hops)
        if fixture:
            fixture["cached"] = True
            return AnalyzeResponse(**fixture)

    if use_cache:
        cached = cache.get(address, max_hops)
        if cached:
            cached["cached"] = True
            return AnalyzeResponse(**cached)

    budget = ApiBudget()
    client = make_client(OFFLINE_MODE, budget)

    try:
        try:
            stats, txs, chain_warnings = client.bundle(address)
            warnings.extend(chain_warnings)
            if chain_warnings:
                degraded = True
        except Exception as exc:  # noqa: BLE001 — nothing may escape
            stats, txs = None, []
            warnings.append(f"Blockchain lookup failed: {type(exc).__name__}.")
            degraded = True

        ctx = build_context(address, stats, txs)

        graph_result = GraphResult()
        if max_hops > 0 and txs:
            try:
                graph_result = traverse(address, txs, client, max_hops=max_hops)
                warnings.extend(graph_result.warnings)
                if graph_result.truncated:
                    degraded = True
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"Counterparty traversal failed: {type(exc).__name__}.")
                degraded = True

        signals = []
        for module in RULE_MODULES:
            try:
                signals.extend(module.evaluate(ctx, graph_result))
            except Exception:  # noqa: BLE001 — one broken rule must not kill the rest
                warnings.append(
                    f"Rule module '{module.__name__}' failed and was skipped."
                )
                degraded = True
                traceback.print_exc()

        # Highest severity first; the frontend re-sorts by weighted contribution.
        signals.sort(key=lambda s: -s.severity)

        response = AnalyzeResponse(
            address=address,
            chain="bitcoin",
            analyzed_at=datetime.now(timezone.utc).isoformat(),
            cached=False,
            degraded=degraded,
            profile=ctx.profile,
            signals=signals,
            graph={"nodes": graph_result.nodes, "edges": graph_result.edges},
            taint_paths=graph_result.taint_paths,
            sources_used=_sources_used(),
            warnings=warnings,
        )

        if use_cache and not degraded:
            cache.put(address, max_hops, response.model_dump())

        return response

    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass


def empty_response(address: str, message: str) -> AnalyzeResponse:
    """Used for invalid input and total failure. Still contract-valid."""
    return AnalyzeResponse(
        address=address,
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        degraded=True,
        profile=Profile(),
        signals=[],
        sources_used=_sources_used(),
        warnings=[message],
    )
