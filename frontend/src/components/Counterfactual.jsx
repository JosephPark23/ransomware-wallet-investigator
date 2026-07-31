import { Scale } from 'lucide-react';



/**
 * The counterfactual line, shown under the score dial.
 *
 * Renders nothing when `result` is null -- lib/counterfactual.js returns null
 * whenever the sentence would be meaningless (no sanctions signal to remove, or
 * the user has already zeroed the sanctions weight, so both halves of the
 * "instead of" would be the same number).
 */

const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

export default function Counterfactual({ result }) {
  if (!result) return null;

  const { score, baseline, delta } = result;
  const direction = delta > 0 ? 'higher' : 'lower';

  return (
    <section className="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800">
      <div className="flex items-start gap-2.5">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-slate-300">
            Discount the sanctions listing entirely and this address scores{' '}
            <span className="font-semibold tabular-nums text-slate-100">{fmt(score)}</span> instead of{' '}
            <span className="font-semibold tabular-nums text-slate-100">{fmt(baseline)}</span>.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Sanctions weighted to zero, every other weight left as you have it —{' '}
            {Math.abs(delta) < 0.005 ? 'no change' : `${fmt(Math.abs(delta))} ${direction}`}.
          </p>
        </div>
      </div>
    </section>
  );
}
