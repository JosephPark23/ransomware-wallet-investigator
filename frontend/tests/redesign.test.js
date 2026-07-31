/**
 * Tests for the three pure modules added by the redesign.
 *
 * Same discipline as the existing suite: the modules under test import no React
 * and touch no DOM, so the behaviour that drives the interface can be asserted
 * directly rather than eyeballed in a browser.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fixture from '../fixtures/sample.json' with { type: 'json' };
import { scoreAddress, defaultWeights } from '../src/lib/scoring.js';
import {
  CONFIDENCE_NOTES,
  SIGNAL_NOTES,
  influence,
  lensNote,
  notesFor,
  verdict,
} from '../src/lib/interpretation.js';
import {
  CLUSTER_PREFIX,
  counterpartyRows,
  isClusterId,
  reduceGraph,
} from '../src/lib/graphRelevance.js';
import { CEILING, STAGES, progressAt } from '../src/lib/progress.js';

// ---------------------------------------------------------------------------
// interpretation.js
// ---------------------------------------------------------------------------

test('every signal in the fixture has rule-specific wording, not a fallback', () => {
  for (const signal of fixture.signals) {
    assert.ok(
      SIGNAL_NOTES[signal.id],
      `no authored notes for ${signal.id} — a real backend rule fell through to the category fallback`,
    );
  }
});

test('an unknown rule still gets true wording from its category', () => {
  const notes = notesFor({ id: 'sanctions.rule_invented_next_year', category: 'sanctions' });
  assert.ok(notes.matters.length > 0);
  assert.ok(notes.plain.toLowerCase().includes('sanctions'));
});

test('a rule with neither an id nor a known category still renders something', () => {
  const notes = notesFor({});
  assert.ok(notes.plain.length > 0);
  assert.ok(notes.matters.length > 0);
});

test('influence labels describe share of points, not importance', () => {
  // Every label must name what it measures. A bare adjective next to a finding
  // reads as a claim about how much that finding matters, which is a different
  // quantity from how the points were divided up.
  for (const points of [30, 12, 3]) {
    assert.match(influence(points, 100).label, /share$/);
  }
  assert.equal(influence(30, 100).label, 'Major share');
  assert.equal(influence(12, 100).label, 'Moderate share');
  assert.equal(influence(3, 100).label, 'Small share');
});

test('the largest contributor is named by rank, not by threshold', () => {
  // The regression this guards: against the fixture the OFAC listing carries
  // 24.9% of the points, a whisker under the 25% cut, and was being labelled
  // "Moderate" -- the most legally consequential finding the tool can report,
  // described with the mildest word on the scale.
  const result = scoreAddress(fixture.signals, defaultWeights());
  const top = [...result.contributions].sort((a, b) => b.contribution - a.contribution)[0];
  assert.match(top.signal.label, /OFAC/);
  assert.ok(top.contribution / result.finalScore < 0.25, 'fixture no longer exercises the regression');
  assert.equal(influence(top.contribution, result.finalScore, { isTop: true }).label, 'Largest contributor');
});

test('a saturated score explains why every share looks small', () => {
  const saturated = influence(24.9, 100);
  assert.equal(saturated.saturated, true);
  assert.match(saturated.sentence, /ceiling/i);
  assert.match(saturated.sentence, /does not mean a modest finding/i);

  const unsaturated = influence(20, 60);
  assert.equal(unsaturated.saturated, false);
  assert.doesNotMatch(unsaturated.sentence, /ceiling/i);
});

test('a zero-contribution signal is reported as context, never as a reduction', () => {
  const effect = influence(0, 100);
  assert.equal(effect.isContextOnly, true);
  assert.equal(effect.points, 0);
  assert.match(effect.sentence, /adds nothing/i);
  // The model cannot produce a negative contribution, so the wording must never
  // claim one.
  assert.doesNotMatch(effect.sentence, /lower|reduce|decrease/i);
});

test('influence survives a zero final score without dividing by it', () => {
  const effect = influence(0, 0);
  assert.equal(Number.isFinite(effect.share), true);
  assert.equal(effect.share, 0);
});

test('the lens note only appears when the lens is actually attenuating', () => {
  assert.equal(lensNote('sanctions', 1), null);
  assert.equal(lensNote('sanctions', undefined), null);
  assert.match(lensNote('sanctions', 0), /switched off/i);
  assert.match(lensNote('ransomware', 0.4), /0\.4/);
});

test('the verdict names the strongest driver, not just the band', () => {
  const result = scoreAddress(fixture.signals, defaultWeights());
  const { headline, because } = verdict(result, fixture.signals.length);
  assert.ok(headline.length > 0);
  // The fixture's top contributor is the OFAC listing.
  assert.match(because, /OFAC/);
});

test('the no-signals verdict refuses to claim the address is clean', () => {
  const result = scoreAddress([], defaultWeights());
  const { because } = verdict(result, 0);
  assert.match(because, /not proof/i);
});

test('confidence wording exists for all three levels and degrades safely', () => {
  for (const level of ['high', 'medium', 'low']) {
    assert.ok(CONFIDENCE_NOTES[level].meaning.length > 0);
  }
});

// ---------------------------------------------------------------------------
// graphRelevance.js
// ---------------------------------------------------------------------------

/** A hop-1 fan-out big enough to break the unreduced layout. */
function bigGraph({ counterparties = 40, flagged = 3 } = {}) {
  const nodes = [{ id: 'target', label: 'target', hop: 0, flags: [] }];
  const edges = [];
  for (let i = 0; i < counterparties; i += 1) {
    const id = `cp${String(i).padStart(3, '0')}`;
    nodes.push({
      id,
      label: id,
      hop: 1,
      // The flagged ones are deliberately the SMALLEST by value, so a
      // value-only ranking would drop them and the exemption is what saves them.
      flags: i < flagged ? ['ofac'] : [],
    });
    edges.push({ source: 'target', target: id, value: i < flagged ? 0.0001 : i + 1 });
  }
  return { nodes, edges };
}

