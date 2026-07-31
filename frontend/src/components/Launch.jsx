import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Database, Network, ShieldAlert } from 'lucide-react';

import { validateAddress } from '../lib/address.js';
import { Button, ThemeToggle } from './ui.jsx';

/**
 * First paint.
 *
 * ## Why there is a launch screen at all
 *
 * The old build ran an analysis on a hard-coded demo address before the user
 * had done anything, and arrived fully populated. Three costs: the user meets a
 * dashboard for an address they did not ask about, the address entry is
 * demoted to a strip at the top of a page already full of results, and the
 * first thing they read is a verdict about somebody else's wallet. The 10-20
 * second cost of a real analysis was also being spent before anyone asked for
 * it.
 *
 * So the app now opens on one question -- which address? -- and nothing else.
 * The input is autofocused, so a demonstrator can start typing or paste
 * immediately without reaching for the mouse.
 *
 * ## Where the demo addresses went
 *
 * They are still on this screen, because taking a first-time visitor to an
 * empty box and no way to see what the tool does would be worse than the
 * problem being fixed. What changed is their WEIGHT, not their presence:
 * attention is driven by size, contrast and colour saturation, not by whether
 * something is on the page. The Analyze button is the only saturated element
 * here; the examples are small, unfilled, text-weight links below the fold of
 * the input. They read as a footnote, which is what they are, and they stay one
 * click away for a live demo rather than two.
 *
 * ## The three lines under the heading
 *
 * They name what the tool does in the order it does it. This is the only place
 * in the app with room to explain itself, and "within a few seconds a viewer
 * should understand the purpose" is a requirement that a tagline alone does not
 * meet.
 */

const CAPABILITIES = [
  {
    icon: ShieldAlert,
    title: 'Screens against watchlists',
    body: 'Checks the address directly against OFAC sanctions data and crowdsourced ransomware payment records.',
  },
  {
    icon: Network,
    title: 'Follows the money outward',
    body: 'Maps counterparties up to two hops away and traces any route that reaches a flagged address.',
  },
  {
    icon: Database,
    title: 'Shows its working',
    body: 'Every point of the score is attributed to a named finding, and every finding to a dated source.',
  },
];

export default function Launch({ onAnalyze, demos = [], initialValue = '' }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const result = validateAddress(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onAnalyze(result.address);
  };

  return (
    <div className="anim-fade min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Wordmark />
        <ThemeToggle />
      </header>

      <main id="main" className="mx-auto max-w-6xl px-5 pb-20">
        <div className="mx-auto max-w-2xl pt-[8vh] text-center sm:pt-[12vh]">
          <p className="text-[0.75rem] font-semibold tracking-[0.16em] uppercase text-ink-faint">
            Bitcoin address risk analysis
          </p>
          <h1 className="anim-rise mt-4 text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[2.875rem]">
            Find out what an address has been involved in.
          </h1>
          <p className="anim-rise mx-auto mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-ink-muted" style={{ animationDelay: '60ms' }}>
            Paste a Bitcoin address to screen it for ransomware and sanctions exposure. Every finding
            is explained in plain English and traced back to a dated source.
          </p>
        </div>

        {/* --- The one thing to do on this screen. --- */}
        <form
          onSubmit={submit}
          noValidate
          className="anim-rise mx-auto mt-9 max-w-2xl"
          style={{ animationDelay: '120ms' }}
        >
          <label htmlFor={inputId} className="sr-only">
            Bitcoin address
          </label>
          <div
            className={`flex flex-col gap-2 rounded-lg border bg-panel p-2 shadow-[var(--shadow-lift)] transition-colors focus-within:border-accent sm:flex-row sm:items-center ${
              error ? 'border-[var(--band-high)]' : 'border-line-strong'
            }`}
          >
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={value}
              onChange={(event) => {
                if (error) setError(null);
                setValue(event.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
            />
            <Button type="submit" variant="primary" size="lg" className="shrink-0">
              Analyze address
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {/* Validation is announced, not merely coloured. */}
          <div aria-live="polite" className="min-h-6">
            {error && (
              <p
                id={errorId}
                className="mt-2 flex items-start gap-1.5 px-1 text-[0.8125rem]"
                style={{ color: 'var(--band-high)' }}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>

          {demos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1.5 px-1 text-[0.8125rem] text-ink-faint">
              <span>No address to hand? Try</span>
              {demos.slice(0, 6).map((demo, index) => (
                <span key={demo.id} className="flex items-baseline">
                  <button
                    type="button"
                    onClick={() => onAnalyze(demo.address)}
                    className="rounded-sm text-accent underline decoration-accent-line underline-offset-[3px] hover:decoration-accent"
                  >
                    {demo.label}
                  </button>
                  {index < Math.min(demos.length, 6) - 1 && <span aria-hidden="true">,</span>}
                </span>
              ))}
            </div>
          )}
        </form>

        <ul className="anim-rise mx-auto mt-16 grid max-w-4xl gap-x-10 gap-y-8 sm:grid-cols-3" style={{ animationDelay: '200ms' }}>
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="mt-2.5 text-[0.9375rem] font-semibold">{title}</h2>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-14 max-w-2xl text-center text-[0.8125rem] leading-relaxed text-ink-faint">
          This tool reports what public datasets and on-chain behaviour show. It does not establish
          who controls an address, and a clean result is not a clearance.
        </p>
      </main>
    </div>
  );
}

/**
 * The wordmark.
 *
 * The mark is a chain link whose final segment is broken out and highlighted --
 * the thing the tool does, which is finding the compromised link in a chain of
 * transactions. It is the only piece of pure decoration in the app and it earns
 * its place by being the subject rather than an abstract glyph.
 */
export function Wordmark({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 28 28" className="h-6 w-6 shrink-0" aria-hidden="true">
        <circle cx="7" cy="14" r="4.25" fill="none" stroke="var(--ink-faint)" strokeWidth="2" />
        <circle cx="14" cy="14" r="4.25" fill="none" stroke="var(--ink-faint)" strokeWidth="2" />
        <circle cx="21" cy="14" r="4.75" fill="var(--band-high)" />
      </svg>
      <span className={`font-semibold tracking-[-0.02em] ${compact ? 'text-[0.9375rem]' : 'text-[1.0625rem]'}`}>
        Chainmark
      </span>
    </div>
  );
}
