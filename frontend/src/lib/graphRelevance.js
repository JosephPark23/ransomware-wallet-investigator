/**
 * Making the counterparty graph survive a busy wallet.
 *
 * Pure functions, no React and no DOM, in the same spirit as graphLayout.js --
 * which this module feeds rather than replaces. `buildGraphLayout` still owns
 * every coordinate; this module decides only WHICH nodes reach it.
 *
 * ## The problem
 *
 * graphLayout.js lays out every node it is given at a fixed 82px row gap, and
 * the SVG height is the tallest column times that gap. A wallet with forty
 * counterparties one hop out therefore renders a canvas over three thousand
 * pixels tall, with forty labels, on a card the user has to scroll past. The
 * fixture has five nodes, so the failure never showed up in development. It is
 * the first thing that happens on a real collection address.
 *
 * ## The approach
 *
 * Rank, cap, and cluster the remainder -- with one hard invariant:
 *
 *   A FLAGGED NODE IS NEVER HIDDEN.
 *
 * That is not a tuning preference, it is the reason the tool exists. Any
 * relevance heuristic that can bury an OFAC-sanctioned counterparty behind a
 * "+34 more" chip has inverted the product. Flagged nodes are exempt from the
 * per-hop cap, exempt from the value filter, and never absorbed into a cluster,
 * so the cap can only ever remove addresses about which nothing is known.
 *
 * Everything else is ranked by how much a reader would want to see it: value
 * moved first, then how many transactions connect it. The remainder collapses
 * into ONE cluster node per hop, which keeps the column count and the layout
 * geometry exactly as they were -- and, critically, keeps the edges: a cluster's
 * edge carries the summed value of every edge it absorbed, so the picture stays
 * quantitatively true rather than merely tidy.
 *
 * The cluster expands into a LIST, not into more circles. Thirty-four more
 * circles is the problem again; a scrollable table is simply the better
 * representation for a long tail, and the graph is for topology.
 */

import { parseFlags } from './flags.js';

export const RELEVANCE_DEFAULTS = {
  /** Unflagged nodes drawn per hop before the rest collapse into a cluster. */
  perHopLimit: 6,
  /** Hide unflagged counterparties whose largest single flow is below this (BTC). */
  minValue: 0,
  /** Drop unflagged counterparties entirely, keeping the flagged skeleton. */
  flaggedOnly: false,
};

export const CLUSTER_PREFIX = '__cluster__';
export const isClusterId = (id) => typeof id === 'string' && id.startsWith(CLUSTER_PREFIX);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hopOf = (n) => (Number.isFinite(Number(n?.hop)) ? Number(n.hop) : 0);
const isFlagged = (n) => parseFlags(n?.flags).length > 0;

/**
 * Per-node totals used both for ranking and for the counterparty table.
 * One pass over the edges, so this stays linear on wallets with thousands.
 */
export function nodeTotals(graph) {
  const totals = new Map();
  const ensure = (id) => {
    if (!totals.has(id)) totals.set(id, { received: 0, sent: 0, txCount: 0 });
    return totals.get(id);
  };

  for (const node of graph?.nodes ?? []) if (node?.id) ensure(node.id);

  for (const edge of graph?.edges ?? []) {
    const value = num(edge?.value);
    if (edge?.source) {
      const t = ensure(edge.source);
      t.sent += value;
      t.txCount += 1;
    }
    if (edge?.target) {
      const t = ensure(edge.target);
      t.received += value;
      t.txCount += 1;
    }
  }

  for (const t of totals.values()) t.volume = t.received + t.sent;
  return totals;
}

/**
 * Reduce a graph to something drawable, with a summary of what was left out.
 *
 * @returns {{
 *   graph: {nodes: object[], edges: object[]},
 *   clusters: Array<{id, hop, count, members: object[], value}>,
 *   summary: {total, shown, hidden, flaggedTotal, flaggedShown, reduced}
 * }}
 */
