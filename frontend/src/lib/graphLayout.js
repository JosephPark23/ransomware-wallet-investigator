/**
 * Geometry for the counterparty graph.
 *
 * No React and no DOM, so what the graph actually draws can be asserted in a
 * plain node test -- the same separation as lib/waterfall.js and the chart.
 *
 * ## Why a hop layout rather than a force simulation
 *
 * contract.md clamps `max_hops` to 0-2 server-side, so this graph is bounded at
 * three columns forever; the fixture is five nodes and four edges. A physics
 * layout would buy nothing at that size and would cost determinism -- the same
 * payload would draw differently on every render, which is untestable and makes
 * two screenshots of the same address disagree.
 *
 * So hop distance is the layout: hop 0 (the analysed address) on the left, each
 * further hop a column to the right. Distance from the target reads left to
 * right, which is also the direction the taint paths read. Node size shrinks
 * with hop for the same reason -- both are magnitude channels, leaving colour
 * free to carry flag identity alone (see lib/flags.js).
 */

import { flagColor, parseFlags } from './flags.js';

export const LAYOUT_DEFAULTS = {
  width: 760,
  paddingX: 104,
  paddingY: 44,
  /** Vertical distance between nodes sharing a column. */
  rowGap: 82,
  minHeight: 240,
  /** Node radius by column index. Beyond the list, the last value repeats. */
  radii: [26, 17, 13],
  /** Gap between an arrowhead and the node it points at. */
  arrowGap: 5,
};

const isFiniteNumber = (v) => Number.isFinite(Number(v));

/** Radius for a column, repeating the final entry for any extra columns. */
const radiusFor = (index, radii) => radii[Math.min(index, radii.length - 1)];

/**
 * Lay out a `graph` object into drawable coordinates.
 *
 * @returns {{width: number, height: number, columns: number[],
 *            nodes: object[], edges: object[], droppedEdges: number}}
 */
export function buildGraphLayout(graph, options = {}) {
  const opts = { ...LAYOUT_DEFAULTS, ...options };
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges : [];

  // A node without an id cannot be referenced by an edge, so it cannot be part
  // of the graph. Duplicates collapse to the first occurrence.
  const seen = new Set();
  const nodes = rawNodes.filter((n) => {
    const id = n?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (nodes.length === 0) {
    return {
      width: opts.width,
      height: opts.minHeight,
      columns: [],
      nodes: [],
      edges: [],
      droppedEdges: rawEdges.length,
    };
  }

  // Group by hop. An absent or non-numeric hop sorts to 0 rather than being
  // dropped -- an unplaceable node is still a real counterparty.
  const hopOf = (n) => (isFiniteNumber(n?.hop) ? Number(n.hop) : 0);
  const columns = [...new Set(nodes.map(hopOf))].sort((a, b) => a - b);
  const columnIndex = new Map(columns.map((hop, i) => [hop, i]));

  const byColumn = columns.map((hop) => nodes.filter((n) => hopOf(n) === hop));
  const tallest = Math.max(...byColumn.map((c) => c.length));

  const height = Math.max(opts.minHeight, tallest * opts.rowGap + opts.paddingY * 2);
  const centerY = height / 2;

  // A single column sits at the left edge rather than centred, so a graph with
  // no counterparties still reads as "the target, and nothing beyond it".
  const span = opts.width - opts.paddingX * 2;
  const xFor = (i) => (columns.length <= 1 ? opts.paddingX : opts.paddingX + (i * span) / (columns.length - 1));

  const placed = [];
  byColumn.forEach((column, i) => {
    const radius = radiusFor(i, opts.radii);
    column.forEach((node, j) => {
      // Centred on the midline: j - (n-1)/2 is negative above, positive below.
      const offset = j - (column.length - 1) / 2;
      const flags = Array.isArray(node.flags) ? node.flags : [];
      placed.push({
        id: node.id,
        label: node.label || node.id,
        type: node.type ?? null,
        hop: columns[i],
        column: i,
        x: xFor(i),
        y: centerY + offset * opts.rowGap,
        r: radius,
        flags,
        parsedFlags: parseFlags(flags),
        color: flagColor(flags),
        flagged: parseFlags(flags).length > 0,
      });
    });
  });

  const byId = new Map(placed.map((n) => [n.id, n]));

  // An edge pointing at a node that is not in `nodes` cannot be drawn without
  // inventing a position for it. Counted rather than silently discarded, so the
  // UI can say the picture is incomplete instead of just looking sparse.
  let droppedEdges = 0;
  const edges = [];
  for (const edge of rawEdges) {
    const from = byId.get(edge?.source);
    const to = byId.get(edge?.target);
    if (!from || !to || from === to) {
      droppedEdges += 1;
      continue;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);

    // Trim each end back to the circle's edge so the line touches the node
    // rather than disappearing under it, and leave room for the arrowhead.
    const ux = length === 0 ? 0 : dx / length;
    const uy = length === 0 ? 0 : dy / length;

    edges.push({
      source: from.id,
      target: to.id,
      value: isFiniteNumber(edge?.value) ? Number(edge.value) : null,
      txHash: edge?.tx_hash ?? null,
      // contract.md: null for unconfirmed transactions.
      timestamp: edge?.timestamp ?? null,
      x1: from.x + ux * from.r,
      y1: from.y + uy * from.r,
      x2: to.x - ux * (to.r + opts.arrowGap),
      y2: to.y - uy * (to.r + opts.arrowGap),
      midX: (from.x + to.x) / 2,
      midY: (from.y + to.y) / 2,
      // An edge landing on a flagged node is the interesting one.
      toFlagged: to.flagged,
    });
  }

  return { width: opts.width, height, columns, nodes: placed, edges, droppedEdges };
}
