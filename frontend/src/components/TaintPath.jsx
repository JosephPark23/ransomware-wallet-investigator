import { ArrowRight, ShieldCheck, Waypoints } from 'lucide-react';

import { flagColor, flagLabel } from '../lib/flags.js';
import { TOPOLOGY_SHARED, buildTaintPath } from '../lib/taint.js';

/**
 * Taint paths: how funds from the analysed address reach something flagged.
 *
 * Each path is a horizontal chain of address chips with the connecting
 * transaction labelled between them, under a plain-English gloss. The gloss is
 * the point -- a chain of truncated hashes tells a reader nothing until someone
 * says what it means, and the sentence is what they will repeat to a colleague.
 *
 * Every sentence is generated in lib/taint.js and tested against the fixture's
 * two paths. Wording that overclaims is a correctness bug here, not a copy
 * tweak: `bottleneck_value` is the ceiling along the path, not a proof that those
 * exact coins arrived, so the gloss says funds were "forwarded" and the
 * bottleneck is stated as a ceiling rather than a delivery.
 */

/** One address in the chain. */
function AddressChip({ step, color }) {
  const tone = step.isFlagged
    ? 'border-transparent text-slate-950'
    : step.isTarget
      ? 'border-slate-600 bg-slate-800 text-slate-100'
      : 'border-slate-700 bg-slate-900 text-slate-300';

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <span
        className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs ${tone}`}
        style={step.isFlagged ? { backgroundColor: color } : undefined}
        title={step.address}
      >
        {step.short}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-slate-600">
        {step.isTarget ? 'analysed' : step.isFlagged ? 'flagged' : 'intermediary'}
      </span>
    </div>
  );
}

/** The transaction connecting two chips. */
function TxLink({ txHash }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 px-1">
      <ArrowRight className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
      {txHash ? (
        <span
          className="max-w-[7rem] truncate font-mono text-[10px] text-slate-500"
          title={txHash}
        >
          {txHash}
        </span>
      ) : (
        // Built from the addresses, not the hash array, so a short tx_hashes
        // array leaves a link unlabelled rather than dropping a hop entirely.
        <span className="text-[10px] italic text-slate-600">tx not recorded</span>
      )}
    </div>
  );
}

function Path({ path }) {
  const view = buildTaintPath(path);
  const color = flagColor([view.targetFlag]);

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-950"
          style={{ backgroundColor: color }}
        >
          {flagLabel(view.targetFlag)}
        </span>
        <span className="text-xs tabular-nums text-slate-500">
          {view.hops} {view.hops === 1 ? 'hop' : 'hops'}
          {/* A shared-counterparty path has no end-to-end flow, so the header
              must not print an amount next to it -- the number would read as
              the transfer the sentence below explicitly denies. */}
          {view.topology !== TOPOLOGY_SHARED &&
            view.formattedValue !== null &&
            ` · ${view.formattedValue} BTC`}
        </span>
        {view.topology === TOPOLOGY_SHARED && (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
            no observed flow
          </span>
        )}
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-slate-200">{view.sentence}</p>
      {view.note && <p className="mt-1 text-xs leading-relaxed text-slate-500">{view.note}</p>}

      {/* Scrolls on its own rather than widening the card. */}
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex w-max items-start gap-1">
          {view.steps.map((step, i) => (
            <div key={`${step.address}-${i}`} className="flex items-start gap-1">
              <AddressChip step={step} color={color} />
              {i < view.steps.length - 1 && <TxLink txHash={step.txHash} />}
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}

export default function TaintPath({ paths = [] }) {
  const list = Array.isArray(paths) ? paths : [];

  return (
    <section
      className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800"
      aria-label="Taint paths"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
          <Waypoints className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Taint paths
        </h2>
        {list.length > 0 && (
          <span className="text-xs tabular-nums text-slate-500">
            {list.length} {list.length === 1 ? 'path' : 'paths'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Routes from this address to something flagged, within the hops we retrieved.
      </p>

      {list.length === 0 ? (
        // No path found is a real result and a reassuring one, but it is bounded
        // by max_hops -- claiming more than "we did not find one" would overstate
        // what a two-hop search can prove.
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-emerald-400/70" aria-hidden="true" />
          <p className="mt-2.5 font-medium text-slate-200">No taint paths found</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
            No route was found from this address to a flagged one within the hops retrieved. A
            longer chain could still exist beyond that range.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {list.map((path, i) => (
            <Path key={`${path?.target_flag ?? 'path'}-${i}`} path={path} />
          ))}
        </ul>
      )}
    </section>
  );
}
