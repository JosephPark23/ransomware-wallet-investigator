/**
 * Plain-English interpretation of signals, scores and evidence keys.
 *
 * Pure functions and data only -- no React, no DOM -- so the wording can be
 * asserted in a plain `node --test` run alongside the rest of lib/.
 *
 * ## Why this module exists
 *
 * The backend already ships an `explanation` per signal and it is good prose,
 * but it answers exactly one question: WHAT was detected. An investigator
 * reading a score needs four answers, and the other three were nowhere on the
 * old screen:
 *
 *   1. What was detected          -> signal.explanation, from the backend
 *   2. Why that matters           -> authored here, per rule
 *   3. How much it moved the score-> COMPUTED from scoring.js contributions
 *   4. How sure we are            -> signal.confidence, restated without jargon
 *
 * (2) is authored rather than derived because "why a funnel pattern is
 * suspicious" is domain knowledge, not something in the payload. It is keyed on
 * the rule id with a category-level fallback, so a rule that does not exist yet
 * still gets a true, if general, answer instead of an empty panel.
 *
 * (3) is deliberately NOT authored. A written claim about importance drifts from
 * the arithmetic the moment a weight moves; the number is read off the same
 * `contributions` array the composition chart draws, so the sentence and the bar
 * cannot disagree.
 *
 * ## On "increased or decreased the score"
 *
 * Nothing here reports a signal that lowered a score, because under the scoring
 * model in scoring.js no signal can. Categories combine by saturating OR, so
 * evidence only ever accumulates, and weights only ever attenuate a category's
 * contribution towards zero. A severity-0 signal (ransomware.group_context is
 * one) therefore contributes exactly nothing and is reported as context rather
 * than as a reduction. Inventing a "this lowered the score by 4" sentence to
 * satisfy a symmetry the model does not have would be the worst kind of
 * plausible-sounding wrong.
 */

import { CATEGORY_LABELS } from './categories.js';

// ---------------------------------------------------------------------------
// Why each finding matters
// ---------------------------------------------------------------------------

/**
 * Written for a reader who understands money laundering but not Bitcoin.
 *
 * `plain` restates the finding without jargon -- it sits above the backend's own
 * explanation as a one-line answer for someone skimming. `matters` is the
 * investigative significance. `limits` is what the finding cannot establish,
 * and it is not optional politeness: a heuristic presented without its false
 * positive mode is how an analyst ends up freezing a payroll wallet.
 */
