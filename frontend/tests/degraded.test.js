/**
 * Unit tests for src/lib/degraded.js -- whether to warn, and what to list.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * The banner component is layout only; every decision it renders is made in
 * this module, which is what makes the decisions testable without a DOM. Same
 * split as lib/waterfall.js and the chart.
 *
 * contract.md rule 1 is the reason this matters: invalid addresses, malformed
 * JSON and outright garbage all come back as HTTP 200 with `degraded: true`.
 * The banner is therefore the ONLY way a user learns something went wrong --
 * there is no error page behind it to catch what it misses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { degradedState, isCached } from '../src/lib/degraded.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

// ---------------------------------------------------------------------------
// The happy path stays quiet
// ---------------------------------------------------------------------------

test('the committed fixture is not degraded and not cached', () => {
  // If this ever fails, someone flipped a flag in fixtures/sample.json to look
  // at the UI and committed it. That is the exact mistake this pins.
  const { degraded, warnings } = degradedState(fixture);
  assert.equal(degraded, false);
  assert.deepEqual(warnings, []);
  assert.equal(isCached(fixture), false);
});

// ---------------------------------------------------------------------------
// Degraded detection
// ---------------------------------------------------------------------------

test('degraded: true with warnings lists every warning, in order', () => {
  const { degraded, warnings } = degradedState({
    degraded: true,
    warnings: ['Ransomwhere unavailable', 'Esplora truncated the transaction list'],
  });
  assert.equal(degraded, true);
  assert.deepEqual(warnings, [
    'Ransomwhere unavailable',
    'Esplora truncated the transaction list',
  ]);
});

test('degraded: true with an EMPTY warnings array still flags degraded', () => {
  // Legal under the contract, and the case the banner is most likely to get
  // wrong -- gating the banner on warnings.length would hide the fact that the
  // analysis was incomplete. The component owns the fallback wording; this just
  // has to keep saying "degraded".
  const { degraded, warnings } = degradedState({ degraded: true, warnings: [] });
  assert.equal(degraded, true);
  assert.deepEqual(warnings, []);
});

test('degraded: true with warnings missing entirely still flags degraded', () => {
  const { degraded, warnings } = degradedState({ degraded: true });
  assert.equal(degraded, true);
  assert.deepEqual(warnings, []);
});

test('degraded is strict about truthiness', () => {
  // A stringified "true" from a backend that double-encoded its JSON must not
  // paint an amber banner over a perfectly good result, and a truthy non-bool
  // must not either.
  for (const value of ['true', 1, 'yes', {}, []]) {
    assert.equal(degradedState({ degraded: value }).degraded, false, `degraded: ${JSON.stringify(value)}`);
  }
  for (const value of [false, null, undefined, 0, '']) {
    assert.equal(degradedState({ degraded: value }).degraded, false);
  }
  assert.equal(degradedState({ degraded: true }).degraded, true);
});

test('warnings on a non-degraded response do not raise the banner', () => {
  // Per the contract the banner is tied to the flag, not to the array. This is
  // pinned so the coupling is a decision on the record rather than an accident.
  const { degraded, warnings } = degradedState({
    degraded: false,
    warnings: ['something informational'],
  });
  assert.equal(degraded, false);
  assert.deepEqual(warnings, ['something informational']);
});

// ---------------------------------------------------------------------------
// Warning list hygiene -- these strings go straight onto the screen
// ---------------------------------------------------------------------------

test('warnings: blank and whitespace-only entries are dropped', () => {
  // An empty bullet in the middle of the list looks like a rendering bug.
  const { warnings } = degradedState({
    degraded: true,
    warnings: ['real warning', '', '   ', '\n', 'another real one'],
  });
  assert.deepEqual(warnings, ['real warning', 'another real one']);
});

test('warnings: entries are trimmed', () => {
  const { warnings } = degradedState({
    degraded: true,
    warnings: ['  padded warning  '],
  });
  assert.deepEqual(warnings, ['padded warning']);
});

test('warnings: null and undefined entries are dropped, not printed', () => {
  // String(null) is "null" -- a bullet reading "null" is worse than no bullet.
  const { warnings } = degradedState({
    degraded: true,
    warnings: [null, 'real warning', undefined],
  });
  assert.deepEqual(warnings, ['real warning']);
});

test('warnings: a non-string entry is coerced rather than dropped', () => {
  // Losing a warning silently is worse than rendering it awkwardly.
  const { warnings } = degradedState({ degraded: true, warnings: [503, 'real warning'] });
  assert.deepEqual(warnings, ['503', 'real warning']);
});

test('warnings: a non-array warnings field degrades to an empty list', () => {
  for (const value of ['a single string', 42, {}, null]) {
    const { warnings } = degradedState({ degraded: true, warnings: value });
    assert.deepEqual(warnings, [], `warnings: ${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// Missing payloads -- the pending and initial states both pass null
// ---------------------------------------------------------------------------

test('a missing payload is not degraded and not cached', () => {
  for (const value of [null, undefined]) {
    const { degraded, warnings } = degradedState(value);
    assert.equal(degraded, false);
    assert.deepEqual(warnings, []);
    assert.equal(isCached(value), false);
  }
});

// ---------------------------------------------------------------------------
// Cached
// ---------------------------------------------------------------------------

test('cached is strict about truthiness', () => {
  assert.equal(isCached({ cached: true }), true);
  assert.equal(isCached({ cached: false }), false);
  assert.equal(isCached({}), false);
  // A "Cached" badge on a fresh result is a small lie about provenance, which
  // is the one thing this screen sells.
  for (const value of ['true', 1, 'yes']) {
    assert.equal(isCached({ cached: value }), false, `cached: ${JSON.stringify(value)}`);
  }
});
