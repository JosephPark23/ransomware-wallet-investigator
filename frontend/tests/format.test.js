/**
 * Unit tests for src/lib/format.js -- the display formatting shared by
 * ProfileStats, SourcePanel and SignalCard.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * The point of this file is the ROUNDING RULE, not the exact glyphs. Locale
 * output varies by machine, so assertions are on what the rule guarantees --
 * that 7.99999999 stops looking like a precise number, that a dust balance
 * never renders as "0", that a date is never shown a day early -- rather than
 * on a literal string that would pin the test to one Intl implementation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BTC_DECIMALS,
  SATOSHI_DECIMALS,
  formatBtc,
  formatBtcAmount,
  formatCount,
  formatDate,
  formatNumber,
} from '../src/lib/format.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

/** Digits after the decimal point in a formatted number, separators ignored. */
const decimalsOf = (text) => {
  const dot = text.lastIndexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

// ---------------------------------------------------------------------------
// BTC amounts -- the reason this module exists
// ---------------------------------------------------------------------------

test('BTC: the fixture float reads as 8, not 7.99999999', () => {
  // This exact value is in fixtures/sample.json three times (total_received,
  // total_sent, and the funnel signal's evidence). It is backend float
  // accumulation, not precision, and printing it raw makes the reader do the
  // rounding themselves.
  assert.equal(formatBtc(7.99999999), '8');
  assert.equal(formatBtcAmount(7.99999999), '8 BTC');
});

test('BTC: fixture profile amounts all round cleanly', () => {
  assert.equal(formatBtc(fixture.profile.total_received), '8');
  assert.equal(formatBtc(fixture.profile.total_sent), '8');
  assert.equal(formatBtc(fixture.profile.balance), '0');
});

test('BTC: trailing zeros are dropped', () => {
  assert.equal(formatBtc(0.85), '0.85');
  assert.equal(formatBtc(4.2), '4.2');
  assert.equal(formatBtc(2), '2');
  assert.equal(formatBtc(0.5), '0.5');
});

test('BTC: rounds to the display precision', () => {
  assert.ok(decimalsOf(formatBtc(1.23456789)) <= BTC_DECIMALS);
  assert.equal(formatBtc(1.23456789), '1.2346');
  // 9.600000000000001 -- another float artefact, this one from the peel chain.
  assert.equal(formatBtc(9.600000000000001), '9.6');
});

test('BTC: exact zero is zero, not 0.0000', () => {
  assert.equal(formatBtc(0), '0');
  assert.equal(formatBtc(-0), '0');
});

test('BTC: a dust balance never renders as zero', () => {
  // THE failure this rule exists to prevent. The funnel-pattern signal cites a
  // "near-zero" balance as evidence; a balance of 1234 sats displayed as "0"
  // makes the page contradict itself, and 0 vs. not-0 is the distinction a
  // reader is actually looking for.
  const dust = 0.00001234;
  assert.notEqual(formatBtc(dust), '0');
  assert.equal(formatBtc(dust), '0.00001234');
  assert.ok(decimalsOf(formatBtc(dust)) <= SATOSHI_DECIMALS);
});

test('BTC: one satoshi survives', () => {
  assert.equal(formatBtc(0.00000001), '0.00000001');
});

test('BTC: below one satoshi is stated as such, not rounded away', () => {
  // Nothing on-chain is smaller than a satoshi, so this is a backend artefact.
  // "<0.00000001" is honest; "0" would not be.
  assert.equal(formatBtc(1e-12), '<0.00000001');
});

test('BTC: non-numeric input returns null so callers can choose the wording', () => {
  assert.equal(formatBtc(null), null);
  assert.equal(formatBtc(undefined), null);
  assert.equal(formatBtc('not a number'), null);
  assert.equal(formatBtc(NaN), null);
  assert.equal(formatBtc(Infinity), null);
  assert.equal(formatBtcAmount(null), null);
});

test('BTC: display rounding is display-only and never mutates its input', () => {
  // The rounded string must not be able to travel back into scoring. Guard the
  // weaker property that is actually checkable here: the input is untouched and
  // the raw value stays available to the caller.
  const profile = { total_received: 7.99999999 };
  formatBtc(profile.total_received);
  assert.equal(profile.total_received, 7.99999999);
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('DATE: a date-only string is never shown a day early', () => {
  // "2020-02-25" parses as UTC midnight. Formatted in any zone behind UTC that
  // is the 24th. The ransomware group-context signal carries exactly this shape
  // (window_first_seen "2020-02-25"), so an OFAC-adjacent date would silently shift.
  const formatted = formatDate('2020-02-25');
  assert.match(formatted, /25/);
  assert.doesNotMatch(formatted, /24/);
});

test('DATE: a full timestamp renders with a time and a zone', () => {
  const formatted = formatDate('2026-07-27T09:00:00+00:00');
  assert.match(formatted, /2026/);
  // Some time-of-day component is present -- an investigator needs it.
  assert.match(formatted, /\d{1,2}:\d{2}/);
});

test('DATE: fixture profile timestamps format without falling through', () => {
  for (const value of [fixture.profile.window_first_seen, fixture.profile.window_last_seen]) {
    const formatted = formatDate(value);
    assert.notEqual(formatted, value, `${value} should not pass through unformatted`);
    assert.doesNotMatch(formatted, /Invalid Date/);
  }
});

test('DATE: fixture source retrieval timestamps format without falling through', () => {
  for (const source of fixture.sources_used) {
    const formatted = formatDate(source.retrieved_at);
    assert.notEqual(formatted, source.retrieved_at);
    assert.doesNotMatch(formatted, /Invalid Date/);
  }
});

test('DATE: fractional seconds are handled', () => {
  // The OFAC source in the fixture carries microseconds.
  const formatted = formatDate('2026-07-27T17:55:44.001980+00:00');
  assert.doesNotMatch(formatted, /Invalid Date/);
  assert.match(formatted, /2026/);
});

test('DATE: a missing value returns null, not the epoch', () => {
  // new Date(null) is 1970-01-01. Rendering that as a window_first_seen date would be
  // a confident, specific, wrong answer.
  assert.equal(formatDate(null), null);
  assert.equal(formatDate(undefined), null);
  assert.equal(formatDate(''), null);
  assert.doesNotMatch(String(formatDate(null)), /1970/);
});

test('DATE: an unparseable value passes through rather than showing Invalid Date', () => {
  assert.equal(formatDate('sometime last tuesday'), 'sometime last tuesday');
});

// ---------------------------------------------------------------------------
// Counts and general numbers
// ---------------------------------------------------------------------------

test('COUNT: whole counts stay whole', () => {
  assert.equal(formatCount(17), '17');
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(fixture.profile.tx_count), '17');
});

test('COUNT: large record counts are grouped', () => {
  // 26000 records in the Ransomwhere dataset. "26000" is a wall of digits.
  const formatted = formatCount(26000);
  assert.notEqual(formatted, '26000');
  assert.match(formatted, /26.000/);
});

test('COUNT: a missing count returns null', () => {
  assert.equal(formatCount(null), null);
  assert.equal(formatCount(undefined), null);
  assert.equal(formatCount('lots'), null);
});

test('NUMBER: integers keep no decimals, floats keep satoshi precision', () => {
  assert.equal(formatNumber(522), '522');
  assert.match(formatNumber(0.9796), /0.9796/);
});
