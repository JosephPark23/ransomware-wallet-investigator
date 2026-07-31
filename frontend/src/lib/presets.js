/**
 * Weight presets -- named points of view on the same evidence.
 *
 * Pure data plus two pure functions, no React, so the numbers can be asserted
 * in a unit test. A preset is just a full set of the five category weights;
 * applying one is a local state change with no network call.
 *
 * Weights are attenuation factors in [0, 1] (see scoring.js). A point of view
 * is therefore expressed by holding the category you care about at 1.0 and
 * turning the others DOWN -- there is no way to turn one up past full. The
 * earlier presets used 2.5 and 3.0 on the assumption that weights amplified;
 * against the current operator those clamp to 1.0, which made three of the four
 * presets score identically. Every preset below keeps its emphasised category
 * at 1.0 and expresses emphasis through the others.
 */

import { CATEGORIES } from './scoring.js';

/**
 * Adding a preset is adding an array entry. Every preset must name all five
 * categories -- a partial preset would silently inherit whatever the sliders
 * happened to be on, which is not a reproducible point of view.
 */
export const PRESETS = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Every category counts equally.',
    weights: {
      sanctions: 1.0,
      ransomware: 1.0,
      obfuscation: 1.0,
      transaction_profile: 1.0,
      counterparty: 1.0,
    },
  },
  {
    id: 'compliance',
    label: 'Compliance officer',
    description: 'A sanctions listing is the finding that carries legal weight.',
    weights: {
      sanctions: 1.0,
      ransomware: 0.3,
      obfuscation: 0.3,
      transaction_profile: 0.3,
      counterparty: 0.3,
    },
  },
  {
    id: 'ransomware',
    label: 'Ransomware analyst',
    description: 'Family attribution and who the address paid, above all else.',
    weights: {
      sanctions: 0.4,
      ransomware: 1.0,
      obfuscation: 0.4,
      transaction_profile: 0.4,
      counterparty: 0.8,
    },
  },
  {
    id: 'behavioral',
    label: 'Behavioral',
    description: 'Ignore the lists; judge the address on how it actually moves funds.',
    weights: {
      sanctions: 0.2,
      ransomware: 0.2,
      obfuscation: 1.0,
      transaction_profile: 1.0,
      counterparty: 0.2,
    },
  },
];

/**
 * Slider steps are 0.1 and preset values are exactly representable, so equality
 * would work -- but a tolerance keeps this honest if either ever changes.
 */
const WEIGHT_EPSILON = 1e-9;

/** Look up a preset by id. */
export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? null;

/**
 * Which preset, if any, the current weights correspond to.
 *
 * Returns null the moment a slider is dragged away from a preset's values --
 * a highlighted button must mean "this is exactly what you are looking at",
 * never "this is roughly where you started".
 */
export function activePresetId(weights = {}) {
  const match = PRESETS.find((preset) =>
    CATEGORIES.every((category) => {
      const current = Number(weights?.[category]);
      return (
        Number.isFinite(current) && Math.abs(current - preset.weights[category]) < WEIGHT_EPSILON
      );
    }),
  );
  return match?.id ?? null;
}
