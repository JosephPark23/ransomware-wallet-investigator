/**
 * Unit tests for src/lib/counterfactual.js.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * The load-bearing test here is `the line renders at all`. This module has now
 * been through both readings of the brief, and each failed for a different
 * reason:
 *
 *   - Zeroing sanctions, with the on-screen sentence "weighted as a compliance
 *     officer would". The maths and the words disagreed: removal lowers the
 *     score, and a compliance officer does not consider a sanctioned address
 *     safer.
 *   - Raising the sanctions weight to 3.0, keeping the sentence. That reading
 *     died with the scoring rewrite. Weights are now attenuation factors capped
 *     at 1.0, so 3.0 clamps; and because the cross-category operator is a
 *     probabilistic OR, a severity-100 sanctions hit saturates the score to
 *     exactly 100 under any weighting that leaves sanctions switched on. The
 *     only sanctions rule that exists is `sanctions.direct_hit` at severity
 *     100 -- so the emphasis form could never move the number, and the line
 *     would have rendered on no address at all.
 *
 * Current form: remove the sanctions weight and report both numbers, with a
 * sentence that describes removal. It always moves for an address carrying a
 * sanctions signal, and it matches `backend/scripts/scoring_reference.py`,
 * which has always implemented the removal form.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COUNTERFACTUAL_CATEGORY, counterfactual } from '../src/lib/counterfactual.js';
import { presetById } from '../src/lib/presets.js';
import { CATEGORIES, defaultWeights, scoreAddress } from '../src/lib/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

const near = (actual, expected, msg) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${msg}: expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`,
  );

/** Run the counterfactual against the fixture at a given set of weights. */
const run = (weights, signals = fixture.signals) =>
  counterfactual(signals, weights, scoreAddress(signals, weights));

const sig = (category, severity, id = `${category}_${severity}`) => ({ id, category, severity });

// ---------------------------------------------------------------------------
// The fixture numbers
// ---------------------------------------------------------------------------

test('GOLDEN: at default weights the fixture goes 100 -> 99.86 without sanctions', () => {
  const weights = defaultWeights();
  const baseline = scoreAddress(fixture.signals, weights).finalScore;
  near(baseline, 100, 'baseline is the documented fixture score');

  const cf = run(weights);
  assert.ok(cf, 'the line is shown');

  // Cross-checked against `python backend/scripts/scoring_reference.py`, whose
  // "Without sanctions" line prints 99.86 for this fixture.
  near(cf.score, 99.864060625, 'counterfactual score');
  near(cf.baseline, 100, 'baseline carried through');
  near(cf.delta, 99.864060625 - 100, 'delta');
  assert.equal(cf.band, 'High');
});

test('THE CRITICAL DIRECTION: removing sanctions LOWERS the score', () => {
  // The sentence on screen says "discount the sanctions listing entirely", so a
  // rise here would mean the copy and the maths have come apart again.
  const cf = run(defaultWeights());
  assert.ok(cf.delta < 0, `expected a drop, got a delta of ${cf.delta}`);
  assert.ok(cf.score < cf.baseline, `${cf.score} must be below ${cf.baseline}`);
});

test('it removes only sanctions, leaving the other four weights alone', () => {
  const weights = presetById('behavioral').weights;
  const baseline = scoreAddress(fixture.signals, weights).finalScore;

  const cf = run(weights);
  assert.ok(cf, 'the line is shown');
  near(cf.baseline, baseline, 'baseline is the caller-supplied weighting');
  // Removing sanctions from the behavioural weighting must equal scoring that
  // same weighting with sanctions at 0 -- nothing else may have moved.
  near(
    cf.score,
    scoreAddress(fixture.signals, { ...weights, sanctions: 0 }).finalScore,
    'only sanctions changed',
  );
});

test('it tracks the other weights rather than pinning to one preset', () => {
  // A full-preset-swap implementation would return the same number regardless
  // of where the other sliders are. These must differ.
  const a = run(defaultWeights()).score;
  const b = run(presetById('behavioral').weights).score;
  const c = run(presetById('ransomware').weights).score;
  assert.notEqual(a, b, 'default vs behavioral');
  assert.notEqual(b, c, 'behavioral vs ransomware analyst');
});

test('it renders on a saturated score, which the emphasis form could not', () => {
  // The regression that killed the previous implementation: an OFAC hit drives
  // the score to exactly 100, so any counterfactual that leaves sanctions
  // switched on compares 100 to 100 and hides itself. This form must still
  // produce a line on precisely that address.
  const saturated = [sig('sanctions', 100), sig('obfuscation', 50)];
  const cf = run(defaultWeights(), saturated);
  assert.ok(cf, 'the line is shown on a saturated score');
  near(cf.baseline, 100, 'saturated baseline');
  near(cf.score, 50, 'obfuscation alone');
});

// ---------------------------------------------------------------------------
// When the line must NOT be shown
// ---------------------------------------------------------------------------

test('hidden when there is no sanctions signal to remove', () => {
  // The brief's guard: otherwise the sentence compares the score to itself.
  const noSanctions = fixture.signals.filter((s) => s.category !== COUNTERFACTUAL_CATEGORY);
  assert.ok(noSanctions.length > 0, 'still has other signals');
  assert.equal(run(defaultWeights(), noSanctions), null);
});

test('hidden when there are no signals at all', () => {
  assert.equal(run(defaultWeights(), []), null);
});

test('hidden when the user has already zeroed sanctions themselves', () => {
  // Both halves of "X instead of Y" would be the same number.
  const weights = { ...defaultWeights(), [COUNTERFACTUAL_CATEGORY]: 0 };
  assert.equal(run(weights), null);
});

test('hidden when the change is too small to be visible at two decimals', () => {
  // A delta under half of the last displayed place would render "X instead of X".
  // A vanishingly small sanctions weight makes removal a sub-visible change.
  const weights = { ...defaultWeights(), [COUNTERFACTUAL_CATEGORY]: 1e-9 };
  assert.equal(run(weights), null);
});

test('returns null rather than throwing on a missing result', () => {
  assert.equal(counterfactual(fixture.signals, defaultWeights(), null), null);
  assert.equal(counterfactual(), null);
});

test('a sanctions-only address drops to zero without it', () => {
  const signals = [sig('sanctions', 100)];
  const cf = run(defaultWeights(), signals);
  assert.ok(cf, 'the line is shown');
  near(cf.baseline, 100, 'sanctions alone');
  near(cf.score, 0, 'nothing else is holding the score up');
  assert.equal(cf.band, 'Low');
});

test('the counterfactual category is one of the five real categories', () => {
  assert.ok(CATEGORIES.includes(COUNTERFACTUAL_CATEGORY));
});
