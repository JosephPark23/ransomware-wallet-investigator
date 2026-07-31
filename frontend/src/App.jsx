import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { SOURCE_FIXTURE, fetchAddressRisk, fetchDemoAddresses } from './lib/api.js';
import { counterfactual } from './lib/counterfactual.js';
import { degradedState, isCached } from './lib/degraded.js';
import { DEMO_ADDRESSES, demoAddressesFrom } from './lib/demos.js';
import { formatDate } from './lib/format.js';
import { activePresetId } from './lib/presets.js';
import { defaultWeights, scoreAddress } from './lib/scoring.js';
import { formatScore } from './lib/waterfall.js';

import Assessment, { summarise } from './components/Assessment.jsx';
import { SectionNav, TopBar } from './components/Chrome.jsx';
import Composition from './components/Composition.jsx';
import Evidence from './components/Evidence.jsx';
import Launch from './components/Launch.jsx';
import Method from './components/Method.jsx';
import Network from './components/Network.jsx';
import Profile from './components/Profile.jsx';
import Progress from './components/Progress.jsx';
import { CopyButton, Note } from './components/ui.jsx';

/**
 * ## Two modes, not one screen
 *
 * The previous build had a single mode: it analysed a hard-coded demo address
 * before the user had done anything and arrived at a full dashboard. That put
 * the address entry -- the only thing a first-time visitor can act on -- into a
 * strip above a page already dense with somebody else's results, and spent a
 * ten-to-twenty second analysis nobody had asked for.
 *
 * Now the app opens on the question it exists to answer (which address?) and
 * transitions to the workspace once there is something to show. The input does
 * not disappear at that point, it relocates: a compact field in the persistent
 * top bar, reachable from anywhere in the document and no longer competing for
 * the reader's first glance.
 *
 * ## What is preserved from the previous implementation
 *
 * All of it, deliberately. The request-superseding logic, the fixture fallback
 * and its honesty notice, the strict reading of `degraded` and `cached`, and the
 * entire pure lib/ layer with its tests. Every change in this file is about WHEN
 * things are shown and WHERE, not about what is true.
 */

const params = () => new URLSearchParams(window.location.search);

