"""Disk cache. No expiry — this is a four-day project, staleness is not the enemy.

Rate limits and bad conference Wi-Fi are the enemy.
"""

import hashlib
import json
from typing import Any

from config import CACHE_DIR, FIXTURES_DIR


def _key(address: str, max_hops: int) -> str:
    return hashlib.sha256(f"{address}:{max_hops}".encode()).hexdigest()


def get(address: str, max_hops: int) -> dict[str, Any] | None:
    path = CACHE_DIR / f"{_key(address, max_hops)}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def put(address: str, max_hops: int, payload: dict[str, Any]) -> None:
    path = CACHE_DIR / f"{_key(address, max_hops)}.json"
    try:
        path.write_text(json.dumps(payload, indent=2))
    except OSError:
        pass  # a cache write failure must never break a response


def get_fixture(address: str, max_hops: int = 2) -> dict[str, Any] | None:
    """Fixtures are committed to git and are what OFFLINE_MODE serves."""
    for candidate in (
        FIXTURES_DIR / f"{address}.json",
        FIXTURES_DIR / f"{_key(address, max_hops)}.json",
    ):
        if candidate.exists():
            try:
                return json.loads(candidate.read_text())
            except (OSError, json.JSONDecodeError):
                continue
    return None


def put_fixture(address: str, payload: dict[str, Any]) -> None:
    (FIXTURES_DIR / f"{address}.json").write_text(json.dumps(payload, indent=2))
