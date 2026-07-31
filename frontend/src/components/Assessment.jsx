import { useMemo } from 'react';
import { AlertTriangle, ArrowDownRight, Scale, Zap } from 'lucide-react';

import { categoryColor } from '../lib/categories.js';
import { formatDate } from '../lib/format.js';
import { verdict } from '../lib/interpretation.js';
import { PRESETS, activePresetId } from '../lib/presets.js';
import { buildWaterfallRows, formatScore } from '../lib/waterfall.js';
import { ScoreRule } from './Composition.jsx';
import ScoreArc from './ScoreArc.jsx';
import { Card, Chip, Disclosure, Eyebrow, Section, Segmented } from './ui.jsx';

/**
 * The first thing read, and for many readers the only thing.
 *
 * Everything here answers one of three questions in order: what is the verdict,
 * what drove it, and how much should I trust it. Detail that answers none of
 * those lives further down the page.
 *
 * ## The verdict sentence
 *
 * Set in the app's only serif, and that is a deliberate typographic signal
 * rather than decoration: everything else on this page is machine output --
 * figures, labels, dataset names -- and this one line is the authored
 * conclusion drawn from it. Giving the judgement its own voice marks the
 * boundary between what was measured and what is being claimed.
 */

// ---------------------------------------------------------------------------
// Degraded status
// ---------------------------------------------------------------------------

/**
 * The partial-results warning, reduced from a card to a line.
 *
 * The old banner was a full-width amber panel carrying a heading, a paragraph
 * and a bulleted list, sitting directly above the score. On a response with two
 * warnings it was taller than the score it qualified, which inverts the
 * hierarchy: the caveat outshouted the finding.
 *
 * The original author's placement argument was right, though, and is kept --
 * the reader has to know the picture is incomplete BEFORE they read the number,
 * not after. So this stays above the score and stays amber rather than red
 * (red is the High band's colour here, and a red bar over the arc would read as
 * "this address is dangerous" instead of "this analysis is incomplete", which
 * are opposite claims). What changed is that the detail is one click away
 * instead of always on screen, and the summary states the count so the reader
 * knows the size of what they are choosing not to open.
 */
