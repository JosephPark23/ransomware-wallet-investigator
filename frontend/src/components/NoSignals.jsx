import { ShieldCheck } from 'lucide-react';

/**
 * Whole-panel empty state: an address with no findings is a real result, not a
 * blank. contract.md rule 2 -- an empty `signals` array means "nothing found",
 * which is itself worth rendering.
 *
 * Shared by SignalList and Waterfall so the two panels cannot drift into telling
 * the same story two different ways.
 */
export default function NoSignals() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center">
      <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400/70" aria-hidden="true" />
      <p className="mt-3 font-medium text-slate-200">No risk indicators detected</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
        Every category was evaluated and none produced a signal. This is not proof the address is
        clean — only that no configured rule matched it.
      </p>
    </div>
  );
}
