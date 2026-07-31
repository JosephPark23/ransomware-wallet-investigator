import { useMemo, useState } from 'react';

import { categoryColor, categoryLabel } from '../lib/categories.js';
import { buildWaterfallRows, formatScore, renderedTotal } from '../lib/waterfall.js';
import { Button, Card, Empty, Section, Segmented } from './ui.jsx';
import { ShieldCheck } from 'lucide-react';

/**
 * How the score was assembled.
 *
 * ## Why the vertical waterfall is gone
 *
 * The old chart was a vertical stacked waterfall in a 300px plot with a 104px
 * band underneath for x-axis labels rotated 35 degrees and clipped at 22
 * characters. It failed at both ends of the range it needed to cover:
 *
 *   - With one or two findings it drew one or two lonely columns in a plot sized
 *     for eight, with two rotated labels under a mostly empty grid. It read as
 *     broken rather than sparse.
 *   - With twenty findings the rotated labels collided, and every one of them
 *     was truncated, so the axis stopped identifying its own bars.
 *
 * Both failures come from the same decision: putting the categorical dimension
 * on the horizontal axis. Screens are wide and short, and text is horizontal, so
 * a categorical axis that grows sideways runs out of room immediately while an
 * axis that grows downward never does.
 *
 * ## What replaced it
 *
 * One idea at two scales.
 *
 *   1. A single segmented rule -- the score drawn as one bar out of 100, cut
 *      into one segment per finding. At one finding it is one block, which reads
 *      correctly as "one thing produced this score". At thirty it is a dense
 *      strip whose proportions are still legible even when individual segments
 *      are not. It degrades in both directions without changing shape, and the
 *      same rule reappears at small size in the assessment header, so the reader
 *      meets the idea once and recognises it twice.
 *
 *   2. Underneath, one row per finding: name on the left in normal reading
 *      order, bar in the middle, figures right-aligned. Labels are never rotated
 *      and never truncated. Adding findings makes the list longer, which costs
 *      nothing, and past a dozen the tail collapses behind a control rather than
 *      running off the screen.
 *
 * The reference line proving the bars reconcile with the dial is preserved as an
 * explicit stated total, and the accessible table twin the old chart carried is
 * kept -- it is now the same shape as the visual rather than an alternative to
 * it.
 */

/** Below this many rows, the list shows everything. Above it, the tail collapses. */
const ROWS_BEFORE_COLLAPSE = 12;
const ROWS_WHEN_COLLAPSED = 8;

/**
 * The score as a single rule out of 100, segmented by contributor.
 *
 * Used at two sizes: large in this section, small in the assessment header.
 * Segments carry a title for pointer users, but nothing here is only available
 * on hover -- every value is also printed in the list below.
 */
export function ScoreRule({ rows, total, height = 'h-3', showTrack = true, className = '' }) {
  const contributing = rows.filter((row) => row.contribution > 0);

  return (
    <div
      className={`flex w-full overflow-hidden rounded-full ${height} ${
        showTrack ? 'bg-sunken' : ''
      } ${className}`}
      role="img"
      aria-label={`Score of ${formatScore(total)} out of 100, made up of ${contributing.length} ${
        contributing.length === 1 ? 'finding' : 'findings'
      }.`}
    >
      {contributing.map((row) => (
        <div
          key={row.id}
          title={`${row.label} — ${formatScore(row.contribution)} points`}
          style={{
            width: `${row.contribution}%`,
            backgroundColor: categoryColor(row.category),
          }}
          // A hairline between segments so adjacent bars in the same category
          // colour are still countable.
          className="h-full border-r border-panel/70 last:border-r-0"
        />
      ))}
    </div>
  );
}

/** One finding's row: label, proportional bar, points, share. */
function ContributionRow({ row, total }) {
  const share = total > 0 ? row.contribution / total : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 translate-y-px rounded-full"
          style={{ backgroundColor: categoryColor(row.category) }}
        />
        <span className="min-w-0">
          <span className="block text-[0.875rem] leading-snug text-ink">{row.label}</span>
          <span className="block text-[0.75rem] text-ink-faint">{categoryLabel(row.category)}</span>
        </span>
      </div>

      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-sunken sm:col-span-1 sm:mt-0">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(share * 100, row.contribution > 0 ? 1.5 : 0)}%`,
            backgroundColor: categoryColor(row.category),
          }}
        />
      </div>

      <div className="num shrink-0 text-right">
        <span className="block text-[0.875rem] font-medium text-ink">
          +{formatScore(row.contribution)}
        </span>
        <span className="block text-[0.75rem] text-ink-faint">{Math.round(share * 100)}%</span>
      </div>
    </li>
  );
}

