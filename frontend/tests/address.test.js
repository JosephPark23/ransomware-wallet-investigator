/**
 * Unit tests for src/lib/address.js.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * Format validation only -- no checksum is verified, so these tests assert
 * shape, not authenticity. See the module header for why that is the right
 * scope here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MAX_BASE58, MIN_BASE58, isValidAddress, validateAddress } from '../src/lib/address.js';
import { DEMO_ADDRESSES } from '../src/lib/demos.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

const P2PKH = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // 34 chars
const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'; // 34 chars
const BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'; // BIP-173 example

// ---------------------------------------------------------------------------
// Accepted
// ---------------------------------------------------------------------------

test('accepts base58 addresses starting 1 or 3', () => {
  for (const address of [P2PKH, P2SH]) {
    const result = validateAddress(address);
    assert.ok(result.ok, `${address} should be valid: ${result.error}`);
    assert.equal(result.address, address, 'returned unchanged');
  }
});

test('accepts bech32 addresses starting bc1', () => {
  const result = validateAddress(BECH32);
  assert.ok(result.ok, result.error);
  assert.equal(result.address, BECH32);
});

test('accepts an all-uppercase bech32 address and normalises it', () => {
  const result = validateAddress(BECH32.toUpperCase());
  assert.ok(result.ok, result.error);
  assert.equal(result.address, BECH32, 'lower-cased on the way out');
});

test('accepts base58 at both length boundaries', () => {
  const at = (n) => `1${'A'.repeat(n - 1)}`;
  assert.ok(validateAddress(at(MIN_BASE58)).ok, `${MIN_BASE58} chars`);
  assert.ok(validateAddress(at(MAX_BASE58)).ok, `${MAX_BASE58} chars`);
  assert.ok(!validateAddress(at(MIN_BASE58 - 1)).ok, 'one under');
  assert.ok(!validateAddress(at(MAX_BASE58 + 1)).ok, 'one over');
});

test('trims surrounding whitespace, which copy/paste adds for free', () => {
  const result = validateAddress(`  ${P2PKH}\n`);
  assert.ok(result.ok, result.error);
  assert.equal(result.address, P2PKH);
});

test('THE ADDRESSES THIS APP SHIPS WITH are valid', () => {
  // A demo entry or fixture that its own validator rejects would be an
  // embarrassing thing to discover during a demo.
  assert.ok(validateAddress(fixture.address).ok, `fixture address ${fixture.address}`);
  for (const demo of DEMO_ADDRESSES) {
    assert.ok(validateAddress(demo.address).ok, `demo "${demo.id}" address ${demo.address}`);
  }
});

// ---------------------------------------------------------------------------
// Rejected
// ---------------------------------------------------------------------------

test('rejects empty and whitespace-only input', () => {
  for (const value of ['', '   ', '\t\n', null, undefined]) {
    const result = validateAddress(value);
    assert.ok(!result.ok, `${JSON.stringify(value)} should be rejected`);
    assert.ok(result.error.length > 0, 'with a message');
  }
});

test('rejects a wrong leading character', () => {
  for (const address of ['2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'xyz123', '0x1234abcd']) {
    assert.ok(!validateAddress(address).ok, `${address} should be rejected`);
  }
});

test('rejects the base58 look-alike characters', () => {
  // 0, O, I and l are excluded from base58 precisely because they are confusable,
  // so seeing one is a strong signal of a transcription error.
  for (const bad of ['0', 'O', 'I', 'l']) {
    const address = `1${bad}${P2PKH.slice(2)}`;
    const result = validateAddress(address);
    assert.ok(!result.ok, `"${bad}" should be rejected`);
    assert.match(result.error, /base58/, 'error names the alphabet');
  }
});

test('rejects mixed-case bech32', () => {
  // BIP-173: the checksum is defined over a single case, so mixed case is
  // malformed rather than merely unusual.
  const mixed = 'bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const result = validateAddress(mixed);
  assert.ok(!result.ok);
  assert.match(result.error, /mixed/i);
});

test('rejects invalid bech32 characters', () => {
  // 'b', 'i' and 'o' are not in the bech32 data alphabet.
  const result = validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3ti');
  assert.ok(!result.ok);
});

test('rejects an address containing spaces', () => {
  const result = validateAddress('1A1zP1eP5QGefi2 DMPTfTL5SLmv7DivfNa');
  assert.ok(!result.ok);
  assert.match(result.error, /space/i);
});

test('every rejection carries a non-empty, specific message', () => {
  const bad = ['', 'x', '2abc', '1' + '0'.repeat(30), 'bc1!!!', '1short'];
  for (const value of bad) {
    const result = validateAddress(value);
    assert.ok(!result.ok, `${value} should be rejected`);
    assert.ok(typeof result.error === 'string' && result.error.trim().length > 0);
    assert.ok(!/undefined|null|NaN/.test(result.error), `leaky message: ${result.error}`);
  }
});

test('isValidAddress mirrors validateAddress', () => {
  assert.equal(isValidAddress(P2PKH), true);
  assert.equal(isValidAddress('nope'), false);
});
