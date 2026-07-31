import { useEffect, useRef } from 'react';
import { AlertTriangle, Database, HelpCircle, RotateCcw } from 'lucide-react';

import { CATEGORY_LABELS, categoryColor } from '../lib/categories.js';
import { formatCount, formatDate } from '../lib/format.js';
import { PRESETS, activePresetId } from '../lib/presets.js';
import { CATEGORIES, WEIGHT_MAX, WEIGHT_MIN } from '../lib/scoring.js';
import { Button, Card, Chip, Note, Section } from './ui.jsx';

/**
 * How the number was arrived at, and who says so.
 *
 * ## Why these two things share a section
 *
 * Provenance and method answer the same challenge -- "on what basis?" -- and in
 * the old build they sat at opposite ends of a long page, with the weight
 * sliders pinned beside the score and the source list stranded at the bottom
 * under everything else. A reader who wanted to interrogate the score had to
 * visit two places and hold one in memory while reading the other.
 *
 * Putting them last is not burying them. This is the section a sceptical reader
 * arrives at deliberately, after the verdict has raised a question; a reader who
 * accepts the verdict never needed it on screen in the first place. That is what
 * progressive disclosure is for at the page level.
 *
 * ## The sliders, demoted
 *
 * They used to sit permanently next to the score, which meant idle fiddling
 * silently altered the headline number with no mark on it. They are still here,
 * unchanged in behaviour, but the common case -- four named points of view -- is
 * handled by the preset control up beside the score, and any deviation from
 * neutral weighting now marks the score itself.
 */

/**
 * A range input that ignores the mouse wheel.
 *
 * Preserved from the previous build along with its reasoning: range inputs
 * consume wheel events, so scrolling the page with the cursor over a slider
 * silently changes a weight -- and therefore the displayed score -- with no
 * deliberate interaction. React attaches wheel listeners passively at the root,
 * so preventDefault only works from a directly attached non-passive listener.
 */
function WeightSlider(props) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const block = (event) => event.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  return <input ref={ref} type="range" {...props} />;
}

