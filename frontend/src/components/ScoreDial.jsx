import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';

/**
 * The headline score gauge. Always renders the number next to the band -- the
 * band alone hides the difference between a 25 and a 49.
 */

const BAND_STYLES = {
  Low: {
    fill: 'oklch(0.72 0.15 155)',
    text: 'text-emerald-300',
    ring: 'ring-emerald-500/30',
    chip: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
    Icon: ShieldCheck,
  },
  Moderate: {
    fill: 'oklch(0.78 0.15 85)',
    text: 'text-amber-300',
    ring: 'ring-amber-500/30',
    chip: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
    Icon: ShieldQuestion,
  },
  Elevated: {
    fill: 'oklch(0.72 0.17 55)',
    text: 'text-orange-300',
    ring: 'ring-orange-500/30',
    chip: 'bg-orange-500/10 text-orange-300 ring-orange-500/30',
    Icon: ShieldAlert,
  },
  High: {
    fill: 'oklch(0.63 0.22 25)',
    text: 'text-red-300',
    ring: 'ring-red-500/30',
    chip: 'bg-red-500/10 text-red-300 ring-red-500/30',
    Icon: ShieldX,
  },
};

const BAND_RANGES = [
  ['Low', '0–24'],
  ['Moderate', '25–49'],
  ['Elevated', '50–74'],
  ['High', '75–100'],
];

export default function ScoreDial({ score = 0, band = 'Low', activeCategories = 0, totalCategories = 5 }) {
  const style = BAND_STYLES[band] ?? BAND_STYLES.Low;
  const { Icon } = style;
  const rounded = Math.round(score * 100) / 100;

  return (
    <section
      className={`rounded-2xl bg-slate-900/60 p-6 ring-1 ${style.ring}`}
      aria-label={`Risk score ${rounded} out of 100, band ${band}`}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        <Icon className={`h-4 w-4 ${style.text}`} aria-hidden="true" />
        Risk score
      </div>

      <div className="relative mx-auto mt-2 h-52 w-full max-w-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ name: band, value: Math.max(0, Math.min(100, score)) }]}
            innerRadius="74%"
            outerRadius="100%"
            startAngle={220}
            endAngle={-40}
            barSize={16}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              dataKey="value"
              angleAxisId={0}
              cornerRadius={8}
              fill={style.fill}
              background={{ fill: 'oklch(0.28 0.03 260)' }}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        {/* The number lives in the middle of the dial; the chart is decoration around it. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className={`text-5xl font-semibold tabular-nums ${style.text}`}>{rounded}</div>
          <div className="text-xs text-slate-500">out of 100</div>
          <div
            className={`mt-2 rounded-full px-3 py-1 text-sm font-medium uppercase tracking-wide ring-1 ${style.chip}`}
          >
            {band}
          </div>
        </div>
      </div>

      <ul className="mt-4 space-y-1 border-t border-slate-800 pt-3 text-xs">
        {BAND_RANGES.map(([name, range]) => (
          <li
            key={name}
            className={`flex justify-between ${name === band ? `font-medium ${style.text}` : 'text-slate-500'}`}
          >
            <span>{name}</span>
            <span className="tabular-nums">{range}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Averaged over the{' '}
        <span className="font-medium text-slate-400">
          {activeCategories} of {totalCategories}
        </span>{' '}
        {activeCategories === 1 ? 'category that produced' : 'categories that produced'} a signal. Silent
        categories are excluded from the average.
      </p>
    </section>
  );
}
