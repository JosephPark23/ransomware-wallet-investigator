/**
 * Scoring math for Bitcoin address risk.
 *
 * Pure functions only: no React, no fetch, no I/O. Everything here is
 * deterministic and depends solely on its arguments, so it can be unit tested
 * directly and ported to the backend if the reference implementation drifts.
 *
 * See docs/SCORING.md for the derivation of the marginal-share algorithm.
 */

/** The five risk categories. This list is exhaustive and ordered for display. */
export const CATEGORIES = [
  'sanctions',
  'ransomware',
  'obfuscation',
  'transaction_profile',
  'counterparty',
];

export const DEFAULT_WEIGHT = 1.0;
export const WEIGHT_MIN = 0;
/**
 * Weights are ATTENUATION factors, not multipliers: 1.0 lets a category's
 * evidence count in full, 0 removes it, and values between dial it down. There
 * is deliberately no way to amplify past 1.0 -- the cross-category operator in
 * scoreAddress() is only monotone and bounded while every effective score stays
 * inside [0, 1], and "count this more than fully" has no meaning for evidence.
 * A stronger opinion is expressed by lowering the other four.
 */
export const WEIGHT_MAX = 1;

/** Band thresholds. A score is in a band when score < cutoff, top band catches the rest. */
const BANDS = [
  { name: 'Low', cutoff: 25 },
  { name: 'Moderate', cutoff: 50 },
  { name: 'Elevated', cutoff: 75 },
  { name: 'High', cutoff: Infinity },
];

/** Tolerance for the "contributions sum to finalScore" invariant, given float math. */
export const SUM_EPSILON = 1e-9;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Severity is a 0-100 number; anything else is treated as 0 rather than NaN-poisoning the score. */
function safeSeverity(signal) {
  const raw = Number(signal?.severity);
  return Number.isFinite(raw) ? clamp(raw, 0, 100) : 0;
}

/** Every category at its default weight. */
export function defaultWeights() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, DEFAULT_WEIGHT]));
}

/**
 * Fill in missing categories with the default and clamp everything to [0, 1].
 * Unknown keys are dropped so a stale weight can't leak into the denominator.
 *
 * Only a real number (or a numeric string) counts as a weight. This matters more
 * than it looks: Number(null), Number(''), Number([]) and Number(false) are all
 * 0, so a naive coercion would read an *absent* weight as an explicit zero and
 * silently drop that category from the denominator — turning a missing config
 * value into a wrong score. Absent means "default 1.0"; only a deliberate 0
 * removes a category.
 */
export function normaliseWeights(partial = {}) {
  const out = {};
  for (const c of CATEGORIES) {
    const raw = partial?.[c];
    const num =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : NaN;
    out[c] = Number.isFinite(num) ? clamp(num, WEIGHT_MIN, WEIGHT_MAX) : DEFAULT_WEIGHT;
  }
  return out;
}

/** Group signals by category, preserving input order within each. */
export function groupByCategory(signals = []) {
  const groups = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const s of signals) {
    if (groups[s?.category]) groups[s.category].push(s);
  }
  return groups;
}

/**
 * Step 1 — saturating (probabilistic) OR within a category:
 *   categoryScore = 100 * (1 - product of (1 - severity_i/100))
 *
 * Two 50s combine to 75, not 100: each additional signal closes part of the
 * remaining gap rather than adding linearly.
 */
export function categoryScore(signals = []) {
  if (signals.length === 0) return 0;
  let remaining = 1;
  for (const s of signals) {
    remaining *= 1 - safeSeverity(s) / 100;
  }
  return 100 * (1 - remaining);
}

/**
 * Marginal share of each signal within its category, normalised to sum to 1.
 *
 * Signals are sorted by descending severity; each takes credit for the portion
 * of the gap it closes (running * severity), where `running` is the unclosed
 * fraction before that signal. The strongest signal therefore gets the largest
 * share, and weaker overlapping signals are discounted rather than double-counted.
 *
 * Returns an array of { signal, share } in the original input order.
 */
export function marginalShares(signals = []) {
  if (signals.length === 0) return [];

  // Sort a copy by descending severity; ties keep their relative input order so
  // the output is stable and reproducible across runs.
  const ordered = signals
    .map((signal, index) => ({ signal, index, severity: safeSeverity(signal) }))
    .sort((a, b) => b.severity - a.severity || a.index - b.index);

  let running = 1;
  let total = 0;
  const credits = new Array(signals.length).fill(0);

  for (const { index, severity } of ordered) {
    const credit = running * severity;
    credits[index] = credit;
    total += credit;
    running *= 1 - severity / 100;
  }

  // total === categoryScore analytically. When every severity is 0 the credits
  // are all 0 and there is no meaningful split, so fall back to an equal share.
  // This keeps the shares summing to exactly 1, which the contributions
  // invariant depends on even for a zero-scoring category.
  if (total === 0) {
    const equal = 1 / signals.length;
    return signals.map((signal) => ({ signal, share: equal }));
  }

  return signals.map((signal, i) => ({ signal, share: credits[i] / total }));
}

