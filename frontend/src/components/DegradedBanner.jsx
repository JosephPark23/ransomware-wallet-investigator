import { AlertTriangle } from 'lucide-react';

/**
 * Shown above the score dial when the backend answered but something failed on
 * the way (contract.md rule 7).
 *
 * The wording is load-bearing. `degraded: true` does NOT mean the results are
 * worthless -- it means part of the picture is missing, and the reader has to
 * know WHICH part before they trust the number underneath. So the banner names
 * what failed and stops; it does not editorialise about the score, and it does
 * not hide or grey out the results it sits above.
 *
 * Amber, not red: red is the High band's colour on this screen, and a red bar
 * over the dial would read as "this address is dangerous" rather than "this
 * analysis is incomplete". Those are opposite claims.
 */
export default function DegradedBanner({ warnings = [] }) {
  return (
    <section
      role="status"
      aria-label="Degraded analysis"
      className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-amber-200">Partial results</h2>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
            Something failed during this analysis and it completed anyway. The score below is
            computed from the evidence that did load.
          </p>

          {warnings.length > 0 ? (
            <ul className="mt-2.5 space-y-1">
              {warnings.map((warning, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-xs leading-relaxed text-amber-100/90"
                >
                  <span className="text-amber-500/60" aria-hidden="true">
                    •
                  </span>
                  <span className="min-w-0 break-words">{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            // A degraded response with an empty `warnings` array is legal under
            // the contract, and an empty amber box would be worse than useless.
            // Saying the detail is missing is itself the warning.
            <p className="mt-2.5 text-xs italic text-amber-100/70">
              No detail was reported about what failed.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