/** Rows folded up to one per category. */
function categoryRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const entry = map.get(row.category) ?? { category: row.category, contribution: 0, count: 0 };
    entry.contribution += row.contribution;
    entry.count += 1;
    map.set(row.category, entry);
  }
  return [...map.values()]
    .sort((a, b) => b.contribution - a.contribution)
    .map((entry) => ({
      id: entry.category,
      label: `${categoryLabel(entry.category)} — ${entry.count} ${
        entry.count === 1 ? 'finding' : 'findings'
      }`,
      category: entry.category,
      contribution: entry.contribution,
    }));
}

export default function Composition({ contributions = [], finalScore = 0, hasSignals = true }) {
  const [grouping, setGrouping] = useState('signal');
  const [expanded, setExpanded] = useState(false);

  const signalRows = useMemo(() => buildWaterfallRows(contributions), [contributions]);
  const rows = useMemo(
    () => (grouping === 'category' ? categoryRows(signalRows) : signalRows),
    [grouping, signalRows],
  );

  // Read the total off the drawn geometry rather than re-summing, preserving the
  // original build's check: if the bars and the score ever disagree, the number
  // printed here disagrees with the arc and the discrepancy is visible.
  const drawnTotal = renderedTotal(signalRows);

  if (!hasSignals) {
    return (
      <Section id="composition" title="Score composition">
        <Empty icon={ShieldCheck} tone="good" title="Nothing to break down">
          No rule matched this address, so there is no score to apportion.
        </Empty>
      </Section>
    );
  }

  if (signalRows.length === 0 || drawnTotal === 0) {
    return (
      <Section
        id="composition"
        title="Score composition"
        description="Findings were recorded, but none of them contribute to the score under your current lens. Raise a category weight in Method to see the breakdown."
      >
        <Card className="p-6">
          <ScoreRule rows={[]} total={0} height="h-4" />
        </Card>
      </Section>
    );
  }

  const collapsible = rows.length > ROWS_BEFORE_COLLAPSE;
  const visible = collapsible && !expanded ? rows.slice(0, ROWS_WHEN_COLLAPSED) : rows;
  const hiddenCount = rows.length - visible.length;

  return (
    <Section
      id="composition"
      title="Score composition"
      meta={`${signalRows.length} ${signalRows.length === 1 ? 'contributor' : 'contributors'}`}
      description={`Each segment is one finding's share of the score. Together they account for all ${formatScore(
        drawnTotal,
      )} points, which is the number on the arc above.`}
      action={
        signalRows.length > 1 && (
          <Segmented
            label="Group composition by"
            value={grouping}
            onChange={(value) => {
              setGrouping(value);
              setExpanded(false);
            }}
            options={[
              { value: 'signal', label: 'By finding' },
              { value: 'category', label: 'By category' },
            ]}
          />
        )
      }
    >
      <Card className="p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-4 pb-2">
          <span className="text-[0.75rem] font-semibold tracking-[0.12em] uppercase text-ink-faint">
            Score
          </span>
          <span className="num text-[0.8125rem] text-ink-muted">
            {formatScore(drawnTotal)} <span className="text-ink-faint">/ 100</span>
          </span>
        </div>

        <ScoreRule rows={rows} total={drawnTotal} height="h-4" />

        <ul className="mt-4 divide-y divide-line border-t border-line">
          {visible.map((row) => (
            <ContributionRow key={row.id} row={row} total={drawnTotal} />
          ))}
        </ul>

        {collapsible && (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            className="mt-3"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show fewer' : `Show ${hiddenCount} smaller ${hiddenCount === 1 ? 'contributor' : 'contributors'}`}
          </Button>
        )}

        <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-ink-faint">
          Categories combine so that additional evidence always raises the score and never lowers it,
          and each finding is credited only with the part of the risk it was first to establish.
          Overlapping findings are discounted rather than counted twice.
        </p>
      </Card>
    </Section>
  );
}
