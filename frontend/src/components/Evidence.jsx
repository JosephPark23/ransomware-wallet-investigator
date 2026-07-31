import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  FlaskConical,
  Info,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { categoryColor, categoryLabel } from '../lib/categories.js';
import { formatDate, formatNumber, prettifyKey } from '../lib/format.js';
import {
  confidenceNote,
  glossFor,
  influence,
  lensNote,
  notesFor,
} from '../lib/interpretation.js';
import { CATEGORIES } from '../lib/scoring.js';
import { formatScore } from '../lib/waterfall.js';
import { Button, Card, Chip, Empty, Eyebrow, Section, Segmented } from './ui.jsx';

/**
 * The findings.
 *
 * ## The problem being solved
 *
 * The old cards showed a label, the backend's explanation, a severity bar, and a
 * collapsed dump of the raw evidence object with its keys mechanically
 * title-cased. "Window Unique Senders: 15" is a spelling change, not an
 * explanation, and severity is an internal quantity that says nothing about how
 * much a finding actually moved the score -- a severity-95 signal in a category
 * the reader has weighted to 0.2 contributes far less than a severity-70 one at
 * full weight, and the old card showed 95 and 70.
 *
 * ## The four questions
 *
 * Every expanded finding answers, in this order:
 *
 *   What was found      the backend's own explanation, which is already good prose
 *   Why it matters      authored per rule in lib/interpretation.js
 *   What it did to the score   COMPUTED from the same contributions the chart draws
 *   How far to trust it  confidence, restated, plus what the finding cannot show
 *
 * The third is the one the old build was missing entirely and the one an
 * investigator actually needs, and it is derived rather than written so it
 * cannot drift from the arithmetic when a weight moves.
 *
 * ## Why accordions
 *
 * Hover cards and popovers were both considered and both rejected. A hover card
 * has no touch equivalent, cannot hold four paragraphs plus a nested data table,
 * and vanishes when the pointer travels toward whatever the reader wanted to
 * compare against. A popover overlays the page, which means it covers the
 * neighbouring finding -- and comparing two findings is the task. Accordions are
 * keyboard-native, printable, linkable, and any number of them can be open at
 * once.
 *
 * The strongest finding opens by default: it demonstrates the interaction
 * without instruction, and it is the one thing a reader who opens nothing else
 * should still see.
 */

const CONFIDENCE_ICON = { high: ShieldAlert, medium: Info, low: FlaskConical };

// ---------------------------------------------------------------------------
// Raw evidence rendering
// ---------------------------------------------------------------------------
//
// Preserved wholesale from the previous build, because the approach was right:
// dispatch on the JS TYPE of each value, never on the key name or rule id, so a
// backend rule with keys nobody has seen before still renders correctly with no
// frontend change. The only addition is the plain-English gloss beneath keys we
// have one for.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const LONG_HEX = /^[0-9a-fA-F]{32,}$/;
const MAX_DEPTH = 4;
const ARRAY_PREVIEW = 3;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function ScalarValue({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-ink-faint italic">Not recorded</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'font-medium text-ink' : 'text-ink-muted'}>{value ? 'Yes' : 'No'}</span>;
  }
  if (typeof value === 'number') {
    return <span className="num text-ink">{formatNumber(value)}</span>;
  }

  const str = String(value);
  if (/^https?:\/\//i.test(str)) {
    return (
      <a
        href={str}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent"
      >
        <span className="break-all">{str}</span>
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      </a>
    );
  }
  if (ISO_DATE.test(str)) {
    return (
      <time dateTime={str} className="text-ink">
        {formatDate(str)}
      </time>
    );
  }
  if (LONG_HEX.test(str)) {
    return (
      <span className="font-mono text-[0.75rem] break-all text-ink-muted" title={str}>
        {str}
      </span>
    );
  }
  return <span className="text-ink">{str}</span>;
}

function ObjectArray({ value, depth }) {
  const [expanded, setExpanded] = useState(false);
  const overflows = value.length > ARRAY_PREVIEW;
  const shown = expanded || !overflows ? value : value.slice(0, ARRAY_PREVIEW);

  return (
    <div className="mt-1 space-y-2">
      {shown.map((item, i) => (
        <div key={i} className="rounded-sm border border-line bg-panel p-2">
          {isPlainObject(item) ? (
            <EvidenceObject data={item} depth={depth + 1} />
          ) : (
            <EvidenceValue value={item} depth={depth + 1} />
          )}
        </div>
      ))}
      {overflows && (
        <Button type="button" variant="quiet" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Show fewer' : `Show all ${value.length}`}
        </Button>
      )}
    </div>
  );
}

