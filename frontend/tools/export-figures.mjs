/**
 * Poster figure export -- four print-ready PNGs at 300 DPI.
 *
 *   node tools/export-figures.mjs
 *
 * Output lands in exports/ (gitignored). Nothing here is imported by the app;
 * this is a build-time tool, not part of the bundle.
 *
 * ## Where the numbers come from
 *
 * The figures are drawn from the SAME pure geometry the app draws from --
 * lib/scoring.js, lib/waterfall.js, lib/graphLayout.js, lib/format.js -- rather
 * than a re-implementation. That is the whole reason those modules have no React
 * in them. A poster that disagreed with the running demo standing next to it
 * would be worse than no poster.
 *
 * ## Why not screenshot the browser
 *
 * A viewport screenshot is 96 DPI and would need upscaling, which is exactly the
 * blur a poster shows off. Instead each chart is emitted as standalone SVG at a
 * viewBox in app-pixels, then rasterized at 3.125x (300/96) so every line is
 * computed at final resolution.
 *
 * Two of the four figures are NOT hand-drawn SVG in the app:
 *   - Waterfall  renders via Recharts. lib/waterfall.js supplies the bars; the
 *                axes, gridlines and reference line are redrawn here.
 *   - Score dial renders via Recharts RadialBarChart and has no geometry module,
 *                so its arc is computed here from the same start/end angles.
 *   - Evidence card is plain HTML/CSS with no vector source at all, so it is
 *                rendered as real HTML against the app's real compiled Tailwind
 *                CSS at 3.125x. That is the faithful high-DPI route for it.
 *
 * ## Consistency
 *
 * Every figure is 768 app-px wide on the same surface, with the same padding and
 * the same type scale -- and that scale is the APP's px sizes, so the SVG
 * figures and the HTML card agree. Heights vary with content; widths never do,
 * so the four stack on a board without looking mismatched.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_COLORS, categoryLabel } from '../src/lib/categories.js';
import { defaultWeights, scoreAddress } from '../src/lib/scoring.js';
import { axisMax, buildWaterfallRows, formatScore, renderedTotal, truncateLabel } from '../src/lib/waterfall.js';
import { buildGraphLayout } from '../src/lib/graphLayout.js';
import { flagLabel } from '../src/lib/flags.js';
import { formatBtc, formatDate, formatNumber, prettifyKey } from '../src/lib/format.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'exports');

const fixture = JSON.parse(readFileSync(join(root, 'fixtures', 'sample.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Shared design system
// ---------------------------------------------------------------------------

const DPI = 300;
/** CSS reference DPI. 300/96 is the factor everything is rasterized at. */
const SCALE = DPI / 96;

/** Every figure is this wide in app-px -> 2400 device px -> 8.00in at 300 DPI. */
const FIG_W = 768;
const PAD = 32;

/**
 * Surface. slate-900/60 over slate-950 is what the categorical palette in
 * categories.js was CVD-validated against, so the poster keeps that exact
 * backdrop rather than inventing a new one and invalidating the contrast work.
 */
const BG = '#0a1022';
const BORDER = '#1e293b'; // slate-800
const GRID = '#1e293b';
const TEXT = '#e2e8f0'; // slate-200
const TEXT_DIM = '#94a3b8'; // slate-400
const TEXT_FAINT = '#64748b'; // slate-500
const RULE = '#94a3b8';

const SANS = "'Segoe UI Variable Display','Segoe UI',system-ui,-apple-system,sans-serif";
const MONO = "'Cascadia Mono',Consolas,'Courier New',monospace";

/** Type scale, in app-px. Mirrors the Tailwind sizes the components use. */
const T = { eyebrow: 11, caption: 11, small: 12, body: 14, h2: 16, huge: 64 };

// ---------------------------------------------------------------------------
// OKLCH -> sRGB
//
// The band colours are declared once, as @theme tokens in src/index.css. They
// are read out of that file rather than copied here, so a token change moves the
// poster too. SVG consumers other than Chromium (Illustrator, InDesign) will not
// parse oklch(), so they are converted to hex on the way out.
// ---------------------------------------------------------------------------

