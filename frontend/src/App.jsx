import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Zap } from 'lucide-react';

import { SOURCE_FIXTURE, fetchAddressRisk, fetchDemoAddresses } from './lib/api.js';
import { counterfactual } from './lib/counterfactual.js';
import { degradedState, isCached } from './lib/degraded.js';
import { DEMO_ADDRESSES, demoAddressesFrom } from './lib/demos.js';
import { formatDate } from './lib/format.js';
import { CATEGORIES, defaultWeights, scoreAddress } from './lib/scoring.js';
import AddressInput from './components/AddressInput.jsx';
import AnalysisSkeleton from './components/AnalysisSkeleton.jsx';
import Counterfactual from './components/Counterfactual.jsx';
import DegradedBanner from './components/DegradedBanner.jsx';
import DemoPicker from './components/DemoPicker.jsx';
import NetworkGraph from './components/NetworkGraph.jsx';
import NoSignals from './components/NoSignals.jsx';
import ProfileStats from './components/ProfileStats.jsx';
import ScoreDial from './components/ScoreDial.jsx';
import SignalList from './components/SignalList.jsx';
import SourcePanel from './components/SourcePanel.jsx';
import TaintPath from './components/TaintPath.jsx';
import Waterfall from './components/Waterfall.jsx';
import WeightSliders from './components/WeightSliders.jsx';

/** The address the app analyses on first paint. */
const INITIAL_ADDRESS = DEMO_ADDRESSES[0].address;

