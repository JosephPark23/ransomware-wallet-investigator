"""Download every intel dataset into data/. Run once, commit the results.

    python scripts/refresh_data.py

Do NOT wire this into request handling. These files are loaded from disk at
startup on purpose: fetching them per request is slow, rude to the people
hosting free research APIs, and breaks the demo the day one of them has an
outage.

ransomware.live's anonymous tier is rate-limited to one request per minute per
endpoint, so the group download deliberately paces itself. Expect it to take a
few minutes. Start it and go write contract.md.
"""

import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import (  # noqa: E402
    DATA_DIR,
    OFAC_ETH_URL,
    OFAC_XBT_URL,
    RANSOMWARE_LIVE_BASE,
    RANSOMWHERE_EXPORT_URL,
    RANSOMWHERE_ZENODO_URL,
)

TIMEOUT = 60.0
UA = {"User-Agent": "cs4cs-rwri/1.0 (student research project)"}


def _write(name: str, content: str) -> Path:
    path = DATA_DIR / name
    path.write_text(content)
    print(f"  wrote {path.relative_to(DATA_DIR.parent)}  ({len(content):,} bytes)")
    return path


def fetch_ofac() -> bool:
    print("\n[1/3] OFAC sanctioned addresses (0xB10C pre-extracted lists)")
    ok = True
    for label, url, filename in (
        ("BTC", OFAC_XBT_URL, "sanctioned_addresses_XBT.txt"),
        ("ETH", OFAC_ETH_URL, "sanctioned_addresses_ETH.txt"),
    ):
        try:
            response = httpx.get(url, timeout=TIMEOUT, headers=UA, follow_redirects=True)
            response.raise_for_status()
            path = _write(filename, response.text)
            count = len([ln for ln in path.read_text().splitlines() if ln.strip()])
            print(f"  {label}: {count} addresses")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {label} failed: {exc}")
            ok = False
    return ok


def fetch_ransomwhere() -> bool:
    print("\n[2/3] Ransomwhere payment addresses")
    try:
        response = httpx.get(
            RANSOMWHERE_EXPORT_URL, timeout=TIMEOUT, headers=UA, follow_redirects=True
        )
        response.raise_for_status()
        data = response.json()
        entries = data.get("result", data) if isinstance(data, dict) else data
        _write("ransomwhere.json", json.dumps(data))
        print(f"  {len(entries):,} records")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! export endpoint failed: {exc}")
        print(f"  ! FALLBACK: download ransomwhere.json by hand from")
        print(f"  !   {RANSOMWHERE_ZENODO_URL}")
        print(f"  ! and save it to {DATA_DIR / 'ransomwhere.json'}")
        return False


def fetch_ransomware_live() -> bool:
    print("\n[3/3] ransomware.live group profiles")
    print("  note: anonymous tier is 1 req/min per endpoint — pacing requests")
    try:
        response = httpx.get(
            f"{RANSOMWARE_LIVE_BASE}/groups", timeout=TIMEOUT, headers=UA,
            follow_redirects=True,
        )
        if response.status_code == 429:
            print("  ! rate limited on first call; wait a minute and re-run")
            return False
        response.raise_for_status()
        groups = response.json()
        if isinstance(groups, dict):
            groups = groups.get("groups", groups.get("data", []))
        _write("ransomware_live_groups.json", json.dumps(groups))
        print(f"  {len(groups)} groups")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! failed: {exc}")
        print("  ! this source is optional — rule 10 simply won't fire without it")
        return False


def main() -> int:
    print("Refreshing intel datasets into", DATA_DIR)
    results = {
        "ofac": fetch_ofac(),
        "ransomwhere": fetch_ransomwhere(),
        "ransomware.live": fetch_ransomware_live(),
    }
    print("\n" + "=" * 60)
    for name, ok in results.items():
        print(f"  {'OK  ' if ok else 'FAIL'}  {name}")
    print("=" * 60)
    print("\nNow: git add data/ && git commit -m 'intel snapshot'")
    return 0 if results["ofac"] else 1


if __name__ == "__main__":
    time.sleep(0)
    raise SystemExit(main())