export function reduceGraph(graph, options = {}) {
  const opts = { ...RELEVANCE_DEFAULTS, ...options };
  const rawNodes = (graph?.nodes ?? []).filter((n) => typeof n?.id === 'string' && n.id);
  const rawEdges = graph?.edges ?? [];

  const empty = {
    graph: { nodes: [], edges: [] },
    clusters: [],
    summary: { total: 0, shown: 0, hidden: 0, flaggedTotal: 0, flaggedShown: 0, reduced: false },
  };
  if (rawNodes.length === 0) return empty;

  const totals = nodeTotals({ nodes: rawNodes, edges: rawEdges });
  const flaggedTotal = rawNodes.filter(isFlagged).length;

  // --- Rank within each hop -------------------------------------------------
  // Flagged first and unconditionally, then by value moved, then by how many
  // transactions touch the node, then by id so the order is reproducible.
  const byHop = new Map();
  for (const node of rawNodes) {
    const hop = hopOf(node);
    if (!byHop.has(hop)) byHop.set(hop, []);
    byHop.get(hop).push(node);
  }

  const rank = (a, b) => {
    const fa = isFlagged(a) ? 1 : 0;
    const fb = isFlagged(b) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const va = totals.get(a.id)?.volume ?? 0;
    const vb = totals.get(b.id)?.volume ?? 0;
    if (va !== vb) return vb - va;
    const ta = totals.get(a.id)?.txCount ?? 0;
    const tb = totals.get(b.id)?.txCount ?? 0;
    if (ta !== tb) return tb - ta;
    return a.id.localeCompare(b.id);
  };

  const kept = [];
  const dropped = [];

  for (const [hop, nodes] of byHop) {
    // Hop 0 is the analysed address. It is the subject of the page and is never
    // filtered, capped or clustered under any option.
    if (hop === 0) {
      kept.push(...nodes);
      continue;
    }

    const ordered = [...nodes].sort(rank);
    let unflaggedShown = 0;

    for (const node of ordered) {
      if (isFlagged(node)) {
        kept.push(node);
        continue;
      }
      if (opts.flaggedOnly) {
        dropped.push(node);
        continue;
      }
      const volume = totals.get(node.id)?.volume ?? 0;
      if (opts.minValue > 0 && volume < opts.minValue) {
        dropped.push(node);
        continue;
      }
      if (unflaggedShown < opts.perHopLimit) {
        kept.push(node);
        unflaggedShown += 1;
      } else {
        dropped.push(node);
      }
    }
  }

  // --- Collapse the remainder into one cluster per hop -----------------------
  const droppedByHop = new Map();
  for (const node of dropped) {
    const hop = hopOf(node);
    if (!droppedByHop.has(hop)) droppedByHop.set(hop, []);
    droppedByHop.get(hop).push(node);
  }

  const clusters = [];
  const clusterOf = new Map(); // hidden node id -> cluster id

  for (const [hop, members] of droppedByHop) {
    const id = `${CLUSTER_PREFIX}${hop}`;
    const value = members.reduce((sum, m) => sum + (totals.get(m.id)?.volume ?? 0), 0);
    clusters.push({ id, hop, count: members.length, members, value });
    for (const m of members) clusterOf.set(m.id, id);
  }

  const clusterNodes = clusters.map((c) => ({
    id: c.id,
    label: `+${c.count}`,
    type: 'cluster',
    hop: c.hop,
    flags: [],
    isCluster: true,
    clusterCount: c.count,
  }));

  // --- Rewrite edges --------------------------------------------------------
  // An edge to a hidden node becomes an edge to that hop's cluster. Parallel
  // edges are merged and their values summed, so the flow a cluster represents
  // is the true total rather than one arbitrary sample of it.
  const visible = new Set([...kept.map((n) => n.id), ...clusterNodes.map((n) => n.id)]);
  const remap = (id) => (visible.has(id) ? id : clusterOf.get(id) ?? null);

  const merged = new Map();
  for (const edge of rawEdges) {
    const source = remap(edge?.source);
    const target = remap(edge?.target);
    if (!source || !target || source === target) continue;

    const key = `${source}\u0000${target}`;
    const existing = merged.get(key);
    if (existing) {
      // Only sum when both sides carry a number; one recorded value plus one
      // unrecorded is not a total, and printing it as one would overstate.
      existing.value =
        existing.value === null || edge?.value == null
          ? existing.value
          : existing.value + num(edge.value);
      existing.count += 1;
      continue;
    }
    merged.set(key, {
      source,
      target,
      value: edge?.value == null ? null : num(edge.value),
      tx_hash: edge?.tx_hash ?? null,
      timestamp: edge?.timestamp ?? null,
      count: 1,
    });
  }

  const shownNodes = [...kept, ...clusterNodes];

  return {
    graph: { nodes: shownNodes, edges: [...merged.values()] },
    clusters,
    summary: {
      total: rawNodes.length,
      shown: kept.length,
      hidden: dropped.length,
      flaggedTotal,
      flaggedShown: kept.filter(isFlagged).length,
      reduced: dropped.length > 0,
    },
  };
}

/**
 * Every counterparty as a table row, unfiltered and uncapped.
 *
 * The accessible and scalable twin of the picture: at two hundred
 * counterparties a sortable table is not a fallback, it is the better tool, and
 * the same pattern already exists in the score composition panel. Sorted by
 * flagged first, then by value, matching the graph's own ranking so the two
 * views never disagree about what is important.
 */
export function counterpartyRows(graph) {
  const nodes = (graph?.nodes ?? []).filter((n) => typeof n?.id === 'string' && n.id);
  const totals = nodeTotals(graph);

  return nodes
    .map((node) => {
      const t = totals.get(node.id) ?? { received: 0, sent: 0, txCount: 0, volume: 0 };
      const flags = parseFlags(node.flags);
      return {
        id: node.id,
        label: node.label || node.id,
        type: node.type ?? null,
        hop: hopOf(node),
        flags,
        flagged: flags.length > 0,
        received: t.received,
        sent: t.sent,
        volume: t.volume,
        txCount: t.txCount,
      };
    })
    .sort(
      (a, b) =>
        Number(b.flagged) - Number(a.flagged) ||
        a.hop - b.hop ||
        b.volume - a.volume ||
        a.id.localeCompare(b.id),
    );
}
