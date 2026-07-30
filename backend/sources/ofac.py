"""OFAC sanctioned digital currency addresses.

Loaded once at startup from data/, never fetched per request. The upstream is
0xB10C's pre-extracted per-asset lists rather than Treasury's 80MB
sdn_advanced.xml, which saves roughly half a day of XML parsing.

Entity detail (name, program, listing date) is optional enrichment. A hit is a
hit whether or not we can name the entity; the entity name only makes the
explanation text nicer.
"""

import json
from datetime import datetime, timezone

from config import DATA_DIR, OFAC_SDN_URL

_addresses: set[str] = set()
_entities: dict[str, dict] = {}
_retrieved_at: str | None = None
_loaded = False


def load() -> None:
    """Idempotent. Call once at startup."""
    global _addresses, _entities, _retrieved_at, _loaded

    xbt_path = DATA_DIR / "sanctioned_addresses_XBT.txt"
    if xbt_path.exists():
        _addresses = {
            line.strip()
            for line in xbt_path.read_text().splitlines()
            if line.strip() and not line.startswith("#")
        }
        _retrieved_at = datetime.fromtimestamp(
            xbt_path.stat().st_mtime, tz=timezone.utc
        ).isoformat()

    # Optional: data/ofac_entities.json maps address -> {entity, program, listed_on}
    entity_path = DATA_DIR / "ofac_entities.json"
    if entity_path.exists():
        try:
            _entities = json.loads(entity_path.read_text())
        except json.JSONDecodeError:
            _entities = {}

    _loaded = True


def is_sanctioned(address: str) -> bool:
    return address in _addresses


def entity_for(address: str) -> dict:
    """Returns {} when we have the address but not the entity detail."""
    return _entities.get(address, {})


def count() -> int:
    return len(_addresses)


def retrieved_at() -> str | None:
    return _retrieved_at


def source_dict() -> dict:
    return {
        "name": "OFAC SDN List",
        "url": OFAC_SDN_URL,
        "retrieved_at": _retrieved_at,
    }


def status() -> dict:
    return {"loaded": _loaded, "records": len(_addresses), "retrieved_at": _retrieved_at}
