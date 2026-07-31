/**
 * Headless smoke test: boots the real app in jsdom and asserts the whole
 * investigation renders.
 *
 * The unit tests in tests/ cover the pure modules; nothing covered the
 * components, so a typo in a panel would ship green. This mounts the actual
 * bundle against a stubbed backend and walks a full session -- launch screen,
 * submit, loading state, results -- checking that each section appears and that
 * nothing logs an error.
 *
 * It also exercises the case the old build could not survive: a wallet with
 * sixty counterparties, where the previous layout produced a five-thousand-pixel
 * canvas. The assertion is not "it looks nicer", it is that the canvas stays
 * bounded AND that every flagged counterparty is still drawn.
 *
 * Run with `npm run smoke` (bundles with esbuild first).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const bundle = fs.readFileSync(new URL('../.smoke/app.js', import.meta.url), 'utf8');
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/sample.json', import.meta.url), 'utf8'));

/** A collection-address-shaped graph. The flagged nodes are the SMALLEST by
 *  value, so a value-only ranking would drop them. */
function crowdedGraph(count = 60, flagged = 3) {
  const nodes = [{ id: fixture.address, label: 'target', hop: 0, flags: [] }];
  const edges = [];
  for (let i = 0; i < count; i += 1) {
    const id = `1Counterparty${String(i).padStart(3, '0')}XXXXXXXXXXXXX`;
    nodes.push({ id, label: id.slice(0, 8), hop: 1, flags: i < flagged ? ['ofac'] : [] });
    edges.push({ source: fixture.address, target: id, value: i < flagged ? 0.001 : i + 1 });
  }
  return { nodes, edges };
}

function boot({ payload = fixture, delayMs = 0, url = 'https://demo.local/' } = {}) {
  const errors = [];
  const dom = new JSDOM(
    '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>',
    { url, runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const { window } = dom;

  window.console.error = (...a) => errors.push(a.join(' '));
  window.addEventListener('error', (e) => errors.push(e.message));

  // Browser APIs jsdom does not implement that the app legitimately uses.
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = async (u) => {
    const demo = String(u).includes('/api/demo');
    if (!demo && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { ok: true, status: 200, json: async () => (demo ? [] : payload) };
  };

  window.eval(bundle);
  return { window, errors, text: () => window.document.body.textContent.replace(/\s+/g, ' ') };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (name) => console.log(`  ok  ${name}`);

// --- A full session -------------------------------------------------------

{
  const { window, errors, text } = boot({ delayMs: 2000 });
  await wait(300);

  console.log('launch');
  assert.match(text(), /Find out what an address has been involved in/);
  pass('states its purpose');
  assert.equal(window.document.activeElement?.tagName, 'INPUT');
  pass('address input is focused');
  assert.doesNotMatch(text(), /Assessment/, 'the app analysed something nobody asked for');
  pass('nothing is analysed until asked');

  const input = window.document.querySelector('input[type="text"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, fixture.address);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document.querySelector('button[type="submit"]').click();
  await wait(900);

  console.log('analysing');
  assert.match(text(), /Retrieving transaction history/);
  pass('stages are named');
  const bar = window.document.querySelector('[role=progressbar]');
  assert.match(bar.getAttribute('aria-valuetext'), /^Estimated/);
  pass('progress is labelled as an estimate, not a measurement');
  assert.doesNotMatch(text(), /Score composition/, 'a stale result stayed on screen');
  pass('no stale result is shown while re-running');

  await wait(1800);

  console.log('results');
  for (const [name, probe] of [
    ['verdict is stated in a sentence', /Severe exposure/],
    ['plain-English lead on each finding', /This exact address is on a US government sanctions list/],
    ['why-it-matters facet', /Why it matters/],
    ['effect-on-score facet', /Effect on the score/],
    ['largest contributor named by rank', /Largest contributor/],
    ['saturation is explained', /does not mean a modest finding/],
    ['zero-contribution findings marked as context', /Context only/],
    ['routes to flagged addresses', /Routes to flagged addresses/],
    ['method is explained', /How the score is calculated/],
    ['sources are named', /OFAC SDN List/],
  ]) {
    assert.match(text(), probe, name);
    pass(name);
  }

  const ids = [...window.document.querySelectorAll('[data-section]')].map((s) => s.dataset.section);
  assert.deepEqual(ids, ['assessment', 'evidence', 'composition', 'network', 'profile', 'method']);
  pass('all six sections rendered in order');

  assert.equal(window.document.querySelectorAll('h1').length, 1);
  pass('exactly one h1');
  assert.match(window.location.search, /address=/);
  pass('the analysis is linkable');
  assert.match(
    window.document.querySelector('[aria-live="polite"].sr-only').textContent,
    /Analysis complete\. Score 100 out of 100, High risk, from 9 findings\./,
  );
  pass('the outcome is announced to assistive technology');
  assert.deepEqual(errors, []);
  pass('no console errors');
}

// --- The wallet that broke the old build ----------------------------------

{
  const { window, errors, text } = boot({
    payload: { ...fixture, graph: crowdedGraph() },
    url: `https://demo.local/?address=${fixture.address}`,
  });
  await wait(800);

  console.log('60-counterparty wallet');
  const svg = [...window.document.querySelectorAll('svg')].find((s) =>
    s.getAttribute('viewBox')?.startsWith('0 0 760'),
  );
  const height = Number(svg.getAttribute('viewBox').split(' ')[3]);

  // The unreduced layout is tallest-column * rowGap + padding: 60 * 82 + 88.
  assert.ok(height < 900, `graph canvas is ${height}px tall`);
  pass(`canvas bounded at ${height}px (unreduced would be ${60 * 82 + 88}px)`);

  assert.match(text(), /3 of 3 flagged \(all of them\)/);
  pass('every flagged counterparty is drawn, despite ranking last by value');
  assert.match(text(), /flagged addresses are never grouped/);
  pass('the invariant is stated to the reader, not just enforced in code');
  assert.ok([...svg.querySelectorAll('g[role=button]')].every((g) => g.getAttribute('tabindex') === '0'));
  pass('graph nodes are keyboard reachable');
  assert.deepEqual(errors, []);
  pass('no console errors');
}

console.log('\nsmoke render: all checks passed');
process.exit(0);
