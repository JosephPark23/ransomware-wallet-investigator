import { useId, useState } from 'react';
import { AlertCircle, Loader2, Search } from 'lucide-react';

import { validateAddress } from '../lib/address.js';

/**
 * Address entry. Validates before it does anything else -- an address that
 * fails the format check is never handed to the API layer.
 *
 * The text itself is controlled by the parent so the demo picker can populate
 * it; the validation error is local, because only this component raises it.
 */
export default function AddressInput({ value, onChange, onAnalyze, busy = false }) {
  const [error, setError] = useState(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const submit = (event) => {
    event.preventDefault();

    const result = validateAddress(value);
    if (!result.ok) {
      setError(result.error);
      return; // Nothing is sent anywhere.
    }

    setError(null);
    // Hand on the normalised address (trimmed, bech32 lower-cased), not the raw text.
    onAnalyze(result.address);
  };

  const handleChange = (event) => {
    // Clear the error as soon as the user starts fixing it; re-validating on
    // every keystroke would flag a half-typed address as broken.
    if (error) setError(null);
    onChange(event.target.value);
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="text-xs font-medium tracking-wider uppercase text-slate-400">
        Bitcoin address
      </label>

      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={handleChange}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`min-w-0 flex-1 rounded-lg border bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 ${
            error
              ? 'border-red-500/60 focus-visible:ring-red-500/40'
              : 'border-slate-700 focus-visible:ring-sky-500/50'
          }`}
        />

        <button
          type="submit"
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          {busy ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </form>
  );
}
