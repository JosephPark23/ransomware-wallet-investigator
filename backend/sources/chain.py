"""Bitcoin chain data via the Esplora API (mempool.space, blockstream.info fallback).

Both hosts speak the same paths, so failover is a base-URL swap.

Everything returned by this module is normalized into a plain dict shape that
the rules consume. The rules never see Esplora's field names. That matters: when
a host changes its schema, exactly one file breaks.

Normalized transaction:
    {
      "txid": str,
      "timestamp": ISO-8601 str | None,
      "block_time": int | None,
      "inputs":  [{"address": str | None, "value": float BTC}],
      "outputs": [{"address": str | None, "value": float BTC}],
      "fee": float BTC,
    }
"""

import json
import threading
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from bitcoin import canonicalize
from config import (
    CHAIN_API_BASE,
    CHAIN_API_FALLBACK,
    CHAIN_REQUEST_DELAY,
    CHAIN_TIMEOUT,
    FIXTURES_DIR,
    MAX_API_CALLS_PER_ANALYSIS,
    MAX_TXS_PER_ADDRESS,
    SATS_PER_BTC,
)

_THROTTLE_LOCK = threading.Lock()
_LAST_CALL = 0.0


class BudgetExceeded(Exception):
    """Raised when an analysis has spent its API call allowance."""


class DeadlineExceeded(Exception):
    """Raised when the analysis wall-clock deadline has elapsed."""


class ApiBudget:
    """One per analysis. Hard-stops fan-out before it hangs the demo."""

    def __init__(self, limit: int = MAX_API_CALLS_PER_ANALYSIS):
        self.limit = limit
        self.used = 0

    def spend(self, n: int = 1) -> None:
        if self.used + n > self.limit:
            raise BudgetExceeded(
                f"API call budget exhausted ({self.limit} calls)"
            )
        self.used += n

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def _sats_to_btc(sats) -> float:
    try:
        return round(int(sats) / SATS_PER_BTC, 8)
    except (TypeError, ValueError):
        return 0.0


