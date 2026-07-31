/**
 * The counterfactual line: how much of the score rests on the sanctions listing.
 *
 * Pure, so the numbers can be asserted in a unit test rather than eyeballed.
 *
 * ## Which counterfactual, and why
 *
 * This re-runs the score with the SANCTIONS weight set to 0, leaving every other
 * weight exactly as the user has it, and reports both numbers. It answers "how
 * much of this score is the OFAC listing, and how much is everything else?" --
 * which is the question an analyst actually has when a list match and a pile of
 * behavioural evidence arrive together.
 *
 * ## Two earlier forms, and why neither survives
 *
 * The brief specified zeroing sanctions but worded the sentence as "weighted as
 * a compliance officer would". Those disagree: zeroing is the removal view, a
 * compliance officer's view is the emphasis view. The first implementation
 * resolved that by keeping the sentence and raising the sanctions weight to 3.0.
 *
 * That is no longer expressible. scoring.js now defines weights as attenuation
 * factors in [0, 1], so 3.0 clamps to 1.0 and, at the default weighting where
 * sanctions already sits at 1.0, the "emphasis" counterfactual compares a number
 * to itself. Worse, the cross-category operator is a probabilistic OR: a
 * severity-100 sanctions hit drives the score to exactly 100 under ANY weighting
 * that leaves sanctions switched on, so the emphasis form can never move the
 * number for the only sanctions rule that exists (`sanctions.direct_hit`, always
 * severity 100). The line would have rendered on no address at all.
 *
 * Resolved the other way round: keep the maths the brief asked for, fix the
 * sentence. Removal always moves the score for an address carrying a sanctions
 * signal, it is the form `scripts/scoring_reference.py` already implements on
 * the backend, and "scores 50 instead of 100 without the listing" is a more
 * useful sentence than either alternative.
 */

import { scoreAddress } from './scoring.js';

/** The category the counterfactual removes. */
export const COUNTERFACTUAL_CATEGORY = 'sanctions';

/**
 * Scores are displayed to two decimals, so a delta below half of the last place
 * would render as "X instead of X" -- the same meaningless sentence the
 * no-signals guard exists to prevent.
 */
const VISIBLE_DELTA = 0.005;

/**
 * @param {Array} signals            the current signal list
 * @param {object} weights           the user's current weights
 * @param {object} result            the already-computed scoreAddress() result
 * @returns {{score, baseline, band, delta} | null}  null means render nothing
 */
export function counterfactual(signals = [], weights = {}, result = null) {
  if (!result) return null;

  // Guard from the brief: with no sanctions signal, removing the sanctions
  // weight cannot move the score, and the line would compare it to itself.
  const sanctions = result.categories?.find((c) => c.category === COUNTERFACTUAL_CATEGORY);
  if (!sanctions || sanctions.signalCount === 0) return null;

  const alternative = scoreAddress(signals, {
    ...weights,
    [COUNTERFACTUAL_CATEGORY]: 0,
  });

  const delta = alternative.finalScore - result.finalScore;

  // Same guard, second cause: the user has already zeroed sanctions themselves.
  if (Math.abs(delta) < VISIBLE_DELTA) return null;

  return {
    score: alternative.finalScore,
    baseline: result.finalScore,
    band: alternative.band,
    delta,
  };
}