export const SIGNAL_NOTES = {
  'sanctions.direct_hit': {
    plain: 'This exact address is on a US government sanctions list.',
    matters:
      'A sanctions designation is a legal fact, not an inference. For a US person or business, moving funds to or from this address can itself be an offence regardless of what the money was for. Everything else on this page is evidence about behaviour; this is the one finding that changes what you are permitted to do.',
    limits:
      'A listing describes the address, not necessarily whoever is holding the keys today. Confirm the entry is still current on the official list before acting.',
  },
  'ransomware.known_address': {
    plain: 'This address has been reported as a wallet used to collect ransom payments.',
    matters:
      'The address appears in a public dataset of wallets that victims paid after an extortion attack, attributed to a named ransomware family. That places it inside a criminal operation rather than merely near one, and it usually means at least one victim can be identified from the same records.',
    limits:
      'The dataset is crowdsourced from victim and researcher reports. It is strong corroboration, not a court finding, and an address can be reported in error.',
  },
  'ransomware.group_context': {
    plain: 'Background intelligence exists on the criminal group linked to this address.',
    matters:
      'This adds who you are likely dealing with -- how the group operates, how many victims are on record, when it was active. It is useful for building the narrative around a case and for deciding who to notify, and it is why a family name appears elsewhere on this page.',
    limits:
      'Context about a group is not evidence about this address. It carries no weight in the score and should not be cited as though it were a finding.',
  },
  'counterparty.flagged_neighbor': {
    plain: 'This address traded directly with one or more addresses that are themselves flagged.',
    matters:
      'A direct transaction is the strongest link the chain can show short of a listing on the address itself. Funds moved between this wallet and a known bad one with nothing in between, so there is no intermediate party to absorb the explanation.',
    limits:
      'Receiving funds is not the same as choosing to. A merchant, exchange or donation address can be paid by anyone, so check the direction of flow and whether this wallet looks like a service before drawing a conclusion.',
  },
  'counterparty.two_hop': {
    plain: 'A flagged address sits two steps away, with one wallet in between.',
    matters:
      'One intermediate wallet is the shortest hop a launderer can add, and it is cheap -- a single pass-through address defeats a naive direct-match check. Proximity at two hops is worth investigating, particularly when the middle wallet does nothing but forward funds.',
    limits:
      'At two hops the link is circumstantial. Busy wallets are two hops from almost everything, so weigh this against how many counterparties the intermediary has.',
  },
  'counterparty.shared_counterparty': {
    plain: 'This address and a flagged address both dealt with the same third party.',
    matters:
      'No funds moved between the two, but they share a correspondent. That pattern shows up when several wallets belong to one operator, or when both are customers of the same service, and it is a useful lead for clustering.',
    limits:
      'This is the weakest link on the page and no money changed hands along it. A shared exchange or mixer connects millions of unrelated addresses.',
  },
  'obfuscation.self_peel': {
    plain: 'Funds were moved through a long chain of the wallet\u2019s own addresses, shedding a little at each step.',
    matters:
      'Peeling is a manual laundering technique: a large balance is walked through a series of transactions, splitting off a small payment each time while the bulk moves on. It exists to make an automated trace expensive, and it is deliberate -- ordinary spending does not produce this shape.',
    limits:
      'Wallet software also produces change outputs that can look similar. The pattern is suggestive on its own and convincing only in volume.',
  },
  'obfuscation.rapid_forward': {
    plain: 'Money arrived and left again almost immediately, rather than being held.',
    matters:
      'A wallet that keeps nothing is a relay, not a destination. Fast pass-through is the standard way collected funds are moved towards cash-out, and it means the address you are looking at is a waypoint -- the counterparties on the outbound side are likely to matter more than this one.',
    limits:
      'Exchange hot wallets, payment processors and consolidation sweeps behave the same way at far greater volume.',
  },
  'profile.collection_pattern': {
    plain: 'Many different senders paid in, very few recipients were paid out, and the balance was emptied.',
    matters:
      'This is the shape of a collection wallet. Extortion, fraud and investment scams all produce it: a crowd of unrelated victims paying one address, which is then drained to a small number of onward wallets. The number of distinct senders is often the number of victims.',
    limits:
      'Donation addresses, crowdfunding and small merchants produce the same funnel. What separates them is usually who the payers are, not the shape.',
  },
  'profile.burst_then_dormant': {
    plain: 'Nearly all the money arrived inside one short window, and the address has been unused since.',
    matters:
      'Campaign-shaped activity. A wallet that fills over a few weeks and then goes silent matches an operation with a start and an end -- an extortion campaign, a scam run, a single fraudulent offering -- rather than an account somebody uses.',
    limits:
      'It is equally the shape of a one-off sale, a closed fundraiser, or a wallet whose owner simply moved on.',
  },
  'profile.round_value_payments': {
    plain: 'Repeated incoming payments landed on suspiciously round amounts.',
    matters:
      'Round figures mean somebody was told a price. Organic payments follow the cost of goods and land on arbitrary amounts; demanded payments cluster on the number in the demand. Repetition is what makes it meaningful -- one round payment is a coincidence, fifteen is a tariff.',
    limits:
      'Weakest signal in the set. Fixed-price services, subscriptions and tipping conventions all cluster on round numbers.',
  },
};