export default function App() {
  const [demos, setDemos] = useState(DEMO_ADDRESSES);
  const [payload, setPayload] = useState(null);
  const [meta, setMeta] = useState(null);
  const [weights, setWeights] = useState(defaultWeights);

  // 'launch' before anything has been asked for, 'running' while a lookup is in
  // flight, 'results' once one has landed. A re-run returns to 'running' rather
  // than leaving the previous address's score on screen under a spinner -- a
  // wrong number displayed confidently is the one failure this app cannot
  // afford.
  const [mode, setMode] = useState('launch');
  const [analyzed, setAnalyzed] = useState('');

  const inFlight = useRef(null);
  const resultsRef = useRef(null);

  // -------------------------------------------------------------------------

  const analyze = useCallback((address) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setAnalyzed(address);
    setMode('running');

    // The analysis is linkable and survives a refresh. Investigators work in
    // case notes and share findings; an analysis that exists only in one browser
    // tab cannot be cited.
    const next = params();
    next.set('address', address);
    window.history.replaceState({}, '', `?${next.toString()}`);
    document.title = `${address.slice(0, 10)}\u2026 \u2014 Chainmark`;

    fetchAddressRisk(address, { signal: controller.signal })
      .then(({ data, source, reason }) => {
        if (controller !== inFlight.current) return; // superseded
        setPayload(data);
        setMeta({ source, reason });
        setMode('results');
      })
      .catch((err) => {
        // api.js resolves on transport failure, so the only thing landing here
        // is an abort, which is not an error worth showing.
        if (err?.name !== 'AbortError') throw err;
      })
      .finally(() => {
        if (controller !== inFlight.current) return;
        inFlight.current = null;
      });
  }, []);

  // Deep link on first paint; otherwise the launch screen, and no network call.
  useEffect(() => {
    const address = params().get('address');
    if (address) analyze(address);
  }, [analyze]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDemoAddresses({ signal: controller.signal })
      .then((records) => setDemos(demoAddressesFrom(records)))
      .catch(() => {}); // an aborted or failed fetch keeps the built-in list
    return () => controller.abort();
  }, []);

  // Results arriving is a page-level change a sighted user sees instantly and a
  // screen reader user would otherwise have to go looking for. Moving focus to
  // the heading of the new content also puts a keyboard user at the top of what
  // they asked for rather than back in the top bar.
  useEffect(() => {
    if (mode === 'results') resultsRef.current?.focus();
  }, [mode, analyzed]);

  // -------------------------------------------------------------------------

  const signals = payload?.signals ?? [];
  const result = useMemo(() => scoreAddress(signals, weights), [signals, weights]);
  const counterfactualResult = useMemo(
    () => counterfactual(signals, weights, result),
    [signals, weights, result],
  );

  const setWeight = (category, value) => setWeights((w) => ({ ...w, [category]: value }));
  const applyPreset = (preset) => setWeights({ ...preset.weights });
  const adjusted = activePresetId(weights) !== 'balanced';

  const settled = mode === 'results';
  const { degraded, warnings } = degradedState(settled ? payload : null);
  const cached = settled && isCached(payload);
  const analyzedAt = settled ? formatDate(payload?.analyzed_at) : null;

  // Every lookup resolves to the same fixture when no backend is reachable.
  // Saying so is better than letting the page quietly report on a different
  // address than the one that was submitted.
  const fixtureMismatch =
    settled && meta?.source === SOURCE_FIXTURE && payload?.address && analyzed !== payload.address;

  const summaryText = useMemo(
    () =>
      settled
        ? summarise({
            address: payload?.address ?? analyzed,
            result,
            signals,
            analyzedAt,
            adjusted,
            sources: payload?.sources_used ?? [],
          })
        : '',
    [settled, payload, analyzed, result, signals, analyzedAt, adjusted],
  );

  const sections = useMemo(
    () => [
      { id: 'assessment', label: 'Assessment' },
      { id: 'evidence', label: 'Evidence', count: signals.length },
      { id: 'composition', label: 'Composition' },
      { id: 'network', label: 'Network', count: payload?.graph?.nodes?.length ?? 0 },
      ...(payload?.profile ? [{ id: 'profile', label: 'Wallet profile' }] : []),
      { id: 'method', label: 'Method' },
    ],
    [signals.length, payload],
  );

  // -------------------------------------------------------------------------

  if (mode === 'launch') {
    return <Launch onAnalyze={analyze} demos={demos} />;
  }

  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-accent px-4 py-2 text-on-accent focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to analysis
      </a>

      <TopBar
        address={payload?.address ?? analyzed}
        band={settled ? result.band : undefined}
        score={settled ? formatScore(result.finalScore) : undefined}
        busy={mode === 'running'}
        demos={demos}
        onAnalyze={analyze}
        summaryText={summaryText}
      />

      {/* One polite live region for the whole app, so the outcome of an analysis
          is announced once rather than reconstructed from a dozen individually
          updating parts. */}
      <div aria-live="polite" className="sr-only">
        {mode === 'running'
          ? `Analysing ${analyzed}.`
          : settled
            ? `Analysis complete. Score ${formatScore(result.finalScore)} out of 100, ${
                result.band
              } risk, from ${signals.length} ${signals.length === 1 ? 'finding' : 'findings'}.`
            : ''}
      </div>

      {mode === 'running' ? (
        <main id="main">
          <Progress address={analyzed} />
        </main>
      ) : (
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,200px)] lg:gap-10">
            <main id="main" className="min-w-0 py-6 lg:py-8">
              <h1 ref={resultsRef} tabIndex={-1} className="sr-only">
                Risk analysis for {payload?.address ?? analyzed}
              </h1>

              {fixtureMismatch && (
                <Note tone="warn" icon={AlertTriangle} className="mb-6">
                  No backend is reachable, so every lookup returns the same sample. You asked for{' '}
                  <span className="font-mono break-all">{analyzed}</span>; everything below describes{' '}
                  <span className="font-mono break-all">{payload.address}</span>.
                </Note>
              )}
              {!fixtureMismatch && meta?.source === SOURCE_FIXTURE && (
                <Note className="mb-6">{meta.reason}</Note>
              )}

              <div className="space-y-12 lg:space-y-16">
                <Assessment
                  result={result}
                  signals={signals}
                  weights={weights}
                  onApplyPreset={applyPreset}
                  degraded={degraded}
                  warnings={warnings}
                  counterfactualResult={counterfactualResult}
                  analyzedAt={analyzedAt}
                  cached={cached}
                  adjusted={adjusted}
                />

                <Evidence signals={signals} result={result} weights={weights} />

                <Composition
                  contributions={result.contributions}
                  finalScore={result.finalScore}
                  hasSignals={signals.length > 0}
                />

                <Network graph={payload?.graph} taintPaths={payload?.taint_paths ?? []} />

                <Profile profile={payload?.profile} />

                <Method
                  weights={weights}
                  categories={result.categories}
                  onChange={setWeight}
                  onApplyPreset={applyPreset}
                  sources={payload?.sources_used}
                />
              </div>

              <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line py-8 text-[0.8125rem] text-ink-faint">
                <p className="max-w-xl leading-relaxed">
                  This analysis reports what public datasets and on-chain behaviour show. It does not
                  establish who controls an address, and a low score is not a clearance.
                </p>
                <CopyButton value={summaryText} label="Copy summary" variant="secondary" size="md" />
              </footer>
            </main>

            {/* Order matters: the navigation follows the content in the DOM, so a
                screen reader and a keyboard user reach the analysis first, and
                CSS places the rail alongside it. */}
            <div className="order-first lg:order-none lg:py-8">
              <SectionNav sections={sections} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
