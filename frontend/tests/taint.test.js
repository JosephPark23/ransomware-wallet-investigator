/**
 * Unit tests for src/lib/taint.js and src/lib/flags.js -- the taint-path gloss
 * and the flag parsing behind it.
 *
 * Run with: npm test   (node --test, no test-runner dependency)
 *
 * The centrepiece is the pair of golden sentences for the fixture's two real
 * paths. That sentence is what a reader repeats to a colleague, so it is pinned
 * verbatim: a wording change that overclaims -- asserting funds ARRIVED when
 * `bottleneck_value` only bounds what COULD have -- is a correctness regression, and
 * a diff on a string literal is the only way to notice it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  UNFLAGGED_COLOR,
  describeFlag,
  dominantFlag,
  flagCategory,
  flagColor,
  flagLabel,
  parseFlag,
  parseFlags,
} from '../src/lib/flags.js';
import {
  TOPOLOGY_INBOUND,
  TOPOLOGY_OUTBOUND,
  TOPOLOGY_SHARED,
  buildTaintPath,
  glossForPath,
  intermediaryCount,
  shortenAddress,
} from '../src/lib/taint.js';
import { CATEGORY_COLORS } from '../src/lib/categories.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample.json'), 'utf8'));

const [ofacPath, contiPath] = fixture.taint_paths;

// ---------------------------------------------------------------------------
// THE POINT OF THIS FILE: the two fixture paths, worded exactly
// ---------------------------------------------------------------------------

test('GOLDEN: the fixture has exactly the two paths these tests assume', () => {
  // If the fixture gains a path, the goldens below stop covering it silently.
  assert.equal(fixture.taint_paths.length, 2);
  assert.equal(ofacPath.target_flag, 'ofac');
  assert.equal(contiPath.target_flag, 'ransomware:Conti');
});

test('GOLDEN: the one-hop OFAC path reads as a direct transfer', () => {
  const { sentence, note } = glossForPath(ofacPath);
  assert.equal(sentence, 'This address sent 4.2 BTC directly to an OFAC-sanctioned address.');
  // One hop means one transaction: the bottleneck IS the transfer, so there is
  // no ceiling worth caveating.
  assert.equal(note, null);
});

test('GOLDEN: the two-hop Conti path names the family and the intermediary', () => {
  const { sentence, note } = glossForPath(contiPath);
  assert.equal(
    sentence,
    'This address sent 2 BTC to an intermediary, which forwarded funds to an address attributed to the Conti ransomware family.',
  );
  assert.equal(
    note,
    '2 BTC is the bottleneck — the largest amount that could have moved the whole way.',
  );
});

test('GOLDEN: the family comes from splitting the flag, not from a lookup table', () => {
  // contract.md: split on ':' to get the family. A backend that starts
  // reporting REvil or LockBit must work with no frontend change.
  assert.match(glossForPath({ ...contiPath, target_flag: 'ransomware:REvil' }).sentence, /REvil ransomware family/);
  assert.match(glossForPath({ ...contiPath, target_flag: 'ransomware:LockBit 3.0' }).sentence, /LockBit 3.0 ransomware family/);
});

test('the two-hop gloss does not claim the funds arrived', () => {
  // `bottleneck_value` is a ceiling, not proof the same coins landed. "sent ...
  // to an intermediary, which forwarded funds to X" is supportable; "sent 2 BTC
  // to X" over two hops is not.
  const { sentence } = glossForPath(contiPath);
  assert.match(sentence, /forwarded funds to/);
  assert.doesNotMatch(sentence, /sent 2 BTC to an address attributed/);
});

test('BTC amounts in the gloss are display-rounded, not raw floats', () => {
  const path = { ...ofacPath, bottleneck_value: 7.99999999 };
  assert.match(glossForPath(path).sentence, /8 BTC/);
  assert.doesNotMatch(glossForPath(path).sentence, /7\.99999999/);
});

test('the pre-rename total_value field is still read, so a stale payload renders', () => {
  // The backend renamed total_value -> bottleneck_value. A response cached
  // before that rename is still a valid thing to hold, and losing the amount
  // would be a silent downgrade rather than a visible error.
  const legacy = { ...ofacPath, total_value: 4.2 };
  delete legacy.bottleneck_value;
  assert.match(glossForPath(legacy).sentence, /4\.2 BTC/);
});

// ---------------------------------------------------------------------------
// Gloss edge cases
// ---------------------------------------------------------------------------

test('a longer chain than the contract allows today still reads correctly', () => {
  // max_hops is clamped at 2, but "an intermediary" about four of them would be
  // wrong rather than merely imprecise.
  const long = {
    target_flag: 'ofac',
    bottleneck_value: 1,
    path: ['a', 'b', 'c', 'd', 'e'],
    tx_hashes: ['h1', 'h2', 'h3', 'h4'],
  };
  assert.equal(
    glossForPath(long).sentence,
    'This address sent 1 BTC through a chain of 3 intermediaries to an OFAC-sanctioned address.',
  );
});

test('an unknown flag degrades to vague-but-true wording', () => {
  const { sentence } = glossForPath({ ...ofacPath, target_flag: 'mixer:Tornado' });
  assert.match(sentence, /a flagged address/);
  assert.doesNotMatch(sentence, /undefined|null/);
});

test('a ransomware flag with no family does not print an empty name', () => {
  const { sentence } = glossForPath({ ...contiPath, target_flag: 'ransomware:' });
  assert.match(sentence, /a known ransomware family/);
  assert.doesNotMatch(sentence, /the {2}ransomware/);
});

test('a missing value drops the amount rather than the path', () => {
  const { sentence, note } = glossForPath({ ...ofacPath, bottleneck_value: null });
  assert.equal(sentence, 'This address sent funds directly to an OFAC-sanctioned address.');
  assert.doesNotMatch(sentence, /null|NaN|undefined/);
  assert.equal(note, null);
});

test('an empty or malformed path does not throw', () => {
  for (const value of [null, undefined, {}, { path: null }, { path: [] }]) {
    const { sentence } = glossForPath(value);
    assert.ok(sentence.length > 0);
    assert.doesNotMatch(sentence, /undefined|NaN/);
  }
});

test('intermediaryCount counts the addresses between the ends', () => {
  assert.equal(intermediaryCount(ofacPath), 0);
  assert.equal(intermediaryCount(contiPath), 1);
  assert.equal(intermediaryCount({ path: ['a'] }), 0);
  assert.equal(intermediaryCount({}), 0);
});

// ---------------------------------------------------------------------------
// The drawn chain
// ---------------------------------------------------------------------------

test('CHAIN: the fixture two-hop path builds three chips and two links', () => {
  const { steps } = buildTaintPath(contiPath);
  assert.equal(steps.length, 3);

  // contract.md: path[0] is the analysed address, path[-1] the flagged one.
  assert.equal(steps[0].isTarget, true);
  assert.equal(steps[0].address, fixture.address);
  assert.equal(steps[2].isFlagged, true);
  assert.equal(steps[1].isTarget, false);
  assert.equal(steps[1].isFlagged, false);

  // tx_hashes[i] links path[i] to path[i+1]; the last chip ends nothing.
  assert.equal(steps[0].txHash, contiPath.tx_hashes[0]);
  assert.equal(steps[1].txHash, contiPath.tx_hashes[1]);
  assert.equal(steps[2].txHash, null);
});

test('CHAIN: a short tx_hashes array leaves a link unlabelled, never drops a hop', () => {
  // Understating the distance to the flagged address is the one error this
  // panel must not make, so the chain is built from the addresses.
  const { steps } = buildTaintPath({ ...contiPath, tx_hashes: [contiPath.tx_hashes[0]] });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].txHash, contiPath.tx_hashes[0]);
  assert.equal(steps[1].txHash, null);
});

test('CHAIN: hops falls back to the drawn length when the field is absent', () => {
  assert.equal(buildTaintPath(contiPath).hops, 2);
  assert.equal(buildTaintPath({ ...contiPath, hops: undefined }).hops, 2);
});

test('CHAIN: a single-address path marks no chip as flagged', () => {
  // path[-1] === path[0]: there is no flagged counterparty to point at.
  const { steps } = buildTaintPath({ target_flag: 'ofac', path: ['abc'], tx_hashes: [] });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].isTarget, true);
  assert.equal(steps[0].isFlagged, false);
});

// ---------------------------------------------------------------------------
// Address shortening
// ---------------------------------------------------------------------------

test('shortenAddress keeps both ends, which is what a human compares', () => {
  assert.equal(shortenAddress(fixture.address), '1A1zP1…ivfNa');
  assert.equal(shortenAddress('1CoUnTerPartyExampleAddress009xQ2'), '1CoUnT…09xQ2');
});

test('shortenAddress leaves an already-short value alone', () => {
  assert.equal(shortenAddress('abc'), 'abc');
  assert.equal(shortenAddress(''), '');
  assert.equal(shortenAddress(null), '');
});

// ---------------------------------------------------------------------------
// Flag parsing -- the contract's split-on-colon rule
// ---------------------------------------------------------------------------

test('parseFlag splits kind from family on the first colon', () => {
  assert.deepEqual(parseFlag('ofac'), { kind: 'ofac', family: null, raw: 'ofac' });
  assert.deepEqual(parseFlag('ransomware:Conti'), {
    kind: 'ransomware',
    family: 'Conti',
    raw: 'ransomware:Conti',
  });
});

test('parseFlag keeps a family containing a colon intact', () => {
  // Splitting naively and taking [1] would truncate this to "Bad".
  assert.equal(parseFlag('ransomware:Bad:Rabbit').family, 'Bad:Rabbit');
});

test('parseFlag survives junk without throwing', () => {
  for (const value of [null, undefined, '', '   ', 42, {}]) {
    const parsed = parseFlag(value);
    assert.equal(parsed.kind, null);
    assert.equal(parsed.family, null);
  }
});

test('parseFlags drops unusable entries', () => {
  assert.equal(parseFlags(['ofac', '', null, 'ransomware:REvil']).length, 2);
  assert.deepEqual(parseFlags(null), []);
  assert.deepEqual(parseFlags('ofac'), []); // a bare string is not the contract shape
});

test('dominantFlag puts OFAC ahead of ransomware', () => {
  // An authoritative list match with legal consequences must not be visually
  // outranked by anything, whatever order the backend sends the flags in.
  assert.equal(dominantFlag(['ransomware:Conti', 'ofac']).kind, 'ofac');
  assert.equal(dominantFlag(['ofac', 'ransomware:Conti']).kind, 'ofac');
  assert.equal(dominantFlag(['ransomware:Conti']).kind, 'ransomware');
  assert.equal(dominantFlag([]), null);
});

test('dominantFlag lets a known flag beat an unknown one', () => {
  assert.equal(dominantFlag(['mixer:Tornado', 'ofac']).kind, 'ofac');
  // ...but an unknown flag alone is still returned rather than discarded.
  assert.equal(dominantFlag(['mixer:Tornado']).kind, 'mixer');
});

// ---------------------------------------------------------------------------
// Colour: the categories.js reuse
// ---------------------------------------------------------------------------

test('COLOUR: flags reuse the category palette so one entity is one colour', () => {
  // An ofac node and the sanctions waterfall bar must not be different colours
  // on the same screen.
  assert.equal(flagColor(['ofac']), CATEGORY_COLORS.sanctions);
  assert.equal(flagColor(['ransomware:Conti']), CATEGORY_COLORS.ransomware);
});

test('COLOUR: unflagged and unknown-flag nodes are neutral, never a category colour', () => {
  assert.equal(flagColor([]), UNFLAGGED_COLOR);
  assert.equal(flagColor(null), UNFLAGGED_COLOR);
  // A future flag must not borrow the sanctions colour by accident.
  assert.equal(flagColor(['mixer:Tornado']), UNFLAGGED_COLOR);
});

test('COLOUR: hop is not encoded in colour', () => {
  // Two nodes with the same flags at different hops are the same colour --
  // categories.js encodes identity, and the layout carries magnitude.
  assert.equal(flagColor(['ofac']), flagColor(['ofac']));
  assert.equal(flagCategory('ofac'), 'sanctions');
  assert.equal(flagCategory('ransomware'), 'ransomware');
  assert.equal(flagCategory('mixer'), null);
});

test('flagLabel gives short chip wording', () => {
  assert.equal(flagLabel('ofac'), 'OFAC');
  assert.equal(flagLabel('ransomware:Conti'), 'Conti ransomware');
  assert.equal(flagLabel('ransomware'), 'Ransomware');
  // Unknown flags echo rather than vanish.
  assert.equal(flagLabel('mixer:Tornado'), 'mixer:Tornado');
});

test('describeFlag covers every flag kind the contract names', () => {
  assert.equal(describeFlag('ofac'), 'an OFAC-sanctioned address');
  assert.equal(describeFlag('ransomware:Conti'), 'an address attributed to the Conti ransomware family');
});

// ---------------------------------------------------------------------------
// Direction: which of the three topologies a path actually is
// ---------------------------------------------------------------------------

test('DIRECTION: an all-out path reads as this address sending', () => {
  const { sentence, topology } = glossForPath({
    ...ofacPath,
    direction_sequence: ['out', 'out'],
    path: ['1Target', '1Middle', '1Flagged'],
    tx_hashes: ['a', 'b'],
  });
  assert.equal(topology, TOPOLOGY_OUTBOUND);
  assert.match(sentence, /^This address sent /);
});

test('DIRECTION: an all-in path reads as this address receiving', () => {
  const { sentence, topology } = glossForPath({
    ...ofacPath,
    direction_sequence: ['in', 'in'],
    path: ['1Target', '1Middle', '1Flagged'],
    tx_hashes: ['a', 'b'],
  });
  assert.equal(topology, TOPOLOGY_INBOUND);
  assert.match(sentence, /^This address received /);
  assert.doesNotMatch(sentence, /sent/);
});

test('DIRECTION: a mixed path claims no flow, and quotes no amount', () => {
  // The regression this exists for: `path` records graph adjacency, not flow.
  // Target deposits to an exchange; a sanctioned address independently deposits
  // to the same exchange. Reading the array left-to-right says "this address
  // sent funds to an OFAC-sanctioned address", which is false -- no value moved
  // between them at all. Quoting the bottleneck here would be the same lie in
  // numeric form, so the amount is withheld too.
  const { sentence, note, topology } = glossForPath({
    ...ofacPath,
    direction_sequence: ['out', 'in'],
    path: ['1Target', '1Exchange', '1Flagged'],
    tx_hashes: ['a', 'b'],
    bottleneck_value: 50,
  });
  assert.equal(topology, TOPOLOGY_SHARED);
  assert.match(sentence, /No flow of funds between them was observed/);
  assert.doesNotMatch(sentence, /sent|received/);
  assert.doesNotMatch(sentence, /50/);
  assert.ok(note, 'the shared-counterparty caveat is always worth stating');
});

test('DIRECTION: an absent direction_sequence falls back to the outbound reading', () => {
  // Backwards compatibility with a payload predating the field. Such a payload
  // came from a backend that only produced outbound-shaped paths, so outbound
  // is the only safe default.
  const legacy = { ...ofacPath };
  delete legacy.direction_sequence;
  assert.equal(glossForPath(legacy).topology, TOPOLOGY_OUTBOUND);
});
