/**
 * Placeholder for the dial, the waterfall and the signal list while an analysis
 * is in flight.
 *
 * A live analysis takes 10-20 seconds (contract.md), which is long enough that
 * a spinner alone reads as a hang. The skeleton holds the shape of the answer
 * so the page does not jump when it arrives, and the duration note tells the
 * reader the wait is expected rather than broken.
 *
 * It replaces the results rather than overlaying them: the previous address's
 * dial left visible under a spinner is a wrong number on screen, and this app
 * has exactly one job -- being right about a number.
 */

const Shimmer = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-slate-800/70 ${className}`} />
);

/** Bar heights for the fake waterfall. Descending, like the real one. */
const BAR_HEIGHTS = ['h-40', 'h-32', 'h-28', 'h-20', 'h-16', 'h-12', 'h-10', 'h-8'];

export default function AnalysisSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Analysing address"
      className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start"
    >
      {/* Dial column */}
      <div className="space-y-4">
        <section className="rounded-2xl bg-slate-900/60 p-6 ring-1 ring-slate-800">
          <Shimmer className="h-3 w-24" />
          <div className="mx-auto mt-4 flex h-52 w-full max-w-64 items-center justify-center">
            <div className="h-40 w-40 animate-pulse rounded-full border-[16px] border-slate-800/70" />
          </div>
          <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
            {[0, 1, 2, 3].map((i) => (
              <Shimmer key={i} className="h-2.5 w-full" />
            ))}
          </div>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
            This can take 10-20 seconds against live data.
          </p>
        </section>

        <section className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
          <Shimmer className="h-3 w-32" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Shimmer key={i} className="h-2.5 w-full" />
            ))}
          </div>
        </section>
      </div>

      {/* Waterfall + signal list column */}
      <div className="space-y-6">
        <section className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
          <Shimmer className="h-3 w-40" />
          <div className="mt-6 flex h-[300px] items-end gap-3">
            {BAR_HEIGHTS.map((height, i) => (
              <div key={i} className="flex flex-1 flex-col justify-end">
                <Shimmer className={height} />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            {BAR_HEIGHTS.map((_, i) => (
              <Shimmer key={i} className="h-2 flex-1" />
            ))}
          </div>
        </section>

        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <section key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <Shimmer className="h-3.5 w-1/2" />
              <div className="mt-3 space-y-2">
                <Shimmer className="h-2.5 w-full" />
                <Shimmer className="h-2.5 w-5/6" />
              </div>
              <Shimmer className="mt-4 h-1.5 w-28" />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