def _iso(block_time) -> str | None:
    if not block_time:
        return None
    try:
        return datetime.fromtimestamp(int(block_time), tz=timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


def _normalize_tx(raw: dict) -> dict:
    status = raw.get("status") or {}
    block_time = status.get("block_time")

    inputs = []
    for vin in raw.get("vin") or []:
        prevout = vin.get("prevout") or {}
        inputs.append(
            {
                "address": prevout.get("scriptpubkey_address"),
                "value": _sats_to_btc(prevout.get("value")),
            }
        )

    outputs = [
        {
            "address": vout.get("scriptpubkey_address"),
            "value": _sats_to_btc(vout.get("value")),
        }
        for vout in raw.get("vout") or []
    ]

    return {
        "txid": raw.get("txid", ""),
        "timestamp": _iso(block_time),
        "block_time": block_time,
        "inputs": inputs,
        "outputs": outputs,
        "fee": _sats_to_btc(raw.get("fee")),
    }


class ChainClient:
    """Live Esplora client."""

    def __init__(
        self,
        base_url: str = CHAIN_API_BASE,
        budget: ApiBudget | None = None,
        deadline: float | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.fallback_url = CHAIN_API_FALLBACK.rstrip("/")
        self.budget = budget or ApiBudget()
        self.deadline = deadline
        self._client = httpx.Client(
            timeout=CHAIN_TIMEOUT, headers={"User-Agent": "cs4cs-rwri/1.0"}
        )
        self._host_failed = False

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _throttle(self) -> None:
        global _LAST_CALL
        with _THROTTLE_LOCK:
            elapsed = time.monotonic() - _LAST_CALL
            if elapsed < CHAIN_REQUEST_DELAY:
                time.sleep(CHAIN_REQUEST_DELAY - elapsed)
            _LAST_CALL = time.monotonic()

    def _timeout(self) -> float:
        if self.deadline is None:
            return CHAIN_TIMEOUT
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise DeadlineExceeded("Analysis deadline reached")
        return min(CHAIN_TIMEOUT, max(0.5, remaining))

    def _get(self, path: str):
        """Returns parsed JSON, or None on any failure. Never raises except BudgetExceeded."""
        base = self.fallback_url if self._host_failed else self.base_url

        for attempt, host in enumerate((base, self.fallback_url)):
            if attempt == 1 and host == base:
                break  # already tried this host
            self.budget.spend()
            self._throttle()
            try:
                response = self._client.get(f"{host}{path}", timeout=self._timeout())
                if response.status_code == 200:
                    return response.json()
                if response.status_code in (429, 502, 503, 504):
                    self._host_failed = True
                    continue
                return None
            except (httpx.HTTPError, json.JSONDecodeError, ValueError):
                self._host_failed = True
                continue
        return None

    def address_stats(self, address: str) -> dict | None:
        address = canonicalize(address)
        if address is None:
            return None
        return self._get(f"/address/{quote(address, safe='')}")

    def address_txs(self, address: str, limit: int = MAX_TXS_PER_ADDRESS) -> list[dict]:
        """Normalized transactions, newest first. Pages only as far as `limit`."""
        address = canonicalize(address)
        if address is None:
            return []
        encoded = quote(address, safe="")
        raw = self._get(f"/address/{encoded}/txs")
        if not isinstance(raw, list):
            return []
        txs = [_normalize_tx(t) for t in raw]

        # One extra page if the budget allows and we still want more.
        if len(txs) < limit and len(raw) >= 25 and self.budget.remaining > 5:
            last = txs[-1]["txid"]
            more = self._get(f"/address/{encoded}/txs/chain/{quote(last, safe='')}")
            if isinstance(more, list):
                txs.extend(_normalize_tx(t) for t in more)

        return txs[:limit]

    def bundle(self, address: str) -> tuple[dict | None, list[dict], list[str]]:
        """Everything we need about one address, plus any warnings to surface."""
        address = canonicalize(address)
        if address is None:
            return None, [], ["Rejected malformed counterparty address from chain data."]
        warnings: list[str] = []
        stats = self.address_stats(address)
        if stats is None:
            warnings.append(
                f"Could not retrieve chain statistics for {address[:12]}…; "
                "profile may be incomplete."
            )
        txs = self.address_txs(address)
        total_txs = sum(
            (stats.get(scope) or {}).get("tx_count", 0)
            for scope in ("chain_stats", "mempool_stats")
        ) if stats else 0
        if not txs and total_txs:
            warnings.append(
                "Blockchain API returned partial transaction history; "
                "graph may be incomplete."
            )
        elif total_txs > len(txs):
            warnings.append(
                f"Analysis covers the {len(txs)} most recent transactions of "
                f"{total_txs} total; profile figures marked 'window' describe "
                "that sample, not the full history."
            )
        return stats, txs, warnings


class OfflineChainClient:
    """Replays committed chain fixtures. Zero network. What OFFLINE_MODE uses."""

    def __init__(self, budget: ApiBudget | None = None):
        self.budget = budget or ApiBudget()
        self._dir = FIXTURES_DIR / "chain"
        self._dir.mkdir(parents=True, exist_ok=True)

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def _load(self, address: str) -> dict | None:
        address = canonicalize(address)
        if address is None:
            return None
        root = self._dir.resolve()
        path = (root / f"{address}.json").resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return None
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def address_stats(self, address: str) -> dict | None:
        blob = self._load(address)
        return blob.get("stats") if blob else None

    def address_txs(self, address: str, limit: int = MAX_TXS_PER_ADDRESS) -> list[dict]:
        blob = self._load(address)
        if not blob:
            return []
        return blob.get("txs", [])[:limit]

    def bundle(self, address: str) -> tuple[dict | None, list[dict], list[str]]:
        address = canonicalize(address)
        if address is None:
            return None, [], ["Rejected malformed counterparty address from fixture data."]
        blob = self._load(address)
        if blob is None:
            return None, [], [
                f"No offline chain data for {address[:12]}…; "
                "run scripts/warm_cache.py while online."
            ]
        stats = blob.get("stats")
        txs = blob.get("txs", [])[:MAX_TXS_PER_ADDRESS]
        total_txs = sum(
            (stats.get(scope) or {}).get("tx_count", 0)
            for scope in ("chain_stats", "mempool_stats")
        ) if stats else len(txs)
        warnings = []
        if total_txs > len(txs):
            warnings.append(
                f"Analysis covers the {len(txs)} most recent transactions of "
                f"{total_txs} total; profile figures marked 'window' describe "
                "that sample, not the full history."
            )
        return stats, txs, warnings


def save_chain_fixture(address: str, stats: dict | None, txs: list[dict]) -> None:
    """Called by warm_cache.py so OfflineChainClient has something to replay."""
    path = FIXTURES_DIR / "chain"
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{address}.json").write_text(
        json.dumps({"stats": stats, "txs": txs}, indent=2)
    )


def make_client(
    offline: bool, budget: ApiBudget | None = None, deadline: float | None = None
):
    return (
        OfflineChainClient(budget)
        if offline
        else ChainClient(budget=budget, deadline=deadline)
    )
