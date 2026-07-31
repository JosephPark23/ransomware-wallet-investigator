import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Filter, ShieldCheck, Waypoints } from 'lucide-react';

import { flagColor, flagLabel } from '../lib/flags.js';
import { formatBtc } from '../lib/format.js';
import { buildGraphLayout } from '../lib/graphLayout.js';
import { counterpartyRows, isClusterId, reduceGraph } from '../lib/graphRelevance.js';
import { TOPOLOGY_SHARED, buildTaintPath } from '../lib/taint.js';
import { Button, Card, Chip, Empty, Eyebrow, Note, Section, Segmented } from './ui.jsx';

/**
 * Who this address dealt with, and how funds reach anything flagged.
 *
 * ## The scaling problem
 *
 * graphLayout.js places every node it is handed at a fixed vertical gap, so the
 * SVG grows linearly with the busiest hop. Five nodes in the fixture is fine;
 * forty counterparties on a real collection wallet is a three-thousand-pixel
 * canvas with forty labels, which is not a visualisation of anything. The old
 * panel had no filtering, no capping, no clustering and no zoom, so a busy
 * address simply broke it.
 *
 * ## What is done about it, and the one thing that is never done
 *
 * Counterparties are ranked by value moved, the top few per hop are drawn, and
 * the tail collapses into a single cluster chip per hop carrying the summed
 * value of every flow it absorbed (lib/graphRelevance.js). Expanding a cluster
 * opens a LIST, not more circles -- thirty-four more circles is the original
 * problem, and a table is simply the better representation for a long tail.
 *
 * The invariant, stated on screen as well as in the code: a flagged
 * counterparty is never capped, never filtered and never clustered. A relevance
 * heuristic that can hide a sanctioned address has inverted the product, and
 * the reader has to be able to trust that the graph being simplified does not
 * mean the graph is hiding the answer.
 *
 * ## The table is not a fallback
 *
 * At two hundred counterparties, a sortable table is the better tool and the
 * picture is for topology. It is offered as a peer view rather than an
 * accessibility afterthought -- and it also happens to be the view that works
 * with a screen reader, which is the same argument the previous build already
 * accepted for the score chart.
 */

const DEFAULT_PER_HOP = 6;

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------