function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // OKLab -> LMS (Ottosson)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  // LMS -> linear sRGB
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const encode = (u) => {
    const g = u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(g * 255)));
  };

  return `#${lin.map((u) => encode(u).toString(16).padStart(2, '0')).join('')}`;
}

/** Pull `--color-band-*: oklch(L C H)` out of src/index.css. */
function readBandColors() {
  const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
  const out = {};
  const re = /--color-band-([a-z]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g;
  for (const [, name, L, C, H] of css.matchAll(re)) {
    out[name] = oklchToHex(Number(L), Number(C), Number(H));
  }
  if (Object.keys(out).length !== 4) {
    throw new Error(`Expected 4 band tokens in src/index.css, found ${Object.keys(out).length}`);
  }
  return out;
}

const BAND_COLORS = readBandColors();
const bandColor = (band) => BAND_COLORS[String(band).toLowerCase()] ?? TEXT_DIM;

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const n = (v) => Math.round(Number(v) * 100) / 100;

function text(str, x, y, { size = T.body, fill = TEXT, anchor = 'start', weight = 400, family = SANS, spacing, rotate, opacity } = {}) {
  const attrs = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    `font-family="${family}"`,
    `font-size="${size}"`,
    `fill="${fill}"`,
    `font-weight="${weight}"`,
    anchor !== 'start' ? `text-anchor="${anchor}"` : '',
    spacing ? `letter-spacing="${spacing}"` : '',
    opacity !== undefined ? `opacity="${opacity}"` : '',
    rotate ? `transform="rotate(${rotate} ${n(x)} ${n(y)})"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')}>${esc(str)}</text>`;
}

/**
 * Greedy word wrap. SVG has no automatic text flow, so lines are measured with
 * an average glyph-width ratio -- approximate, but the figures are checked
 * visually after rasterizing, which is the only real test of a wrap.
 */
function wrap(str, maxWidth, size, ratio = 0.5) {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * ratio)));
  const words = String(str ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > perLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(str, x, y, maxWidth, { size = T.body, fill = TEXT_DIM, lineHeight = 1.55, ratio = 0.5, ...rest } = {}) {
  const lines = wrap(str, maxWidth, size, ratio);
  const svg = lines
    .map((line, i) => text(line, x, y + i * size * lineHeight, { size, fill, ...rest }))
    .join('');
  return { svg, height: lines.length * size * lineHeight, lines: lines.length };
}

/** Figure chrome: the shared surface every figure sits on. */
function figure(name, width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * SCALE)}" height="${Math.round(height * SCALE)}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${BG}"/>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="${BORDER}"/>
${body}
</svg>`;
  return { name, width: Math.round(width * SCALE), height: Math.round(height * SCALE), svg };
}

// ---------------------------------------------------------------------------
// Figure 1 -- the waterfall
// ---------------------------------------------------------------------------

function waterfallFigure(result) {
  const rows = buildWaterfallRows(result.contributions);
  const max = axisMax(renderedTotal(rows));

  const W = FIG_W;
  const H = 480;
  // The x-axis labels are rotated -35deg and anchored at their right end, so
  // each runs left and down from its tick, and the FIRST one reaches further
  // left than the axis does. The plot is inset far enough that a full-length
  // label still lands inside the figure: 22 chars is ~126px, ~103px of that
  // horizontal, against a first tick at ~135. Widening the margin rather than
  // truncating harder keeps the poster's labels identical to the screen's.
  const plot = { left: 100, right: W - PAD, top: 92, bottom: H - 140 };
  const plotW = plot.right - plot.left;
  const plotH = plot.bottom - plot.top;

  const yFor = (v) => plot.bottom - (v / max) * plotH;
  const slot = plotW / rows.length;
  const barW = slot * 0.62;

  let body = '';

  body += text('SCORE COMPOSITION', PAD, PAD + 10, { size: T.eyebrow, fill: TEXT_FAINT, weight: 600, spacing: 1.2 });
  body += paragraph(
    `Each bar is one signal's share of the score, largest first — stacking from 0 to the dial's ${formatScore(result.finalScore)}.`,
    PAD,
    PAD + 30,
    W - PAD * 2,
    { size: T.small, fill: TEXT_DIM },
  ).svg;

  // Gridlines + y-axis
  for (let v = 0; v <= max; v += 10) {
    const y = yFor(v);
    body += `<line x1="${n(plot.left)}" y1="${n(y)}" x2="${n(plot.right)}" y2="${n(y)}" stroke="${GRID}" stroke-width="0.75"/>`;
    body += text(String(v), plot.left - 8, y + 4, { size: T.caption, fill: TEXT_FAINT, anchor: 'end' });
  }

  // Bars
  rows.forEach((row, i) => {
    const x = plot.left + i * slot + (slot - barW) / 2;
    const top = yFor(row.cumulative);
    const height = Math.max(1, yFor(row.base) - top);
    const color = CATEGORY_COLORS[row.category] ?? TEXT_FAINT;

    body += `<rect x="${n(x)}" y="${n(top)}" width="${n(barW)}" height="${n(height)}" fill="${color}" rx="1.5"/>`;
    // Same helper, same default budget as the chart -- identical label text.
    body += text(truncateLabel(row.label), plot.left + i * slot + slot / 2, plot.bottom + 12, {
      size: T.caption,
      fill: TEXT_FAINT,
      anchor: 'end',
      rotate: -35,
    });
  });

  // The reference line is drawn at the DIAL's finalScore, not the chart's own
  // total, so a mismatch shows as a visible gap instead of quietly agreeing.
  const refY = yFor(result.finalScore);
  body += `<line x1="${n(plot.left)}" y1="${n(refY)}" x2="${n(plot.right)}" y2="${n(refY)}" stroke="${RULE}" stroke-width="1" stroke-dasharray="4 3"/>`;
  body += text(formatScore(result.finalScore), plot.right - 2, refY - 6, { size: T.caption, fill: RULE, anchor: 'end', weight: 600 });

  // Legend
  const active = [...new Set(rows.map((r) => r.category))];
  let lx = PAD;
  const ly = H - 34;
  for (const category of active) {
    const color = CATEGORY_COLORS[category] ?? TEXT_FAINT;
    body += `<circle cx="${n(lx + 4)}" cy="${n(ly - 4)}" r="4" fill="${color}"/>`;
    body += text(categoryLabel(category), lx + 14, ly, { size: T.caption, fill: TEXT_DIM });
    lx += 14 + categoryLabel(category).length * T.caption * 0.52 + 22;
  }

  return figure('waterfall', W, H, body);
}

// ---------------------------------------------------------------------------
// Figure 2 -- the score dial
//
// Recharts draws this as a RadialBarChart from 220deg to -40deg. Same angles
// here, as a stroked arc: a ring of constant thickness is what innerRadius 74%
// + outerRadius 100% produces, and an arc stroke is the simpler way to say it.
// ---------------------------------------------------------------------------

const START_ANGLE = 220;
const END_ANGLE = -40;

const polar = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  // SVG y grows downward, so the sine term is subtracted.
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
};

function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const largeArc = Math.abs(a0 - a1) > 180 ? 1 : 0;
  // Angles decrease, which is clockwise on screen once y is flipped.
  return `M ${n(x0)} ${n(y0)} A ${r} ${r} 0 ${largeArc} 1 ${n(x1)} ${n(y1)}`;
}

const BAND_RANGES = [
  ['Low', '0–24'],
  ['Moderate', '25–49'],
  ['Elevated', '50–74'],
  ['High', '75–100'],
];

function dialFigure(result) {
  const W = FIG_W;
  // Sized to the band chip's lower edge, not the arc's bounding box -- the arc
  // stops at 220deg/-40deg, so a square-ish canvas would leave a dead strip.
  const H = 344;
  const color = bandColor(result.band);
  const score = Math.max(0, Math.min(100, result.finalScore));

  const cx = 208;
  const cy = 214;
  const r = 108;
  const thickness = 24;
  const sweep = START_ANGLE - END_ANGLE;
  const valueEnd = START_ANGLE - sweep * (score / 100);

  let body = '';

  body += text('RISK SCORE', PAD, PAD + 10, { size: T.eyebrow, fill: TEXT_FAINT, weight: 600, spacing: 1.2 });

  // Track, then value.
  body += `<path d="${arcPath(cx, cy, r, START_ANGLE, END_ANGLE)}" fill="none" stroke="#243049" stroke-width="${thickness}" stroke-linecap="round"/>`;
  body += `<path d="${arcPath(cx, cy, r, START_ANGLE, valueEnd)}" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"/>`;

  // The number lives inside the dial; the arc is decoration around it.
  body += text(formatScore(result.finalScore), cx, cy + 18, { size: T.huge, fill: color, anchor: 'middle', weight: 600 });
  body += text('out of 100', cx, cy + 42, { size: T.small, fill: TEXT_FAINT, anchor: 'middle' });

  // Band chip
  const chipW = 108;
  const chipH = 30;
  body += `<rect x="${n(cx - chipW / 2)}" y="${n(cy + 58)}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.4"/>`;
  body += text(String(result.band).toUpperCase(), cx, cy + 58 + 20, { size: T.body, fill: color, anchor: 'middle', weight: 600, spacing: 1 });

  // Band table, right half. Always shows the number beside the band --
  // contract.md step 3, and the band alone hides a 25 from a 49.
  const tx = 420;
  let ty = 108;
  body += text('BANDS', tx, ty, { size: T.eyebrow, fill: TEXT_FAINT, weight: 600, spacing: 1.2 });
  ty += 26;
  for (const [name, range] of BAND_RANGES) {
    const isCurrent = name === result.band;
    body += text(name, tx, ty, {
      size: T.body,
      fill: isCurrent ? color : TEXT_FAINT,
      weight: isCurrent ? 600 : 400,
    });
    body += text(range, W - PAD, ty, {
      size: T.body,
      fill: isCurrent ? color : TEXT_FAINT,
      weight: isCurrent ? 600 : 400,
      anchor: 'end',
    });
    ty += 30;
  }

  const activeCount = result.categories.filter((c) => c.active).length;
  body += `<line x1="${tx}" y1="${n(ty)}" x2="${W - PAD}" y2="${n(ty)}" stroke="${BORDER}"/>`;
  body += paragraph(
    `Averaged over the ${activeCount} of ${result.categories.length} categories that produced a signal. Silent categories are excluded from the average.`,
    tx,
    ty + 22,
    W - PAD - tx,
    { size: T.small, fill: TEXT_FAINT },
  ).svg;

  return figure('score-dial', W, H, body);
}

