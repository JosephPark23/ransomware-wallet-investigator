"""Reference implementation of the scoring math, plus golden numbers.

    python scripts/scoring_reference.py

The frontend owns scoring — this file does not run in production. It exists so
Dev B can assert scoring.js against known-correct values instead of eyeballing
a dial. Run it, paste the golden numbers into a frontend unit test, done.

Category scores and the final score both use probabilistic OR. Category weights
are attenuation factors in ``[0, 1]`` rather than renormalising multipliers.
This guarantees that adding evidence cannot lower the score. Waterfall
contributions are allocated symmetrically by effective category evidence, so
equal evidence receives equal credit regardless of category list order.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import BANDS, FIXTURES_DIR  # noqa: E402

CATEGORIES = ["sanctions", "ransomware", "obfuscation", "transaction_profile", "counterparty"]

PRESETS = {
    "Balanced": {c: 1.0 for c in CATEGORIES},
    "Compliance officer": {
        "sanctions": 1.0, "ransomware": 0.3, "obfuscation": 0.3,
        "transaction_profile": 0.3, "counterparty": 0.3,
    },
    "Ransomware analyst": {
        "sanctions": 0.4, "ransomware": 1.0, "obfuscation": 0.4,
        "transaction_profile": 0.4, "counterparty": 0.8,
    },
    "Behavioral": {
        "sanctions": 0.2, "ransomware": 0.2, "obfuscation": 1.0,
        "transaction_profile": 1.0, "counterparty": 0.2,
    },
}


def category_score(signals: list[dict]) -> float:
    """Probabilistic OR: two mixer hits do not score 160.

    The first signal contributes most; each additional one adds progressively
    less. Easy to explain out loud as "diminishing returns on repeated evidence
    of the same kind."
    """
    product = 1.0
    for signal in signals:
        product *= 1 - signal["severity"] / 100
    return 100 * (1 - product)


def band_for(score: float) -> str:
    score = max(0.0, min(100.0, score))
    for low, high, name in BANDS:
        if low <= score < high:
            return name
    return "High"


def score(signals: list[dict], weights: dict[str, float]) -> dict:
    by_category: dict[str, list[dict]] = {}
    for signal in signals:
        by_category.setdefault(signal["category"], []).append(signal)

    category_scores = {c: category_score(s) for c, s in by_category.items()}

    # Probabilistic OR across categories is monotone: additional evidence can
    # never lower the score. Weights attenuate evidence instead of
    # renormalising every other category.
    active = {
        c: min(max(weights.get(c, 1.0), 0.0), 1.0)
        for c in category_scores
        if weights.get(c, 1.0) > 0
    }
    effective_by_category = {
        category: (category_scores[category] / 100) * weight
        for category, weight in active.items()
    }
    remaining = 1.0
    for effective in effective_by_category.values():
        remaining *= 1 - effective
    final = 100 * (1 - remaining)
    total_effective = sum(effective_by_category.values())
    category_contributions = {
        category: final * effective / total_effective
        for category, effective in effective_by_category.items()
    } if total_effective else {}

    contributions = []
    for category, group in by_category.items():
        weight = weights.get(category, 1.0)
        if weight <= 0 or category not in category_contributions:
            for signal in group:
                contributions.append({"id": signal["id"], "category": category, "contribution": 0.0})
            continue

        cat_score = category_scores[category]
        # Share of the category score attributable to each signal. Uses the
        # marginal contribution under probabilistic OR, normalised to sum to 1.
        marginals = []
        running = 1.0
        for signal in sorted(group, key=lambda s: -s["severity"]):
            severity = signal["severity"] / 100
            marginals.append((signal, running * severity))
            running *= 1 - severity
        marginal_total = sum(m for _, m in marginals) or 1.0

        for signal, marginal in marginals:
            share = marginal / marginal_total
            contributions.append(
                {
                    "id": signal["id"],
                    "category": category,
                    "contribution": category_contributions[category] * share,
                }
            )

    return {
        "final_score": round(final, 2),
        "band": band_for(final),
        "category_scores": {c: round(v, 2) for c, v in category_scores.items()},
        "contributions": sorted(contributions, key=lambda c: -c["contribution"]),
    }


def counterfactual(signals: list[dict], weights: dict[str, float], zeroed: str) -> float:
    modified = dict(weights)
    modified[zeroed] = 0.0
    return score(signals, modified)["final_score"]


def main() -> int:
    path = FIXTURES_DIR / "sample.json"
    if not path.exists():
        print("Run scripts/make_sample_fixture.py first")
        return 1

    signals = json.loads(path.read_text())["signals"]
    print(f"Golden values for fixtures/sample.json ({len(signals)} signals)\n")

    failures = 0
    for name, weights in PRESETS.items():
        result = score(signals, weights)
        total = sum(c["contribution"] for c in result["contributions"])
        drift = abs(total - result["final_score"])
        status = "OK" if drift < 0.01 else f"MISMATCH (drift {drift:.4f})"
        if drift >= 0.01:
            failures += 1

        print(f"{name}")
        print(f"  final score : {result['final_score']}  ({result['band']})")
        print(f"  categories  : {result['category_scores']}")
        print(f"  bars sum to : {total:.2f}   {status}")
        for contribution in result["contributions"][:4]:
            print(f"      {contribution['contribution']:6.2f}  {contribution['id']}")
        print()

    balanced = PRESETS["Balanced"]
    base = score(signals, balanced)["final_score"]
    print("Counterfactual lines (for the live text under the dial):")
    for category in CATEGORIES:
        without = counterfactual(signals, balanced, category)
        print(f"  Without {category:20} -> {without:6.2f}  (vs {base})")

    print("\n--- edge cases the frontend must not get wrong ---")
    single = [{"id": "sanctions.direct_hit", "category": "sanctions", "severity": 100}]
    result = score(single, balanced)
    print(f"  sanctions-only address        : {result['final_score']} ({result['band']})")
    if result["final_score"] != 100:
        print("    !! should be 100 — check the denominator handling")
        failures += 1

    print(f"  no signals at all             : {score([], balanced)['final_score']}")
    print(f"  all weights zero             : {score(signals, {c: 0.0 for c in CATEGORIES})['final_score']}")

    duplicate = [
        {"id": "a", "category": "obfuscation", "severity": 50},
        {"id": "b", "category": "obfuscation", "severity": 50},
    ]
    print(
        f"  two 50-severity same category : "
        f"{score(duplicate, balanced)['final_score']} (saturating, not 100)"
    )

    print()
    print("FAIL" if failures else "PASS — all contribution sets sum to their final score")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
