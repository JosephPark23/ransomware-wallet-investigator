import { useId } from 'react';

import { DEMO_ADDRESSES } from '../lib/demos.js';

/**
 * Curated demo addresses.
 *
 * The list is a prop: App.jsx supplies the backend's /api/demo set when it
 * arrives and the built-in fallback until then, so this component never has to
 * know which one it is holding. It defaults to the built-in list so it stays
 * renderable in isolation.
 *
 * Nothing here knows how many entries there are, so adding one is an array edit.
 * A <select> rather than a button row for the same reason: it stays usable at
 * one entry and at twenty.
 */
export default function DemoPicker({ onSelect, busy = false, demos = DEMO_ADDRESSES }) {
  const selectId = useId();
  const list = Array.isArray(demos) && demos.length > 0 ? demos : DEMO_ADDRESSES;

  if (list.length === 0) return null;

  const handleChange = (event) => {
    const demo = list.find((d) => d.id === event.target.value);
    if (demo) onSelect(demo);
    // Reset to the placeholder so re-picking the same entry fires onChange again.
    event.target.value = '';
  };

  return (
    <div>
      <label htmlFor={selectId} className="text-xs font-medium tracking-wider uppercase text-slate-400">
        Demo addresses
      </label>

      <select
        id={selectId}
        defaultValue=""
        onChange={handleChange}
        disabled={busy}
        className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="" disabled>
          Load a demo address…
        </option>
        {list.map((demo) => (
          <option key={demo.id} value={demo.id}>
            {demo.address.slice(0, 8)}… — {demo.label}
          </option>
        ))}
      </select>
    </div>
  );
}
