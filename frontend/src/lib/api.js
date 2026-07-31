/**
 * Fetch wrapper for address risk lookups, with a fixture fallback.
 *
 * ## Where requests go
 *
 * By default, nowhere in particular: requests are made to the RELATIVE path
 * `/api/analyze`, which vite.config.js proxies to the backend on :8000 in dev
 * and which a reverse proxy handles in a deployment. Relative-by-default means
 * the common case needs no configuration and, because the browser sees a
 * same-origin request, no CORS preflight either.
 *
 * Set VITE_API_BASE_URL to point at a backend on another origin (a teammate's
 * machine, a tunnel). The backend's CORS allow-list is read from its own
 * CORS_ORIGINS environment variable, so both ends have to agree.
 *
 * Set VITE_USE_FIXTURE=1 to bypass the network entirely and serve
 * fixtures/sample.json. That is the offline demo path, and it is opt-in: an
 * earlier version made the fixture the DEFAULT whenever no base URL was set,
 * which meant a correctly-configured dev server silently showed canned data and
 * looked like it was working. Serving a fixture is a fallback, never a default.
 *
 * ## Failure behaviour
 *
 * This function always resolves. The backend contract says /api/analyze returns
 * HTTP 200 with a degraded body rather than an error status, so any non-200 or
 * transport failure is outside the contract -- the network, not the analysis.
 * Those degrade to the fixture with a reason attached, and the UI labels the
 * result as fixture-sourced. An aborted request is the one exception: it is
 * rethrown, because a superseded lookup is not a failure to report.
 */

import sampleFixture from '../../fixtures/sample.json';

const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '';
const USE_FIXTURE = String(import.meta.env?.VITE_USE_FIXTURE ?? '') === '1';

/** Source of a result, so the UI can be honest about where numbers came from. */
export const SOURCE_API = 'api';
export const SOURCE_FIXTURE = 'fixture';

/** Absolute when VITE_API_BASE_URL is set, relative (proxied) otherwise. */
const endpoint = (path) => (API_BASE ? `${API_BASE.replace(/\/$/, '')}${path}` : path);

const fixtureResult = (reason) => ({ data: sampleFixture, source: SOURCE_FIXTURE, reason });

/**
 * Look up risk signals for an address.
 * Always resolves -- transport failures degrade to the fixture rather than throw.
 *
 * @returns {Promise<{data: object, source: string, reason?: string}>}
 */
export async function fetchAddressRisk(address, { maxHops = 2, signal } = {}) {
  if (USE_FIXTURE) {
    return fixtureResult('VITE_USE_FIXTURE=1 — serving the local fixture, no network call.');
  }

  try {
    const res = await fetch(endpoint('/api/analyze'), {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ address, max_hops: maxHops }),
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status} ${res.statusText}`);
    return { data: await res.json(), source: SOURCE_API };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return fixtureResult(`Backend unreachable (${err.message}) — serving the local fixture.`);
  }
}

/**
 * Curated demo addresses from GET /api/demo.
 *
 * Resolves to an empty array on any failure. The caller falls back to its own
 * built-in list, so a backend without a curated set costs the demo picker
 * nothing -- it does not need to distinguish "endpoint missing" from "endpoint
 * returned nothing", because both mean the same thing here.
 */
export async function fetchDemoAddresses({ signal } = {}) {
  if (USE_FIXTURE) return [];
  try {
    const res = await fetch(endpoint('/api/demo'), { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return [];
  }
}
