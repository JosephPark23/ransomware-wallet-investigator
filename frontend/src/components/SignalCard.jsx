import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FlaskConical, Info, ShieldAlert } from 'lucide-react';

import { formatDate, formatNumber, prettifyKey } from '../lib/format.js';

/**
 * One risk signal.
 *
 * The `evidence` object is free-form and its keys differ per rule, so it is
 * rendered STRUCTURALLY -- dispatch on the JS type of each value, never on the
 * key name or the rule id. A new backend rule with keys nobody has seen before
 * renders correctly without a frontend change.
 */

// ---------------------------------------------------------------------------
// Confidence: an OFAC listing and a peel-chain guess must not look alike.
// ---------------------------------------------------------------------------

const CONFIDENCE = {
  high: {
    label: 'High confidence',
    // Solid border, saturated badge, full contrast: this is an assertion of fact.
    card: 'border-slate-700 bg-slate-900/70',
    badge: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40',
    Icon: ShieldAlert,
    note: null,
  },
  medium: {
    label: 'Medium confidence',
    card: 'border-slate-800 bg-slate-900/50',
    badge: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/40',
    Icon: Info,
    note: 'Inferred from clustering. Attribution may be incomplete.',
  },
  low: {
    label: 'Low confidence',
    // Dashed border + muted everything: visually reads as "a guess", not a finding.
    card: 'border-dashed border-slate-800 bg-slate-900/25',
    badge: 'bg-slate-700/30 text-slate-400 ring-1 ring-slate-600/40',
    Icon: FlaskConical,
    note: 'Heuristic. Fires on some legitimate activity — corroborate before acting.',
  },
};

const confidenceStyle = (c) => CONFIDENCE[c] ?? CONFIDENCE.medium;

const severityTone = (severity) => {
  if (severity >= 75) return 'bg-red-500';
  if (severity >= 50) return 'bg-orange-500';
  if (severity >= 25) return 'bg-amber-500';
  return 'bg-emerald-500';
};

// ---------------------------------------------------------------------------
// Generic evidence rendering
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const LONG_HEX = /^[0-9a-fA-F]{32,}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A scalar leaf. */
function ScalarValue({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-600 italic">Not recorded</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-amber-300' : 'text-slate-400'}>{value ? 'Yes' : 'No'}</span>
    );
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums text-slate-200">{formatNumber(value)}</span>;
  }

  const str = String(value);
  if (/^https?:\/\//i.test(str)) {
    return (
      <a
        href={str}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
      >
        <span className="break-all">{str}</span>
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      </a>
    );
  }
  if (ISO_DATE.test(str)) {
    return (
      <time dateTime={str} className="text-slate-200">
        {formatDate(str)}
      </time>
    );
  }
  if (LONG_HEX.test(str)) {
    // Transaction ids and similar: monospace, wrapping, full value on hover.
    return (
      <span className="break-all font-mono text-xs text-slate-300" title={str}>
        {str}
      </span>
    );
  }
  return <span className="text-slate-200">{str}</span>;
}

const MAX_DEPTH = 4;

/** Rows of an object array shown before collapsing. Purely a length heuristic. */
const ARRAY_PREVIEW = 3;

/**
 * An array of objects, collapsed past a few entries.
 *
 * Some rules carry long sample arrays -- round-value matches ships ten. Rendered
 * in full, a low-confidence heuristic becomes the tallest thing on the page and
 * visually outranks an OFAC hit, which contract rule 4 explicitly forbids.
 * Collapsing keeps every entry reachable without letting length imply weight.
 */
function ObjectArray({ value, depth }) {
  const [expanded, setExpanded] = useState(false);
  const overflows = value.length > ARRAY_PREVIEW;
  const shown = expanded || !overflows ? value : value.slice(0, ARRAY_PREVIEW);

  return (
    <div className="mt-1 space-y-2">
      {shown.map((item, i) => (
        <div key={i} className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
          {isPlainObject(item) ? (
            <EvidenceObject data={item} depth={depth + 1} />
          ) : (
            <EvidenceValue value={item} depth={depth + 1} />
          )}
        </div>
      ))}

      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="rounded text-xs font-medium text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
        >
          {expanded ? 'Show fewer' : `Show all ${value.length}`}
        </button>
      )}
    </div>
  );
}

