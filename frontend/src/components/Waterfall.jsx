import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { categoryColor, categoryLabel } from '../lib/categories.js';
import {
  axisMax,
  buildWaterfallRows,
  formatScore,
  renderedTotal,
  truncateLabel,
} from '../lib/waterfall.js';
import NoSignals from './NoSignals.jsx';

/**
 * The waterfall: how the final score was actually assembled.
 *
 * One bar per signal, left to right, ordered by descending contribution, from 0
 * up to finalScore. Recharts has no waterfall type, so each bar is a two-segment
 * stack -- an invisible `base` segment holding the running total before this
 * signal, and a visible `contribution` segment on top of it. The top edge of the
 * last bar is therefore the sum of every contribution, and it has to land on the
 * number in the dial. A reference line is drawn at that number so the reader can
 * see it land rather than take it on trust.
 *
 * All ordering and stacking geometry lives in lib/waterfall.js so it can be unit
 * tested without a DOM; this file is layout and colour only.
 */

// Chrome. Recessive by design -- the bars are the content.
const GRID = '#1e293b'; // slate-800
const AXIS_TEXT = '#64748b'; // slate-500
const TOTAL_RULE = '#94a3b8'; // slate-400

/** Plot height, and the band below it reserved for angled x-axis labels. */
const PLOT_HEIGHT = 300;
const LABEL_BAND = 104;

/**
 * Angled, truncated x-axis label.
 *
 * Nine long signal labels will not fit horizontally at any realistic width, so
 * they are rotated and clipped to a fixed character budget. The full text is one
 * hover away and is also spelled out in the table view, so nothing is only
 * reachable through the tooltip.
 */
function AngledTick({ x, y, payload }) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      transform={`rotate(-35, ${x}, ${y})`}
      fill={AXIS_TEXT}
      fontSize={11}
    >
      {truncateLabel(payload.value)}
    </text>
  );
}

function WaterfallTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  // Both stacked segments share one row, so either entry carries the whole row.
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="max-w-72 rounded-lg border border-slate-700 bg-slate-950/95 p-3 shadow-xl">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: categoryColor(row.category) }}
        />
        <div className="min-w-0">
          <p className="text-sm leading-snug font-medium text-slate-100">{row.label}</p>
          <p className="mt-0.5 text-xs text-slate-500">{categoryLabel(row.category)}</p>
        </div>
      </div>

      <dl className="mt-2 space-y-0.5 border-t border-slate-800 pt-2 text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Contribution</dt>
          <dd className="font-medium tabular-nums text-slate-200">
            +{formatScore(row.contribution)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Running total</dt>
          <dd className="tabular-nums text-slate-400">{formatScore(row.cumulative)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Legend: identity is never carried by colour alone. */
function Legend({ categories }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
      {categories.map((category) => (
        <li key={category} className="flex items-center gap-1.5 text-xs text-slate-400">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: categoryColor(category) }}
          />
          {categoryLabel(category)}
        </li>
      ))}
    </ul>
  );
}

/** The WCAG-clean twin of the chart. Every value on screen is also readable here. */
function TableView({ rows, total }) {
  return (
    <details className="mt-4 border-t border-slate-800 pt-3">
      <summary className="cursor-pointer rounded text-xs font-medium text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50">
        Show as table
      </summary>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-800">
              <th scope="col" className="py-1.5 pr-3 font-medium">Signal</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Category</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Contribution</th>
              <th scope="col" className="py-1.5 text-right font-medium">Running total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-800/60">
                <td className="py-1.5 pr-3 text-slate-300">{row.label}</td>
                <td className="py-1.5 pr-3 text-slate-500">{categoryLabel(row.category)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-slate-200">
                  +{formatScore(row.contribution)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-400">
                  {formatScore(row.cumulative)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium text-slate-200">
              <td className="py-1.5 pr-3" colSpan={3}>
                Final score
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatScore(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  );
}

function Panel({ children, note }) {
  return (
    <section className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
      <h2 className="text-xs font-medium tracking-wider uppercase text-slate-400">
        Score composition
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{note}</p>
      {children}
    </section>
  );
}

export default function Waterfall({ contributions = [], finalScore = 0, hasSignals = true }) {
  const rows = useMemo(() => buildWaterfallRows(contributions), [contributions]);

  // No signals at all: the same treatment the signal list gives, not an empty axis.
  if (!hasSignals) {
    return (
      <section aria-label="Score composition">
        <NoSignals />
      </section>
    );
  }

  // Signals exist but every category is weighted to zero, so there is nothing to
  // divide up. That is a very different statement from "nothing was found", and
  // must not borrow the "no risk indicators detected" wording.
  if (rows.length === 0) {
    return (
      <Panel note="Every category is weighted to zero, so no signal contributes to the score. Raise a weight to see the breakdown.">
        <div />
      </Panel>
    );
  }

  // What the bars actually add up to, read off the drawn geometry rather than
  // re-summing the contributions -- re-summing would only re-prove the scoring
  // invariant and would still pass if the bars were built wrong.
  const total = renderedTotal(rows);
  // The reference line is drawn at the DIAL's number, not at the chart's own
  // total, so a mismatch between the two shows up as a visible gap instead of
  // silently agreeing with itself.
  const max = axisMax(Math.max(total, finalScore));
  // Legend order follows the bars, so the first swatch is the biggest contributor.
  const present = [...new Set(rows.map((r) => r.category))];

  return (
    <Panel
      note={
        <>
          Each bar is one signal&rsquo;s share of the score, largest first. The bars stack from 0 to{' '}
          <span className="font-medium tabular-nums text-slate-300">{formatScore(total)}</span> — the
          same number as the dial.
        </>
      }
    >
      <div
        style={{ height: PLOT_HEIGHT + LABEL_BAND }}
        role="img"
        aria-label={`Waterfall of ${rows.length} risk signals accumulating to a final score of ${formatScore(total)} out of 100. The full breakdown is available in the table below.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            // Rotated labels are anchored at their right end, so each one's tail
            // runs down-and-left past the tick. The left margin is what keeps the
            // first bar's label inside the card instead of over its edge.
            margin={{ top: 16, right: 8, bottom: LABEL_BAND, left: 24 }}
            barCategoryGap="22%"
          >
            <CartesianGrid stroke={GRID} vertical={false} />

            <XAxis
              dataKey="label"
              interval={0}
              tick={<AngledTick />}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              height={1}
            />
            <YAxis
              domain={[0, max]}
              tick={{ fill: AXIS_TEXT, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />

            <Tooltip
              content={<WaterfallTooltip />}
              cursor={{ fill: '#ffffff', fillOpacity: 0.04 }}
            />

            {/* The staircase: an invisible riser, then the visible step on top. */}
            <Bar dataKey="base" stackId="waterfall" fill="none" isAnimationActive={false} />
            <Bar
              dataKey="contribution"
              stackId="waterfall"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell key={row.id} fill={categoryColor(row.category)} />
              ))}
            </Bar>

            {/* Where the bars are SUPPOSED to land -- the dial's score. Solid:
                this is a real threshold, not a gridline. */}
            <ReferenceLine
              y={finalScore}
              stroke={TOTAL_RULE}
              strokeWidth={1}
              label={{
                value: formatScore(finalScore),
                position: 'right',
                fill: TOTAL_RULE,
                fontSize: 11,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Legend categories={present} />
      <TableView rows={rows} total={total} />
    </Panel>
  );
}
