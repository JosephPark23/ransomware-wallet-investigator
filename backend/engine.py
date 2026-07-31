"""The analysis engine. Its one hard promise: it always returns a response.

Every source failure becomes a warning and a `degraded: true` flag, never an
exception that reaches the client. A partial answer is a demo; an error page is
not. If you are tempted to let something raise here, don't — put it in warnings
and let the frontend render it.
"""

import traceback
import time
from datetime import datetime, timezone

import cache
from bitcoin import canonicalize
from config import MAX_ANALYSIS_SECONDS, MAX_HOPS, OFFLINE_MODE
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

def is_valid_bitcoin_address(address: str) -> bool:
    """Compatibility wrapper for callers that only need a boolean."""
    return canonicalize(address) is not None


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
        SourceUsed(
            name="OFAC SDN List",
            records=ofac.count(),
            retrieved_at=ofac.retrieved_at(),
            stale=ofac.status().get("stale"),
        ),
    ]
    if ransomwhere.count():
        used.append(
            SourceUsed(
                name="Ransomwhere",
                records=ransomwhere.count(),
                retrieved_at=ransomwhere.status()["retrieved_at"],
                stale=ransomwhere.status().get("stale"),
            )
        )
    if ransomware_live.count():
        used.append(
            SourceUsed(
                name="ransomware.live",
                records=ransomware_live.count(),
                retrieved_at=ransomware_live.status()["retrieved_at"],
                stale=ransomware_live.status().get("stale"),
            )
        )
    return used


def analyze(address: str, max_hops: int = MAX_HOPS, use_cache: bool = True) -> AnalyzeResponse:
    canonical = canonicalize(address)
    if canonical is None:
        return empty_response(
            (address or "").strip(),
            "That does not look like a valid Bitcoin address.",
        )
    with cache.key_lock(canonical, max_hops):
        return _analyze_locked(canonical, max_hops=max_hops, use_cache=use_cache)


def _analyze_locked(
    address: str, max_hops: int = MAX_HOPS, use_cache: bool = True
) -> AnalyzeResponse:
    max_hops = max(0, min(max_hops, MAX_HOPS))
    warnings: list[str] = []
    degraded = False
    for name, status in source_status().items():
        if name == "chain" or not isinstance(status, dict):
            continue
        if status.get("retrieved_at") is None:
            warnings.append(
                f"{name} snapshot has no recorded retrieval time."
            )
        elif status.get("stale"):
            warnings.append(f"{name} snapshot is stale; refresh before relying on this result.")
            degraded = True

    if OFFLINE_MODE:
        fixture = cache.get_fixture(address, max_hops)
        if fixture:
            fixture["cached"] = True
            return AnalyzeResponse(**fixture)

    if use_cache:
        cached = cache.get(address, max_hops)
        if cached:
            cached["cached"] = True
            cached_warnings = list(cached.get("warnings") or [])
            cached["warnings"] = list(dict.fromkeys([*cached_warnings, *warnings]))
            cached["degraded"] = bool(cached.get("degraded")) or degraded
            return AnalyzeResponse(**cached)

    budget = ApiBudget()
    deadline = time.monotonic() + MAX_ANALYSIS_SECONDS
    client = make_client(OFFLINE_MODE, budget, deadline=deadline)

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

        try:
            ctx = build_context(address, stats, txs)
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                f"Profile computation failed: {type(exc).__name__}; using an empty profile."
            )
            degraded = True
            ctx = build_context(address, None, [])

        graph_result = GraphResult()
        # `max_hops=0` means "do not explore counterparties", not "tell me
        # nothing about the address I asked about". traverse() handles 0
        # correctly on its own -- it seeds the target and never enters the
        # expansion loop -- so the guard only has to skip the call when there
        # are no transactions to walk. Guarding on max_hops too dropped the
        # target node from its own graph, leaving the UI with an empty panel
        # that reads as "no data" rather than "no counterparties explored".
        if txs:
            try:
                graph_result = traverse(
                    address, txs, client, max_hops=max_hops, deadline=deadline
                )
                warnings.extend(graph_result.warnings)
                if graph_result.truncated:
                    degraded = True
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"Counterparty traversal failed: {type(exc).__name__}.")
                degraded = True

        signals = []
        for module in RULE_MODULES:
            if time.monotonic() >= deadline:
                warnings.append(
                    "Analysis deadline reached; remaining rule modules were skipped."
                )
                degraded = True
                break
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

        try:
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
                sources_used=_safe_sources_used(warnings),
                warnings=warnings,
            )
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                f"Response validation failed: {type(exc).__name__}; partial results omitted."
            )
            return empty_response(address, warnings[-1], warnings=warnings)

        if use_cache and not degraded:
            cache.put(address, max_hops, response.model_dump())

        return response

    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass


def _safe_sources_used(warnings: list[str] | None = None) -> list[SourceUsed]:
    try:
        return _sources_used()
    except Exception as exc:  # noqa: BLE001
        if warnings is not None:
            warnings.append(f"Source provenance unavailable: {type(exc).__name__}.")
        return []


def empty_response(
    address: str, message: str, warnings: list[str] | None = None
) -> AnalyzeResponse:
    """Used for invalid input and total failure. Still contract-valid."""
    return AnalyzeResponse(
        address=address,
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        degraded=True,
        profile=Profile(),
        signals=[],
        sources_used=_safe_sources_used(warnings),
        warnings=list(warnings or []) if warnings else [message],
    )