/** Category-level fallback, so an unrecognised future rule still says something true. */
export const CATEGORY_NOTES = {
  sanctions: {
    plain: 'This address matched an official sanctions dataset.',
    matters:
      'Sanctions findings carry legal consequences rather than merely investigative ones, which is why they are treated as the most serious category on this page.',
    limits: 'Verify the entry against the issuing authority before acting on it.',
  },
  ransomware: {
    plain: 'This address was matched against ransomware intelligence.',
    matters:
      'Ransomware findings tie an address to a specific criminal operation, which usually means identifiable victims and a known playbook.',
    limits: 'Attribution comes from reported data and is corroboration, not proof.',
  },
  obfuscation: {
    plain: 'The way funds moved through this address looks designed to be hard to follow.',
    matters:
      'Obfuscation findings describe technique rather than identity. They suggest somebody expected to be traced, which is itself informative about intent.',
    limits: 'Normal wallet software and services can produce similar patterns.',
  },
  transaction_profile: {
    plain: 'The overall pattern of this address\u2019s activity matches a known criminal shape.',
    matters:
      'Profile findings describe how the address behaves rather than who it is. They are how a wallet with no list match still comes to attention.',
    limits: 'Behavioural shapes have legitimate look-alikes; corroborate before relying on one.',
  },
  counterparty: {
    plain: 'This address is connected to other addresses that are flagged.',
    matters:
      'Guilt by association is weak on its own and strong in combination. What matters is how close the connection is and which direction the funds moved.',
    limits: 'Anyone can send funds to any address without the recipient\u2019s involvement.',
  },
};

/** Notes for a signal: rule-specific if we have them, otherwise category-level. */
export function notesFor(signal) {
  return (
    SIGNAL_NOTES[signal?.id] ??
    CATEGORY_NOTES[signal?.category] ?? {
      plain: 'A risk rule matched this address.',
      matters:
        'This finding comes from a rule this interface does not have a written description for. The technical detail below is the authoritative record of what matched.',
      limits: null,
    }
  );
}

// ---------------------------------------------------------------------------
// Confidence, in plain words
// ---------------------------------------------------------------------------

export const CONFIDENCE_NOTES = {
  high: {
    label: 'High confidence',
    meaning: 'A direct match against a named dataset. Treat this as established fact.',
    rank: 3,
  },
  medium: {
    label: 'Medium confidence',
    meaning:
      'Inferred from how addresses group together rather than read from a list. The pattern is real; the attribution may be incomplete.',
    rank: 2,
  },
  low: {
    label: 'Low confidence',
    meaning:
      'A behavioural heuristic. It fires on some entirely legitimate activity, so corroborate it before acting on it.',
    rank: 1,
  },
};

export const confidenceNote = (confidence) =>
  CONFIDENCE_NOTES[confidence] ?? CONFIDENCE_NOTES.medium;

// ---------------------------------------------------------------------------
// Influence on the score
// ---------------------------------------------------------------------------

/**
 * Bands for a finding's SHARE OF THE POINTS. The wording matters more than the
 * cut points, and getting it wrong was a real bug caught in review.
 *
 * The first version of this used bare adjectives -- "Decisive", "Major",
 * "Moderate", "Minor". Against the fixture that labelled the OFAC sanctions
 * listing, which is the most legally consequential fact the tool can report,
 * as "Moderate": it contributes 24.9% of the points, a whisker under the 25%
 * cut. The arithmetic was right and the sentence was misleading, because a bare
 * adjective next to a finding reads as a claim about how much that finding
 * MATTERS, while the number underneath measures only how the total was divided
 * up. Those are different quantities and this app must not conflate them.
 *
 * Two changes. Every label now says "share", so it describes the thing it
 * actually measures. And the largest contributor is named as such by rank
 * rather than by threshold, so the strongest finding is never demoted by a
 * cut point it happens to sit beneath.
 */
const INFLUENCE_BANDS = [
  { min: 0.25, label: 'Major share', tone: 'elevated' },
  { min: 0.1, label: 'Moderate share', tone: 'moderate' },
  { min: 0, label: 'Small share', tone: 'low' },
];

