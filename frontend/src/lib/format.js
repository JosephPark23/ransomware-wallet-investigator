/**
 * Display formatting. No React, so it can be imported from a plain node test.
 *
 * Everything here is for the SCREEN ONLY. Nothing in this module may be fed
 * back into scoring: `formatBtc` deliberately drops precision, and a rounded
 * number that leaks into a severity or a weight is a silent wrong answer.
 * Scoring reads the raw payload; components read this.
 *
 * `formatDate` and `formatNumber` were private to SignalCard.jsx. ProfileStats
 * and SourcePanel need the same treatment for the same kinds of values, and two
 * date formatters in one app drift -- so they live here now and SignalCard
 * imports them.
 */

// ---------------------------------------------------------------------------
// Key names
// ---------------------------------------------------------------------------

/**
 * Token-level spelling overrides. This is a dictionary of common tokens, not a
 * per-rule layout -- an unknown token just gets title-cased.
 */
const TOKEN_OVERRIDES = new Map(
  Object.entries({
    id: 'ID', ids: 'IDs', uid: 'UID', uids: 'UIDs', url: 'URL', urls: 'URLs',
    api: 'API', ip: 'IP', btc: 'BTC', eth: 'ETH', usd: 'USD', eur: 'EUR',
    txid: 'TxID', txids: 'TxIDs', ofac: 'OFAC', sdn: 'SDN', kyc: 'KYC',
    aml: 'AML', utc: 'UTC', dprk: 'DPRK', usa: 'USA', us: 'US', avg: 'Avg',
  }),
);

/**
 * `total_received_btc` -> `Total Received BTC`. Purely mechanical, key-name agnostic.
 *
 * Lived in SignalCard.jsx until the poster export needed it too. Node cannot
 * import a .jsx file, and reimplementing it in the export script would let the
 * printed figure drift from the screen.
 */
export function prettifyKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase -> spaced
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(
      (word) =>
        TOKEN_OVERRIDES.get(word.toLowerCase()) ??
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_ONLY_FORMAT = { year: 'numeric', month: 'short', day: 'numeric' };
const TIMESTAMP_FORMAT = {
  ...DATE_ONLY_FORMAT,
  hour: 'numeric',
  minute: '2-digit',
  // An investigator reading a timestamp needs to know which zone it is in.
  timeZoneName: 'short',
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A timestamp or a date, rendered in the reader's own locale and zone.
 *
 * Returns `null` for a missing value so callers can pick their own fallback
 * wording, and returns the input unchanged if it will not parse -- showing the
 * raw string beats showing "Invalid Date".
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === '') return null;

  // A date-only string like "2022-04-14" is parsed as UTC midnight by spec.
  // Formatting that in a timezone behind UTC renders the PREVIOUS day, so an
  // OFAC listing date would silently display a day early. Build the date from
  // its own components instead so it is never shifted across a zone.
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const local = new Date(Number(y), Number(m) - 1, Number(d));
    if (Number.isNaN(local.getTime())) return value;
    return local.toLocaleDateString(undefined, DATE_ONLY_FORMAT);
  }

  // A full timestamp carries its own offset, so converting to local time is
  // correct here -- that is the reader's own clock.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, TIMESTAMP_FORMAT);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A general-purpose number, grouped, with BTC-grade precision preserved. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: SATOSHI_DECIMALS });
}

/**
 * A number, or null if the value is absent.
 *
 * `Number(null)` and `Number('')` are both 0, so coercing straight to Number
 * turns a missing balance into a confident "0 BTC" and a missing record count
 * into "0 records". Absent and zero are different claims; only one of them is
 * safe to make up.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A whole count -- transactions, senders, days. Grouped, never fractional. */
export function formatCount(value) {
  const n = toNumber(value);
  if (n === null) return null;
  return Math.round(n).toLocaleString();
}

// ---------------------------------------------------------------------------
// BTC amounts
// ---------------------------------------------------------------------------

/**
 * Decimals shown by default. Bitcoin divides to 8 (one satoshi), but a wallet
 * total printed to 8 places is unreadable and, worse, misleading: float
 * accumulation in the backend produces values like 7.99999999 that are really
 * 8 BTC and only look precise. Four places is ~1000 sats -- past anything that
 * changes how a reader reads the number.
 */
export const BTC_DECIMALS = 4;

/** The true floor: one satoshi. */
export const SATOSHI_DECIMALS = 8;
const SATOSHI = 1e-8;

/**
 * A BTC amount, rounded FOR DISPLAY ONLY.
 *
 * Returns the bare number; callers add the unit. Trailing zeros are dropped, so
 * 7.99999999 reads "8" and 0.85 reads "0.85" rather than "0.8500".
 *
 * Rounding is widened, never applied blindly: an amount small enough to round
 * to zero at four places is shown to the full satoshi instead. A dust balance
 * displayed as "0 BTC" would contradict the funnel-pattern signal sitting on
 * the same screen, which cites a near-zero-but-nonzero balance as evidence.
 */
export function formatBtc(value) {
  const n = toNumber(value);
  if (n === null) return null;
  if (n === 0) return '0';

  const abs = Math.abs(n);

  // Below half a satoshi there is no precision left to widen to, and the
  // honest statement is that it is smaller than the chain can express.
  if (abs < SATOSHI / 2) return n > 0 ? '<0.00000001' : '>-0.00000001';

  // Would this round to zero at the display precision? Then show more of it.
  const decimals = abs < 0.5 * 10 ** -BTC_DECIMALS ? SATOSHI_DECIMALS : BTC_DECIMALS;

  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** A BTC amount with its unit, for the common case. */
export function formatBtcAmount(value) {
  const formatted = formatBtc(value);
  return formatted === null ? null : `${formatted} BTC`;
}
