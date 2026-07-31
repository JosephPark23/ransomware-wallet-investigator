"""Bitcoin address validation and canonicalization.

Bech32 encodings are case-insensitive but every internal lookup uses their
lowercase canonical form. Legacy Base58 addresses remain case-sensitive.

Length bounds are 26-35 characters for Base58, which is the real range a
base58check-encoded 25-byte payload can produce. The first version allowed up
to 40 to be safe; "safe" in the wrong direction, as it turned out -- the
frontend independently settled on a tighter bound, and the disagreement only
surfaced when the frontend's input box started rejecting addresses this backend
had already accepted and shipped as demo fixtures. Both ends now use 26-35.
Measured against the shipped data, the tighter bound rejects none of the 10,832
Base58 addresses in the Ransomwhere export or the 380 in the OFAC list, whose
lengths are all 33 or 34.

This is still a format check, not a checksum check.
"""

import re

_BASE58 = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$")
_BECH32 = re.compile(r"^bc1[a-z0-9]{11,71}$")


def canonicalize(address: str | None) -> str | None:
    """Return a canonical address, or ``None`` when the format is malformed."""
    candidate = (address or "").strip()
    if _BASE58.fullmatch(candidate):
        return candidate
    lowered = candidate.lower()
    if _BECH32.fullmatch(lowered):
        return lowered
    return None


def is_valid(address: str | None) -> bool:
    return canonicalize(address) is not None
