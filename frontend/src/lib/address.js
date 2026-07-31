/**
 * Client-side Bitcoin address validation.
 *
 * Pure functions, no React -- so the rules can be unit tested directly.
 *
 * ## What this is and is not
 *
 * This is a FORMAT check, not a checksum check. It verifies the prefix, length
 * and alphabet; it does NOT verify the base58check or bech32 checksum, so a
 * typo'd address with a valid shape still passes here. Real verification needs
 * either a dependency or a few hundred lines of hashing, and neither is in
 * today's scope.
 *
 * That is fine, because this is a UX guard rather than a security boundary:
 * contract.md rule 1 says /api/analyze never rejects anything -- invalid
 * addresses come back 200 with `degraded: true` and a warning. The backend is
 * the authority. All this does is stop an obvious typo from costing the user a
 * 10-20 second round trip.
 */

/**
 * Base58 excludes 0, O, I and l precisely because they are easy to confuse, so
 * their presence is a reliable sign of a mistyped address rather than a rare one.
 */
const BASE58_CHARS = '[1-9A-HJ-NP-Za-km-z]';

/**
 * P2PKH starts with 1, P2SH with 3. 26-35 characters total -- the real range a
 * base58check-encoded 25-byte payload produces, and the same bound
 * `backend/bitcoin.py` enforces. The two were 25-34 here and 26-40 there, which
 * is the kind of near-agreement that holds until it doesn't: the backend
 * accepted, analysed and shipped 35-character demo fixtures that this validator
 * then refused to let anyone type in.
 */
const BASE58 = new RegExp(`^[13]${BASE58_CHARS}{25,34}$`);

/** Bech32's data alphabet, which drops 1, b, i and o. */
const BECH32_CHARS = '[qpzry9x8gf2tvdw0s3jn54khce6mua7l]';

// BIP-173 caps the whole string at 90 characters. Real bc1 addresses are 42
// (P2WPKH) or 62 (P2WSH / P2TR); the bounds here stay loose enough to accept
// future witness versions without another edit.
const BECH32 = new RegExp(`^bc1${BECH32_CHARS}{11,87}$`);

export const MIN_BASE58 = 26;
export const MAX_BASE58 = 35;

/**
 * Validate a candidate address.
 *
 * @param {string} raw
 * @returns {{ok: true, address: string} | {ok: false, error: string}}
 */
export function validateAddress(raw) {
  // Surrounding whitespace comes free with copy/paste and is never meaningful.
  const address = String(raw ?? '').trim();

  if (address === '') {
    return { ok: false, error: 'Enter a Bitcoin address.' };
  }

  if (/\s/.test(address)) {
    return { ok: false, error: 'An address cannot contain spaces.' };
  }

  // --- bech32 -------------------------------------------------------------
  if (/^bc1/i.test(address)) {
    const lower = address.toLowerCase();

    // Mixed case is explicitly invalid in BIP-173: the checksum is defined over
    // one case or the other, so "Bc1Q..." is not merely unusual, it is malformed.
    if (address !== lower && address !== address.toUpperCase()) {
      return { ok: false, error: 'A bech32 address must be all lower case or all upper case, not mixed.' };
    }

    if (!BECH32.test(lower)) {
      const bad = [...lower.slice(3)].find((c) => !/[qpzry9x8gf2tvdw0s3jn54khce6mua7l]/.test(c));
      if (bad) {
        return { ok: false, error: `"${bad}" is not a valid bech32 character.` };
      }
      return { ok: false, error: `That looks like a bech32 address but the length is wrong (${address.length} characters).` };
    }

    return { ok: true, address: lower };
  }

  // --- base58 -------------------------------------------------------------
  if (/^[13]/.test(address)) {
    if (address.length < MIN_BASE58 || address.length > MAX_BASE58) {
      return {
        ok: false,
        error: `A base58 address is ${MIN_BASE58}–${MAX_BASE58} characters; this one is ${address.length}.`,
      };
    }

    if (!BASE58.test(address)) {
      const bad = [...address].find((c) => !/[1-9A-HJ-NP-Za-km-z]/.test(c));
      const hint = bad && '0OIl'.includes(bad) ? ` (base58 excludes 0, O, I and l)` : '';
      return { ok: false, error: `"${bad}" is not a valid base58 character${hint}.` };
    }

    return { ok: true, address };
  }

  return {
    ok: false,
    error: 'Not a recognised Bitcoin address — expected base58 (starting 1 or 3) or bech32 (starting bc1).',
  };
}

/** Convenience predicate for callers that only need a yes/no. */
export const isValidAddress = (raw) => validateAddress(raw).ok;
