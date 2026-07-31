/**
 * Layout math for the waterfall chart.
 *
 * Pure functions, no React, no Recharts -- so the geometry the chart actually
 * renders can be asserted in a plain `node --test` unit test. That separation is
 * the point: `scoring.js` proves the CONTRIBUTIONS reconcile, and this module
 * proves the BARS DRAWN FROM THEM reconcile. A chart can be wrong in ways the
 * scoring tests cannot see -- a dropped row, a stale sort, a base segment that
 * accumulates the wrong neighbour -- and none of that shows up in a sum over the
 * contributions array.
 *
 * Nothing here recomputes any scoring quantity. `contribution` arrives from
 * scoring.js already correct; all this module does is order the rows and take a
 * running total, which is chart geometry (where a bar starts on the y-axis), not
 * scoring.
 */

/** X-axis labels are truncated to this many characters; the full text is in the tooltip. */
export const LABEL_MAX_CHARS = 22;

/** Y-axis rounds up to a multiple of this, so the top gridline is a round number. */
const AXIS_STEP = 10;

/**
 * Turn scoring contributions into stacked-bar rows, ordered by descending
 * contribution.
 *
 * Each row is drawn as two stacked segments: an invisible `base` (everything
 * accumulated before this signal) and a visible `contribution` on top of it.
 * `cumulative` is the top edge of the visible segment -- the running total after
 * this signal -- and the LAST row's `cumulative` is where the waterfall lands.
 * That number must equal finalScore, and is what the test asserts.
 *
 * Contributions from scoring.js are never negative (severity and weight are both
 * clamped to be non-negative), so the staircase only ever climbs.
 *
 * @param {Array<{signal: object, category: string, contribution: number}>} contributions
 * @returns {Array<{id, label, category, contribution, base, cumulative}>}
 */
export function buildWaterfallRows(contributions = []) {
  const ordered = contributions
    .map((entry, index) => ({ entry, index }))
    // Descending contribution; ties keep input order so the chart is stable
    // between renders rather than reshuffling equal bars.
    .sort((a, b) => b.entry.contribution - a.entry.contribution || a.index - b.index);

  let running = 0;

  return ordered.map(({ entry }, position) => {
    // A NaN contribution would poison every base after it and silently detach
    // the last bar from the dial, so it is floored to 0 rather than propagated.
    const contribution = Number.isFinite(entry?.contribution) ? entry.contribution : 0;
    const base = running;
    running += contribution;

    return {
      id: entry?.signal?.id ?? `${entry?.category ?? 'signal'}-${position}`,
      label: entry?.signal?.label ?? entry?.signal?.id ?? 'Unnamed signal',
      category: entry?.category,
      contribution,
      base,
      cumulative: running,
    };
  });
}

/**
 * The total the chart actually draws: the top edge of the final bar.
 *
 * Read off the rows rather than re-summing the contributions, because re-summing
 * would just re-derive the scoring invariant and pass even if the bars were
 * built wrong.
 */
export function renderedTotal(rows = []) {
  return rows.length === 0 ? 0 : rows[rows.length - 1].cumulative;
}

/**
 * Y-axis upper bound: the next round number at or above the total, never below
 * one step and never above 100.
 *
 * 100 is the top of the score domain, not an arbitrary large value, so a
 * saturated score is drawn touching the ceiling rather than rounded up to 110.
 * Headroom above 100 would imply the scale continues, and a reader who sees a
 * bar stop short of a 110 gridline will read a maxed-out score as merely high.
 * A saturated score is now the common case for any address with a direct OFAC
 * hit, so this is the case worth getting right.
 */
export function axisMax(total) {
  if (!Number.isFinite(total) || total <= 0) return AXIS_STEP;
  return Math.min(100, Math.max(AXIS_STEP, Math.ceil(total / AXIS_STEP) * AXIS_STEP));
}

/** Trim a signal label for the x-axis. The untruncated label lives in the tooltip. */
export function truncateLabel(label, max = LABEL_MAX_CHARS) {
  const text = String(label ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Round for display: 4.4 stays 4.4, 20.000000000000004 becomes 20. */
export const formatScore = (n) => String(Math.round(n * 100) / 100);
