"""Bounded, expiring, source-aware disk cache."""

import hashlib
import json
import os
import threading
import time
from contextlib import contextmanager
from typing import Any

from config import (
    CACHE_DIR,
    CACHE_MAX_ENTRIES,
    CACHE_TTL_SECONDS,
    DATA_DIR,
    FIXTURES_DIR,
)

_fingerprint_signature: tuple[tuple[str, int, int], ...] | None = None
_fingerprint_value = ""
_lock_guard = threading.Lock()
_key_locks: dict[str, tuple[threading.Lock, int]] = {}


def _source_fingerprint() -> str:
    """Hash loaded intelligence snapshots so refreshes invalidate old results."""
    global _fingerprint_signature, _fingerprint_value
    paths = sorted(
        path
        for path in DATA_DIR.iterdir()
        if path.is_file() and path.name != "calibration_cohorts.json"
    )
    signature = tuple(
        (path.name, path.stat().st_size, path.stat().st_mtime_ns) for path in paths
    )
    if signature == _fingerprint_signature:
        return _fingerprint_value
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    _fingerprint_signature = signature
    _fingerprint_value = digest.hexdigest()
    return _fingerprint_value


def _key(address: str, max_hops: int) -> str:
    raw = f"{address}:{max_hops}:{_source_fingerprint()}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _fixture_key(address: str, max_hops: int) -> str:
    return hashlib.sha256(f"{address}:{max_hops}".encode()).hexdigest()


@contextmanager
def key_lock(address: str, max_hops: int):
    """Serialize identical analyses so only one request performs traversal."""
    key = _key(address, max_hops)
    with _lock_guard:
        lock, users = _key_locks.get(key, (threading.Lock(), 0))
        _key_locks[key] = (lock, users + 1)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
        with _lock_guard:
            current_lock, users = _key_locks.get(key, (lock, 1))
            if current_lock is lock and users <= 1:
                _key_locks.pop(key, None)
            elif current_lock is lock:
                _key_locks[key] = (lock, users - 1)


def get(address: str, max_hops: int) -> dict[str, Any] | None:
    path = CACHE_DIR / f"{_key(address, max_hops)}.json"
    if not path.exists():
        return None
    try:
        if time.time() - path.stat().st_mtime > CACHE_TTL_SECONDS:
            return None
    except OSError:
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def put(address: str, max_hops: int, payload: dict[str, Any]) -> None:
    path = CACHE_DIR / f"{_key(address, max_hops)}.json"
    tmp = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2))
        os.replace(tmp, path)
        entries = sorted(
            CACHE_DIR.glob("*.json"),
            key=lambda candidate: candidate.stat().st_mtime,
            reverse=True,
        )
        for stale in entries[CACHE_MAX_ENTRIES:]:
            stale.unlink(missing_ok=True)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def get_fixture(address: str, max_hops: int = 2) -> dict[str, Any] | None:
    """Fixtures are committed to git and are what OFFLINE_MODE serves."""
    root = FIXTURES_DIR.resolve()
    for candidate in (
        root / f"{address}.json",
        root / f"{_fixture_key(address, max_hops)}.json",
    ):
        candidate = candidate.resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        if candidate.exists():
            try:
                return json.loads(candidate.read_text())
            except (OSError, json.JSONDecodeError):
                continue
    return None


def put_fixture(address: str, payload: dict[str, Any]) -> None:
    (FIXTURES_DIR / f"{address}.json").write_text(json.dumps(payload, indent=2))