/**
 * A saturated score is why shares look flat, and saying so is the difference
 * between an honest percentage and a misleading one.
 *
 * When the score is already at its ceiling, no finding can claim a large share
 * of it: the points get divided among everything that contributed, so five
 * categories of evidence produce five modest-looking percentages. Without this
 * note a reader compares 24.9% against 100 and concludes the listing was a
 * minor part of the picture, which is the opposite of true.
 */
const SATURATED_AT = 99.95;

/**
 * How much one finding moved the score.
 *
 * @param {number} contribution  points this finding added, from scoring.js
 * @param {number} finalScore    the score those points add up to
 * @param {{isTop?: boolean}} [options]  whether this is the largest contributor
 * @returns {{points, share, label, tone, isContextOnly, saturated, sentence}}
 */
export function influence(contribution, finalScore, { isTop = false } = {}) {
  const points = Number.isFinite(contribution) ? contribution : 0;
  const total = Number.isFinite(finalScore) && finalScore > 0 ? finalScore : 0;
  const share = total > 0 ? points / total : 0;
  const saturated = total >= SATURATED_AT;

  if (points <= 0) {
    return {
      points: 0,
      share: 0,
      label: 'Context only',
      tone: 'neutral',
      isContextOnly: true,
      saturated,
      sentence:
        'Recorded but adds nothing to the score. It is background for the case, not evidence weighed in the assessment.',
    };
  }

  const band = INFLUENCE_BANDS.find((b) => share >= b.min) ?? INFLUENCE_BANDS.at(-1);
  const pct = Math.round(share * 100);

  const saturationNote = saturated
    ? ' The score is already at its ceiling of 100, so the points are divided among everything that contributed \u2014 a modest percentage here does not mean a modest finding.'
    : '';

  return {
    points,
    share,
    label: isTop ? 'Largest contributor' : band.label,
    tone: isTop ? 'high' : band.tone,
    isContextOnly: false,
    saturated,
    sentence: `Added ${round2(points)} points \u2014 ${pct}% of the ${round2(
      total,
    )} total.${saturationNote} Evidence only ever adds here; nothing on this page subtracts.`,
  };
}

const round2 = (n) => String(Math.round(n * 100) / 100);

/**
 * A note about the user's current lens, or null when the lens is neutral.
 *
 * Shown per signal because the weight applies to its whole category, and a
 * reader looking at one card has no other way to know its contribution has been
 * dialled down by a control several sections away.
 */
export function lensNote(category, weight) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w >= 1) return null;
  const label = CATEGORY_LABELS[category] ?? category;
  if (w <= 0) {
    return `${label} is switched off in your current lens, so this finding is excluded from the score entirely.`;
  }
  return `Your current lens counts ${label.toLowerCase()} at ${w.toFixed(
    1,
  )} of 1.0, so this finding contributes less than it would at full weight.`;
}

// ---------------------------------------------------------------------------
// The headline verdict
// ---------------------------------------------------------------------------

const BAND_VERDICT = {
  Low: 'Nothing found that would stop a transaction',
  Moderate: 'Worth a second look before proceeding',
  Elevated: 'Substantial exposure \u2014 do not proceed without review',
  High: 'Severe exposure \u2014 treat as compromised',
};

/**
 * One sentence naming the judgement and the reason for it.
 *
 * Built from the strongest contributor rather than from the band alone, because
 * "high risk" without a reason is the kind of output that gets ignored on the
 * second reading. Returns both halves separately so the interface can typeset
 * the judgement and the justification differently.
 */
