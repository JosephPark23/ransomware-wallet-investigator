/**
 * Unit tests for src/lib/waterfall.js -- the geometry the waterfall chart draws.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * These deliberately do NOT re-assert the scoring invariant. tests/scoring.test.js
 * already proves the contributions array sums to finalScore; re-summing that array
 * here would prove the same thing twice and would still pass if the chart dropped
 * a bar, sorted stale data, or mis-stacked a base segment.
 *
 * What is asserted instead is the DRAWN staircase: every bar starts exactly where
 * the previous one ended, and the top edge of the last bar -- the number a reader
 * sees the chart land on -- equals finalScore.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CATEGORIES, SUM_EPSILON, scoreAddress } from '../src/lib/scoring.js';
import {
  axisMax,
  buildWaterfallRows,
  formatScore,
  renderedTotal,
  truncateLabel,
} from '../src/lib/waterfall.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

const near = (actual, expected, msg) =>
  assert.ok(
    Math.abs(actual - expected) < SUM_EPSILON,
    `${msg}: expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`,
  );

const sig = (category, severity, id = `${category}_${severity}`) => ({
  id,
  category,
  severity,
  label: `${category} at ${severity}`,
});

const rowsFor = (signals, weights) => {
  const result = scoreAddress(signals, weights);
  return { result, rows: buildWaterfallRows(result.contributions) };
};

// ---------------------------------------------------------------------------
// THE POINT OF THIS FILE: the rendered staircase reconciles with the dial
// ---------------------------------------------------------------------------

test('RENDERED TOTAL: the top of the last bar equals finalScore (fixture)', () => {
  const { result, rows } = rowsFor(fixture.signals);

  // renderedTotal reads the last bar's top edge -- the geometry, not the inputs.
  near(renderedTotal(rows), result.finalScore, 'last bar top edge vs dial');
  near(renderedTotal(rows), 100, 'and that number is 100');
});

test('RENDERED TOTAL: every bar starts where the previous one ended', () => {
  const { rows } = rowsFor(fixture.signals);

  assert.equal(rows[0].base, 0, 'the first bar starts at 0');
  for (let i = 1; i < rows.length; i++) {
    near(
      rows[i].base,
      rows[i - 1].cumulative,
      `bar ${i} (${rows[i].id}) must sit on top of bar ${i - 1}`,
    );
  }
  // No bar may be drawn hanging in space or overlapping its neighbour.
  for (const row of rows) {
    near(row.base + row.contribution, row.cumulative, `${row.id} segment height`);
  }
});

test('RENDERED TOTAL: holds across many shapes, not just the fixture', () => {
  const cases = [
    { name: 'single signal', signals: [sig('sanctions', 100)] },
    { name: 'one per category', signals: CATEGORIES.map((c, i) => sig(c, (i + 1) * 17)) },
    {
      name: 'lopsided category',
      signals: [sig('ransomware', 90), sig('ransomware', 80), sig('ransomware', 70)],
    },
    { name: 'all zero severities', signals: [sig('obfuscation', 0), sig('obfuscation', 0)] },
    {
      name: 'zero severity beside a real hit',
      signals: [sig('obfuscation', 0), sig('sanctions', 100)],
    },
    {
      name: 'a category zeroed out',
      signals: [sig('sanctions', 80), sig('ransomware', 60)],
      weights: { ransomware: 0 },
    },
    {
      name: 'weighted',
      signals: [sig('sanctions', 100), sig('counterparty', 40)],
      weights: { sanctions: 3, counterparty: 0.5 },
    },
  ];

  for (const { name, signals, weights } of cases) {
    const { result, rows } = rowsFor(signals, weights);
    assert.equal(rows.length, result.contributions.length, `${name}: every signal gets a bar`);
    near(renderedTotal(rows), result.finalScore, `${name}: rendered total`);
  }
});

test('RENDERED TOTAL: holds under randomised input', () => {
  // Deterministic LCG so a failure is reproducible.
  let seed = 20260727;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

  for (let iter = 0; iter < 500; iter++) {
    const count = Math.floor(rand() * 12);
    const signals = Array.from({ length: count }, (_, i) =>
      sig(CATEGORIES[Math.floor(rand() * CATEGORIES.length)], Math.round(rand() * 100), `s${i}`),
    );
    const weights = Object.fromEntries(CATEGORIES.map((c) => [c, Math.round(rand() * 6) / 2]));

    const { result, rows } = rowsFor(signals, weights);
    const delta = Math.abs(renderedTotal(rows) - result.finalScore);
    assert.ok(delta < SUM_EPSILON, `iter ${iter}: rendered total off by ${delta}`);

    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        Math.abs(rows[i].base - rows[i - 1].cumulative) < SUM_EPSILON,
        `iter ${iter}: bar ${i} detached from its neighbour`,
      );
    }
  }
});

test('a bar is never dropped, duplicated, or invented', () => {
  const { result, rows } = rowsFor(fixture.signals);
  assert.equal(rows.length, 9);

  const rowIds = [...rows.map((r) => r.id)].sort();
  const contributionIds = [...result.contributions.map((c) => c.signal.id)].sort();
  assert.deepEqual(rowIds, contributionIds, 'the bars are exactly the contributions');
  assert.equal(new Set(rowIds).size, rows.length, 'no duplicate bars');
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test('GOLDEN: the fixture draws these nine bars, in this order, at these heights', () => {
  const { rows } = rowsFor(fixture.signals);

  // Ordered by descending contribution, per the brief.
  // Cross-checked against `python backend/scripts/scoring_reference.py`.
  const expected = [
    ['sanctions.direct_hit', 24.919013207077],
    ['ransomware.known_address', 23.673062546723],
    ['counterparty.flagged_neighbor', 17.443309244954],
    ['profile.collection_pattern', 11.213555943185],
    ['obfuscation.self_peel', 8.721654622477],
    ['obfuscation.rapid_forward', 5.66907550461],
    ['profile.burst_then_dormant', 5.482182905557],
    ['profile.round_value_payments', 2.878146025417],
    // Severity 0 by design: named, considered, contributes nothing.
    ['ransomware.group_context', 0],
  ];

  assert.deepEqual(rows.map((r) => r.id), expected.map(([id]) => id), 'bar order');

  let running = 0;
  rows.forEach((row, i) => {
    const [id, contribution] = expected[i];
    near(row.contribution, contribution, `${id} bar height`);
    near(row.base, running, `${id} bar base`);
    running += contribution;
    near(row.cumulative, running, `${id} running total`);
  });

  near(running, 100, 'the nine bars end at 100');
});

test('bars are ordered by descending contribution', () => {
  const { rows } = rowsFor(fixture.signals);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i - 1].contribution >= rows[i].contribution,
      `bar ${i - 1} (${rows[i - 1].contribution}) must be at least bar ${i} (${rows[i].contribution})`,
    );
  }
});

test('equal contributions keep their input order rather than reshuffling', () => {
  // Two categories with identical scores and weights contribute identically.
  const { rows } = rowsFor([sig('sanctions', 50, 'first'), sig('ransomware', 50, 'second')]);
  near(rows[0].contribution, rows[1].contribution, 'a genuine tie');
  assert.deepEqual(rows.map((r) => r.id), ['first', 'second'], 'ties are stable');
});

test('each bar carries its own category, for colouring', () => {
  const { rows } = rowsFor(fixture.signals);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.category]));
  assert.equal(byId['sanctions.direct_hit'], 'sanctions');
  assert.equal(byId['profile.round_value_payments'], 'transaction_profile');
  assert.equal(byId['ransomware.group_context'], 'ransomware');
});

// ---------------------------------------------------------------------------
// Empty and degenerate cases
// ---------------------------------------------------------------------------

test('no signals produces no bars and no total', () => {
  const { result, rows } = rowsFor([]);
  assert.deepEqual(rows, []);
  assert.equal(renderedTotal(rows), 0);
  assert.equal(result.finalScore, 0);
});

test('all weights zeroed draws flat bars totalling zero, not an empty chart', () => {
  // The signal still fired; the reader has simply told the tool to disregard its
  // category. A bar of height 0 says "considered, weighted out". An absent bar
  // would say "nothing found", which is a different and wrong claim.
  const zeroed = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const { rows } = rowsFor([sig('sanctions', 100)], zeroed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contribution, 0);
  assert.equal(renderedTotal(rows), 0);
});

test('a zero-height bar is still drawn, sitting flat on its base', () => {
  // A severity-0 signal contributes nothing but is still a signal that fired.
  const { rows } = rowsFor([sig('obfuscation', 0, 'nil'), sig('sanctions', 100, 'hit')]);
  const nil = rows.find((r) => r.id === 'nil');
  assert.ok(nil, 'the zero-contribution signal still gets a bar');
  near(nil.contribution, 0, 'zero height');
  near(nil.base, nil.cumulative, 'sits flat');
});

test('a non-finite contribution is floored to 0 instead of poisoning every later base', () => {
  // Defensive: one NaN must not detach the whole staircase from the dial.
  const rows = buildWaterfallRows([
    { signal: { id: 'ok', label: 'fine' }, category: 'sanctions', contribution: 10 },
    { signal: { id: 'bad', label: 'broken' }, category: 'ransomware', contribution: NaN },
  ]);
  assert.ok(rows.every((r) => Number.isFinite(r.base) && Number.isFinite(r.cumulative)));
  near(renderedTotal(rows), 10, 'the good bar still lands');
});

test('a signal with no label falls back rather than rendering undefined', () => {
  const rows = buildWaterfallRows([
    { signal: { id: 'no.label' }, category: 'sanctions', contribution: 5 },
    { signal: {}, category: 'ransomware', contribution: 1 },
  ]);
  assert.equal(rows[0].label, 'no.label', 'falls back to the id');
  assert.equal(rows[1].label, 'Unnamed signal');
  assert.ok(rows[1].id, 'and still gets a usable react key');
});

// ---------------------------------------------------------------------------
// Axis and label helpers
// ---------------------------------------------------------------------------

test('the y-axis reaches the total, rounds up to a gridline, and stops at 100', () => {
  assert.equal(axisMax(82.41), 90, 'rounds up to the next gridline');
  assert.equal(axisMax(0), 10, 'never a zero-height axis');
  assert.equal(axisMax(3), 10);
  assert.equal(axisMax(NaN), 10);
  // A saturated score sits flush with the ceiling rather than pushing the axis
  // to 110 -- 100 is the top of the scale, not a value the score can pass.
  assert.equal(axisMax(100), 100);
  assert.equal(axisMax(99.99), 100);

  for (const total of [0.1, 12, 50, 82.41, 99.99, 100]) {
    assert.ok(axisMax(total) >= total, `the final bar always fits at ${total}`);
    assert.ok(axisMax(total) <= 100, `the axis never exceeds the scale at ${total}`);
  }
});

test('x-axis labels are truncated but never mangled', () => {
  assert.equal(truncateLabel('short'), 'short', 'short labels pass through');

  const long = 'Funnel pattern: many senders, few recipients, drained balance';
  const cut = truncateLabel(long);
  assert.ok(cut.length <= 22, `truncated to ${cut.length} chars`);
  assert.ok(cut.endsWith('…'), 'ellipsis marks the cut');
  assert.ok(long.startsWith(cut.slice(0, -1).trimEnd()), 'the kept prefix is verbatim');

  assert.equal(truncateLabel(null), '', 'no "null" on the axis');
  assert.equal(truncateLabel(undefined), '');
});

test('displayed numbers match the brief, without float noise', () => {
  const { rows } = rowsFor(fixture.signals);
  const shown = rows.map((r) => formatScore(r.contribution));
  assert.deepEqual(shown, [
    '24.92',
    '23.67',
    '17.44',
    '11.21',
    '8.72',
    '5.67',
    '5.48',
    '2.88',
    '0',
  ]);
  assert.equal(formatScore(renderedTotal(rows)), '100');
});
