import { CATEGORIES } from '../lib/scoring.js';
import NoSignals from './NoSignals.jsx';
import SignalCard from './SignalCard.jsx';

/**
 * Signals grouped by category, in the canonical category order.
 *
 * Categories that produced no signals are shown greyed out rather than hidden,
 * so it is visible that they were checked and stayed silent -- and that they
 * were therefore left out of the weighted average.
 */

const CATEGORY_LABELS = {
  sanctions: 'Sanctions',
  ransomware: 'Ransomware',
  obfuscation: 'Obfuscation',
  transaction_profile: 'Transaction profile',
  counterparty: 'Counterparty',
};

export default function SignalList({ signals = [], categories = [] }) {
  if (signals.length === 0) return <NoSignals />;

  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const s of signals) {
    if (byCategory[s?.category]) byCategory[s.category].push(s);
  }

  const meta = Object.fromEntries(categories.map((c) => [c.category, c]));

  return (
    <div className="space-y-6">
      {CATEGORIES.map((category) => {
        const catSignals = byCategory[category];
        const info = meta[category];
        const isSilent = catSignals.length === 0;
        const excluded = info && !info.active;

        return (
          <section key={category}>
            <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-800 pb-1.5">
              <h2
                className={`text-sm font-semibold uppercase tracking-wider ${
                  isSilent ? 'text-slate-600' : 'text-slate-300'
                }`}
              >
                {CATEGORY_LABELS[category] ?? category}
              </h2>

              <div className="flex items-center gap-2 text-xs">
                {excluded && (
                  <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-slate-500">
                    {isSilent ? 'no signals — excluded from average' : 'weight 0 — excluded'}
                  </span>
                )}
                {info && !isSilent && (
                  <span className="tabular-nums text-slate-400">
                    category score{' '}
                    <span className="font-medium text-slate-200">
                      {Math.round(info.score * 100) / 100}
                    </span>
                  </span>
                )}
              </div>
            </header>

            {isSilent ? (
              <p className="py-1 text-sm text-slate-600 italic">No signals in this category.</p>
            ) : (
              <div className="space-y-3">
                {catSignals.map((signal, i) => (
                  <SignalCard key={signal.id ?? `${category}-${i}`} signal={signal} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