/** Recursive dispatch on value shape. */
function EvidenceValue({ value, depth }) {
  if (depth >= MAX_DEPTH) {
    return <span className="text-slate-500 italic">Nested further — see raw response</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-600 italic">None</span>;

    // Arrays of objects become stacked mini key/value blocks; arrays of
    // scalars become inline chips. Both are decided by content, not key name.
    if (value.some(isPlainObject)) {
      return <ObjectArray value={value} depth={depth} />;
    }

    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <span
            key={i}
            className="rounded bg-slate-800/70 px-1.5 py-0.5 text-xs text-slate-300"
          >
            <ScalarValue value={item} />
          </span>
        ))}
      </span>
    );
  }

  if (isPlainObject(value)) {
    return (
      <div className="mt-1 border-l border-slate-800 pl-3">
        <EvidenceObject data={value} depth={depth + 1} />
      </div>
    );
  }

  return <ScalarValue value={value} />;
}

/** Key/value rows for any object. */
function EvidenceObject({ data, depth = 0 }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) {
    return <p className="text-sm text-slate-600 italic">No evidence recorded</p>;
  }

  return (
    <dl className="space-y-1.5">
      {entries.map(([key, value]) => {
        // Composite values need their own line; scalars sit beside the label.
        const block = Array.isArray(value) ? value.some(isPlainObject) : isPlainObject(value);
        return (
          <div
            key={key}
            className={block ? 'text-sm' : 'flex flex-wrap gap-x-2 text-sm sm:grid sm:grid-cols-[minmax(0,11rem)_1fr]'}
          >
            <dt className="shrink-0 text-slate-500">{prettifyKey(key)}</dt>
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

/**
 * Source attribution. Behavioural heuristics have no external source, so both
 * `url` and `retrieved_at` are null for them and the name must stand alone.
 */
function SourceLine({ source }) {
  if (!source?.name) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
      <span>Source:</span>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
        >
          {source.name}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : (
        <span className="text-slate-400">{source.name}</span>
      )}
      {source.retrieved_at && (
        <span className="text-slate-600">
          · retrieved <time dateTime={source.retrieved_at}>{formatDate(source.retrieved_at)}</time>
        </span>
      )}
    </div>
  );
}

export default function SignalCard({ signal, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const style = confidenceStyle(signal?.confidence);
  const { Icon } = style;
  const severity = Number.isFinite(Number(signal?.severity)) ? Number(signal.severity) : 0;
  const hasEvidence = signal?.evidence && Object.keys(signal.evidence).length > 0;

  return (
    <article className={`rounded-xl border p-4 transition-colors ${style.card}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* contract.md: the human-readable name is `label`, the prose is
                `explanation`. Both are guaranteed non-empty (contract rule 6);
                the id fallback is a last resort, not an expected path. */}
            <h3 className="font-medium text-slate-100">{signal?.label ?? signal?.id ?? 'Unnamed signal'}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.badge}`}>
              {style.label}
            </span>
          </div>

          {signal?.explanation && (
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{signal.explanation}</p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
              <div
                className={`h-full rounded-full ${severityTone(severity)}`}
                style={{ width: `${Math.max(0, Math.min(100, severity))}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              severity <span className="font-medium text-slate-300">{severity}</span>
            </span>
          </div>

          {style.note && <p className="mt-2 text-xs italic text-slate-500">{style.note}</p>}

          {hasEvidence && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {open ? 'Hide evidence' : 'Show evidence'}
              </button>

              {open && (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <EvidenceObject data={signal.evidence} />
                </div>
              )}
            </>
          )}

          <div className="mt-3 border-t border-slate-800/70 pt-2">
            <SourceLine source={signal?.source} />
          </div>
        </div>
      </div>
    </article>
  );
}
