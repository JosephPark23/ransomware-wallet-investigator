import { useMemo, useState } from 'react';
import { Network } from 'lucide-react';

import { flagLabel } from '../lib/flags.js';
import { buildGraphLayout } from '../lib/graphLayout.js';
import { formatBtc } from '../lib/format.js';

/**
 * The counterparty graph: who this address transacted with, and how far the
 * flagged ones sit from it.
 *
 * Hand-drawn SVG rather than a force simulation. contract.md clamps hops at 2,
 * so the graph is three columns forever and physics would only cost determinism
 * -- see lib/graphLayout.js, which owns all the geometry so it can be asserted
 * without a DOM. This file is paint.
 *
 * Encoding, kept deliberately orthogonal:
 *   colour   WHICH flag (OFAC / ransomware / none) -- identity, from categories.js
 *   column   how many hops from the analysed address -- magnitude
 *   size     the same thing again, so hop survives greyscale and CVD
 *
 * Colour never carries hop and position never carries flag, so no node has to
 * be two things at once.
 */

const AXIS_TEXT = '#64748b'; // slate-500
const EDGE = '#334155'; // slate-700
const EDGE_FLAGGED = '#64748b'; // brighter, for edges landing on a flagged node

/** Column heading. `hop` is the contract's own number, so it is shown as-is. */
function ColumnHeader({ hop, x }) {
  return (
    <text x={x} y={16} textAnchor="middle" fill={AXIS_TEXT} fontSize="10" letterSpacing="0.08em">
      {hop === 0 ? 'ANALYSED' : `${hop} HOP${hop === 1 ? '' : 'S'}`}
    </text>
  );
}

export default function NetworkGraph({ graph }) {
  const [selected, setSelected] = useState(null);

  const layout = useMemo(() => buildGraphLayout(graph), [graph]);
  const { width, height, columns, nodes, edges, droppedEdges } = layout;

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  // No nodes at all is a different statement from nodes with no edges between
  // them, and both are different from "we did not look". Say which.
  if (nodes.length === 0) {
    return (
      <section
        className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800"
        aria-label="Counterparty graph"
      >
        <Header count={0} />
        <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center text-sm text-slate-500">
          No transaction graph was returned for this address.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800"
      aria-label="Counterparty graph"
    >
      <Header count={nodes.length} edgeCount={edges.length} />

      {edges.length === 0 && (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
          No transactions were retrieved between these addresses, so the graph shows the addresses
          without the flows connecting them.
        </p>
      )}

      {droppedEdges > 0 && (
        // Silence here would just look like a sparser graph, which is the one
        // way this panel could mislead without appearing to.
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
          {droppedEdges} {droppedEdges === 1 ? 'transaction references' : 'transactions reference'} an
          address missing from the graph and {droppedEdges === 1 ? 'is' : 'are'} not drawn.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label={`Transaction graph: ${nodes.length} addresses across ${columns.length} hop levels`}
        >
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_FLAGGED} />
            </marker>
          </defs>

          {columns.map((hop, i) => {
            const x = nodes.find((n) => n.column === i)?.x ?? 0;
            return <ColumnHeader key={hop} hop={hop} x={x} />;
          })}

          {edges.map((edge, i) => (
            <g key={`${edge.source}->${edge.target}-${i}`}>
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={edge.toFlagged ? EDGE_FLAGGED : EDGE}
                strokeWidth={edge.toFlagged ? 1.75 : 1.25}
                markerEnd="url(#graph-arrow)"
              />
              {edge.value !== null && (
                <text
                  x={edge.midX}
                  y={edge.midY - 6}
                  textAnchor="middle"
                  fill={AXIS_TEXT}
                  fontSize="10"
                  className="tabular-nums"
                >
                  {formatBtc(edge.value)} BTC
                </text>
              )}
            </g>
          ))}

          {nodes.map((node) => {
            const isSelected = node.id === selected;
            return (
              <g
                key={node.id}
                onClick={() => setSelected(isSelected ? null : node.id)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(isSelected ? null : node.id);
                  }
                }}
                aria-label={`${node.label}${node.flags.length ? `, flagged ${node.flags.join(', ')}` : ''}, hop ${node.hop}`}
              >
                {/* The analysed address gets a halo so it is findable without
                    relying on it being leftmost. */}
                {node.hop === 0 && (
                  <circle cx={node.x} cy={node.y} r={node.r + 6} fill="none" stroke={node.color} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" />
                )}
                {isSelected && (
                  <circle cx={node.x} cy={node.y} r={node.r + 4} fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={node.color}
                  fillOpacity={node.flagged ? 0.9 : 0.5}
                  stroke={node.color}
                  strokeWidth="1.5"
                />
                <text
                  x={node.x}
                  y={node.y + node.r + 15}
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fontSize="11"
                  className="font-mono"
                >
                  {node.label}
                </text>
                {node.flagged && (
                  <text
                    x={node.x}
                    y={node.y + node.r + 28}
                    textAnchor="middle"
                    fill={node.color}
                    fontSize="10"
                    fontWeight="500"
                  >
                    {node.parsedFlags.map((f) => flagLabel(f.raw)).join(' · ')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail for a clicked node. The full address is the thing a reader
          actually needs out of this panel, and it does not fit on the canvas. */}
      {selectedNode && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs">
          <p className="font-mono break-all text-slate-300">{selectedNode.id}</p>
          <p className="mt-1 text-slate-500">
            {selectedNode.hop === 0 ? 'The analysed address' : `${selectedNode.hop} hop${selectedNode.hop === 1 ? '' : 's'} away`}
            {selectedNode.type ? ` · ${selectedNode.type}` : ''}
            {selectedNode.flags.length > 0
              ? ` · ${selectedNode.parsedFlags.map((f) => flagLabel(f.raw)).join(', ')}`
              : ' · no flags'}
          </p>
        </div>
      )}

      <Legend nodes={nodes} />
    </section>
  );
}

function Header({ count, edgeCount }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
        <Network className="h-4 w-4 text-slate-500" aria-hidden="true" />
        Counterparty graph
      </h2>
      {count > 0 && (
        <span className="text-xs tabular-nums text-slate-500">
          {count} {count === 1 ? 'address' : 'addresses'}
          {edgeCount !== undefined && ` · ${edgeCount} ${edgeCount === 1 ? 'flow' : 'flows'}`}
        </span>
      )}
    </div>
  );
}

/**
 * Only lists flags actually present, so it never explains an absent colour.
 *
 * Entries are grouped BY COLOUR, not per flag. Two ransomware families share the
 * ransomware colour, and listing "REvil ransomware" and "Conti ransomware" as
 * separate swatches of the same orange would promise a distinction the chart
 * cannot make. One swatch, both families named after it.
 */
function Legend({ nodes }) {
  const groups = new Map();
  for (const node of nodes) {
    for (const flag of node.parsedFlags) {
      const entry = groups.get(node.color) ?? { kind: flag.kind, families: new Set() };
      if (flag.family) entry.families.add(flag.family);
      groups.set(node.color, entry);
    }
  }
  const hasUnflagged = nodes.some((n) => !n.flagged);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-800 pt-3 text-xs text-slate-500">
      {[...groups].map(([color, { kind, families }]) => (
        <span key={color} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
          {flagLabel(kind)}
          {families.size > 0 && (
            <span className="text-slate-600">({[...families].join(', ')})</span>
          )}
        </span>
      ))}
      {hasUnflagged && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-500/50" aria-hidden="true" />
          No flags
        </span>
      )}
      <span className="text-slate-600">Distance from the analysed address runs left to right.</span>
    </div>
  );
}