function GraphCanvas({ layout, selected, onSelect, clusters }) {
  const { width, height, columns, nodes, edges } = layout;
  const svgRef = useRef(null);

  // Arrow keys walk the drawn nodes in reading order. With the per-hop cap in
  // place the node count is bounded, so every node can be a tab stop without
  // turning the graph into a tab trap.
  const onKeyDown = (event, index, node) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(node.id === selected ? null : node.id);
      return;
    }
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + nodes.length) % nodes.length;
    svgRef.current?.querySelector(`[data-node-index="${next}"]`)?.focus();
  };

  return (
    <div className="overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[620px]"
        role="group"
        aria-label={`Counterparty graph: ${nodes.length} addresses across ${columns.length} hop levels. The table view lists every counterparty.`}
      >
        <defs>
          <marker id="cm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)" />
          </marker>
        </defs>

        {columns.map((hop, i) => {
          const x = nodes.find((n) => n.column === i)?.x ?? 0;
          return (
            <text
              key={hop}
              x={x}
              y={15}
              textAnchor="middle"
              fill="var(--ink-faint)"
              fontSize="9.5"
              letterSpacing="0.1em"
            >
              {hop === 0 ? 'ANALYSED' : `${hop} HOP${hop === 1 ? '' : 'S'}`}
            </text>
          );
        })}

        {edges.map((edge, i) => (
          <g key={`${edge.source}->${edge.target}-${i}`}>
            <line
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke={edge.toFlagged ? 'var(--ink-faint)' : 'var(--line-strong)'}
              strokeWidth={edge.toFlagged ? 1.75 : 1.25}
              markerEnd="url(#cm-arrow)"
            />
            {edge.value !== null && (
              <text
                x={edge.midX}
                y={edge.midY - 6}
                textAnchor="middle"
                fill="var(--ink-faint)"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                {formatBtc(edge.value)}
              </text>
            )}
          </g>
        ))}

        {nodes.map((node, index) => {
          const isSelected = node.id === selected;
          const cluster = isClusterId(node.id) ? clusters.find((c) => c.id === node.id) : null;

          return (
            <g
              key={node.id}
              data-node-index={index}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : node.id)}
              onKeyDown={(event) => onKeyDown(event, index, node)}
              className="cursor-pointer outline-none"
              aria-label={
                cluster
                  ? `${cluster.count} further counterparties at hop ${node.hop}, grouped. None of them are flagged.`
                  : `${node.label}${node.flags.length ? `, flagged ${node.flags.join(', ')}` : ', no flags'}, hop ${node.hop}`
              }
            >
              {node.hop === 0 && (
                <circle cx={node.x} cy={node.y} r={node.r + 6} fill="none" stroke={node.color} strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />
              )}
              {isSelected && (
                <circle cx={node.x} cy={node.y} r={node.r + 4} fill="none" stroke="var(--accent)" strokeWidth="2" />
              )}

              {cluster ? (
                // Clusters look like a group, not like an address: dashed edge,
                // hollow fill, count instead of a label.
                <>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r}
                    fill="var(--s-sunken)"
                    stroke="var(--line-strong)"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--ink-muted)"
                    fontSize="10"
                    fontWeight="600"
                  >
                    +{cluster.count}
                  </text>
                </>
              ) : (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={node.color}
                  fillOpacity={node.flagged ? 0.92 : 0.42}
                  stroke={node.color}
                  strokeWidth="1.5"
                />
              )}

              <text
                x={node.x}
                y={node.y + node.r + 14}
                textAnchor="middle"
                fill="var(--ink-muted)"
                fontSize="10.5"
                fontFamily={cluster ? 'inherit' : 'var(--font-mono)'}
              >
                {cluster ? 'grouped' : node.label}
              </text>
              {node.flagged && (
                <text x={node.x} y={node.y + node.r + 26} textAnchor="middle" fill={node.color} fontSize="9.5" fontWeight="600">
                  {node.parsedFlags.map((f) => flagLabel(f.raw)).join(' \u00b7 ')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function CounterpartyTable({ rows }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 25);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[0.875rem]">
          <thead>
            <tr className="border-b border-line text-[0.75rem] text-ink-faint">
              <th scope="col" className="py-2 pr-3 font-medium">Address</th>
              <th scope="col" className="py-2 pr-3 font-medium">Flags</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Hops</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Received</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Sent</th>
              <th scope="col" className="py-2 text-right font-medium">Flows</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="py-2 pr-3">
                  <span className="font-mono text-[0.8125rem] break-all text-ink" title={row.id}>
                    {row.label}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {row.flagged ? (
                    <span className="font-medium" style={{ color: flagColor(row.flags.map((f) => f.raw)) }}>
                      {row.flags.map((f) => flagLabel(f.raw)).join(', ')}
                    </span>
                  ) : (
                    <span className="text-ink-faint">&mdash;</span>
                  )}
                </td>
                <td className="num py-2 pr-3 text-right text-ink-muted">{row.hop}</td>
                <td className="num py-2 pr-3 text-right text-ink-muted">{formatBtc(row.received) ?? '0'}</td>
                <td className="num py-2 pr-3 text-right text-ink-muted">{formatBtc(row.sent) ?? '0'}</td>
                <td className="num py-2 text-right text-ink-muted">{row.txCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 25 && (
        <Button type="button" variant="quiet" size="sm" className="mt-3" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show first 25' : `Show all ${rows.length}`}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taint paths
// ---------------------------------------------------------------------------

function TaintPathItem({ path }) {
  const view = buildTaintPath(path);
  const color = flagColor([view.targetFlag]);

  return (
    <li className="rounded-md border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Chip color={color} soft="transparent">
          {flagLabel(view.targetFlag)}
        </Chip>
        <span className="num text-[0.8125rem] text-ink-faint">
          {view.hops} {view.hops === 1 ? 'hop' : 'hops'}
          {view.topology !== TOPOLOGY_SHARED &&
            view.formattedValue !== null &&
            ` \u00b7 ${view.formattedValue} BTC`}
        </span>
        {view.topology === TOPOLOGY_SHARED && (
          <Chip className="bg-sunken text-ink-faint">no observed flow</Chip>
        )}
      </div>

      <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">{view.sentence}</p>
      {view.note && <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-faint">{view.note}</p>}

      <div className="mt-3 overflow-x-auto pb-1">
        <ol className="flex w-max items-start gap-1">
          {view.steps.map((step, i) => (
            <li key={`${step.address}-${i}`} className="flex items-start gap-1">
              <div className="flex shrink-0 flex-col items-center gap-1">
                <span
                  className="rounded-sm border px-2.5 py-1.5 font-mono text-[0.75rem]"
                  style={
                    step.isFlagged
                      ? { backgroundColor: color, color: 'var(--s-panel)', borderColor: color }
                      : step.isTarget
                        ? { backgroundColor: 'var(--s-sunken)', borderColor: 'var(--line-strong)' }
                        : { borderColor: 'var(--line)' }
                  }
                  title={step.address}
                >
                  {step.short}
                </span>
                <span className="text-[0.625rem] tracking-wider uppercase text-ink-faint">
                  {step.isTarget ? 'analysed' : step.isFlagged ? 'flagged' : 'intermediary'}
                </span>
              </div>
              {i < view.steps.length - 1 && (
                <div className="flex shrink-0 flex-col items-center gap-1 px-1">
                  <ArrowRight className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
                  {step.txHash ? (
                    <span className="max-w-[7rem] truncate font-mono text-[0.625rem] text-ink-faint" title={step.txHash}>
                      {step.txHash}
                    </span>
                  ) : (
                    <span className="text-[0.625rem] text-ink-faint italic">tx not recorded</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

export default function Network({ graph, taintPaths = [] }) {
  const [view, setView] = useState('graph');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [perHop, setPerHop] = useState(DEFAULT_PER_HOP);
  const [selected, setSelected] = useState(null);

  const reduced = useMemo(
    () => reduceGraph(graph, { perHopLimit: perHop, flaggedOnly }),
    [graph, perHop, flaggedOnly],
  );

  // The canvas grows with the busiest column, so the row gap tightens as the
  // column fills. Without this the cap alone still yields a card taller than
  // the viewport whenever several hops are full.
  const layout = useMemo(() => {
    const perColumn = new Map();
    for (const node of reduced.graph.nodes) {
      const hop = Number(node.hop) || 0;
      perColumn.set(hop, (perColumn.get(hop) ?? 0) + 1);
    }
    const tallest = Math.max(1, ...perColumn.values());
    const rowGap = Math.max(46, Math.min(82, Math.round(560 / tallest)));
    return buildGraphLayout(reduced.graph, { rowGap });
  }, [reduced]);

  const rows = useMemo(() => counterpartyRows(graph), [graph]);
  const selectedNode = layout.nodes.find((n) => n.id === selected) ?? null;
  const selectedCluster = selected ? reduced.clusters.find((c) => c.id === selected) : null;

  const { summary } = reduced;
  const hasGraph = rows.length > 0;

  return (
    <Section
      id="network"
      title="Network"
      meta={
        hasGraph
          ? `${summary.total} ${summary.total === 1 ? 'address' : 'addresses'}${
              summary.flaggedTotal > 0 ? ` \u00b7 ${summary.flaggedTotal} flagged` : ''
            }`
          : undefined
      }
      description="Counterparties within the hops retrieved, and any route from this address to something on a watchlist."
      action={
        hasGraph && (
          <Segmented
            label="Network view"
            value={view}
            onChange={setView}
            options={[
              { value: 'graph', label: 'Graph' },
              { value: 'table', label: 'Table' },
            ]}
          />
        )
      }
    >
      <Card className="p-5 sm:p-6">
        {!hasGraph ? (
          <Empty title="No transaction graph was returned">
            The analysis did not retrieve counterparties for this address, so there is nothing to
            map.
          </Empty>
        ) : view === 'table' ? (
          <CounterpartyTable rows={rows} />
        ) : (
          <>
            {/* --- Controls --- */}
            <div className="no-print mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
                <Segmented
                  label="Which counterparties to draw"
                  value={flaggedOnly ? 'flagged' : 'all'}
                  onChange={(value) => setFlaggedOnly(value === 'flagged')}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'flagged', label: 'Flagged only', hint: 'Draw only the analysed address and flagged counterparties' },
                  ]}
                />
              </div>

              {!flaggedOnly && (
                <label className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
                  <span className="whitespace-nowrap">Per hop</span>
                  <input
                    type="range"
                    min={2}
                    max={20}
                    step={1}
                    value={perHop}
                    onChange={(event) => setPerHop(Number(event.target.value))}
                    className="w-28"
                    aria-label="Unflagged counterparties drawn per hop"
                  />
                  <span className="num w-5 text-ink">{perHop}</span>
                </label>
              )}
            </div>

            {/* --- What is on screen versus what exists. Stated always, not only
                    when something is hidden: silence would read as "this is
                    everything", which is the one way this panel could mislead
                    without appearing to. --- */}
            <p className="mb-3 text-[0.8125rem] text-ink-muted">
              Showing <span className="num font-medium text-ink">{summary.shown}</span> of{' '}
              <span className="num">{summary.total}</span> addresses
              {summary.flaggedTotal > 0 && (
                <>
                  {' \u00b7 '}
                  <span className="num font-medium" style={{ color: 'var(--band-high)' }}>
                    {summary.flaggedShown} of {summary.flaggedTotal}
                  </span>{' '}
                  flagged
                  {summary.flaggedShown === summary.flaggedTotal && ' (all of them)'}
                </>
              )}
              {summary.hidden > 0 && ` \u00b7 ${summary.hidden} grouped into the "+" chips`}
            </p>

            {layout.edges.length === 0 && (
              <Note className="mb-3">
                No transactions were retrieved between these addresses, so the graph shows the
                addresses without the flows connecting them.
              </Note>
            )}
            {layout.droppedEdges > 0 && (
              <Note tone="warn" className="mb-3">
                {layout.droppedEdges}{' '}
                {layout.droppedEdges === 1 ? 'transaction references' : 'transactions reference'} an
                address missing from the graph and {layout.droppedEdges === 1 ? 'is' : 'are'} not
                drawn.
              </Note>
            )}

            <GraphCanvas
              layout={layout}
              selected={selected}
              onSelect={setSelected}
              clusters={reduced.clusters}
            />

            {/* --- Detail for a clicked node, or the contents of a cluster. --- */}
            {selectedCluster && (
              <div className="anim-fade mt-3 rounded-md border border-line bg-sunken p-3">
                <Eyebrow>
                  {selectedCluster.count} grouped counterparties at hop {selectedCluster.hop}
                </Eyebrow>
                <p className="mt-1 text-[0.8125rem] text-ink-faint">
                  None of these carry a flag. They were grouped because they moved less value than
                  the addresses drawn.
                </p>
                <ul className="mt-2.5 max-h-56 space-y-1 overflow-y-auto">
                  {selectedCluster.members.map((member) => (
                    <li key={member.id} className="font-mono text-[0.75rem] break-all text-ink-muted">
                      {member.id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selectedNode && !selectedCluster && (
              <div className="anim-fade mt-3 rounded-md border border-line bg-sunken p-3">
                <p className="font-mono text-[0.8125rem] break-all text-ink">{selectedNode.id}</p>
                <p className="mt-1 text-[0.8125rem] text-ink-faint">
                  {selectedNode.hop === 0
                    ? 'The analysed address'
                    : `${selectedNode.hop} hop${selectedNode.hop === 1 ? '' : 's'} away`}
                  {selectedNode.type ? ` \u00b7 ${selectedNode.type}` : ''}
                  {selectedNode.flags.length > 0
                    ? ` \u00b7 ${selectedNode.parsedFlags.map((f) => flagLabel(f.raw)).join(', ')}`
                    : ' \u00b7 no flags'}
                </p>
              </div>
            )}

            {/* --- Legend. Only describes encodings actually in use. --- */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-[0.8125rem] text-ink-faint">
              {[...new Set(layout.nodes.filter((n) => n.flagged).map((n) => n.color))].map((color) => {
                const node = layout.nodes.find((n) => n.color === color && n.flagged);
                return (
                  <span key={color} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                    {flagLabel(node.parsedFlags[0].kind)}
                  </span>
                );
              })}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--node-unflagged)', opacity: 0.5 }} aria-hidden="true" />
                No flags
              </span>
              {summary.hidden > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border border-dashed border-[var(--line-strong)]" aria-hidden="true" />
                  Grouped &mdash; flagged addresses are never grouped
                </span>
              )}
              <span>Distance from the analysed address runs left to right.</span>
            </div>
          </>
        )}
      </Card>

      {/* --- Taint paths sit inside Network because they answer the same
              question the graph does -- where did the money touch? -- and
              splitting them into their own section made the reader hold the
              graph in their head while scrolling to the answer. --- */}
      <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="flex items-center gap-2 text-[1.0625rem] font-semibold">
            <Waypoints className="h-4 w-4 text-ink-faint" aria-hidden="true" />
            Routes to flagged addresses
          </h3>
          {taintPaths.length > 0 && (
            <span className="num text-[0.8125rem] text-ink-faint">
              {taintPaths.length} {taintPaths.length === 1 ? 'route' : 'routes'}
            </span>
          )}
        </div>

        {taintPaths.length === 0 ? (
          <Empty icon={ShieldCheck} tone="good" title="No route found">
            Nothing connects this address to a flagged one within the hops retrieved. A longer chain
            could still exist beyond that range.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {taintPaths.map((path, i) => (
              <TaintPathItem key={`${path?.target_flag ?? 'path'}-${i}`} path={path} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
