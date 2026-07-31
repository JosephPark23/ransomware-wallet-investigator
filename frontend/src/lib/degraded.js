/**
 * Reading the response envelope: `degraded`, `warnings`, `cached`.
 *
 * No React, so it can be imported from a plain node test. The banner component
 * is layout only; every decision about WHETHER to warn and WHAT to list is
 * made here, because that is the part that has edge cases.
 *
 * contract.md rule 7: `degraded: true` means something failed but we answered
 * anyway. Show the banner and list `warnings`. It does not mean the results are
 * worthless -- so the banner qualifies the screen, it does not replace it.
 */

/**
 * Normalised degraded state for a response.
 *
 * @returns {{degraded: boolean, warnings: string[]}}
 */
export function degradedState(payload) {
  // Strictly `true`. A missing field, a null, or the string "true" from a
  // backend that stringified its JSON are all "not degraded" -- guessing here
  // would put a scary red banner over a perfectly good result.
  const degraded = payload?.degraded === true;

  const raw = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const warnings = raw
    .map((w) => (typeof w === 'string' ? w : String(w ?? '')).trim())
    .filter(Boolean);

  return { degraded, warnings };
}

/**
 * Whether the response came from the backend's cache.
 *
 * Same strictness as `degraded`, for the opposite reason: a "cached" badge on a
 * fresh result is a small lie about where the number came from, and provenance
 * is the whole point of this screen.
 */
export const isCached = (payload) => payload?.cached === true;
