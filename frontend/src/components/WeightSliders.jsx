import { useEffect, useRef } from 'react';

import { CATEGORY_LABELS } from '../lib/categories.js';
import { PRESETS, activePresetId } from '../lib/presets.js';
import { CATEGORIES, WEIGHT_MAX, WEIGHT_MIN } from '../lib/scoring.js';

/**
 * Category weight controls: four presets over five sliders.
 *
 * Extracted from App.jsx, which is where this panel used to live inline.
 */

/**
 * A range input that ignores the mouse wheel.
 *
 * Range inputs consume wheel events, so scrolling the page with the cursor over
 * a slider silently changes the weight -- and therefore the displayed score --
 * with no deliberate interaction. React registers wheel listeners passively at
 * the root, so preventDefault() only works from a directly attached
 * non-passive listener.
 */
function WeightSlider(props) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const blockWheel = (event) => event.preventDefault();
    el.addEventListener('wheel', blockWheel, { passive: false });
    return () => el.removeEventListener('wheel', blockWheel);
  }, []);

  return <input ref={ref} type="range" {...props} />;
}

/**
 * Preset buttons. Applying one is pure local state -- all five weights at once,
 * recomputed on the spot, no network call.
 *
 * `active` comes from comparing the live weights to each preset rather than from
 * remembering which button was last clicked, so dragging any slider afterwards
 * clears the highlight on its own. A lit button always means "this is exactly
 * what you are looking at".
 */
function PresetButtons({ weights, onApply }) {
  const active = activePresetId(weights);

  return (
    <div className="mt-3" role="group" aria-label="Weight presets">
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map((preset) => {
          const isActive = preset.id === active;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(preset)}
              aria-pressed={isActive}
              title={preset.description}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 ${
                isActive
                  ? 'bg-sky-500/15 text-sky-300 ring-sky-500/50'
                  : 'bg-slate-800/40 text-slate-400 ring-slate-700/60 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-slate-600 italic">
        {active
          ? PRESETS.find((p) => p.id === active).description
          : 'Custom weights — no preset applied.'}
      </p>
    </div>
  );
}

export default function WeightSliders({ weights, onChange, onApplyPreset, categories = [] }) {
  const meta = Object.fromEntries(categories.map((c) => [c.category, c]));

  return (
    <section className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
      <h2 className="text-xs font-medium tracking-wider uppercase text-slate-400">Category weights</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Set a weight to 0 to drop that category from the score entirely.
      </p>

      <PresetButtons weights={weights} onApply={onApplyPreset} />

      <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
        {CATEGORIES.map((category) => {
          const weight = weights[category];
          const info = meta[category];
          const muted = !info?.active;

          return (
            <div key={category}>
              <div className="flex items-baseline justify-between text-xs">
                <label htmlFor={`weight-${category}`} className={muted ? 'text-slate-600' : 'text-slate-300'}>
                  {CATEGORY_LABELS[category]}
                </label>
                <span className={`tabular-nums ${weight === 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                  {weight.toFixed(1)}
                </span>
              </div>
              <WeightSlider
                id={`weight-${category}`}
                min={WEIGHT_MIN}
                max={WEIGHT_MAX}
                step={0.1}
                value={weight}
                onChange={(e) => onChange(category, Number(e.target.value))}
                className="mt-1 w-full accent-sky-500"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
