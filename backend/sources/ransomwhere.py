"""Ransomwhere crowdsourced ransomware payment addresses.

Loaded from data/ransomwhere.json, downloaded once by scripts/refresh_data.py.
Do not fetch this on every request: it is a multi-megabyte export and hammering
someone's free research API from a demo laptop is both slow and rude.

The export shape has drifted between versions, so every accessor here is
defensive. We accept either a bare list or a {"result": [...]} envelope, and
treat every field as optional.
"""

import json
from datetime import datetime, timezone

from bitcoin import canonicalize
from config import DATA_DIR, RANSOMWHERE_EXPORT_URL
from sources import manifest

# address -> {family, balance, first_seen, last_seen, tx_count}
_by_address: dict[str, dict] = {}
_families: dict[str, int] = {}
_retrieved_at: str | None = None
_loaded = False


def _normalize(raw) -> list[dict]:
    if isinstance(raw, dict):
        for key in ("result", "results", "data", "addresses"):
            if isinstance(raw.get(key), list):
                return raw[key]
        return []
    return raw if isinstance(raw, list) else []


def _parse_ts(value) -> str | None:
    """Ransomwhere has used ISO strings and unix seconds in different versions."""
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except (ValueError, OSError, OverflowError):
            return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def load() -> None:
    global _by_address, _families, _retrieved_at, _loaded
    _by_address, _families, _retrieved_at, _loaded = {}, {}, None, False

    path = DATA_DIR / "ransomwhere.json"
    if not path.exists():
        _loaded = False
        return

    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        _loaded = False
        return

    entries = _normalize(raw)
    by_address: dict[str, dict] = {}
    families: dict[str, int] = {}

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        address = canonicalize(entry.get("address") or entry.get("addr"))
        if not address:
            continue

        blockchain = (entry.get("blockchain") or "bitcoin").lower()
        if blockchain not in ("bitcoin", "btc", ""):
            continue  # Bitcoin only — multi-chain is Future Work on the poster

        family = entry.get("family") or entry.get("ransomware") or "Unknown"
        txs = entry.get("transactions") or []
        times = [t.get("time") for t in txs if isinstance(t, dict) and t.get("time")]
        parsed = [p for p in (_parse_ts(t) for t in times) if p]

        by_address[address] = {
            "family": family,
            "balance": entry.get("balance"),
            "tx_count": len(txs),
            "first_seen": min(parsed) if parsed else _parse_ts(entry.get("createdAt")),
            "last_seen": max(parsed) if parsed else _parse_ts(entry.get("updatedAt")),
        }
        families[family] = families.get(family, 0) + 1

    _by_address = by_address
    _families = families
    _retrieved_at = manifest.retrieved_at(path.name)
    _loaded = True


def is_known(address: str) -> bool:
    canonical = canonicalize(address)
    return bool(canonical and canonical in _by_address)


def lookup(address: str) -> dict:
    canonical = canonicalize(address)
    return _by_address.get(canonical, {}) if canonical else {}


def family_for(address: str) -> str | None:
    return lookup(address).get("family")


def sample_addresses(family: str | None = None, limit: int = 10) -> list[str]:
    """Used by scripts/pick_demo_addresses.py to curate the demo set."""
    out = []
    for address, meta in _by_address.items():
        if family and meta.get("family") != family:
            continue
        out.append(address)
        if len(out) >= limit:
            break
    return out


def families() -> dict[str, int]:
    return dict(sorted(_families.items(), key=lambda kv: -kv[1]))


def count() -> int:
    return len(_by_address)


def source_dict() -> dict:
    return {
        "name": "Ransomwhere",
        "url": RANSOMWHERE_EXPORT_URL,
        "retrieved_at": _retrieved_at,
        "stale": manifest.stale("ransomwhere.json"),
    }


def status() -> dict:
    return {
        "loaded": _loaded,
        "records": len(_by_address),
        "families": len(_families),
        "retrieved_at": _retrieved_at,
        "stale": manifest.stale("ransomwhere.json"),
    }
