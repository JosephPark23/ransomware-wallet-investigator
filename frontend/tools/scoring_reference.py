"""Independent Python port of src/lib/scoring.js.

WHY THIS EXISTS: the brief pointed at ../backend/scripts/scoring_reference.py as
the source of golden numbers. That file (and the whole backend directory) does
not exist in this checkout, so this is a SECOND, INDEPENDENTLY WRITTEN
implementation of the same spec, used to cross-check the JS and to generate the
golden numbers baked into tests/scoring.test.js.

It is NOT the teammate's reference implementation. When the real one appears,
diff against it -- if they disagree, the backend wins and this file goes away.

Usage:
    python tools/scoring_reference.py              # human-readable table
    python tools/scoring_reference.py --json       # golden numbers as JSON
"""

import json
import sys
from pathlib import Path

CATEGORIES = [
    "sanctions",
    "ransomware",
    "obfuscation",
    "transaction_profile",
    "counterparty",
]
DEFAULT_WEIGHT = 1.0
BANDS = [("Low", 25), ("Moderate", 50), ("Elevated", 75), ("High", float("inf"))]


def band_for(score):
    for name, cutoff in BANDS:
        if score < cutoff:
            return name
    return "High"


def category_score(signals):
    """100 * (1 - product of (1 - severity/100))."""
    if not signals:
        return 0.0
    remaining = 1.0
    for s in signals:
        remaining *= 1 - s["severity"] / 100
    return 100 * (1 - remaining)


def marginal_shares(signals):
    """Descending-severity marginal credit, normalised to sum to 1."""
    if not signals:
        return []
    order = sorted(range(len(signals)), key=lambda i: (-signals[i]["severity"], i))
    credits = [0.0] * len(signals)
    running, total = 1.0, 0.0
    for i in order:
        sev = signals[i]["severity"]
        credits[i] = running * sev
        total += credits[i]
        running *= 1 - sev / 100
    if total == 0:
        return [1.0 / len(signals)] * len(signals)
    return [c / total for c in credits]


def score_address(signals, weights=None):
    weights = {**{c: DEFAULT_WEIGHT for c in CATEGORIES}, **(weights or {})}
    groups = {c: [s for s in signals if s.get("category") == c] for c in CATEGORIES}

    # Active = produced at least one signal AND carries non-zero weight.
    active = [c for c in CATEGORIES if groups[c] and weights[c] > 0]
    total_weight = sum(weights[c] for c in active)

    cat_scores = {c: category_score(groups[c]) for c in CATEGORIES}

    if total_weight == 0:
        return {
            "finalScore": 0.0,
            "band": band_for(0),
            "categoryScores": cat_scores,
            "activeCategories": [],
            "contributions": [],
        }

    final = sum(weights[c] * cat_scores[c] for c in active) / total_weight

    contributions = []
    for c in active:
        frac = weights[c] / total_weight
        for sig, share in zip(groups[c], marginal_shares(groups[c])):
            contributions.append(
                {
                    "id": sig["id"],
                    "category": c,
                    "severity": sig["severity"],
                    "share": share,
                    # (weight_c * categoryScore_c / total_weight) * share_i
                    "contribution": frac * cat_scores[c] * share,
                }
            )

    return {
        "finalScore": final,
        "band": band_for(final),
        "categoryScores": cat_scores,
        "activeCategories": active,
        "contributions": contributions,
    }


def main():
    fixture_path = Path(__file__).resolve().parent.parent / "fixtures" / "sample.json"
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    result = score_address(data["signals"])

    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
        return

    print(f"fixture: {fixture_path.name}  address: {data['address']}")
    print(f"signals: {len(data['signals'])}\n")

    print("category scores")
    for c in CATEGORIES:
        n = sum(1 for s in data["signals"] if s.get("category") == c)
        mark = "*" if c in result["activeCategories"] else " "
        print(f"  {mark} {c:<22} {result['categoryScores'][c]:>8.4f}   ({n} signals)")
    print("  (* = active, counted in the weighted average)\n")

    print(f"FINAL SCORE: {result['finalScore']:.6f}  band={result['band']}")
    print(f"active categories: {len(result['activeCategories'])} of {len(CATEGORIES)}\n")

    print("per-signal contributions")
    for c in result["contributions"]:
        print(
            f"  {c['id']:<16} {c['category']:<22} sev={c['severity']:>3} "
            f"share={c['share']:.6f}  contrib={c['contribution']:.6f}"
        )

    total = sum(c["contribution"] for c in result["contributions"])
    print(f"\n  sum of contributions: {total:.12f}")
    print(f"  final score:          {result['finalScore']:.12f}")
    print(f"  delta:                {abs(total - result['finalScore']):.3e}")

    # Spot-check the cases the brief called out explicitly.
    solo = score_address([{"id": "x", "category": "sanctions", "severity": 100}])
    print(f"\nlone OFAC hit -> {solo['finalScore']:.1f} ({solo['band']})  [must be 100, not 20]")

    # A category scoring 100 must out-contribute one scoring 30 at equal weight.
    pair = score_address(
        [
            {"id": "hot", "category": "sanctions", "severity": 100},
            {"id": "cold", "category": "transaction_profile", "severity": 30},
        ]
    )
    hot = next(c for c in pair["contributions"] if c["id"] == "hot")["contribution"]
    cold = next(c for c in pair["contributions"] if c["id"] == "cold")["contribution"]
    print(
        f"equal weight, score 100 vs 30 -> {hot:.4f} vs {cold:.4f}  "
        f"[{'OK' if hot > cold else 'BROKEN'}: must not be equal]"
    )


if __name__ == "__main__":
    main()
