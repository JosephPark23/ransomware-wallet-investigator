"""Replace synthetic fixture identities with validator-safe Base58 placeholders.

This is a deterministic migration utility. It preserves fixture topology while
ensuring every address that can be expanded by ``OfflineChainClient`` passes
the same boundary validation as live Esplora data.
"""

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bitcoin import canonicalize  # noqa: E402
from config import FIXTURES_DIR  # noqa: E402

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
REFERENCE_FILES = (
    Path(__file__).resolve().parent.parent / "tests" / "factories.py",
    Path(__file__).resolve().parent / "make_sample_fixture.py",
)


def _placeholder(original: str) -> str:
    digest = hashlib.sha256(original.encode()).digest()
    chars = ["1"]
    for index in range(33):
        chars.append(ALPHABET[digest[index % len(digest)] % len(ALPHABET)])
    return "".join(chars)


def _addresses(blob: dict) -> set[str]:
    found = set()
    for tx in blob.get("txs", []):
        for side in ("inputs", "outputs"):
            for item in tx.get(side, []):
                if item.get("address"):
                    found.add(item["address"])
    return found


def main() -> int:
    fixture_dir = FIXTURES_DIR / "chain"
    paths = sorted(fixture_dir.glob("*.json"))
    originals = {path.stem for path in paths}
    for path in paths:
        originals.update(_addresses(json.loads(path.read_text())))

    mapping = {
        address: _placeholder(address)
        for address in sorted(originals)
        if canonicalize(address) is None
    }
    if not mapping:
        print("All fixture addresses already pass validation.")
        return 0

    for path in paths:
        text = path.read_text()
        for old, new in mapping.items():
            text = text.replace(old, new)
        path.write_text(text)

    for path in paths:
        replacement = mapping.get(path.stem)
        if replacement:
            path.rename(path.with_name(f"{replacement}.json"))

    for path in REFERENCE_FILES:
        text = path.read_text()
        for old, new in mapping.items():
            text = text.replace(old, new)
        path.write_text(text)

    print(f"Normalized {len(mapping)} synthetic fixture addresses.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