function DegradedStrip({ warnings }) {
  const count = warnings.length;

  return (
    <div
      role="status"
      className="rounded-md border px-3 py-2"
      style={{ borderColor: 'var(--warn-line)', backgroundColor: 'var(--warn-soft)' }}
    >
      <Disclosure
        summaryClassName="text-left"
        summary={
          <span className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem] font-medium" style={{ color: 'var(--warn)' }}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
            Partial results
            <span className="font-normal opacity-80">
              {count > 0
                ? `${count} ${count === 1 ? 'check' : 'checks'} failed; the score uses the evidence that did load`
                : 'something failed during this analysis and it completed anyway'}
            </span>
          </span>
        }
        panelClassName="pt-2 pl-6"
      >
        {count > 0 ? (
          <ul className="space-y-1.5">
            {warnings.map((warning, i) => (
              <li key={i} className="flex gap-2 text-[0.8125rem] leading-relaxed" style={{ color: 'var(--warn)' }}>
                <span aria-hidden="true" className="opacity-50">
                  &bull;
                </span>
                <span className="min-w-0 break-words">{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] italic" style={{ color: 'var(--warn)' }}>
            No detail was reported about what failed.
          </p>
        )}
      </Disclosure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lens
// ---------------------------------------------------------------------------

/**
 * Weight presets, promoted; the five sliders, demoted.
 *
 * The sliders used to sit permanently beside the score, which had two costs.
 * They took prime space for a control most readers never touch, and -- worse --
 * they silently changed the headline number with no mark on it, so a screenshot
 * of a score taken after a slider was dragged looks exactly like a screenshot of
 * the default score.
 *
 * Presets cover the common case and are one control instead of five. The full
 * sliders remain, in Method, one link away. And whenever the weights are not the
 * neutral setting the score carries an "adjusted lens" marker, everywhere it
 * appears, so a modified number can never be mistaken for the default one.
 */
function LensControl({ weights, onApplyPreset, adjusted }) {
  const active = activePresetId(weights);

  return (
    <div className="no-print">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>Lens</Eyebrow>
        <a href="#method" className="text-[0.75rem] text-accent hover:underline">
          Fine-tune
        </a>
      </div>
      <div className="mt-2">
        <Segmented
          label="Weighting preset"
          value={active ?? 'custom'}
          onChange={(id) => {
            const preset = PRESETS.find((p) => p.id === id);
            if (preset) onApplyPreset(preset);
          }}
          options={[
            ...PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
              hint: preset.description,
            })),
            ...(active ? [] : [{ value: 'custom', label: 'Custom', hint: 'Weights set by hand' }]),
          ]}
        />
      </div>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
        {active
          ? PRESETS.find((p) => p.id === active).description
          : 'Weights set by hand in Method.'}
        {adjusted && ' The score below reflects this weighting, not the neutral one.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Assessment({
  result,
  signals,
  weights,
  onApplyPreset,
  degraded,
  warnings,
  counterfactualResult,
  analyzedAt,
  cached,
  adjusted,
}) {
  const rows = useMemo(() => buildWaterfallRows(result.contributions), [result.contributions]);
  const drivers = rows.filter((row) => row.contribution > 0).slice(0, 3);
  const { headline, because } = useMemo(
    () => verdict(result, signals.length),
    [result, signals.length],
  );

  const activeCount = result.categories.filter((c) => c.active).length;
  const totalCategories = result.categories.length;

  return (
    <Section id="assessment" title="Assessment" className="pt-2">
      <Card className="overflow-hidden">
        <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-10">
          {/* --- The instrument --- */}
          <div className="lg:border-r lg:border-line lg:pr-10">
            <ScoreArc score={result.finalScore} band={result.band} adjusted={adjusted} />

            <div className="mt-5 border-t border-line pt-4">
              <LensControl weights={weights} onApplyPreset={onApplyPreset} adjusted={adjusted} />
            </div>
          </div>

          {/* --- The reading --- */}
          <div className="min-w-0">
            {degraded && (
              <div className="mb-5">
                <DegradedStrip warnings={warnings} />
              </div>
            )}

            <p className="font-serif text-[1.5rem] leading-[1.25] font-medium tracking-[-0.01em] text-balance sm:text-[1.75rem]">
              {headline}.
            </p>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">{because}</p>

            {rows.length > 0 && (
              <div className="mt-6">
                <div className="flex items-baseline justify-between gap-3">
                  <Eyebrow>Score composition</Eyebrow>
                  <a href="#composition" className="text-[0.75rem] text-accent hover:underline">
                    Full breakdown
                  </a>
                </div>
                <ScoreRule rows={rows} total={result.finalScore} height="h-2.5" className="mt-2" />

                <ul className="mt-3 space-y-1.5">
                  {drivers.map((row) => (
                    <li key={row.id} className="flex items-baseline gap-2 text-[0.875rem]">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 translate-y-px rounded-full"
                        style={{ backgroundColor: categoryColor(row.category) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink-muted">{row.label}</span>
                      <span className="num shrink-0 font-medium text-ink">
                        +{formatScore(row.contribution)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* --- Trust qualifiers. Grouped, because they are one thought:
                    how far does this reading actually reach. --- */}
            <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-[0.75rem] text-ink-faint">Categories with evidence</dt>
                <dd className="num mt-0.5 text-[0.875rem] text-ink">
                  {activeCount} of {totalCategories}
                  <span className="ml-1.5 text-[0.8125rem] text-ink-faint">
                    silent categories are not counted against the address
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[0.75rem] text-ink-faint">Analysed</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.875rem] text-ink">
                  {analyzedAt ?? <span className="text-ink-faint">not recorded</span>}
                  {cached && (
                    <Chip
                      color="var(--accent)"
                      soft="var(--accent-soft)"
                      title="Served from the backend cache — returned in milliseconds rather than 10-20 seconds."
                    >
                      <Zap className="h-3 w-3" aria-hidden="true" />
                      Cached
                    </Chip>
                  )}
                </dd>
              </div>
            </dl>

            {counterfactualResult && (
              <div className="mt-4 flex items-start gap-2.5 rounded-md bg-sunken px-3 py-2.5">
                <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                  Set the sanctions listing aside entirely and this address scores{' '}
                  <span className="num font-medium text-ink">
                    {formatScore(counterfactualResult.score)}
                  </span>{' '}
                  instead of{' '}
                  <span className="num font-medium text-ink">
                    {formatScore(counterfactualResult.baseline)}
                  </span>
                  <ArrowDownRight className="mx-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" />
                  <span className="num">{formatScore(Math.abs(counterfactualResult.delta))}</span>{' '}
                  {counterfactualResult.delta > 0 ? 'higher' : 'lower'}. Everything else stays as you
                  have it, so this is how much of the number rests on the listing alone.
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Section>
  );
}

/** Convenience: a plain-text case note of the whole assessment. */
export function summarise({ address, result, signals, analyzedAt, adjusted, sources = [] }) {
  const rows = buildWaterfallRows(result.contributions).filter((r) => r.contribution > 0);
  const { headline, because } = verdict(result, signals.length);

  return [
    `Bitcoin address risk assessment`,
    `Address: ${address}`,
    `Score: ${formatScore(result.finalScore)} / 100 (${result.band})${
      adjusted ? ' — non-default category weighting applied' : ''
    }`,
    `Verdict: ${headline}. ${because}`,
    analyzedAt ? `Analysed: ${analyzedAt}` : null,
    '',
    `Findings (${signals.length}):`,
    ...signals.map((signal) => {
      const row = rows.find((r) => r.id === signal.id);
      const points = row ? `+${formatScore(row.contribution)}` : 'context only';
      return `  - [${points}] ${signal.label} (${signal.confidence} confidence)`;
    }),
    '',
    sources.length > 0
      ? `Sources: ${sources
          .map((s) => `${s.name}${s.retrieved_at ? ` (retrieved ${formatDate(s.retrieved_at)})` : ''}`)
          .join('; ')}`
      : 'Sources: none reported',
  ]
    .filter((line) => line !== null)
    .join('\n');
}
