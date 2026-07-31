/**
 * The staged progress model shown while an analysis runs.
 *
 * Pure, no timers and no React: it maps elapsed milliseconds to a stage and a
 * fraction, and the component owns the clock. That keeps every awkward case --
 * the response that beats the estimate, the one that overruns it -- assertable
 * in a plain node test.
 *
 * ## What this is honest about
 *
 * `POST /api/analyze` is a single opaque request. There is no progress event to
 * subscribe to, so any bar drawn here is an ESTIMATE against the documented
 * 10-20 second budget, not a measurement. Two consequences, both deliberate:
 *
 *   1. The fraction is capped below 1 and never completes on its own. A bar that
 *      fills to 100% and then sits there is worse than no bar at all -- it
 *      states the work is finished when it is not. Completion is caused by the
 *      response arriving, never by the clock.
 *
 *   2. Once the estimate is overrun the interface says so rather than inventing
 *      more progress. `overtime` is what the component uses to swap in "this is
 *      taking longer than usual" instead of quietly stretching the animation.
 *
 * The stages themselves are real: they name the work the backend actually does,
 * in the order it does it, which is what makes the wait legible rather than
 * merely decorated. A spinner says "something is happening"; "Screening against
 * sanctions and ransomware lists" says what, and that is the difference between
 * a wait that feels attended and one that feels hung.
 */

/**
 * Stage weights are rough shares of the total budget, not measurements. Chain
 * retrieval dominates because it is the only stage that makes external network
 * calls; scoring is arithmetic over data already in memory.
 */
export const STAGES = [
  {
    id: 'chain',
    label: 'Retrieving transaction history',
    detail: 'Pulling this address\u2019s transactions from the chain data provider.',
    weight: 0.34,
  },
  {
    id: 'screen',
    label: 'Screening against watchlists',
    detail: 'Checking the address against sanctions and ransomware datasets.',
    weight: 0.16,
  },
  {
    id: 'graph',
    label: 'Mapping counterparties',
    detail: 'Following transactions outward to build the counterparty graph.',
    weight: 0.24,
  },
  {
    id: 'taint',
    label: 'Tracing routes to flagged addresses',
    detail: 'Searching the graph for paths that reach something on a watchlist.',
    weight: 0.16,
  },
  {
    id: 'score',
    label: 'Weighing evidence',
    detail: 'Combining findings into a score and assembling the explanation.',
    weight: 0.1,
  },
];

/** Nominal duration of a live analysis, from the backend contract. */
export const BUDGET_MS = 15000;

/** The bar stops here and waits. Completion is an event, not a deadline. */
export const CEILING = 0.94;

/** Past this multiple of the budget the interface stops implying an estimate. */
const OVERTIME_FACTOR = 1.35;

const cumulativeWeights = (() => {
  let running = 0;
  return STAGES.map((stage) => {
    const start = running;
    running += stage.weight;
    return { start, end: running };
  });
})();

/**
 * Where the analysis appears to be, given how long it has been running.
 *
 * @param {number} elapsedMs
 * @param {{budgetMs?: number}} [options]
 * @returns {{
 *   index: number, stage: object, fraction: number,
 *   completed: string[], overtime: boolean, elapsedSeconds: number
 * }}
 */
export function progressAt(elapsedMs, { budgetMs = BUDGET_MS } = {}) {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const budget = budgetMs > 0 ? budgetMs : BUDGET_MS;

  // Approach the ceiling asymptotically rather than linearly. A linear bar that
  // is 60% full at 9 seconds promises delivery at 15 and breaks that promise on
  // every slow request; a decaying curve slows visibly as it approaches the
  // ceiling, which reads as "nearly there" without committing to a time.
  const raw = 1 - Math.exp((-2.2 * elapsed) / budget);
  const fraction = Math.min(CEILING, raw * CEILING);

  // The final stage holds indefinitely: work that overruns the estimate is
  // still work, and demoting it back to an earlier stage would be a lie.
  const index = Math.min(
    STAGES.length - 1,
    cumulativeWeights.findIndex(({ end }) => fraction < end * CEILING) === -1
      ? STAGES.length - 1
      : cumulativeWeights.findIndex(({ end }) => fraction < end * CEILING),
  );

  return {
    index,
    stage: STAGES[index],
    fraction,
    completed: STAGES.slice(0, index).map((s) => s.id),
    overtime: elapsed > budget * OVERTIME_FACTOR,
    elapsedSeconds: Math.floor(elapsed / 1000),
  };
}
