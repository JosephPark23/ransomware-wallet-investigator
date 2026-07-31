import { useEffect, useState } from 'react';

import { BAND_META, bandMeta } from './ui.jsx';

/**
 * The score, drawn as a calibrated instrument rather than a progress donut.
 *
 * ## What changed and why
 *
 * The previous dial showed a filled arc and, underneath it, a separate
 * four-row list of the band ranges. Those are the same information twice, and
 * splitting them means a reader looking at a needle at "62" has to move their
 * eyes down and do the comparison themselves to learn it is in the Elevated
 * band and how close it sits to the next gate.
 *
 * Here the bands ARE the scale. The thin outer track is divided into the four
 * ranges in their own colours, gate marks sit at 25, 50 and 75, and the value
 * arc is drawn against that scale. "62, Elevated, and closer to the High gate
 * than to the Moderate one" is now a single glance rather than a lookup, and
 * one element replaced two.
 *
 * ## Encoding
 *
 * Colour is reinforcement, never the message. The number is printed at full
 * size, the band is named in words, and the arc's own length carries the
 * magnitude -- so the reading survives greyscale, colour blindness, and a
 * projector with the contrast turned down.
 *
 * Hand-drawn SVG rather than a chart library: this is one arc and a handful of
 * ticks, it needs to animate on a stroke-dashoffset that Recharts does not
 * expose, and dropping the dependency here and in the composition panel removes
 * roughly half a megabyte from a bundle whose whole job is to feel immediate.
 */

const SIZE = 240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_VALUE = 84; // thick inner arc
const R_SCALE = 106; // thin outer band scale
const STROKE_VALUE = 18;
const STROKE_SCALE = 4;

/** Sweep, in degrees. 0 sits upper-left, 100 lower-right, open at the bottom. */
const START = 220;
const END = -40;

const angleFor = (value) => START + (clamp(value) / 100) * (END - START);
const clamp = (v) => Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));

function pointAt(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY - radius * Math.sin(rad)];
}

function arcPath(from, to, radius) {
  const [x1, y1] = pointAt(angleFor(from), radius);
  const [x2, y2] = pointAt(angleFor(to), radius);
  const large = Math.abs(angleFor(to) - angleFor(from)) > 180 ? 1 : 0;
  // Sweep flag 1: angles decrease as the value rises, which is clockwise on screen.
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}

/** Full arc length, for the dash-offset draw-on. */
const VALUE_ARC_LENGTH = (Math.abs(END - START) / 360) * 2 * Math.PI * R_VALUE;

export default function ScoreArc({ score = 0, band = 'Low', adjusted = false }) {
  const value = clamp(score);
  const meta = bandMeta(band);
  const shown = Math.round(value * 100) / 100;

  // Draw-on runs once per score change. Starting from the full offset and
  // transitioning to the target means the arc sweeps out to its value instead of
  // appearing at it, which is the one moment in this interface where motion
  // carries meaning: it shows the number being arrived at.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(frame);
  }, [value, band]);

  const offset = drawn ? VALUE_ARC_LENGTH * (1 - value / 100) : VALUE_ARC_LENGTH;

  return (
    <div className="relative mx-auto w-full max-w-[260px]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Risk score ${shown} out of 100, in the ${band} band (${meta.range[0]} to ${meta.range[1]}).`}
      >
        {/* --- Band scale. The thresholds, drawn where they apply. --- */}
        {Object.entries(BAND_META).map(([name, info]) => {
          const active = name === band;
          return (
            <path
              key={name}
              d={arcPath(info.range[0] + 0.6, info.range[1] - 0.6, R_SCALE)}
              fill="none"
              stroke={info.color}
              strokeWidth={active ? STROKE_SCALE + 2 : STROKE_SCALE}
              strokeOpacity={active ? 1 : 0.28}
              strokeLinecap="butt"
            />
          );
        })}

        {/* --- Gate marks at the band boundaries. --- */}
        {[25, 50, 75].map((gate) => {
          const [x1, y1] = pointAt(angleFor(gate), R_VALUE - STROKE_VALUE / 2 - 3);
          const [x2, y2] = pointAt(angleFor(gate), R_SCALE - STROKE_SCALE);
          return (
            <line
              key={gate}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--line-strong)"
              strokeWidth="1"
            />
          );
        })}
        {[0, 25, 50, 75, 100].map((gate) => {
          const [tx, ty] = pointAt(angleFor(gate), R_SCALE + 13);
          return (
            <text
              key={gate}
              x={tx}
              y={ty}
              textAnchor="middle"
              dominantBaseline="middle"
              className="num"
              fill="var(--ink-faint)"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
            >
              {gate}
            </text>
          );
        })}

        {/* --- Value track and value arc. --- */}
        <path
          d={arcPath(0, 100, R_VALUE)}
          fill="none"
          stroke="var(--s-sunken)"
          strokeWidth={STROKE_VALUE}
          strokeLinecap="round"
        />
        <path
          d={arcPath(0, 100, R_VALUE)}
          fill="none"
          stroke={meta.color}
          strokeWidth={STROKE_VALUE}
          strokeLinecap="round"
          strokeDasharray={VALUE_ARC_LENGTH}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16, 0.84, 0.44, 1)' }}
        />

        {/* --- The exact reading, marked on the scale. --- */}
        {value > 0 && (
          <line
            {...(() => {
              const [x1, y1] = pointAt(angleFor(value), R_VALUE - STROKE_VALUE / 2 - 2);
              const [x2, y2] = pointAt(angleFor(value), R_VALUE + STROKE_VALUE / 2 + 2);
              return { x1, y1, x2, y2 };
            })()}
            stroke="var(--s-panel)"
            strokeWidth="2.5"
            style={{ transition: 'all 900ms cubic-bezier(0.16, 0.84, 0.44, 1)' }}
          />
        )}
      </svg>

      {/* The number is the content; the arc is the scale it is read against. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-4">
        <div
          className="num font-mono text-[3.25rem] leading-none font-semibold tracking-tight"
          style={{ color: meta.color }}
        >
          {shown}
        </div>
        <div className="mt-1.5 text-[0.8125rem] font-semibold tracking-wide uppercase" style={{ color: meta.color }}>
          {band}
        </div>
        <div className="mt-0.5 text-[0.75rem] text-ink-faint">
          {adjusted ? 'adjusted lens' : 'of 100'}
        </div>
      </div>
    </div>
  );
}
