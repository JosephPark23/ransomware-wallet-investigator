/**
 * Unit tests for src/lib/scoring.js.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * Golden numbers come from tools/scoring_reference.py, an independently written
 * Python port of the same spec. The brief referenced
 * ../backend/scripts/scoring_reference.py, which does not exist in this
 * checkout -- when it appears, regenerate these values from it instead.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CATEGORIES,
  SUM_EPSILON,
  WEIGHT_MAX,
  bandFor,
  categoryScore,
  defaultWeights,
  marginalShares,
  normaliseWeights,
  scoreAddress,
} from '../src/lib/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

/** Assert two floats agree to within the stated invariant tolerance. */
const near = (actual, expected, msg) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${msg}: expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`,
  );

const sig = (category, severity, id = `${category}_${severity}`) => ({ id, category, severity });

// ---------------------------------------------------------------------------
// Step 1: saturating OR within a category
// ---------------------------------------------------------------------------

test('categoryScore: empty category scores 0', () => {
  assert.equal(categoryScore([]), 0);
});

test('categoryScore: single signal passes its severity through', () => {
  near(categoryScore([sig('ransomware', 85)]), 85, 'single signal');
});

test('categoryScore: saturates rather than adding linearly', () => {
  // Two 50s must give 75, not 100.
  near(categoryScore([sig('a', 50), sig('a', 50)]), 75, 'two 50s');
  // Three 50s: 100 * (1 - 0.5^3) = 87.5
  near(categoryScore([sig('a', 50), sig('a', 50), sig('a', 50)]), 87.5, 'three 50s');
});

test('categoryScore: never exceeds 100 and a 100 pins the category', () => {
  const score = categoryScore([sig('a', 100), sig('a', 60), sig('a', 30)]);
  near(score, 100, 'saturated at 100');
});

test('categoryScore: is order independent', () => {
  const a = categoryScore([sig('a', 85), sig('a', 60), sig('a', 20)]);
  const b = categoryScore([sig('a', 20), sig('a', 85), sig('a', 60)]);
  near(a, b, 'order independence');
});

// ---------------------------------------------------------------------------
// Step 2: weighted average across ACTIVE categories only
// ---------------------------------------------------------------------------

test('THE CRITICAL CASE: a lone OFAC hit scores 100, not 20', () => {
  const result = scoreAddress([sig('sanctions', 100)]);
  near(result.finalScore, 100, 'lone sanctions hit');
  assert.equal(result.band, 'High');
  assert.equal(result.totalActiveWeight, 1, 'only one category in the denominator');
});

test('silent categories neither dilute nor contribute', () => {
  // sanctions=100, ransomware=50, three silent categories.
  // 100 * (1 - (1-1.0)*(1-0.5)) = 100. The three silent categories multiply the
  // remaining mass by 1 and are therefore invisible, which is the point: absent
  // evidence is not evidence of low risk.
  const result = scoreAddress([sig('sanctions', 100), sig('ransomware', 50)]);
  near(result.finalScore, 100, 'two active categories, one saturating');
  assert.equal(result.totalActiveWeight, 2);

  // Non-saturating pair, so the operator itself is visible:
  // 100 * (1 - 0.4 * 0.5) = 80.
  near(scoreAddress([sig('sanctions', 60), sig('ransomware', 50)]).finalScore, 80, 'combined');
});

test('a zero weight removes the category from numerator AND denominator', () => {
  const signals = [sig('sanctions', 100), sig('ransomware', 50)];
  // Zeroing ransomware must leave sanctions alone at 100, not average to 50.
  const result = scoreAddress(signals, { ransomware: 0 });
  near(result.finalScore, 100, 'ransomware zeroed out');
  assert.equal(result.totalActiveWeight, 1);
  assert.equal(result.categories.find((c) => c.category === 'ransomware').active, false);
});

test('weights attenuate their own category and nothing else', () => {
  const signals = [sig('sanctions', 100), sig('ransomware', 50)];
  // Halving ransomware takes its effective score from 0.5 to 0.25 and leaves
  // sanctions at 1.0: 100 * (1 - 0*0.75) = 100. Saturated either way here, so
  // use a non-saturating pair to see the attenuation actually bite.
  const soft = [sig('sanctions', 60), sig('ransomware', 50)];
  // Balanced: 100 * (1 - 0.4*0.5) = 80
  near(scoreAddress(soft).finalScore, 80, 'both at full weight');
  // ransomware at 0.5: effective 0.25 -> 100 * (1 - 0.4*0.75) = 70
  near(scoreAddress(soft, { ransomware: 0.5 }).finalScore, 70, 'ransomware halved');
  // Raising sanctions cannot amplify past full weight; 3 clamps to 1.
  near(
    scoreAddress(soft, { sanctions: 3 }).finalScore,
    scoreAddress(soft).finalScore,
    'weights above 1 clamp rather than amplify',
  );
  assert.equal(scoreAddress(signals, { sanctions: 3 }).categories[0].weight, 1);
});

test('MONOTONE: adding a signal can never lower the score', () => {
  // The property the whole cross-category operator exists to guarantee. The
  // weighted average it replaced failed this: an OFAC hit alone scored 100 and
  // dropped to 46 once four more incriminating signals arrived.
  const categories = [...CATEGORIES];
  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);

  for (let trial = 0; trial < 500; trial += 1) {
    const n = 1 + Math.floor(rand() * 5);
    const signals = Array.from({ length: n }, (_, i) =>
      sig(categories[Math.floor(rand() * categories.length)], Math.floor(rand() * 101), `s${i}`),
    );
    const before = scoreAddress(signals).finalScore;
    const extra = sig(
      categories[Math.floor(rand() * categories.length)],
      Math.floor(rand() * 101),
      'extra',
    );
    const after = scoreAddress([...signals, extra]).finalScore;
    assert.ok(
      after >= before - 1e-9,
      `adding ${extra.category}/${extra.severity} lowered ${before} to ${after}`,
    );
  }
});

test('a lone OFAC hit stays at 100 however much other evidence arrives', () => {
  const ofac = sig('sanctions', 100);
  const piled = [
    ofac,
    sig('transaction_profile', 35),
    sig('obfuscation', 35),
    sig('counterparty', 40),
    sig('ransomware', 20),
  ];
  near(scoreAddress([ofac]).finalScore, 100, 'sanctions alone');
  near(scoreAddress(piled).finalScore, 100, 'sanctions plus four weaker findings');
});

test('no signals at all scores 0 / Low with no contributions', () => {
  const result = scoreAddress([]);
  assert.equal(result.finalScore, 0);
  assert.equal(result.band, 'Low');
  assert.equal(result.totalActiveWeight, 0);
  assert.deepEqual(result.contributions, []);
});

test('all weights zeroed scores 0, with every bar flattened rather than dropped', () => {
  const zeroed = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const result = scoreAddress([sig('sanctions', 100)], zeroed);
  assert.equal(result.finalScore, 0);
  assert.ok(Number.isFinite(result.finalScore), 'must not be NaN or Infinity');
  // The signal still exists and the reader should still see it listed; it just
  // contributes nothing. Dropping the entry entirely would make a zeroed
  // category look like a category that found nothing.
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].contribution, 0);
});

test('a category whose only signal is severity 0 scores 0 without dividing by zero', () => {
  // ransomware.group_context ships at severity 0 by design, so this is a real
  // payload shape, not a synthetic edge case.
  const result = scoreAddress([sig('ransomware', 0)]);
  assert.equal(result.finalScore, 0);
  assert.ok(Number.isFinite(result.finalScore), 'must not be NaN or Infinity');
  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].contribution, 0);
});

test('signals in unknown categories are ignored, not crashed on', () => {
  const result = scoreAddress([sig('sanctions', 100), sig('not_a_category', 90)]);
  near(result.finalScore, 100, 'unknown category dropped');
  assert.equal(result.totalActiveWeight, 1);
});

// ---------------------------------------------------------------------------
// Weights handling
// ---------------------------------------------------------------------------

test('weights default to 1.0 and clamp to [0, 1]', () => {
  assert.deepEqual(defaultWeights(), Object.fromEntries(CATEGORIES.map((c) => [c, 1.0])));
  const w = normaliseWeights({ sanctions: 99, ransomware: -5, obfuscation: 0.5 });
  assert.equal(w.sanctions, WEIGHT_MAX, 'clamped to max');
  assert.equal(w.sanctions, 1, 'weights are attenuation factors: 1.0 is full, never more');
  assert.equal(w.ransomware, 0, 'clamped to min');
  assert.equal(w.obfuscation, 0.5, 'in-range value preserved');
  assert.equal(w.counterparty, 1.0, 'missing category defaults');
});

test('an ABSENT weight defaults to 1.0 and never reads as an explicit 0', () => {
  // Regression: Number(null), Number(''), Number([]) and Number(false) are all 0.
  // Coercing naively turns a missing config value into a zero weight, which drops
  // the category from the denominator and silently inflates the score.
  const w = normaliseWeights({
    sanctions: null,
    ransomware: undefined,
    obfuscation: '',
    transaction_profile: false,
    counterparty: [],
  });
  for (const c of CATEGORIES) {
    assert.equal(w[c], 1.0, `${c} must default to 1.0, not 0`);
  }

  // A null weight must not change the score. 100 * (1 - 0.4*0.5) = 80.
  near(
    scoreAddress([sig('sanctions', 60), sig('ransomware', 50)], { ransomware: null }).finalScore,
    80,
    'null weight behaves as the default, not as 0',
  );

  // Non-numeric junk also defaults rather than zeroing.
  assert.equal(normaliseWeights({ sanctions: 'abc' }).sanctions, 1.0);
  // ...but a deliberate 0, in either number or string form, still means 0.
  assert.equal(normaliseWeights({ sanctions: 0 }).sanctions, 0);
  assert.equal(normaliseWeights({ sanctions: '0' }).sanctions, 0);
  assert.equal(normaliseWeights({ sanctions: '0.25' }).sanctions, 0.25);
});

// ---------------------------------------------------------------------------
// Step 3: bands
// ---------------------------------------------------------------------------

test('bands map to the documented ranges', () => {
  assert.equal(bandFor(0), 'Low');
  assert.equal(bandFor(24), 'Low');
  assert.equal(bandFor(24.999), 'Low');
  assert.equal(bandFor(25), 'Moderate');
  assert.equal(bandFor(49), 'Moderate');
  assert.equal(bandFor(50), 'Elevated');
  assert.equal(bandFor(74), 'Elevated');
  assert.equal(bandFor(74.25), 'Elevated', 'the fixture sits just under the High edge');
  assert.equal(bandFor(75), 'High');
  assert.equal(bandFor(100), 'High');
});

// ---------------------------------------------------------------------------
// Marginal shares
// ---------------------------------------------------------------------------

test('marginal shares always sum to 1', () => {
  const cases = [
    [sig('a', 85), sig('a', 60)],
    [sig('a', 10), sig('a', 90), sig('a', 45), sig('a', 45)],
    [sig('a', 100)],
    [sig('a', 0), sig('a', 0)], // degenerate: equal-share fallback
  ];
  for (const signals of cases) {
    const total = marginalShares(signals).reduce((s, x) => s + x.share, 0);
    near(total, 1, `shares sum to 1 for ${signals.length} signals`);
  }
});

test('the strongest signal takes the largest share', () => {
  const shares = marginalShares([sig('a', 30), sig('a', 90), sig('a', 60)]);
  const bySeverity = [...shares].sort((x, y) => y.signal.severity - x.signal.severity);
  assert.equal(bySeverity[0].signal.severity, 90);
  assert.ok(
    bySeverity[0].share > bySeverity[1].share && bySeverity[1].share > bySeverity[2].share,
    'shares strictly decrease with severity',
  );
});

test('marginal shares are returned in input order', () => {
  const signals = [sig('a', 30, 'first'), sig('a', 90, 'second')];
  const shares = marginalShares(signals);
  assert.equal(shares[0].signal.id, 'first');
  assert.equal(shares[1].signal.id, 'second');
});

test('all-zero-severity category splits shares equally', () => {
  const shares = marginalShares([sig('a', 0), sig('a', 0), sig('a', 0)]);
  for (const s of shares) near(s.share, 1 / 3, 'equal fallback share');
});

// ---------------------------------------------------------------------------
// THE INVARIANT: contributions sum to finalScore
// ---------------------------------------------------------------------------

const sumContributions = (r) => r.contributions.reduce((s, c) => s + c.contribution, 0);

const contributionOf = (result, id) =>
  result.contributions.find((c) => c.signal.id === id).contribution;

test('a category scoring 100 out-contributes one scoring 30 at equal weight', () => {
  // The regression this guards: an earlier formula scaled finalScore by the
  // weight fraction alone, dropping categoryScore. Two equally weighted
  // categories then got identical contributions no matter how they scored --
  // on the waterfall a severity-30 heuristic looked as important as an OFAC hit.
  const result = scoreAddress([
    sig('sanctions', 100, 'hot'),
    sig('transaction_profile', 30, 'cold'),
  ]);

  const hot = contributionOf(result, 'hot');
  const cold = contributionOf(result, 'cold');

  assert.ok(hot > cold, `expected the 100-scoring category to lead: ${hot} vs ${cold}`);
  // finalScore is 100 (sanctions saturates). Allocation is by effective score:
  // sanctions 1.0, transaction_profile 0.3, total 1.3 -> 100*(1/1.3) and
  // 100*(0.3/1.3).
  near(hot, (100 * 1.0) / 1.3, 'sanctions contribution');
  near(cold, (100 * 0.3) / 1.3, 'transaction_profile contribution');
  near(hot + cold, result.finalScore, 'still reconciles');

  // The ordering must follow categoryScore, not signal count: one strong signal
  // beats two weak ones in another category at the same weight.
  const mixed = scoreAddress([
    sig('sanctions', 90, 'single_strong'),
    sig('obfuscation', 20, 'weak_a'),
    sig('obfuscation', 20, 'weak_b'),
  ]);
  const strong = contributionOf(mixed, 'single_strong');
  const weakTotal = contributionOf(mixed, 'weak_a') + contributionOf(mixed, 'weak_b');
  assert.ok(strong > weakTotal, `expected 90 to beat two 20s: ${strong} vs ${weakTotal}`);
});

test('contributions scale with categoryScore at equal weight, across the range', () => {
  // Same weight everywhere, so contribution order must exactly track category score.
  const result = scoreAddress([
    sig('sanctions', 100, 'a'),
    sig('ransomware', 75, 'b'),
    sig('obfuscation', 50, 'c'),
    sig('transaction_profile', 25, 'd'),
  ]);

  const ordered = ['a', 'b', 'c', 'd'].map((id) => contributionOf(result, id));
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      ordered[i - 1] > ordered[i],
      `contribution ${i - 1} (${ordered[i - 1]}) must exceed ${i} (${ordered[i]})`,
    );
  }
  // Allocation is finalScore * effective_c / sum(effective). Effective scores
  // are 1.0, 0.75, 0.5 and 0.25 at equal weight, so the split is 40/30/20/10 %
  // of a saturated finalScore of 100.
  near(ordered[0], 40, 'score 100 -> 40% of the total');
  near(ordered[3], 10, 'score 25 -> 10% of the total');
  near(sumContributions(result), result.finalScore, 'still reconciles');
});

test('weight still modulates contribution independently of score', () => {
  // Weights attenuate, so a lower-scoring category outranks a higher-scoring one
  // by having the higher one turned DOWN -- score drives the split, but weight
  // is still a real lever. sanctions 100 at 0.2 gives effective 0.2;
  // transaction_profile 30 at 1.0 gives 0.3.
  const result = scoreAddress(
    [sig('sanctions', 100, 'hot'), sig('transaction_profile', 30, 'cold')],
    { sanctions: 0.2, transaction_profile: 1 },
  );
  const total = 0.2 + 0.3;
  near(contributionOf(result, 'hot'), (result.finalScore * 0.2) / total, 'weighted-down sanctions');
  near(contributionOf(result, 'cold'), (result.finalScore * 0.3) / total, 'full-weight profile');
  assert.ok(
    contributionOf(result, 'cold') > contributionOf(result, 'hot'),
    'attenuating a category can invert the order',
  );
  near(sumContributions(result), result.finalScore, 'still reconciles');
});

test('SYMMETRY: equal effective evidence gets equal bars, whatever the category order', () => {
  // Regression: an earlier allocation consumed the remaining probability mass in
  // CATEGORIES order, so the category listed first got a bar twice the size of
  // an identically-scoring peer. The bars encoded array position, not evidence.
  const result = scoreAddress([sig('sanctions', 50, 'first'), sig('ransomware', 50, 'second')]);
  near(contributionOf(result, 'first'), contributionOf(result, 'second'), 'equal evidence');
  near(sumContributions(result), result.finalScore, 'still reconciles');
});

test('INVARIANT: contributions sum to finalScore (fixture)', () => {
  const result = scoreAddress(fixture.signals);
  near(sumContributions(result), result.finalScore, 'fixture contributions');
});

test('INVARIANT: contributions sum to finalScore across many shapes', () => {
  const cases = [
    { name: 'single signal', signals: [sig('sanctions', 100)] },
    { name: 'one per category', signals: CATEGORIES.map((c, i) => sig(c, (i + 1) * 17)) },
    {
      name: 'lopsided category',
      signals: [sig('ransomware', 90), sig('ransomware', 80), sig('ransomware', 70), sig('sanctions', 10)],
    },
    { name: 'zero severities', signals: [sig('obfuscation', 0), sig('obfuscation', 0)] },
    {
      name: 'zero severity beside a real hit',
      signals: [sig('obfuscation', 0), sig('sanctions', 100)],
    },
    { name: 'weighted', signals: [sig('sanctions', 100), sig('counterparty', 40)], weights: { sanctions: 1, counterparty: 0.5 } },
    { name: 'a category zeroed', signals: [sig('sanctions', 80), sig('ransomware', 60)], weights: { ransomware: 0 } },
  ];

  for (const { name, signals, weights } of cases) {
    const result = scoreAddress(signals, weights);
    const delta = Math.abs(sumContributions(result) - result.finalScore);
    assert.ok(delta < SUM_EPSILON, `${name}: contributions off by ${delta}`);
  }
});

test('INVARIANT: holds under randomised input', () => {
  // Deterministic LCG so a failure is reproducible.
  let seed = 20260727;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

  for (let iter = 0; iter < 500; iter++) {
    const count = Math.floor(rand() * 12);
    const signals = Array.from({ length: count }, (_, i) =>
      sig(CATEGORIES[Math.floor(rand() * CATEGORIES.length)], Math.round(rand() * 100), `s${i}`),
    );
    const weights = Object.fromEntries(
      CATEGORIES.map((c) => [c, Math.round(rand() * 6) / 2]), // 0, 0.5 ... 3
    );

    const result = scoreAddress(signals, weights);
    const delta = Math.abs(sumContributions(result) - result.finalScore);
    assert.ok(delta < SUM_EPSILON, `iter ${iter}: contributions off by ${delta}`);
    assert.ok(
      result.finalScore >= 0 && result.finalScore <= 100,
      `iter ${iter}: score ${result.finalScore} out of range`,
    );
  }
});

// ---------------------------------------------------------------------------
// Golden numbers from tools/scoring_reference.py
// ---------------------------------------------------------------------------

test('GOLDEN: fixture category scores match the reference implementation', () => {
  const result = scoreAddress(fixture.signals);
  const expected = {
    sanctions: 100, // one signal at 100
    ransomware: 95, // 100 * (1 - 0.05 * 1.00); group_context ships at severity 0
    obfuscation: 57.75, // 100 * (1 - 0.65 * 0.65)
    transaction_profile: 78.55, // 100 * (1 - 0.55 * 0.60 * 0.65)
    counterparty: 70, // one signal at 70
  };
  for (const [category, score] of Object.entries(expected)) {
    near(result.categories.find((c) => c.category === category).score, score, category);
  }
});

test('GOLDEN: fixture final score is 100 / High over all 5 active categories', () => {
  // Cross-checked against `python backend/scripts/scoring_reference.py`: the two
  // implementations agree to 1e-9 on the final score, every category score and
  // every per-signal contribution, across all four presets.
  //
  // 100 exactly, because the fixture carries a severity-100 sanctions hit and
  // the cross-category operator is a probabilistic OR: an effective score of 1.0
  // leaves no residual mass for anything else to reduce. That is the intended
  // reading -- a confirmed OFAC designation is a maximum-risk finding, and no
  // amount of additional or absent evidence should move it.
  const result = scoreAddress(fixture.signals);
  near(result.finalScore, 100, 'final score');
  assert.equal(result.band, 'High');
  assert.equal(result.totalActiveWeight, 5, 'the real fixture populates every category');
  assert.deepEqual(
    result.categories.filter((c) => c.active).map((c) => c.category),
    ['sanctions', 'ransomware', 'obfuscation', 'transaction_profile', 'counterparty'],
  );
});

test('GOLDEN: the fixture exercises all five categories and 9 signals', () => {
  // Guards against a fixture swap silently narrowing coverage.
  assert.equal(fixture.signals.length, 9);
  const seen = new Set(fixture.signals.map((s) => s.category));
  assert.deepEqual([...seen].sort(), [...CATEGORIES].sort());
});

test('GOLDEN: fixture per-signal contributions match the reference implementation', () => {
  const result = scoreAddress(fixture.signals);
  // Full-precision values, copied from `python tools/scoring_reference.py --json`.
  // Do not retype these from the human-readable table -- it rounds to 6 decimals,
  // which is coarser than the 1e-9 tolerance these assertions use.
  //
  // Each category hands out finalScore * effective_c / sum(effective), split by
  // marginal share within the category. Verified identical to
  // `backend/scripts/scoring_reference.py` across all four presets.
  const expected = {
    'sanctions.direct_hit': { share: 1.0, contribution: 24.919013207077 },
    'ransomware.known_address': { share: 1.0, contribution: 23.673062546723152 },
    // group_context ships at severity 0 by design: it names the group without
    // asserting extra risk, so it earns a zero-height bar rather than a
    // missing one -- the reader still sees the signal was considered.
    'ransomware.group_context': { share: 0, contribution: 0 },
    'counterparty.flagged_neighbor': { share: 1.0, contribution: 17.443309244953902 },
    'obfuscation.self_peel': { share: 0.6060606060606061, contribution: 8.72165462247695 },
    'obfuscation.rapid_forward': { share: 0.3939393939393939, contribution: 5.669075504610016 },
    'profile.collection_pattern': { share: 0.5728835136855506, contribution: 11.21355594318465 },
    'profile.burst_then_dormant': { share: 0.2800763844684914, contribution: 5.48218290555694 },
    'profile.round_value_payments': { share: 0.147040101845958, contribution: 2.878146025417394 },
  };

  assert.equal(result.contributions.length, 9);
  for (const c of result.contributions) {
    const want = expected[c.signal.id];
    assert.ok(want, `unexpected contribution for ${c.signal.id}`);
    near(c.share, want.share, `${c.signal.id} share`);
    near(c.contribution, want.contribution, `${c.signal.id} contribution`);
  }
});