function Weights({ weights, categories, onChange, onApplyPreset }) {
  const active = activePresetId(weights);
  const meta = Object.fromEntries(categories.map((c) => [c.category, c]));
  const balanced = PRESETS.find((p) => p.id === 'balanced');

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-[1.0625rem] font-semibold">Category weights</h3>
          <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-ink-muted">
            Weights turn a category down, never up. Full weight lets a category&rsquo;s evidence count
            in full; zero removes it from the score entirely. To emphasise one category, lower the
            others.
          </p>
        </div>
        {active !== 'balanced' && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onApplyPreset(balanced)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset to neutral
          </Button>
        )}
      </div>

      <div className="mt-5 space-y-4 border-t border-line pt-5">
        {CATEGORIES.map((category) => {
          const weight = weights[category];
          const info = meta[category];
          const silent = !info || info.signalCount === 0;

          return (
            <div key={category}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <label
                  htmlFor={`weight-${category}`}
                  className={`flex items-baseline gap-2 text-[0.875rem] ${silent ? 'text-ink-faint' : 'text-ink'}`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 translate-y-px rounded-full"
                    style={{ backgroundColor: categoryColor(category), opacity: silent ? 0.35 : 1 }}
                  />
                  {CATEGORY_LABELS[category]}
                  <span className="text-[0.75rem] text-ink-faint">
                    {silent
                      ? 'no findings'
                      : `${info.signalCount} ${info.signalCount === 1 ? 'finding' : 'findings'}`}
                  </span>
                </label>
                <span className={`num text-[0.8125rem] ${weight === 0 ? 'text-ink-faint' : 'text-ink-muted'}`}>
                  {weight.toFixed(1)}
                  {weight === 0 && ' — excluded'}
                </span>
              </div>
              <WeightSlider
                id={`weight-${category}`}
                min={WEIGHT_MIN}
                max={WEIGHT_MAX}
                step={0.1}
                value={weight}
                onChange={(event) => onChange(category, Number(event.target.value))}
                aria-describedby={`weight-${category}-state`}
                className="mt-1"
              />
              <span id={`weight-${category}-state`} className="sr-only">
                {silent
                  ? 'This category produced no findings, so its weight does not affect the score.'
                  : `Weight ${weight.toFixed(1)} of 1.0`}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Sources({ sources = [] }) {
  const list = Array.isArray(sources) ? sources : [];

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[1.0625rem] font-semibold">Sources used</h3>
        {list.length > 0 && (
          <span className="num text-[0.8125rem] text-ink-faint">
            {list.length} {list.length === 1 ? 'dataset' : 'datasets'}
          </span>
        )}
      </div>
      <p className="mt-1 text-[0.875rem] text-ink-muted">
        Every finding on this page traces back to one of these. How recently a list was pulled
        matters as much as how big it is &mdash; a stale sanctions list misses last week&rsquo;s
        designations.
      </p>

      {list.length === 0 ? (
        // Not the same as "no findings". No sources means nothing was checked,
        // which makes the score meaningless rather than merely low.
        <Note tone="warn" icon={AlertTriangle} className="mt-4">
          No sources were reported for this analysis. Treat the score as unsupported.
        </Note>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((source, i) => {
            const retrieved = formatDate(source?.retrieved_at);
            const records = formatCount(source?.records);
            const stale = source?.stale === true;
            const unknownAge = !retrieved;

            return (
              <li key={source?.name ?? i} className="rounded-md border border-line bg-sunken p-3">
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium break-words text-ink">
                      {source?.name ?? 'Unnamed source'}
                    </p>
                    <p className="mt-1 text-[0.8125rem] text-ink-muted">
                      {records === null ? (
                        <span className="text-ink-faint italic">record count not reported</span>
                      ) : (
                        <>
                          <span className="num font-medium">{records}</span>{' '}
                          {records === '1' ? 'record' : 'records'}
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-ink-faint">
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

                    {(stale || unknownAge) && (
                      <p
                        className="mt-1.5 flex items-start gap-1.5 text-[0.75rem] leading-relaxed"
                        style={{ color: stale ? 'var(--warn)' : 'var(--ink-faint)' }}
                      >
                        {stale ? (
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        )}
                        <span>
                          {stale
                            ? 'Stale — refresh before relying on a clean result from this list.'
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
    </Card>
  );
}

/** How the score is computed, in prose, once. */
function HowItWorks() {
  return (
    <Card className="p-5 sm:p-6">
      <h3 className="text-[1.0625rem] font-semibold">How the score is calculated</h3>
      <ol className="mt-4 space-y-4">
        {[
          {
            title: 'Findings combine within a category',
            body: 'Two findings in the same category overlap rather than stack. Two moderate findings produce a strong category score, not a maximum one, because each additional finding closes part of what is left rather than adding on top.',
          },
          {
            title: 'Categories combine across the address',
            body: 'The same rule applies again across categories, which means more evidence always raises the score and never lowers it. An earlier version averaged the categories, which had the perverse effect of lowering a sanctioned address\u2019s score when further incriminating evidence arrived.',
          },
          {
            title: 'Your weighting attenuates',
            body: 'A weight scales its own category down and leaves the others alone, so caring more about sanctions does not silently mean caring less about ransomware. A weight of zero removes a category from the calculation entirely.',
          },
          {
            title: 'Each finding is credited with its own share',
            body: 'Points are apportioned by how much risk each finding was first to establish, so two findings with equal evidence receive equal credit and overlapping ones are discounted rather than double-counted. The shares add up to exactly the score shown.',
          },
        ].map((step, i) => (
          <li key={step.title} className="flex gap-3.5">
            <span
              aria-hidden="true"
              className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[0.75rem] font-semibold text-ink-muted"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-medium">{step.title}</p>
              <p className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        {Object.entries({ Low: '0\u201324', Moderate: '25\u201349', Elevated: '50\u201374', High: '75\u2013100' }).map(
          ([band, range]) => (
            <Chip key={band} className="bg-sunken text-ink-muted">
              {band} <span className="num text-ink-faint">{range}</span>
            </Chip>
          ),
        )}
      </div>
    </Card>
  );
}

export default function Method({ weights, categories, onChange, onApplyPreset, sources }) {
  return (
    <Section
      id="method"
      title="Method & sources"
      description="What produced this number, and which datasets it was checked against."
    >
      <div className="space-y-4">
        <Weights
          weights={weights}
          categories={categories}
          onChange={onChange}
          onApplyPreset={onApplyPreset}
        />
        <HowItWorks />
        <Sources sources={sources} />
      </div>
    </Section>
  );
}
