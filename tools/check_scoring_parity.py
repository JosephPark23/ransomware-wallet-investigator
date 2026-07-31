"""Assert the Python and JavaScript scoring implementations agree, number for number.

    python tools/check_scoring_parity.py

Scoring lives in the browser (contract.md rule 3: severity is intrinsic,
weighting happens client-side and only client-side). `backend/scripts/
scoring_reference.py` exists so the frontend has something to be checked
against. Two implementations of the same formula in two languages is a standing
invitation to drift, and drift here is invisible: both sides keep producing
plausible numbers, they just stop being the same number.

They have already drifted once. The backend's cross-category operator was
rewritten from a weighted average to a probabilistic OR after the average was
found to be non-monotone -- an OFAC-sanctioned address scored 100 on the
sanctions hit alone and dropped to 46 once four more incriminating signals
arrived. The frontend kept the average for another two rounds, which meant the
corrected backend maths was doing nothing at all for the app: the dial the user
actually reads was still the broken one.

This script compares every number that reaches a user -- final score, band,
per-category scores and per-signal waterfall contributions -- across all four
weight presets. Wire it into CI. It is the only thing standing between the two
halves and a silent re-divergence.

Exit code 0 on agreement, 1 on any mismatch.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

from scoring_reference import PRESETS, score  # noqa: E402

FIXTURE = ROOT / "frontend" / "fixtures" / "sample.json"

# Contributions are compared at 1e-6 because the JS side is serialised through
# JSON. The final score is compared at the 2 decimals the Python reference
# rounds to, which is also the precision the dial displays.
CONTRIBUTION_TOLERANCE = 1e-6
SCORE_TOLERANCE = 1e-9

_HARNESS = """
import fs from 'node:fs';
import { scoreAddress } from './src/lib/scoring.js';

const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const presets = JSON.parse(process.argv[3]);
const out = {};
for (const [name, weights] of Object.entries(presets)) {
  const result = scoreAddress(fixture.signals, weights);
  out[name] = {
    final: result.finalScore,
    band: result.band,
    categories: Object.fromEntries(
      result.categories.filter((c) => c.signalCount > 0).map((c) => [c.category, c.score]),
    ),
    contributions: Object.fromEntries(
      result.contributions.map((c) => [c.signal.id, c.contribution]),
    ),
  };
}
process.stdout.write(JSON.stringify(out));
"""


def _javascript_results() -> dict:
    """Run the real frontend module under node and return what it produced."""
    harness = ROOT / "frontend" / ".scoring-parity-harness.mjs"
    harness.write_text(_HARNESS)
    try:
        raw = subprocess.check_output(
            ["node", harness.name, str(FIXTURE), json.dumps(PRESETS)],
            cwd=ROOT / "frontend",
        )
    finally:
        harness.unlink(missing_ok=True)
    return json.loads(raw)


def main() -> int:
    if not FIXTURE.exists():
        print(f"fixture not found: {FIXTURE}")
        return 1

    signals = json.loads(FIXTURE.read_text())["signals"]
    js = _javascript_results()
    mismatches: list[str] = []

    for name, weights in PRESETS.items():
        py = score(signals, weights)
        other = js.get(name)
        if other is None:
            mismatches.append(f"{name}: missing from the JavaScript output")
            continue

        if abs(py["final_score"] - round(other["final"], 2)) > SCORE_TOLERANCE:
            mismatches.append(
                f"{name}: final score {py['final_score']} vs {round(other['final'], 2)}"
            )
        if py["band"] != other["band"]:
            mismatches.append(f"{name}: band {py['band']} vs {other['band']}")

        for category, value in py["category_scores"].items():
            theirs = other["categories"].get(category)
            if theirs is None or abs(value - round(theirs, 2)) > SCORE_TOLERANCE:
                mismatches.append(f"{name}/{category}: category score {value} vs {theirs}")

        for contribution in py["contributions"]:
            theirs = other["contributions"].get(contribution["id"])
            if theirs is None or abs(contribution["contribution"] - theirs) > CONTRIBUTION_TOLERANCE:
                mismatches.append(
                    f"{name}/{contribution['id']}: contribution "
                    f"{contribution['contribution']} vs {theirs}"
                )

        print(f"  {name:20} {other['final']:10.6f}  {other['band']}")

    print()
    if mismatches:
        print(f"DIVERGENT — {len(mismatches)} mismatch(es):")
        for line in mismatches[:20]:
            print(f"  {line}")
        return 1

    print(
        "IDENTICAL — final score, band, category scores and every per-signal "
        f"contribution agree across all {len(PRESETS)} presets."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
