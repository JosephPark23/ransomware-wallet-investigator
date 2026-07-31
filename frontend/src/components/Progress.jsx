import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { STAGES, progressAt } from '../lib/progress.js';
import { AddressText, Card } from './ui.jsx';

/**
 * What the user watches for ten to twenty seconds.
 *
 * The old build showed a static shimmer and a line of text saying the wait was
 * expected. That is better than a bare spinner and still not enough: nothing on
 * screen changed for twenty seconds, so the only evidence the app was alive was
 * a CSS pulse, and a reader who has been burned by a hung page cannot tell those
 * apart.
 *
 * Here the stage list advances, the bar moves, and the elapsed counter ticks.
 * Three independent things changing is what distinguishes "working" from
 * "frozen", and the stage names make the wait legible: the reader learns what
 * the tool is doing, which is a small piece of education delivered in dead time.
 *
 * ## The honesty constraint
 *
 * The request is a single opaque POST with no progress events, so this is an
 * estimate and it is labelled as one. lib/progress.js caps the bar below full
 * and holds -- it can never sit at 100% claiming to be finished -- and once the
 * estimate is overrun the interface says so rather than inventing more motion.
 * A progress bar that lies is worse than no progress bar, because the next wait
 * is one the user no longer believes.
 */

export default function Progress({ address }) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 120);
    return () => clearInterval(timer);
  }, [address]);

  const { index, fraction, overtime, elapsedSeconds } = progressAt(elapsed);

  return (
    <div className="anim-fade mx-auto max-w-[1400px] px-4 pt-10 pb-20 sm:px-6">
      <div className="mx-auto max-w-xl">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[0.75rem] font-semibold tracking-[0.14em] uppercase text-ink-faint">
            Analysing
          </p>
          <p className="num text-[0.75rem] text-ink-faint" aria-hidden="true">
            {elapsedSeconds}s
          </p>
        </div>
        <AddressText value={address} className="mt-1.5 block text-ink" />

        {/* The bar. `aria-valuetext` carries the estimate caveat so the value is
            not read out as a measured fact by a screen reader either. */}
        <div
          className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuetext={`Estimated ${Math.round(fraction * 100)} per cent complete`}
          aria-label="Analysis progress, estimated"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${fraction * 100}%`, transition: 'width 300ms linear' }}
          />
        </div>

        {/* Stage changes are announced politely rather than assertively: this is
            status, and it must not interrupt whatever the user is reading. */}
        <ol className="mt-6 space-y-0" aria-live="polite" aria-atomic="false">
          {STAGES.map((stage, i) => {
            const done = i < index;
            const current = i === index;
            return (
              <li
                key={stage.id}
                className="flex items-start gap-3 py-2"
                aria-current={current ? 'step' : undefined}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {done ? (
                    <Check className="h-3.5 w-3.5" style={{ color: 'var(--band-low)' }} aria-hidden="true" />
                  ) : current ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[0.875rem] transition-colors ${
                      current ? 'font-medium text-ink' : done ? 'text-ink-muted' : 'text-ink-faint'
                    }`}
                  >
                    {stage.label}
                    <span className="sr-only">{done ? ' — done' : current ? ' — in progress' : ' — pending'}</span>
                  </span>
                  {current && (
                    <span className="anim-fade mt-0.5 block text-[0.8125rem] text-ink-muted">
                      {stage.detail}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-5 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
          {overtime
            ? 'This is taking longer than usual. The chain data provider can be slow under load — the analysis is still running and will appear when it completes.'
            : 'Progress is estimated from the typical 10\u201320 second analysis time, not measured — the backend reports only when it finishes.'}
        </p>
      </div>

      {/* Layout placeholder, so the results do not shove the page around when
          they land. Deliberately quiet: the stage list above is where the
          reader should be looking. */}
      <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" aria-hidden="true">
        <Card className="p-6">
          <div className="shimmer mx-auto h-40 w-40 rounded-full" />
          <div className="shimmer mt-5 h-3 w-3/4 rounded-sm" />
          <div className="shimmer mt-2 h-3 w-1/2 rounded-sm" />
        </Card>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <div className="shimmer h-3.5 w-2/5 rounded-sm" />
              <div className="shimmer mt-3 h-2.5 w-full rounded-sm" />
              <div className="shimmer mt-2 h-2.5 w-4/5 rounded-sm" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
