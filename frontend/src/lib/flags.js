/**
 * Graph node flags: parsing, wording, and colour.
 *
 * No React, so it can be imported from a plain node test.
 *
 * contract.md: `flags` is a possibly-empty array of `"ofac"` or
 * `"ransomware:{Family}"` -- split on `:` to get the family name. That split is
 * the ONLY place the family is defined, so it lives here once and both
 * NetworkGraph and TaintPath read it rather than each doing their own split.
 *
 * ## Colour
 *
 * Flags reuse the category palette in categories.js: an `ofac` flag IS the
 * sanctions category and a `ransomware:*` flag IS the ransomware category, so a
 * flagged node carries the same colour as the corresponding waterfall bar. One
 * entity, one colour, across both charts.
 *
 * Hop distance is deliberately NOT encoded in colour. categories.js is explicit
 * that its palette encodes identity and never magnitude, and hop is magnitude --
 * the graph layout carries it as column position and node size instead. Using
 * colour for both would also collide: a two-hop OFAC node cannot be two colours.
 *
 * The palette was CVD-validated as a five-colour set. This module uses two of
 * those five plus a neutral, which is a strict subset -- separation between the
 * colours actually drawn can only be wider than what was validated, so no
 * re-validation is needed for this use.
 */

import { categoryColor } from './categories.js';

export const FLAG_OFAC = 'ofac';
export const FLAG_RANSOMWARE = 'ransomware';

/** Unflagged nodes. Grey reads as "nothing known against this address". */
export const UNFLAGGED_COLOR = 'var(--node-unflagged, #64748b)';

/**
 * Most severe first. An address that is both sanctioned and a known ransomware
 * address is drawn as sanctioned: OFAC is an authoritative list match with legal
 * consequences attached, and it must not be visually outranked by anything.
 */
const FLAG_PRECEDENCE = [FLAG_OFAC, FLAG_RANSOMWARE];

/**
 * `"ransomware:Conti"` -> `{ kind: 'ransomware', family: 'Conti' }`.
 *
 * Rejoins on `:` after the first separator, so a family name containing a colon
 * survives instead of being silently truncated.
 */
export function parseFlag(flag) {
  const raw = typeof flag === 'string' ? flag.trim() : '';
  if (!raw) return { kind: null, family: null, raw: '' };

  const separator = raw.indexOf(':');
  if (separator === -1) return { kind: raw.toLowerCase(), family: null, raw };

  const kind = raw.slice(0, separator).trim().toLowerCase();
  const family = raw.slice(separator + 1).trim();
  return { kind, family: family || null, raw };
}

/** Every parseable flag on a node, in input order. */
export function parseFlags(flags) {
  return (Array.isArray(flags) ? flags : []).map(parseFlag).filter((f) => f.kind);
}

/**
 * The flag that decides how a node is drawn, or null if it carries none.
 * Known flags outrank unknown ones, so a future backend flag cannot quietly
 * displace an OFAC hit in the colouring.
 */
export function dominantFlag(flags) {
  const parsed = parseFlags(flags);
  if (parsed.length === 0) return null;

  for (const kind of FLAG_PRECEDENCE) {
    const match = parsed.find((f) => f.kind === kind);
    if (match) return match;
  }
  return parsed[0];
}

/** Which risk category a flag belongs to, or null for one we do not know. */
export function flagCategory(kind) {
  if (kind === FLAG_OFAC) return 'sanctions';
  if (kind === FLAG_RANSOMWARE) return 'ransomware';
  return null;
}

/** Fill colour for a node, from its flags. Unflagged and unknown both go grey. */
export function flagColor(flags) {
  const category = flagCategory(dominantFlag(flags)?.kind);
  return category ? categoryColor(category) : UNFLAGGED_COLOR;
}

/**
 * Short chip wording: `"OFAC"`, `"Conti ransomware"`.
 * An unknown flag is echoed rather than dropped -- losing a flag on screen is
 * worse than rendering one nobody has styled yet.
 */
export function flagLabel(flag) {
  const { kind, family, raw } = parseFlag(flag);
  if (kind === FLAG_OFAC) return 'OFAC';
  if (kind === FLAG_RANSOMWARE) return family ? `${family} ransomware` : 'Ransomware';
  return raw;
}

/**
 * Sentence-fragment wording, for the taint-path gloss.
 * Reads as the object of "sent 2 BTC to ...".
 */
export function describeFlag(flag) {
  const { kind, family } = parseFlag(flag);
  if (kind === FLAG_OFAC) return 'an OFAC-sanctioned address';
  if (kind === FLAG_RANSOMWARE) {
    return family
      ? `an address attributed to the ${family} ransomware family`
      : 'an address attributed to a known ransomware family';
  }
  // Unknown flag from a rule that does not exist yet. Vague but never wrong.
  return 'a flagged address';
}