// ---------------------------------------------------------------------------
// Figure 3 -- the counterparty graph
//
// A near-direct port of NetworkGraph.jsx, reading the same buildGraphLayout
// coordinates the component reads.
// ---------------------------------------------------------------------------

function graphFigure() {
  const HEAD = 96;
  const FOOT = 40;
  const layout = buildGraphLayout(fixture.graph, { width: FIG_W, paddingX: 112 });
  const W = FIG_W;
  const H = HEAD + layout.height + FOOT;

  let body = '';

  body += text('COUNTERPARTY GRAPH', PAD, PAD + 10, { size: T.eyebrow, fill: TEXT_FAINT, weight: 600, spacing: 1.2 });
  body += text(
    `${layout.nodes.length} addresses · ${layout.edges.length} flows`,
    W - PAD,
    PAD + 10,
    { size: T.caption, fill: TEXT_FAINT, anchor: 'end' },
  );
  body += paragraph('Colour is the flag; distance from the analysed address runs left to right.', PAD, PAD + 30, W - PAD * 2, {
    size: T.small,
    fill: TEXT_DIM,
  }).svg;

  body += `<g transform="translate(0 ${HEAD})">`;
  body += `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${TEXT_FAINT}"/></marker></defs>`;

  // Column headers
  for (let i = 0; i < layout.columns.length; i += 1) {
    const hop = layout.columns[i];
    const node = layout.nodes.find((nd) => nd.column === i);
    if (!node) continue;
    body += text(hop === 0 ? 'ANALYSED' : `${hop} HOP${hop === 1 ? '' : 'S'}`, node.x, 14, {
      size: T.caption,
      fill: TEXT_FAINT,
      anchor: 'middle',
      spacing: 0.8,
    });
  }

  for (const edge of layout.edges) {
    body += `<line x1="${n(edge.x1)}" y1="${n(edge.y1)}" x2="${n(edge.x2)}" y2="${n(edge.y2)}" stroke="${edge.toFlagged ? TEXT_FAINT : '#334155'}" stroke-width="${edge.toFlagged ? 1.6 : 1.1}" marker-end="url(#arrow)"/>`;
    if (edge.value !== null) {
      body += text(`${formatBtc(edge.value)} BTC`, edge.midX, edge.midY - 6, {
        size: T.caption,
        fill: TEXT_FAINT,
        anchor: 'middle',
      });
    }
  }

  for (const node of layout.nodes) {
    if (node.hop === 0) {
      body += `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="${n(node.r + 6)}" fill="none" stroke="${node.color}" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    }
    body += `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="${n(node.r)}" fill="${node.color}" fill-opacity="${node.flagged ? 0.9 : 0.5}" stroke="${node.color}" stroke-width="1.5"/>`;
    body += text(node.label, node.x, node.y + node.r + 15, { size: T.caption, fill: '#cbd5e1', anchor: 'middle', family: MONO });
    if (node.flagged) {
      body += text(node.parsedFlags.map((f) => flagLabel(f.raw)).join(' · '), node.x, node.y + node.r + 29, {
        size: T.caption,
        fill: node.color,
        anchor: 'middle',
        weight: 500,
      });
    }
  }
  body += `</g>`;

  // Legend, grouped by colour so two ransomware families share one swatch
  // rather than promising a distinction the chart cannot make.
  const groups = new Map();
  for (const node of layout.nodes) {
    for (const flag of node.parsedFlags) {
      const entry = groups.get(node.color) ?? { kind: flag.kind, families: new Set() };
      if (flag.family) entry.families.add(flag.family);
      groups.set(node.color, entry);
    }
  }

  const ly = H - 24;
  body += `<line x1="${PAD}" y1="${n(ly - 20)}" x2="${W - PAD}" y2="${n(ly - 20)}" stroke="${BORDER}"/>`;
  let lx = PAD;
  for (const [color, { kind, families }] of groups) {
    const label = families.size > 0 ? `${flagLabel(kind)} (${[...families].join(', ')})` : flagLabel(kind);
    body += `<circle cx="${n(lx + 4)}" cy="${n(ly - 4)}" r="4" fill="${color}"/>`;
    body += text(label, lx + 14, ly, { size: T.caption, fill: TEXT_DIM });
    lx += 14 + label.length * T.caption * 0.52 + 20;
  }
  body += `<circle cx="${n(lx + 4)}" cy="${n(ly - 4)}" r="4" fill="${TEXT_FAINT}" fill-opacity="0.5"/>`;
  body += text('No flags', lx + 14, ly, { size: T.caption, fill: TEXT_DIM });

  return figure('network-graph', W, H, body);
}

// ---------------------------------------------------------------------------
// Figure 4 -- the expanded evidence card
//
// SignalCard is HTML/CSS with no vector source, so this is emitted as real HTML
// against the app's compiled Tailwind CSS and rasterized at 3.125x. Same
// classes as the component, so the figure inherits the real styling instead of
// a hand-rebuilt approximation of it.
// ---------------------------------------------------------------------------

/** Locate the built stylesheet. The hash changes per build, so it is globbed. */
function findBuiltCss() {
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) return null;
  const css = readdirSync(assets).find((f) => f.endsWith('.css'));
  return css ? join(assets, css) : null;
}

/** Mirrors SignalCard's ScalarValue dispatch for the scalar cases OFAC uses. */
function evidenceValueHtml(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="text-slate-600 italic">Not recorded</span>';
  }
  if (typeof value === 'number') {
    return `<span class="tabular-nums text-slate-200">${esc(formatNumber(value))}</span>`;
  }
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return `<span class="text-slate-200">${esc(formatDate(str))}</span>`;
  }
  return `<span class="text-slate-200">${esc(str)}</span>`;
}

function evidenceCardHtml(signal, cssPath) {
  const rows = Object.entries(signal.evidence ?? {})
    .map(
      ([key, value]) => `
        <div class="flex flex-wrap gap-x-2 text-sm sm:grid sm:grid-cols-[minmax(0,11rem)_1fr]">
          <dt class="shrink-0 text-slate-500">${esc(prettifyKey(key))}</dt>
          <dd class="min-w-0">${evidenceValueHtml(value)}</dd>
        </div>`,
    )
    .join('');

  const retrieved = formatDate(signal.source?.retrieved_at);

  return `<!doctype html>
<meta charset="utf-8">
<title>Evidence card — ${esc(signal.id)}</title>
<link rel="stylesheet" href="file:///${cssPath.replace(/\\/g, '/')}">
<style>
  /* The figure surface, matching the SVG figures exactly. */
  html, body { margin: 0; background: ${BG}; }
  body { width: ${FIG_W}px; font-family: ${SANS}; }
  .figure { box-sizing: border-box; width: ${FIG_W}px; padding: ${PAD}px; border: 1px solid ${BORDER}; }
</style>
<body>
  <div class="figure">
    <p style="font-size:${T.eyebrow}px;letter-spacing:1.2px;font-weight:600;color:${TEXT_FAINT};margin:0 0 18px">
      EVIDENCE — HIGHEST-SEVERITY SIGNAL
    </p>

    <article class="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="font-medium text-slate-100">${esc(signal.label)}</h3>
          <span class="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/40">
            High confidence
          </span>
        </div>

        <p class="mt-1 text-sm leading-relaxed text-slate-400">${esc(signal.explanation)}</p>

        <div class="mt-3 flex items-center gap-3">
          <div class="h-1.5 w-28 overflow-hidden rounded-full bg-slate-800">
            <div class="h-full rounded-full bg-red-500" style="width:${Math.max(0, Math.min(100, signal.severity))}%"></div>
          </div>
          <span class="text-xs tabular-nums text-slate-400">
            severity <span class="font-medium text-slate-300">${signal.severity}</span>
          </span>
        </div>

        <div class="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <dl class="space-y-1.5">${rows}</dl>
        </div>

        <div class="mt-3 border-t border-slate-800/70 pt-2">
          <div class="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
            <span>Source:</span>
            <span class="text-sky-400 underline decoration-sky-400/40 underline-offset-2">${esc(signal.source.name)}</span>
            ${retrieved ? `<span class="text-slate-600">· retrieved ${esc(retrieved)}</span>` : ''}
          </div>
        </div>
      </div>
    </article>
  </div>
</body>`;
}

// ---------------------------------------------------------------------------
// PNG DPI metadata
//
// Chromium writes no pHYs chunk, so the file has pixel dimensions but no
// physical size and a layout tool places it at 96 DPI -- three times too big.
// Injecting pHYs makes the figure self-describing: drop it into InDesign or
// PowerPoint and it lands at 8in wide at 300 DPI without being resized by hand.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function stampDpi(pngPath, dpi) {
  const png = readFileSync(pngPath);
  // pixels per metre, rounded: 300 dpi -> 11811
  const ppm = Math.round(dpi / 0.0254);

  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data.writeUInt8(1, 8); // unit: metres

  const type = Buffer.from('pHYs', 'ascii');
  const chunk = Buffer.concat([
    Buffer.alloc(4),
    type,
    data,
    Buffer.alloc(4),
  ]);
  chunk.writeUInt32BE(data.length, 0);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 4 + 4 + data.length);

  // Walk chunks; drop any existing pHYs and insert ours before the first IDAT.
  let offset = 8; // past the signature
  const head = [png.subarray(0, 8)];
  let inserted = false;
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const name = png.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + len;
    if (name === 'pHYs') {
      offset = end;
      continue;
    }
    if (name === 'IDAT' && !inserted) {
      head.push(chunk);
      inserted = true;
    }
    head.push(png.subarray(offset, end));
    offset = end;
  }
  writeFileSync(pngPath, Buffer.concat(head));
}

// ---------------------------------------------------------------------------
// Rasterizing
// ---------------------------------------------------------------------------

function findBrowser() {
  if (process.env.EXPORT_BROWSER) return process.env.EXPORT_BROWSER;
  const candidates = [
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error('No Chrome or Edge found. Set EXPORT_BROWSER to a Chromium binary.');
  }
  return found;
}

function shoot(browser, url, pngPath, width, height, scale = 1) {
  execFileSync(
    browser,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--force-device-scale-factor=${scale}`,
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      url,
    ],
    { stdio: 'pipe', timeout: 90_000 },
  );
}

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;

