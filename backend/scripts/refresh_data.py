"""Safely refresh intelligence snapshots and their provenance manifest."""

import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bitcoin import canonicalize  # noqa: E402
from config import (  # noqa: E402
    DATA_DIR,
    OFAC_XBT_URL,
    RANSOMWARE_LIVE_BASE,
    RANSOMWHERE_EXPORT_URL,
    RANSOMWHERE_ZENODO_URL,
)

TIMEOUT = 60.0
UA = {"User-Agent": "cs4cs-rwri/1.0 (student research project)"}
MANIFEST_PATH = DATA_DIR / "manifest.json"


def _read_manifest() -> dict:
    try:
        value = json.loads(MANIFEST_PATH.read_text())
        return value if isinstance(value, dict) else {"sources": {}}
    except (OSError, json.JSONDecodeError):
        return {"sources": {}}


def _atomic_text(path: Path, content: str) -> None:
    tmp = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    tmp.write_text(content)
    os.replace(tmp, path)


def _write_checked(
    name: str,
    content: str,
    *,
    source_url: str,
    records: int,
    min_records: int,
) -> Path:
    if records < min_records:
        raise ValueError(
            f"{name}: {records} records, expected at least {min_records}; refusing overwrite"
        )

    path = DATA_DIR / name
    if path.exists():
        previous = _record_count(path)
        if previous and not (previous * 0.5 <= records <= previous * 2):
            raise ValueError(
                f"{name}: record count changed from {previous} to {records}; "
                "refusing suspicious overwrite"
            )

    if path.exists():
        shutil.copy2(path, path.with_suffix(f"{path.suffix}.bak"))
    _atomic_text(path, content)
    manifest = _read_manifest()
    manifest.setdefault("sources", {})[name] = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "url": source_url,
        "records": records,
        "sha256": hashlib.sha256(content.encode()).hexdigest(),
    }
    _atomic_text(MANIFEST_PATH, json.dumps(manifest, indent=2, sort_keys=True))
    print(f"  wrote {path.relative_to(DATA_DIR.parent)} ({len(content):,} bytes)")
    return path


def _record_count(path: Path) -> int:
    try:
        if path.suffix == ".txt":
            return sum(
                1
                for line in path.read_text().splitlines()
                if line.strip() and not line.strip().startswith("#")
            )
        raw = json.loads(path.read_text())
        if isinstance(raw, dict):
            for key in ("result", "results", "data", "addresses", "groups"):
                if isinstance(raw.get(key), list):
                    return len(raw[key])
        return len(raw) if isinstance(raw, list) else 0
    except (OSError, json.JSONDecodeError):
        return 0


def fetch_ofac() -> bool:
    print("\n[1/3] OFAC sanctioned Bitcoin addresses")
    try:
        response = httpx.get(
            OFAC_XBT_URL, timeout=TIMEOUT, headers=UA, follow_redirects=True
        )
        response.raise_for_status()
        records = [
            line.strip()
            for line in response.text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        valid = [address for address in (canonicalize(line) for line in records) if address]
        if records and len(valid) / len(records) < 0.95:
            raise ValueError("less than 95% of OFAC records are valid Bitcoin addresses")
        _write_checked(
            "sanctioned_addresses_XBT.txt",
            response.text,
            source_url=OFAC_XBT_URL,
            records=len(valid),
            min_records=100,
        )
        print(f"  BTC: {len(valid)} addresses")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! BTC failed without replacing the existing snapshot: {exc}")
        return False


def fetch_ransomwhere() -> bool:
    print("\n[2/3] Ransomwhere payment addresses")
    try:
        response = httpx.get(
            RANSOMWHERE_EXPORT_URL,
            timeout=TIMEOUT,
            headers=UA,
            follow_redirects=True,
        )
        response.raise_for_status()
        data = response.json()
        entries = data.get("result", data) if isinstance(data, dict) else data
        if not isinstance(entries, list):
            raise ValueError("unexpected Ransomwhere schema")
        _write_checked(
            "ransomwhere.json",
            json.dumps(data),
            source_url=RANSOMWHERE_EXPORT_URL,
            records=len(entries),
            min_records=100,
        )
        print(f"  {len(entries):,} records")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! export failed without replacing the existing snapshot: {exc}")
        print(f"  ! manual fallback: {RANSOMWHERE_ZENODO_URL}")
        return False


def fetch_ransomware_live() -> bool:
    print("\n[3/3] ransomware.live group profiles")
    try:
        url = f"{RANSOMWARE_LIVE_BASE}/groups"
        response = httpx.get(
            url, timeout=TIMEOUT, headers=UA, follow_redirects=True
        )
        response.raise_for_status()
        groups = response.json()
        if isinstance(groups, dict):
            groups = groups.get("groups", groups.get("data", []))
        if not isinstance(groups, list):
            raise ValueError("unexpected ransomware.live schema")
        _write_checked(
            "ransomware_live_groups.json",
            json.dumps(groups),
            source_url=url,
            records=len(groups),
            min_records=50,
        )
        print(f"  {len(groups)} groups")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! failed without replacing the existing snapshot: {exc}")
        return False


def main() -> int:
    print("Refreshing intel datasets into", DATA_DIR)
    results = {
        "ofac": fetch_ofac(),
        "ransomwhere": fetch_ransomwhere(),
        "ransomware.live": fetch_ransomware_live(),
    }
    for name, ok in results.items():
        print(f"  {'OK' if ok else 'FAIL'} {name}")
    return 0 if results["ofac"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
