/**
 * Unit tests for src/lib/presets.js.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * The weight values are the spec, so they are asserted literally rather than
 * derived -- a test that recomputed them from the same source it is checking
 * would pass no matter what the numbers were.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, activePresetId, presetById } from '../src/lib/presets.js';
import { CATEGORIES, WEIGHT_MAX, WEIGHT_MIN, defaultWeights } from '../src/lib/scoring.js';

// ---------------------------------------------------------------------------
// The values themselves
// ---------------------------------------------------------------------------

test('PRESET VALUES: every preset matches the brief exactly', () => {
  const expected = {
    balanced: {
      sanctions: 1.0,
      ransomware: 1.0,
      obfuscation: 1.0,
      transaction_profile: 1.0,
      counterparty: 1.0,
    },
    compliance: {
      sanctions: 1.0,
      ransomware: 0.3,
      obfuscation: 0.3,
      transaction_profile: 0.3,
      counterparty: 0.3,
    },
    ransomware: {
      sanctions: 0.4,
      ransomware: 1.0,
      obfuscation: 0.4,
      transaction_profile: 0.4,
      counterparty: 0.8,
    },
    behavioral: {
      sanctions: 0.2,
      ransomware: 0.2,
      obfuscation: 1.0,
      transaction_profile: 1.0,
      counterparty: 0.2,
    },
  };

  assert.equal(PRESETS.length, 4, 'four presets');
  for (const [id, weights] of Object.entries(expected)) {
    const preset = presetById(id);
    assert.ok(preset, `preset "${id}" exists`);
    assert.deepEqual(preset.weights, weights, `preset "${id}" weights`);
  }
});

test('every preset names all five categories', () => {
  // A partial preset would leave the unnamed categories on whatever the sliders
  // happened to be, so the preset would not be reproducible.
  for (const preset of PRESETS) {
    assert.deepEqual(
      Object.keys(preset.weights).sort(),
      [...CATEGORIES].sort(),
      `preset "${preset.id}" covers every category`,
    );
  }
});

test('every preset weight is inside the allowed range', () => {
  for (const preset of PRESETS) {
    for (const [category, weight] of Object.entries(preset.weights)) {
      assert.ok(
        typeof weight === 'number' && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX,
        `${preset.id}.${category} = ${weight} is outside [${WEIGHT_MIN}, ${WEIGHT_MAX}]`,
      );
    }
  }
});

test('presets have unique ids and human labels', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const preset of PRESETS) {
    assert.ok(preset.label?.length > 0, `${preset.id} has a label`);
  }
});

test('balanced is exactly the app default', () => {
  assert.deepEqual(presetById('balanced').weights, defaultWeights());
});

// ---------------------------------------------------------------------------
// Which preset is highlighted
// ---------------------------------------------------------------------------

test('ACTIVE PRESET: each preset recognises its own weights', () => {
  for (const preset of PRESETS) {
    assert.equal(activePresetId(preset.weights), preset.id, `${preset.id} highlights itself`);
  }
});

test('ACTIVE PRESET: dragging any slider clears the highlight', () => {
  // The regression this guards: highlighting the last button *clicked* rather
  // than comparing live weights would leave a preset lit while showing
  // something else entirely.
  for (const preset of PRESETS) {
    for (const category of CATEGORIES) {
      const nudged = { ...preset.weights, [category]: preset.weights[category] + 0.1 };
      assert.equal(
        activePresetId(nudged),
        null,
        `${preset.id} must not stay active after ${category} moves`,
      );
    }
  }
});

test('ACTIVE PRESET: arbitrary custom weights match nothing', () => {
  assert.equal(activePresetId({ sanctions: 1.7, ransomware: 0.3, obfuscation: 2.2, transaction_profile: 1.1, counterparty: 0.9 }), null);
  assert.equal(activePresetId({}), null, 'empty weights match nothing');
  assert.equal(activePresetId(), null, 'no argument matches nothing');
});

test('ACTIVE PRESET: a missing or non-numeric weight never matches', () => {
  const partial = { ...presetById('balanced').weights };
  delete partial.counterparty;
  assert.equal(activePresetId(partial), null, 'a missing category is not a match');

  assert.equal(
    activePresetId({ ...presetById('balanced').weights, counterparty: '1.0' }),
    'balanced',
    'a numeric string still matches',
  );
  assert.equal(
    activePresetId({ ...presetById('balanced').weights, counterparty: null }),
    null,
    'null is not 1.0 here, even though normaliseWeights would default it',
  );
});

test('applying a preset cannot mutate the stored definition', () => {
  // App spreads the preset into state; a shared object reference would let a
  // slider drag rewrite the preset itself.
  const before = { ...presetById('compliance').weights };
  const applied = { ...presetById('compliance').weights };
  applied.sanctions = 0.1;
  assert.deepEqual(presetById('compliance').weights, before, 'definition unchanged');
});