/** Band name for a score, e.g. 74.25 -> "Elevated". */
export function bandFor(score) {
  return BANDS.find((b) => score < b.cutoff).name;
}

/**
 * Full scoring pass.
 *
 * Step 2 — monotone probabilistic OR across categories:
 *   effective_c = (categoryScore_c / 100) * weight_c
 *   finalScore  = 100 * (1 - product over active categories of (1 - effective_c))
 *
 * A category is active when it produced at least one signal AND carries a
 * non-zero weight.
 *
 * This replaces the weighted average the first version used. The average was
 * monotone in nothing: an OFAC-sanctioned address scoring 100 on `sanctions`
 * alone dropped to 46 once four *additional* incriminating signals arrived in
 * other categories, because each new category pulled the mean down. Averaging
 * treats evidence as a poll. It is not a poll -- evidence accumulates, and the
 * operator has to be non-decreasing in it. Probabilistic OR is, and it is the
 * same operator already used inside a category, so there is one idea on the
 * screen instead of two.
 *
 * Weights attenuate rather than renormalise. Under the old form, raising one
 * category's weight lowered every other category's influence, so "I care more
 * about sanctions" silently meant "I care less about ransomware" -- not what
 * the control says. Here each weight only scales its own category's evidence.
 *
 * Step 3 — per-signal contribution:
 *   categoryContribution_c = finalScore * effective_c / sum of effective
 *   contribution_i         = categoryContribution_c * marginalShare_i
 *
 * The allocation is symmetric: two categories with equal effective evidence
 * receive equal bars. An earlier draft consumed the remaining probability mass
 * in CATEGORIES order, which gave whichever category happened to be listed
 * first a bar twice the size of an identically-scoring peer -- the bars encoded
 * array position, not evidence. Both invariants must hold on any future change:
 * contributions sum exactly to finalScore, AND equal evidence gets equal credit.
 *
 * @returns {{
 *   finalScore: number, band: string, totalActiveWeight: number,
 *   categories: Array<{category,score,weight,active,signalCount,effective,weightFraction}>,
 *   contributions: Array<{signal,category,share,contribution}>
 * }}
 */
export function scoreAddress(signals = [], weightsInput = {}) {
  const weights = normaliseWeights(weightsInput);
  const groups = groupByCategory(signals);

  const categories = CATEGORIES.map((category) => {
    const catSignals = groups[category];
    const weight = weights[category];
    // Weight 0 removes the category entirely.
    const active = catSignals.length > 0 && weight > 0;
    const score = categoryScore(catSignals);
    return {
      category,
      weight,
      active,
      signalCount: catSignals.length,
      score,
      effective: active ? (score / 100) * weight : 0,
      weightFraction: 0, // filled in below, once the allocation base is known
    };
  });

  const totalActiveWeight = categories.reduce((sum, c) => sum + (c.active ? c.weight : 0), 0);
  const totalEffective = categories.reduce((sum, c) => sum + c.effective, 0);

  // No signals, every weighted-in category zeroed by the user, or every active
  // category scored 0 (a lone severity-0 informational signal does this).
  if (totalEffective === 0) {
    return {
      finalScore: 0,
      band: bandFor(0),
      totalActiveWeight,
      categories,
      contributions: categories.flatMap((c) =>
        groups[c.category].map((signal) => ({
          signal,
          category: c.category,
          share: 0,
          contribution: 0,
        })),
      ),
    };
  }

  let remaining = 1;
  for (const c of categories) {
    remaining *= 1 - c.effective;
  }
  const finalScore = 100 * (1 - remaining);

  const contributions = [];
  for (const c of categories) {
    if (!c.active) continue;
    c.weightFraction = c.effective / totalEffective;
    const categoryContribution = finalScore * c.weightFraction;
    for (const { signal, share } of marginalShares(groups[c.category])) {
      contributions.push({
        signal,
        category: c.category,
        share,
        contribution: categoryContribution * share,
      });
    }
  }

  return { finalScore, band: bandFor(finalScore), totalActiveWeight, categories, contributions };
}