// ---------------------------------------------------------------------------

function main() {
  mkdirSync(outDir, { recursive: true });

  const result = scoreAddress(fixture.signals, defaultWeights);
  const ofac = fixture.signals.find((s) => s.id === 'sanctions.direct_hit');
  if (!ofac) throw new Error('sanctions.direct_hit not found in the fixture');

  const svgFigures = [waterfallFigure(result), dialFigure(result), graphFigure()];
  const browser = findBrowser();
  const written = [];

  // --- SVG figures: viewBox in app-px, rasterized at exact device pixels ---
  for (const fig of svgFigures) {
    const svgPath = join(outDir, `${fig.name}.svg`);
    writeFileSync(svgPath, fig.svg, 'utf8');

    // A bare .svg loads centred with a white page behind it, so it is wrapped
    // in a page sized exactly to the figure with zero margin.
    const htmlPath = join(outDir, `.${fig.name}.html`);
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${BG}}svg{display:block}</style>${fig.svg}`,
      'utf8',
    );

    const pngPath = join(outDir, `${fig.name}.png`);
    shoot(browser, fileUrl(htmlPath), pngPath, fig.width, fig.height, 1);
    stampDpi(pngPath, DPI);
    written.push({ name: fig.name, width: fig.width, height: fig.height, vector: true });
  }

  // --- Evidence card: real HTML against the app's compiled CSS, at 3.125x ---
  const cssPath = findBuiltCss();
  if (!cssPath) {
    throw new Error('dist/assets/*.css not found. Run `npm run build` first — the evidence card figure needs the compiled Tailwind CSS.');
  }
  const cardHtmlPath = join(outDir, '.evidence-card.html');
  writeFileSync(cardHtmlPath, evidenceCardHtml(ofac, cssPath), 'utf8');

  // app-px. Measured off the rasterized output rather than guessed: this is the
  // card's natural height plus PAD above and below, so the figure's padding
  // matches the SVG figures' on every edge.
  const CARD_H = 458;
  const cardPng = join(outDir, 'evidence-card.png');
  shoot(browser, fileUrl(cardHtmlPath), cardPng, FIG_W, CARD_H, SCALE);
  stampDpi(cardPng, DPI);
  written.push({
    name: 'evidence-card',
    width: Math.round(FIG_W * SCALE),
    height: Math.round(CARD_H * SCALE),
    vector: false,
  });

  const inches = (px) => (px / DPI).toFixed(2);
  console.log(`\nexports/ — ${DPI} DPI, all ${Math.round(FIG_W * SCALE)}px (${inches(FIG_W * SCALE)}in) wide\n`);
  for (const f of written) {
    console.log(
      `  ${f.name.padEnd(15)} ${String(f.width).padStart(5)} x ${String(f.height).padStart(5)} px` +
        `   ${inches(f.width)} x ${inches(f.height)} in` +
        `   ${f.vector ? 'from SVG (+ .svg kept)' : 'from HTML + app CSS'}`,
    );
  }
  console.log(`\n  Score: ${formatScore(result.finalScore)} / ${result.band}`);
  console.log(`  Bars sum to: ${formatScore(renderedTotal(buildWaterfallRows(result.contributions)))}\n`);
}

main();