export function verdict(result, signalCount = 0) {
  const band = result?.band ?? 'Low';
  const headline = BAND_VERDICT[band] ?? BAND_VERDICT.Low;

  if (!signalCount) {
    return {
      headline: 'No risk indicators detected',
      because:
        'Every category was checked and none matched. That is not proof the address is clean \u2014 only that no configured rule found anything.',
    };
  }

  const top = [...(result?.contributions ?? [])]
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)[0];

  if (!top) {
    return {
      headline,
      because: `${signalCount} ${
        signalCount === 1 ? 'finding was' : 'findings were'
      } recorded, but none of them carry weight under your current lens.`,
    };
  }

  const others = (result?.contributions ?? []).filter((c) => c.contribution > 0).length - 1;
  const driver = top.signal?.label ?? 'an unnamed finding';
  const tail =
    others > 0
      ? ` and ${others} other ${others === 1 ? 'finding' : 'findings'}`
      : '';

  return {
    headline,
    because: `Driven by ${lowerFirst(driver)}${tail}.`,
  };
}

const lowerFirst = (s) => {
  const text = String(s ?? '');
  // Only lower an ordinary capitalised word. ACRONYMS and proper nouns stay put,
  // so "OFAC SDN list" is not mangled into "oFAC".
  if (/^[A-Z][a-z]/.test(text)) return text.charAt(0).toLowerCase() + text.slice(1);
  return text;
};

// ---------------------------------------------------------------------------
// Evidence keys
// ---------------------------------------------------------------------------

/**
 * Plain-English gloss for the raw evidence keys the backend emits.
 *
 * The old build rendered these keys mechanically -- `window_unique_senders`
 * became "Window Unique Senders" -- which is a spelling change, not an
 * explanation. Keys without a gloss still fall back to the mechanical version,
 * so an unknown key is unexplained rather than missing.
 */
export const EVIDENCE_GLOSS = {
  matched_address: 'The address that matched the dataset.',
  entity: 'The person or organisation the listing names.',
  program: 'The sanctions programme the listing was made under.',
  listed_on: 'The date the designation was published.',
  list_size: 'How many entries were in the list that was searched.',
  dataset_size: 'How many entries were in the dataset that was searched.',
  family: 'The ransomware operation this address is attributed to.',
  reported_transactions: 'How many payments to this address victims or researchers reported.',
  first_reported_payment: 'Earliest reported payment to this address.',
  last_reported_payment: 'Most recent reported payment to this address.',
  group: 'The criminal group profile this attribution links to.',
  victim_count: 'Victims on record for this group, across all its addresses.',
  flagged_counterparties: 'Flagged addresses this one transacted with directly.',
  total_flagged_neighbors: 'How many flagged addresses were found adjacent to this one.',
  window_unique_senders: 'Distinct addresses that paid in, within the transactions examined.',
  window_unique_recipients: 'Distinct addresses paid out to, within the transactions examined.',
  window_balance: 'What was left over across the transactions examined.',
  window_received: 'Total received across the transactions examined.',
  window_share: 'Share of all value that arrived inside the flagged time window.',
  window_start: 'Start of the concentrated activity window.',
  window_end: 'End of the concentrated activity window.',
  payments_in_window: 'Payments received inside that window.',
  dormant_days: 'Days since the last activity on this address.',
  matches: 'The individual transactions that triggered this rule.',
  match_count: 'How many transactions triggered this rule.',
  match_share: 'Proportion of examined transactions that triggered this rule.',
  round_values_checked: 'The round figures the rule tested against.',
  tolerance: 'How close to a round figure a payment had to land to count.',
  links: 'The chain of transactions the rule followed.',
  link_count: 'How many steps long that chain was.',
  forwarded_value: 'Amount that left again shortly after arriving.',
  total_received: 'Total amount received.',
  forwarded_share: 'Proportion of received funds that was forwarded on.',
  examples: 'Sample transactions illustrating the pattern.',
  threshold: 'The cut-off this rule had to clear in order to fire.',
  profile_url: 'Where the group profile can be read in full.',
  asset: 'The cryptocurrency the listing covers.',
};

export const glossFor = (key) => EVIDENCE_GLOSS[key] ?? null;
