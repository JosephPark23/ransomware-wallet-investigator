import { AlertTriangle, Database, HelpCircle } from 'lucide-react';

import { formatCount, formatDate } from '../lib/format.js';

/**
 * Provenance: which intel sources were loaded, how big each one was, and when
 * it was last pulled.
 *
 * Every number on this screen traces back to something listed here, so the
 * panel is deliberately a full card with a heading rather than a footnote --
 * "scored 82" is an assertion, "scored 82 against an OFAC list of 522 entries
 * retrieved this morning" is a citation, and only the second one survives being
 * asked "says who?".
 *
 * Staleness is the thing a reader actually needs from this panel: an OFAC list
 * pulled six months ago will happily miss a designation made last week. The
 * retrieved-at date is therefore given equal weight to the record count, not
 * tucked into a tooltip.
 *
 * The backend now says so directly. `stale` is a tri-state: `true` (older than
 * the configured maximum age), `false` (fresh), or `null` (the snapshot has no
 * recorded retrieval time at all, because it predates the provenance manifest).
 * Those three need three different treatments, and the third is the one worth
 * getting right -- an unknown retrieval time is NOT the same as a recent one,
 * and it is not an error either. It is a citation with the date torn off.
 *
 * An earlier version rendered a missing `retrieved_at` as "computed locally, not
 * retrieved", reasoning that behavioural heuristics have no external source.
 * That confused two different fields: heuristics appear in `signal.source`,
 * never in `sources_used`, so everything on this panel IS an external dataset
 * and a missing date here can only mean unknown provenance. Labelling unknown
 * provenance as locally computed is the exact opposite of what this panel is
 * for.
 */

export default function SourcePanel({ sources = [] }) {
  const list = Array.isArray(sources) ? sources : [];

  return (
    <section
      className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800"
      aria-label="Intelligence sources used"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Sources used
        </h2>
        {list.length > 0 && (
          <span className="text-xs tabular-nums text-slate-500">
            {list.length} {list.length === 1 ? 'dataset' : 'datasets'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Every finding on this page traces back to one of these.
      </p>

      {list.length === 0 ? (
        // Not the same as "no signals". No sources means nothing was checked,
        // which makes the score above meaningless rather than merely low.
        <p className="mt-4 text-sm text-amber-300/80">
          No sources were reported for this analysis. Treat the score above as unsupported.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((source, i) => {
            const retrieved = formatDate(source?.retrieved_at);
            const records = formatCount(source?.records);
            // Strictly `true`/`null`: anything else is treated as fresh, so a
            // backend that omits the field cannot paint every source amber.
            const stale = source?.stale === true;
            const provenanceUnknown = !retrieved;

            return (
              <li
                key={source?.name ?? i}
                className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
              >
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words text-slate-200">
                      {source?.name ?? 'Unnamed source'}
                    </p>

                    <p className="mt-1.5 text-xs text-slate-400">
                      {records === null ? (
                        <span className="text-slate-600 italic">record count not reported</span>
                      ) : (
                        <>
                          <span className="font-medium tabular-nums text-slate-300">{records}</span>{' '}
                          {records === '1' ? 'record' : 'records'}
                        </>
                      )}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-500">
                      {retrieved ? (
                        <>
                          retrieved{' '}
                          <time dateTime={source.retrieved_at} title={source.retrieved_at}>
                            {retrieved}
                          </time>
                        </>
                      ) : (
                        <span className="italic">retrieval time not recorded</span>
                      )}
                    </p>

                    {(stale || provenanceUnknown) && (
                      <p
                        className={`mt-1.5 flex items-start gap-1.5 text-xs ${
                          stale ? 'text-amber-300/90' : 'text-slate-500'
                        }`}
                      >
                        {stale ? (
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        )}
                        <span>
                          {stale
                            ? 'Stale — refresh before relying on a negative result from this list.'
                            : 'Age unknown, so this list cannot be confirmed current.'}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
