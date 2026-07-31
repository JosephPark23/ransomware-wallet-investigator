/**
 * Presentation constants for the five risk categories.
 *
 * The category list itself lives in scoring.js -- this module only decides how
 * those categories LOOK. No React, so it can be imported from a plain node test.
 *
 * ## The palette
 *
 * These five colours are new. Before the waterfall there was no per-category
 * colour anywhere in the app: index.css defines four *band* tokens (low /
 * moderate / elevated / high), SignalCard has a four-step severity ramp and a
 * three-step confidence ramp, and SignalList renders category headings in plain
 * slate. All of those encode SEVERITY. None of them encode identity, and there
 * were never five of anything.
 *
 * So this is the app's first categorical palette, and it is deliberately kept
 * separate from the severity ramps: a bar is coloured by WHICH category it came
 * from, never by how bad it is. Bar length already carries magnitude.
 *
 * Steps are the reference dark-mode categorical slots, chosen as a set by
 * running every five-colour subset through the data-viz palette validator
 * against this app's actual chart surface (slate-900/60 over slate-950,
 * ~#0a1022). The winning set scores:
 *
 *   lightness band  PASS   all five within OKLCH L 0.48-0.67
 *   chroma floor    PASS   all five >= 0.10
 *   CVD separation  11.4   worst all-pairs (deutan), counterparty vs ransomware
 *   contrast        PASS   4.80:1 - 6.16:1 against the card
 *
 * 11.4 sits in the 8-12 "floor" band, which is only legal alongside a secondary
 * encoding, so the waterfall never leans on hue alone: every bar carries its own
 * x-axis label, a tooltip, and a row in the table view. No five-colour subset
 * reaches the >=12 target -- dichromatic colour space is two-dimensional and five
 * mutually separable hues do not fit in it. Re-run the validator before changing
 * any value here.
 */

/** Human-readable category names. */
export const CATEGORY_LABELS = {
  sanctions: 'Sanctions',
  ransomware: 'Ransomware',
  obfuscation: 'Obfuscation',
  transaction_profile: 'Transaction profile',
  counterparty: 'Counterparty',
};

/**
 * Identity colour per category, as a CSS custom property with a literal
 * fallback.
 *
 * ## Why a var() and not a hex
 *
 * The app now ships a light theme as well as a dark one, and the validated dark
 * palette above is unreadable on a white card -- #c98500 against #ffffff is
 * 2.6:1. Resolving the colour in CSS rather than in JS means the theme switch
 * needs no React state, no context and no re-render: the same `fill` attribute
 * paints correctly in both themes because the variable underneath it changed.
 *
 * The light values (declared in index.css) are the dark set moved down in
 * lightness with hue held constant. Holding hue is what preserves the
 * dichromatic separation the original validation measured -- CVD confusion lines
 * run through hue, so a uniform lightness shift cannot bring two of these
 * colours closer together, and the added lightness contrast can only help. The
 * pair is still worth re-running through the validator if any hue moves.
 *
 * The literal fallback is the dark value, so anything rendering this SVG outside
 * the app's stylesheet -- the poster export in tools/, a copied-out chart --
 * still gets a real colour instead of black.
 */
export const CATEGORY_COLORS = {
  sanctions: 'var(--cat-sanctions, #e66767)',
  ransomware: 'var(--cat-ransomware, #d95926)',
  obfuscation: 'var(--cat-obfuscation, #d55181)',
  transaction_profile: 'var(--cat-transaction_profile, #3987e5)',
  counterparty: 'var(--cat-counterparty, #c98500)',
};

/** Fallback for a category the backend invents later; grey reads as "unclassified". */
export const UNKNOWN_CATEGORY_COLOR = 'var(--cat-unknown, #64748b)';

export const categoryLabel = (category) => CATEGORY_LABELS[category] ?? category;
export const categoryColor = (category) => CATEGORY_COLORS[category] ?? UNKNOWN_CATEGORY_COLOR;