export default function App() {
  // Starts as the built-in list so the picker is never empty on first paint,
  // then upgrades to the backend's curated set if /api/demo answers. The
  // initial analysis does not wait on it -- a slow demo endpoint should not
  // delay the thing the reader came to see.
  const [demos, setDemos] = useState(DEMO_ADDRESSES);
  const [payload, setPayload] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [weights, setWeights] = useState(defaultWeights);

  // What is in the text box, versus what was actually analysed. They differ
  // while the user is typing, and they can differ AFTER a lookup too -- see the
  // fixture note below.
  const [query, setQuery] = useState(INITIAL_ADDRESS);
  const [analyzed, setAnalyzed] = useState(INITIAL_ADDRESS);

  // Against the fixture every lookup resolves instantly, but a real analysis
  // takes 10-20 seconds (contract.md), so two quick submits would otherwise be
  // in flight together with no guarantee the LAST one is the one that lands.
  // The newest request wins: the previous is aborted, and a superseded response
  // is ignored even if it still arrives.
  const inFlight = useRef(null);

  const analyze = useCallback((address, { initial = false } = {}) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    if (initial) setLoading(true);
    else setBusy(true);
    setAnalyzed(address);

    fetchAddressRisk(address, { signal: controller.signal })
      // TODO: against fixtures this resolves in ~0ms, so the skeleton flashes and is gone; the real 10-20s backend call is what makes it worth having. Verified with a temporary 800ms delay here.
      .then(({ data, source, reason }) => {
        if (controller !== inFlight.current) return; // superseded
        setPayload(data);
        setMeta({ source, reason });
      })
      .catch((err) => {
        // api.js resolves on transport failure, so the only thing that lands
        // here is an abort -- which is not an error worth showing.
        if (err?.name !== 'AbortError') throw err;
      })
      .finally(() => {
        // Don't let a superseded request clear the flag for the live one.
        if (controller !== inFlight.current) return;
        inFlight.current = null;
        setLoading(false);
        setBusy(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => analyze(INITIAL_ADDRESS, { initial: true }), [analyze]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDemoAddresses({ signal: controller.signal })
      .then((records) => setDemos(demoAddressesFrom(records)))
      .catch(() => {}); // an aborted or failed fetch keeps the built-in list
    return () => controller.abort();
  }, []);

  // One flag for "an analysis is in flight", whether it is the first one or a
  // later one. Both put the same skeleton on screen -- the reader does not care
  // which it is, and a first load that looks different from a re-run just makes
  // the page feel inconsistent.
  const pending = loading || busy;

  const signals = payload?.signals ?? [];
  const result = useMemo(() => scoreAddress(signals, weights), [signals, weights]);
  const activeCount = result.categories.filter((c) => c.active).length;

  // Recomputed on every weight change, same as the dial.
  const counterfactualResult = useMemo(
    () => counterfactual(signals, weights, result),
    [signals, weights, result],
  );

  const setWeight = (category, value) => setWeights((w) => ({ ...w, [category]: value }));
  const applyPreset = (preset) => setWeights({ ...preset.weights });

  const handleDemo = (demo) => {
    setQuery(demo.address);
    analyze(demo.address);
  };

  // There is no backend yet, so every lookup resolves to the same fixture
  // whatever was typed. Saying so is better than letting the header quietly
  // show a different address than the one the user just submitted.
  //
  // Suppressed while pending: `payload` is still the PREVIOUS result then, so
  // comparing it against the newly submitted address compares two unrelated
  // things and flashes the notice on every re-run.
  const servedFixtureForOtherAddress =
    !pending &&
    meta?.source === SOURCE_FIXTURE &&
    payload?.address &&
    analyzed !== payload.address;

  // Envelope state. Read only when settled, for the same reason -- a stale
  // "cached" badge or degraded banner describes the last response, not this one.
  const { degraded, warnings } = degradedState(pending ? null : payload);
  const cached = !pending && isCached(payload);
  const analyzedAt = !pending ? formatDate(payload?.analyzed_at) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Bitcoin Address Risk</h1>
        {/* Falls back to the submitted address so the first paint is not blank
            and so the header names what is being analysed, not what was. */}
        <p className="mt-1 font-mono text-sm break-all text-slate-400">
          {payload?.address ?? analyzed}
        </p>

        {analyzedAt && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>
              Analysed <time dateTime={payload.analyzed_at}>{analyzedAt}</time>
            </span>
            {cached && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/30"
                title="Served from the backend's cache — returned in milliseconds instead of 10-20 seconds."
              >
                <Zap className="h-3 w-3" aria-hidden="true" />
                Cached
              </span>
            )}
          </p>
        )}

        {meta?.source === SOURCE_FIXTURE && (
          <p className="mt-1 text-xs text-slate-500">{meta.reason}</p>
        )}
      </header>

      <section className="mb-6 rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-start">
          <AddressInput value={query} onChange={setQuery} onAnalyze={analyze} busy={pending} />
          <DemoPicker onSelect={handleDemo} busy={pending} demos={demos} />
        </div>

        {servedFixtureForOtherAddress && (
          <p className="mt-3 border-t border-slate-800 pt-3 text-xs text-amber-300/80">
            No backend is wired up yet, so every address returns the same sample. You asked for{' '}
            <span className="font-mono break-all">{analyzed}</span>; the results below are for{' '}
            <span className="font-mono break-all">{payload.address}</span>.
          </p>
        )}
      </section>

      {pending ? (
        <AnalysisSkeleton />
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
            <div className="space-y-4 lg:sticky lg:top-8">
              {/* Above the dial: the reader has to know the picture is partial
                  before they read the number, not after. */}
              {degraded && <DegradedBanner warnings={warnings} />}

              <ScoreDial
                score={result.finalScore}
                band={result.band}
                activeCategories={activeCount}
                totalCategories={CATEGORIES.length}
              />
              <Counterfactual result={counterfactualResult} />
              <WeightSliders
                weights={weights}
                onChange={setWeight}
                onApplyPreset={applyPreset}
                categories={result.categories}
              />
            </div>

            {/* Both panels own an empty state so each is correct on its own, but
                stacking two identical "no risk indicators" cards would be silly --
                with nothing to show, the column renders it once. */}
            <div className="space-y-6">
              {signals.length === 0 ? (
                <NoSignals />
              ) : (
                <>
                  <Waterfall contributions={result.contributions} finalScore={result.finalScore} />
                  <SignalList signals={signals} categories={result.categories} />
                </>
              )}
            </div>
          </div>

          {/* Below the evidence cards: where the money went, then what the
              address did, then who says so. All full width -- they describe the
              whole result rather than the dial, and the graph needs the room. */}
          <div className="mt-6 space-y-6">
            <NetworkGraph graph={payload?.graph} />
            <TaintPath paths={payload?.taint_paths} />
            <ProfileStats profile={payload?.profile} />
            <SourcePanel sources={payload?.sources_used} />
          </div>
        </>
      )}
    </main>
  );
}
