"""Read provenance written by ``scripts/refresh_data.py``."""

import json
from datetime import datetime, timezone

from config import DATA_DIR, SOURCE_MAX_AGE_DAYS


def metadata(filename: str) -> dict:
    path = DATA_DIR / "manifest.json"
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    entry = raw.get("sources", {}).get(filename, {})
    return entry if isinstance(entry, dict) else {}


def retrieved_at(filename: str) -> str | None:
    value = metadata(filename).get("retrieved_at")
    return value if isinstance(value, str) and value else None


def stale(filename: str) -> bool | None:
    value = retrieved_at(filename)
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - parsed).days > SOURCE_MAX_AGE_DAYS
