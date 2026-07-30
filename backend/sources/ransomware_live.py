"""ransomware.live group profiles — served from a snapshot, never live.

The anonymous free tier is rate-limited to one request per minute per endpoint.
That is fine for a nightly refresh and completely unusable at request time: two
analyses in a row would stall the demo for sixty seconds. So scripts/refresh_data.py
downloads all group profiles once into data/ransomware_live_groups.json and we
match against that.

Family names differ between datasets ("Conti" vs "conti" vs "Conti Ransomware"),
so matching is normalized and fuzzy at the edges.
"""

import json
import re
from datetime import datetime, timezone

from config import DATA_DIR

_groups: dict[str, dict] = {}  # normalized name -> profile
_retrieved_at: str | None = None
_loaded = False


def _normalize_name(name: str) -> str:
    name = (name or "").lower().strip()
    name = re.sub(r"\b(ransomware|group|gang|team|locker)\b", "", name)
    return re.sub(r"[^a-z0-9]", "", name)


def load() -> None:
    global _groups, _retrieved_at, _loaded

    path = DATA_DIR / "ransomware_live_groups.json"
    if not path.exists():
        _loaded = False
        return

    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        _loaded = False
        return

    entries = raw.get("groups", raw) if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        _loaded = False
        return

    groups = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or entry.get("group_name")
        if not name:
            continue
        key = _normalize_name(name)
        if not key:
            continue
        groups[key] = {
            "name": name,
            "description": (entry.get("description") or "").strip(),
            "victim_count": entry.get("victims") or entry.get("victim_count"),
            "first_seen": entry.get("first_seen") or entry.get("discovered"),
            "last_seen": entry.get("last_seen"),
            "url": f"https://www.ransomware.live/group/{name.lower()}",
        }

    _groups = groups
    _retrieved_at = datetime.fromtimestamp(
        path.stat().st_mtime, tz=timezone.utc
    ).isoformat()
    _loaded = True


def lookup(family: str | None) -> dict:
    """Exact-then-substring match on the normalized name. Returns {} on miss."""
    if not family:
        return {}
    key = _normalize_name(family)
    if not key:
        return {}
    if key in _groups:
        return _groups[key]
    for candidate, profile in _groups.items():
        if candidate and (candidate in key or key in candidate):
            return profile
    return {}


def count() -> int:
    return len(_groups)


def source_dict() -> dict:
    return {
        "name": "ransomware.live",
        "url": "https://www.ransomware.live/",
        "retrieved_at": _retrieved_at,
    }


def status() -> dict:
    return {"loaded": _loaded, "records": len(_groups), "retrieved_at": _retrieved_at}
