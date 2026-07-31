/**
 * Unit tests for src/lib/graphLayout.js -- the geometry the counterparty graph
 * draws.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * Same reasoning as tests/waterfall.test.js: the layout lives outside the
 * component so what is DRAWN can be asserted without a DOM. A dropped node, an
 * edge pointing at nothing, or a hop collapsing into the wrong column are all
 * invisible to a test that only checks the input payload.
 *
 * Determinism is the reason this is hand-rolled rather than force-directed, so
 * it is asserted directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LAYOUT_DEFAULTS, buildGraphLayout } from '../src/lib/graphLayout.js';
import { CATEGORY_COLORS } from '../src/lib/categories.js';
import { UNFLAGGED_COLOR } from '../src/lib/flags.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

const layoutOf = (graph) => buildGraphLayout(graph);

// ---------------------------------------------------------------------------
// THE POINT OF THIS FILE: the fixture graph draws completely and predictably
// ---------------------------------------------------------------------------

test('GOLDEN: the fixture draws all five nodes and all four edges', () => {
  const { nodes, edges, droppedEdges } = layoutOf(fixture.graph);
  assert.equal(nodes.length, 5);
  assert.equal(edges.length, 4);
  assert.equal(droppedEdges, 0);
});

test('GOLDEN: hop becomes column, left to right', () => {
  const { columns, nodes } = layoutOf(fixture.graph);
  assert.deepEqual(columns, [0, 1, 2]);

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assert.equal(byId[fixture.address].column, 0);
  assert.equal(byId['1CoUnTerPartyExampleAddress009xQ2'].column, 1);
  assert.equal(byId['1TwoHopFlaggedAddressExample00Zz'].column, 2);

  // x strictly increases with hop -- that is the whole read of the chart.
  const xByHop = [0, 1, 2].map((hop) => nodes.find((n) => n.hop === hop).x);
  assert.ok(xByHop[0] < xByHop[1], `hop 0 (${xByHop[0]}) should sit left of hop 1 (${xByHop[1]})`);
  assert.ok(xByHop[1] < xByHop[2], `hop 1 (${xByHop[1]}) should sit left of hop 2 (${xByHop[2]})`);
});

test('DETERMINISM: the same payload lays out identically every time', () => {
  // The reason this is not a force simulation. Two runs must be byte-identical
  // or screenshots of the same address disagree with each other.
  assert.deepEqual(layoutOf(fixture.graph), layoutOf(fixture.graph));
});

test('nodes sharing a column are spread, never stacked on one point', () => {
  const { nodes } = layoutOf(fixture.graph);
  const hop1 = nodes.filter((n) => n.hop === 1);
  assert.equal(hop1.length, 3);

  const ys = hop1.map((n) => n.y);
  assert.equal(new Set(ys).size, ys.length, 'hop-1 nodes overlap');
  // All at the same x: a column is a column.
  assert.equal(new Set(hop1.map((n) => n.x)).size, 1);
});

test('a column is centred on the midline', () => {
  const { nodes, height } = layoutOf(fixture.graph);
  const hop1 = nodes.filter((n) => n.hop === 1);
  const mean = hop1.reduce((sum, n) => sum + n.y, 0) / hop1.length;
  assert.ok(Math.abs(mean - height / 2) < 0.0001, `column centred at ${mean}, midline is ${height / 2}`);
});

test('every node lands inside the viewBox', () => {
  const { nodes, width, height } = layoutOf(fixture.graph);
  for (const n of nodes) {
    assert.ok(n.x - n.r >= 0 && n.x + n.r <= width, `${n.id} escapes horizontally at x=${n.x}`);
    assert.ok(n.y - n.r >= 0 && n.y + n.r <= height, `${n.id} escapes vertically at y=${n.y}`);
  }
});

test('node size shrinks with hop, so distance survives greyscale', () => {
  const { nodes } = layoutOf(fixture.graph);
  const radius = (hop) => nodes.find((n) => n.hop === hop).r;
  assert.ok(radius(0) > radius(1), 'the analysed address should be the largest node');
  assert.ok(radius(1) > radius(2));
});

// ---------------------------------------------------------------------------
// Colour comes from flags only
// ---------------------------------------------------------------------------

test('COLOUR: flagged fixture nodes take their category colour', () => {
  const { nodes } = layoutOf(fixture.graph);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  assert.equal(byId['1CoUnTerPartyExampleAddress009xQ2'].color, CATEGORY_COLORS.sanctions);
  assert.equal(byId['1SecondFlaggedCounterparty00003Kd'].color, CATEGORY_COLORS.ransomware);
  assert.equal(byId['1TwoHopFlaggedAddressExample00Zz'].color, CATEGORY_COLORS.ransomware);
});

test('COLOUR: unflagged fixture nodes stay neutral', () => {
  const { nodes } = layoutOf(fixture.graph);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Both the analysed address and the plain intermediary carry no flags in the
  // fixture, so neither may borrow a category colour.
  assert.equal(byId[fixture.address].color, UNFLAGGED_COLOR);
  assert.equal(byId[fixture.address].flagged, false);
  assert.equal(byId['1IntermediaryAddressExample0000Wq'].color, UNFLAGGED_COLOR);
});

test('COLOUR: hop does not change a node colour', () => {
  // Same flags at hop 1 and hop 2 -> same colour. Colour is identity; the
  // column and the radius carry distance.
  const graph = {
    nodes: [
      { id: 'a', hop: 1, flags: ['ransomware:Conti'] },
      { id: 'b', hop: 2, flags: ['ransomware:Conti'] },
    ],
    edges: [],
  };
  const { nodes } = layoutOf(graph);
  assert.equal(nodes[0].color, nodes[1].color);
  assert.notEqual(nodes[0].column, nodes[1].column);
});

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

test('edges are trimmed back to the node edge, not the centre', () => {
  // Otherwise the line vanishes under the circle and the arrowhead lands inside it.
  const { nodes, edges } = layoutOf(fixture.graph);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  for (const edge of edges) {
    const from = byId[edge.source];
    const to = byId[edge.target];
    const startGap = Math.hypot(edge.x1 - from.x, edge.y1 - from.y);
    const endGap = Math.hypot(edge.x2 - to.x, edge.y2 - to.y);

    assert.ok(Math.abs(startGap - from.r) < 0.0001, `edge starts ${startGap} from centre, radius is ${from.r}`);
    assert.ok(endGap > to.r, `edge ends inside the target node (${endGap} <= ${to.r})`);
  }
});

test('edge value and tx hash survive into the geometry', () => {
  const { edges } = layoutOf(fixture.graph);
  const first = edges.find((e) => e.target === '1CoUnTerPartyExampleAddress009xQ2');
  assert.equal(first.value, 4.2);
  assert.equal(first.txHash, fixture.graph.edges[0].tx_hash);
});

test('an edge pointing at a missing node is dropped AND counted', () => {
  // Counted, so the UI can admit the picture is incomplete. Silently dropping
  // it would just look like a sparser graph.
  const graph = {
    nodes: [{ id: 'a', hop: 0, flags: [] }],
    edges: [
      { source: 'a', target: 'ghost', value: 1 },
      { source: 'nobody', target: 'a', value: 1 },
    ],
  };
  const { edges, droppedEdges } = layoutOf(graph);
  assert.equal(edges.length, 0);
  assert.equal(droppedEdges, 2);
});

test('a self-referencing edge is dropped rather than drawn as a zero-length line', () => {
  const graph = { nodes: [{ id: 'a', hop: 0, flags: [] }], edges: [{ source: 'a', target: 'a' }] };
  const { edges, droppedEdges } = layoutOf(graph);
  assert.equal(edges.length, 0);
  assert.equal(droppedEdges, 1);
});

test('a null timestamp is preserved, not coerced', () => {
  // contract.md: null for unconfirmed transactions.
  const graph = {
    nodes: [{ id: 'a', hop: 0, flags: [] }, { id: 'b', hop: 1, flags: [] }],
    edges: [{ source: 'a', target: 'b', value: 1, timestamp: null }],
  };
  assert.equal(layoutOf(graph).edges[0].timestamp, null);
});

test('a non-numeric edge value becomes null rather than NaN', () => {
  const graph = {
    nodes: [{ id: 'a', hop: 0, flags: [] }, { id: 'b', hop: 1, flags: [] }],
    edges: [{ source: 'a', target: 'b', value: 'lots' }],
  };
  assert.equal(layoutOf(graph).edges[0].value, null);
});

// ---------------------------------------------------------------------------
// Empty and malformed graphs
// ---------------------------------------------------------------------------

test('an empty graph produces an empty layout, not a crash', () => {
  for (const value of [null, undefined, {}, { nodes: [], edges: [] }, { nodes: null }]) {
    const { nodes, edges, columns, height } = layoutOf(value);
    assert.deepEqual(nodes, []);
    assert.deepEqual(edges, []);
    assert.deepEqual(columns, []);
    assert.equal(height, LAYOUT_DEFAULTS.minHeight);
  }
});

test('nodes with no edges still lay out', () => {
  // "Addresses, but no retrieved flows between them" is a real response and a
  // different statement from an empty graph.
  const graph = {
    nodes: [{ id: 'a', hop: 0, flags: [] }, { id: 'b', hop: 1, flags: [] }],
    edges: [],
  };
  const { nodes, edges } = layoutOf(graph);
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 0);
});

test('a lone node sits at the left rather than floating mid-canvas', () => {
  const { nodes } = layoutOf({ nodes: [{ id: 'a', hop: 0, flags: [] }], edges: [] });
  assert.equal(nodes[0].x, LAYOUT_DEFAULTS.paddingX);
});

test('a node with no id is dropped -- no edge could reference it', () => {
  const graph = { nodes: [{ hop: 0 }, { id: 'a', hop: 0, flags: [] }], edges: [] };
  assert.equal(layoutOf(graph).nodes.length, 1);
});

test('a duplicate node id collapses to one node', () => {
  const graph = {
    nodes: [{ id: 'a', hop: 0, flags: [] }, { id: 'a', hop: 1, flags: ['ofac'] }],
    edges: [],
  };
  const { nodes } = layoutOf(graph);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].hop, 0, 'the first occurrence wins');
});

test('a missing hop places the node in the first column rather than dropping it', () => {
  // An unplaceable node is still a real counterparty.
  const graph = { nodes: [{ id: 'a', flags: [] }, { id: 'b', hop: 1, flags: [] }], edges: [] };
  const { nodes, columns } = layoutOf(graph);
  assert.equal(nodes.length, 2);
  assert.deepEqual(columns, [0, 1]);
  assert.equal(nodes.find((n) => n.id === 'a').hop, 0);
});

test('non-contiguous hops still produce ordered columns', () => {
  // Nothing guarantees hop 1 exists just because hop 2 does.
  const graph = { nodes: [{ id: 'a', hop: 0, flags: [] }, { id: 'b', hop: 2, flags: [] }], edges: [] };
  const { columns, nodes } = layoutOf(graph);
  assert.deepEqual(columns, [0, 2]);
  assert.ok(nodes.find((n) => n.hop === 0).x < nodes.find((n) => n.hop === 2).x);
});

test('a taller column grows the canvas instead of overflowing it', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, hop: 1, flags: [] }));
  const { height, nodes } = layoutOf({ nodes: many, edges: [] });
  assert.ok(height > LAYOUT_DEFAULTS.minHeight);
  for (const n of nodes) {
    assert.ok(n.y - n.r >= 0 && n.y + n.r <= height, `${n.id} escapes at y=${n.y}`);
  }
});