function EvidenceValue({ value, depth }) {
  if (depth >= MAX_DEPTH) {
    return <span className="text-ink-faint italic">Nested further &mdash; see the raw response</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-faint italic">None</span>;
    if (value.some(isPlainObject)) return <ObjectArray value={value} depth={depth} />;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <span key={i} className="rounded-sm bg-panel px-1.5 py-0.5 text-[0.75rem] ring-1 ring-line">
            <ScalarValue value={item} />
          </span>
        ))}
      </span>
    );
  }
  if (isPlainObject(value)) {
    return (
      <div className="mt-1 border-l border-line pl-3">
        <EvidenceObject data={value} depth={depth + 1} />
      </div>
    );
  }
  return <ScalarValue value={value} />;
}

function EvidenceObject({ data, depth = 0 }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) {
    return <p className="text-[0.875rem] text-ink-faint italic">No evidence recorded</p>;
  }

  return (
    <dl className="space-y-2.5">
      {entries.map(([key, value]) => {
        const block = Array.isArray(value) ? value.some(isPlainObject) : isPlainObject(value);
        const gloss = depth === 0 ? glossFor(key) : null;
        return (
          <div
            key={key}
            className={
              block
                ? 'text-[0.875rem]'
                : 'gap-x-4 text-[0.875rem] sm:grid sm:grid-cols-[minmax(0,13rem)_1fr]'
            }
          >
            <dt className="min-w-0">
              <span className="text-ink-muted">{prettifyKey(key)}</span>
              {gloss && <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-faint">{gloss}</span>}
            </dt>
            <dd className="min-w-0">
              <EvidenceValue value={value} depth={depth} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// One finding
// ---------------------------------------------------------------------------

function SourceLine({ source }) {
  if (!source?.name) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-ink-faint">
      <span>Source:</span>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent"
        >
          {source.name}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : (
        <span className="text-ink-muted">{source.name}</span>
      )}
      {source.retrieved_at && (
        <span>
          &middot; retrieved <time dateTime={source.retrieved_at}>{formatDate(source.retrieved_at)}</time>
        </span>
      )}
    </p>
  );
}

/** A labelled block inside an open finding. */
function Facet({ label, children }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

function Finding({ signal, contribution, finalScore, weight, defaultOpen, isTop }) {
  const [open, setOpen] = useState(defaultOpen);
  const [rawOpen, setRawOpen] = useState(false);

  const notes = notesFor(signal);
  const confidence = confidenceNote(signal?.confidence);
  const Icon = CONFIDENCE_ICON[signal?.confidence] ?? Info;
  const effect = influence(contribution, finalScore, { isTop });
  const lens = lensNote(signal?.category, weight);
  const color = categoryColor(signal?.category);
  const hasEvidence = signal?.evidence && Object.keys(signal.evidence).length > 0;
  const panelId = `finding-${signal?.id ?? signal?.label}`;

  return (
    <Card
      as="article"
      className={`overflow-hidden transition-shadow ${open ? 'shadow-[var(--shadow-lift)]' : ''}`}
      data-print-open=""
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-hover sm:px-5"
        >
          {/* Category colour as a left rule: identity, carried without spending
              a whole chip on it. */}
          <span
            aria-hidden="true"
            className="mt-0.5 h-9 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[1rem] leading-snug font-medium text-ink">
                {signal?.label ?? signal?.id ?? 'Unnamed finding'}
              </span>
              <span className="text-[0.75rem] text-ink-faint">{categoryLabel(signal?.category)}</span>
            </span>

            {/* Closed state carries the plain-English one-liner, so a reader who
                opens nothing still learns what each finding is. */}
            <span className="mt-1 block text-[0.875rem] leading-relaxed text-ink-muted">
              {notes.plain}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-2.5 pt-0.5">
            <span className="hidden text-right sm:block">
              <span className="num block text-[0.9375rem] font-medium text-ink">
                {effect.isContextOnly ? '\u2014' : `+${formatScore(effect.points)}`}
              </span>
              <span className="block text-[0.6875rem] text-ink-faint">{effect.label}</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 text-ink-faint transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
            />
          </span>
        </button>
      </h3>

      {open && (
        <div id={panelId} className="anim-fade space-y-5 border-t border-line px-4 py-5 sm:px-5">
          <Facet label="What was found">
            {signal?.explanation ?? notes.plain}
          </Facet>

          <Facet label="Why it matters">{notes.matters}</Facet>

          <Facet label="Effect on the score">
            <p>
              <span className="font-medium text-ink">{effect.label}.</span> {effect.sentence}
            </p>
            {effect.share > 0 && (
              <div className="mt-2.5 flex items-center gap-3">
                <div className="h-1.5 max-w-56 flex-1 overflow-hidden rounded-full bg-sunken">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(effect.share * 100, 2)}%`, backgroundColor: color }}
                  />
                </div>
                <span className="num text-[0.8125rem] text-ink-faint">
                  {Math.round(effect.share * 100)}% of the score
                </span>
              </div>
            )}
            {lens && <p className="mt-2 text-[0.875rem] text-ink-faint">{lens}</p>}
          </Facet>

          <Facet label="How far to trust it">
            <p>
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {confidence.label}.
              </span>{' '}
              {confidence.meaning}
            </p>
            {notes.limits && <p className="mt-1.5">{notes.limits}</p>}
          </Facet>

          <div className="space-y-3 border-t border-line pt-4">
            <SourceLine source={signal?.source} />

            {hasEvidence && (
              <div>
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  aria-expanded={rawOpen}
                  onClick={() => setRawOpen((v) => !v)}
                  className="-ml-2.5"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 transition-transform ${rawOpen ? '' : '-rotate-90'}`}
                  />
                  {rawOpen ? 'Hide underlying data' : 'Show underlying data'}
                </Button>
                {rawOpen && (
                  <div className="anim-fade mt-2 rounded-md bg-sunken p-3.5">
                    <EvidenceObject data={signal.evidence} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export default function Evidence({ signals = [], result, weights = {} }) {
  const [order, setOrder] = useState('influence');

  const contributionById = useMemo(() => {
    const map = new Map();
    for (const entry of result?.contributions ?? []) {
      const key = entry.signal?.id ?? entry.signal?.label;
      if (key) map.set(key, entry.contribution);
    }
    return map;
  }, [result]);

  const keyOf = (signal) => signal?.id ?? signal?.label;

  const ordered = useMemo(() => {
    const list = [...signals];
    if (order === 'category') {
      return list.sort(
        (a, b) =>
          CATEGORIES.indexOf(a?.category) - CATEGORIES.indexOf(b?.category) ||
          (contributionById.get(keyOf(b)) ?? 0) - (contributionById.get(keyOf(a)) ?? 0),
      );
    }
    // Default: strongest first. The old build grouped by category, which put a
    // low-confidence heuristic above a decisive sanctions hit whenever the array
    // order happened to fall that way.
    return list.sort(
      (a, b) => (contributionById.get(keyOf(b)) ?? 0) - (contributionById.get(keyOf(a)) ?? 0),
    );
  }, [signals, order, contributionById]);

  if (signals.length === 0) {
    return (
      <Section id="evidence" title="Evidence">
        <Empty icon={ShieldCheck} tone="good" title="No risk indicators detected">
          Every category was evaluated and none produced a finding. That is not proof the address is
          clean &mdash; only that no configured rule matched it.
        </Empty>
      </Section>
    );
  }

  // The largest contributor is identified by rank rather than by threshold, so
  // the strongest finding is never demoted by a cut point it happens to sit
  // just beneath. Ordering is deterministic, so this is stable between renders.
  const topKey = [...signals]
    .map((s) => [keyOf(s), contributionById.get(keyOf(s)) ?? 0])
    .sort((a, b) => b[1] - a[1])
    .filter(([, points]) => points > 0)[0]?.[0];

  const contextOnly = ordered.filter((s) => (contributionById.get(keyOf(s)) ?? 0) <= 0).length;
  const silent = CATEGORIES.filter(
    (category) => !signals.some((signal) => signal?.category === category),
  );

  return (
    <Section
      id="evidence"
      title="Evidence"
      meta={`${signals.length} ${signals.length === 1 ? 'finding' : 'findings'}`}
      description="Each finding explains what was detected, why it matters, and exactly how many points it added. Open one to read it in full."
      action={
        <Segmented
          label="Order findings by"
          value={order}
          onChange={setOrder}
          options={[
            { value: 'influence', label: 'Strongest first' },
            { value: 'category', label: 'By category' },
          ]}
        />
      }
    >
      <div className="space-y-2.5">
        {ordered.map((signal, index) => (
          <Finding
            key={keyOf(signal) ?? index}
            signal={signal}
            contribution={contributionById.get(keyOf(signal)) ?? 0}
            finalScore={result.finalScore}
            weight={weights[signal?.category]}
            isTop={keyOf(signal) === topKey}
            defaultOpen={index === 0 && order === 'influence'}
          />
        ))}
      </div>

      {/* Two facts that are only visible in the negative space, and both matter:
          what was checked and stayed silent, and what was recorded but weighed
          nothing. Neither was stated anywhere in the old build. */}
      {(silent.length > 0 || contextOnly > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {silent.length > 0 && (
            <Chip className="bg-sunken text-ink-faint">
              {silent.map(categoryLabel).join(', ')} checked, nothing found
            </Chip>
          )}
          {contextOnly > 0 && (
            <Chip className="bg-sunken text-ink-faint">
              {contextOnly} {contextOnly === 1 ? 'finding is' : 'findings are'} context only and add no
              points
            </Chip>
          )}
        </div>
      )}
    </Section>
  );
}
