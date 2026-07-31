/**
 * Taint paths: the view model and the plain-English gloss.
 *
 * No React, so it can be imported from a plain node test. The component is
 * layout only -- every sentence it prints is generated here, which is the same
 * split as lib/waterfall.js and the chart. A sentence that overclaims is a
 * correctness bug, not a copy tweak, so it belongs somewhere assertable.
 *
 * contract.md on the shape:
 *   - `path[0]` is always the analysed address, `path[-1]` the flagged one
 *   - `tx_hashes[i]` links `path[i]` to `path[i+1]`, so there is always exactly
 *     one fewer hash than address
 *   - `bottleneck_value` is the smallest transfer along the path, "the most that
 *     could actually have flowed end to end"
 *   - `direction_sequence[i]` is `"out"` when `path[i]` sent toward `path[i+1]`
 *     and `"in"` when value moved the other way
 *
 * ## Two things drive the wording
 *
 * The bottleneck is a ceiling, not a delivery. Over one hop it IS the transfer,
 * so "sent 4.2 BTC" is exact. Over two, 2 BTC entered the intermediary and 2 BTC
 * left it, but nothing proves they were the same coins. The gloss therefore says
 * funds were "forwarded" rather than asserting the amount arrived, and a
 * separate note states the ceiling explicitly.
 *
 * DIRECTION decides whether there is a flow to describe at all. The first
 * version of this module read every path as `target -> ... -> flagged` and
 * printed "This address sent ... to an OFAC-sanctioned address" for all of them.
 * That is false for the most common two-hop topology on Bitcoin: the analysed
 * address deposits to an exchange, a sanctioned address independently deposits
 * to the same exchange, and no value ever moves between the two. `path` records
 * graph adjacency, not flow, so the array order alone cannot tell those apart --
 * `direction_sequence` can, and the three cases get three different sentences.
 * A mixed sequence is co-occurrence and is stated as such.
 */

import { describeFlag } from './flags.js';
import { formatBtc } from './format.js';

/**
 * `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` -> `1A1zP1…ivfNa`.
 *
 * Bitcoin addresses are unreadable at full length and every one of them in a
 * chain would wrap. Head and tail are both kept because that is what a human
 * actually compares; the full value stays available via `title` in the UI.
 * Anything already short enough is returned untouched rather than padded.
 */
export function shortenAddress(address, { head = 6, tail = 5 } = {}) {
  const str = typeof address === 'string' ? address.trim() : '';
  if (!str) return '';
  if (str.length <= head + tail + 1) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

/** How many addresses sit between the analysed address and the flagged one. */
export function intermediaryCount(path) {
  const addresses = Array.isArray(path?.path) ? path.path : [];
  return Math.max(0, addresses.length - 2);
}

/**
 * The middle clause of the gloss, describing how far the funds travelled.
 * Generalised past two hops even though the contract clamps there today --
 * a raised limit should read correctly rather than silently say "an
 * intermediary" about four of them.
 */
function describeRoute(intermediaries) {
  if (intermediaries <= 0) return 'directly to';
  if (intermediaries === 1) return 'to an intermediary, which forwarded funds to';
  return `through a chain of ${intermediaries} intermediaries to`;
}

/** Same clause, for value travelling towards the analysed address. */
function describeInboundRoute(intermediaries) {
  if (intermediaries <= 0) return 'directly from';
  if (intermediaries === 1) return 'through one intermediary from';
  return `through a chain of ${intermediaries} intermediaries from`;
}

export const TOPOLOGY_OUTBOUND = 'outbound_flow';
export const TOPOLOGY_INBOUND = 'inbound_flow';
export const TOPOLOGY_SHARED = 'shared_counterparty';

/**
 * Which of the three shapes a path is.
 *
 * An absent or empty `direction_sequence` is treated as outbound rather than
 * shared. That is the reading the field was introduced to replace, so it is the
 * only backwards-compatible default -- and a payload predating the field came
 * from a backend that only ever produced outbound-shaped paths anyway.
 */
export function topologyFor(path) {
  const directions = Array.isArray(path?.direction_sequence) ? path.direction_sequence : [];
  if (directions.length === 0) return TOPOLOGY_OUTBOUND;
  if (directions.every((d) => d === 'in')) return TOPOLOGY_INBOUND;
  if (directions.every((d) => d === 'out')) return TOPOLOGY_OUTBOUND;
  return TOPOLOGY_SHARED;
}

/** The bottleneck, tolerating the pre-rename field name on a stale payload. */
export function bottleneckValue(path) {
  return path?.bottleneck_value ?? path?.total_value ?? null;
}

/**
 * The plain-English gloss for one taint path.
 *
 * @returns {{sentence: string, note: string|null}} `note` is the bottleneck
 *   caveat, present only when there is an intermediary for it to apply to.
 */
export function glossForPath(path) {
  const value = formatBtc(bottleneckValue(path));
  const intermediaries = intermediaryCount(path);
  const counterparty = describeFlag(path?.target_flag);
  const topology = topologyFor(path);

  // A path with no usable value still has a story worth telling; only the
  // amount is missing, so the sentence drops the amount rather than the path.
  const amount = value === null ? 'funds' : `${value} BTC`;

  if (topology === TOPOLOGY_SHARED) {
    // No end-to-end flow exists, so there is no amount to quote and no
    // bottleneck to caveat -- quoting one would imply the transfer this
    // sentence exists to deny.
    return {
      topology,
      sentence:
        `This address and ${counterparty} both transacted with the same ` +
        `intermediary. No flow of funds between them was observed.`,
      note: 'Shared counterparties are common: exchanges and payment processors serve unrelated customers.',
    };
  }

  if (topology === TOPOLOGY_INBOUND) {
    return {
      topology,
      sentence: `This address received ${amount} ${describeInboundRoute(intermediaries)} ${counterparty}.`,
      note:
        intermediaries > 0 && value !== null
          ? `${value} BTC is the bottleneck — the largest amount that could have moved the whole way.`
          : null,
    };
  }

  return {
    topology,
    sentence: `This address sent ${amount} ${describeRoute(intermediaries)} ${counterparty}.`,
    note:
      intermediaries > 0 && value !== null
        ? `${value} BTC is the bottleneck — the largest amount that could have moved the whole way.`
        : null,
  };
}

/**
 * A taint path flattened into what the component draws: alternating address
 * chips and the transaction that connects each pair.
 *
 * Links are built from the ADDRESSES, not from `tx_hashes`, so a response whose
 * hash array is short renders the chain with an unlabelled link instead of
 * silently dropping a hop. A missing hop would understate the distance between
 * the analysed address and the flagged one, which is the one thing this panel
 * exists to communicate.
 */
export function buildTaintPath(path) {
  const addresses = (Array.isArray(path?.path) ? path.path : []).filter(Boolean);
  const hashes = Array.isArray(path?.tx_hashes) ? path.tx_hashes : [];
  const lastIndex = addresses.length - 1;

  const steps = addresses.map((address, i) => ({
    address,
    short: shortenAddress(address),
    // Roles come from position, which the contract guarantees.
    isTarget: i === 0,
    isFlagged: i === lastIndex && lastIndex > 0,
    // The hash on the link LEAVING this address, if there is one.
    txHash: i < lastIndex ? (hashes[i] ?? null) : null,
  }));

  return {
    steps,
    ...glossForPath(path),
    targetFlag: path?.target_flag ?? null,
    hops: Number.isFinite(Number(path?.hops)) ? Number(path.hops) : Math.max(0, lastIndex),
    bottleneckValue: bottleneckValue(path),
    formattedValue: formatBtc(bottleneckValue(path)),
  };
}