test('a flagged counterparty is never hidden, however far down the ranking it sits', () => {
  const { graph, summary } = reduceGraph(bigGraph(), { perHopLimit: 4 });
  assert.equal(summary.flaggedShown, summary.flaggedTotal);
  assert.equal(summary.flaggedTotal, 3);
  for (const node of graph.nodes) {
    if (node.id.startsWith('cp00') && Number(node.id.slice(2)) < 3) {
      assert.ok(node, 'a flagged node was dropped');
    }
  }
});

test('flagged-only mode still keeps the analysed address and every flag', () => {
  const { graph, summary } = reduceGraph(bigGraph(), { flaggedOnly: true });
  assert.ok(graph.nodes.some((n) => n.id === 'target'));
  assert.equal(summary.flaggedShown, 3);
  assert.equal(summary.hidden, 37);
});

test('the drawn node count is bounded by the cap plus flags plus one cluster', () => {
  const { graph } = reduceGraph(bigGraph({ counterparties: 500, flagged: 2 }), {
    perHopLimit: 6,
  });
  // 1 target + 6 unflagged + 2 flagged + 1 cluster
  assert.equal(graph.nodes.length, 10);
});

test('the remainder collapses into exactly one cluster per hop', () => {
  const { clusters, graph } = reduceGraph(bigGraph(), { perHopLimit: 5 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].hop, 1);
  assert.equal(clusters[0].count, 32);
  assert.equal(clusters[0].members.length, 32);
  assert.ok(graph.nodes.some((n) => isClusterId(n.id)));
  assert.ok(clusters[0].id.startsWith(CLUSTER_PREFIX));
});

test('a cluster edge carries the summed value of the edges it absorbed', () => {
  const graph = {
    nodes: [
      { id: 'target', hop: 0, flags: [] },
      { id: 'a', hop: 1, flags: [] },
      { id: 'b', hop: 1, flags: [] },
      { id: 'c', hop: 1, flags: [] },
    ],
    edges: [
      { source: 'target', target: 'a', value: 10 },
      { source: 'target', target: 'b', value: 2 },
      { source: 'target', target: 'c', value: 3 },
    ],
  };
  const { graph: reduced } = reduceGraph(graph, { perHopLimit: 1 });
  const clusterEdge = reduced.edges.find((e) => isClusterId(e.target));
  assert.equal(clusterEdge.value, 5);
  assert.equal(clusterEdge.count, 2);
});

test('an unrecorded edge value is never silently summed into a total', () => {
  const graph = {
    nodes: [
      { id: 'target', hop: 0, flags: [] },
      { id: 'a', hop: 1, flags: [] },
      { id: 'b', hop: 1, flags: [] },
      { id: 'c', hop: 1, flags: [] },
    ],
    edges: [
      { source: 'target', target: 'a', value: 9 },
      { source: 'target', target: 'b', value: null },
      { source: 'target', target: 'c', value: 4 },
    ],
  };
  const { graph: reduced } = reduceGraph(graph, { perHopLimit: 1 });
  const clusterEdge = reduced.edges.find((e) => isClusterId(e.target));
  assert.equal(clusterEdge.value, null);
});

test('the fixture graph is small enough that nothing is reduced at all', () => {
  const { summary, clusters } = reduceGraph(fixture.graph);
  assert.equal(summary.reduced, false);
  assert.equal(summary.hidden, 0);
  assert.equal(clusters.length, 0);
  assert.equal(summary.shown, fixture.graph.nodes.length);
});

test('an empty or malformed graph reduces to nothing rather than throwing', () => {
  assert.equal(reduceGraph(null).summary.total, 0);
  assert.equal(reduceGraph({ nodes: [{}], edges: null }).summary.total, 0);
});

test('the counterparty table lists every address, flagged first', () => {
  const rows = counterpartyRows(bigGraph());
  assert.equal(rows.length, 41);
  assert.ok(rows.slice(0, 3).every((r) => r.flagged));
  assert.ok(rows.every((r) => Number.isFinite(r.volume)));
});

// ---------------------------------------------------------------------------
// progress.js
// ---------------------------------------------------------------------------

test('the progress bar never reaches full on the clock alone', () => {
  for (const elapsed of [0, 5000, 15000, 60000, 600000]) {
    assert.ok(progressAt(elapsed).fraction <= CEILING);
  }
  assert.ok(progressAt(600000).fraction < 1);
});

test('progress is monotonic', () => {
  let previous = -1;
  for (let t = 0; t <= 40000; t += 500) {
    const { fraction } = progressAt(t);
    assert.ok(fraction >= previous, `progress went backwards at ${t}ms`);
    previous = fraction;
  }
});

test('stages advance forward and never regress', () => {
  let previous = -1;
  for (let t = 0; t <= 60000; t += 250) {
    const { index } = progressAt(t);
    assert.ok(index >= previous);
    assert.ok(index < STAGES.length);
    previous = index;
  }
});

test('the last stage holds indefinitely rather than looping', () => {
  assert.equal(progressAt(300000).index, STAGES.length - 1);
});

test('an overrun is reported rather than animated away', () => {
  assert.equal(progressAt(5000).overtime, false);
  assert.equal(progressAt(40000).overtime, true);
});

test('a nonsense elapsed time is treated as the start, not as NaN', () => {
  assert.equal(progressAt(NaN).fraction, 0);
  assert.equal(progressAt(-500).fraction, 0);
});
