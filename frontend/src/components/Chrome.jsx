import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';

import { validateAddress } from '../lib/address.js';
import { Wordmark } from './Launch.jsx';
import { AddressText, BandChip, Button, CopyButton, ThemeToggle } from './ui.jsx';

/**
 * Persistent chrome for the investigation workspace.
 *
 * ## The top bar answers "what am I looking at"
 *
 * In the old build the analysed address appeared once, in a header that
 * scrolled away, while the score lived in a card several viewports up from
 * wherever the reader had got to. Two things must never leave the screen during
 * an investigation: which address this is, and what the verdict was. Both are
 * pinned here.
 *
 * ## The address input, after analysis
 *
 * Demoted to a compact field in the bar rather than removed. The brief asked
 * for the input to become secondary once results exist, and a search field in a
 * persistent bar is exactly that: available in one click from anywhere in the
 * document, taking a fraction of the space, and no longer competing with the
 * findings for the reader's first glance.
 */

export function TopBar({
  address,
  band,
  score,
  busy,
  demos,
  onAnalyze,
  summaryText,
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-panel/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0 })}
          className="no-print shrink-0 rounded-sm"
          aria-label="Back to top"
        >
          <Wordmark compact />
        </button>

        <div className="order-3 flex min-w-0 flex-1 basis-full items-center gap-2 sm:order-none sm:basis-auto">
          <span className="hidden text-[0.75rem] text-ink-faint sm:inline">Analysing</span>
          <AddressText value={address} truncate className="min-w-0 truncate text-ink-muted" />
          <CopyButton value={address} label="" copiedLabel="" className="w-7 px-0" />
        </div>

        {band && (
          <BandChip band={band} score={score} className="order-2 shrink-0 sm:order-none" />
        )}

        <div className="no-print order-last ml-auto flex items-center gap-1.5">
          <QuickSearch onAnalyze={onAnalyze} busy={busy} />
          <DemoMenu demos={demos} onSelect={onAnalyze} busy={busy} />
          {summaryText && (
            <CopyButton value={summaryText} label="Copy summary" variant="ghost" className="hidden lg:inline-flex" />
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/** Compact re-analysis field. Same validation path as the launch screen. */
function QuickSearch({ onAnalyze, busy }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const id = useId();

  const submit = (event) => {
    event.preventDefault();
    const result = validateAddress(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setValue('');
    onAnalyze(result.address);
  };

  return (
    <form onSubmit={submit} noValidate className="relative hidden sm:block">
      <label htmlFor={id} className="sr-only">
        Analyse a different address
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => {
          if (error) setError(null);
          setValue(event.target.value);
        }}
        placeholder="Another address"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? 'true' : undefined}
        className={`h-8 w-40 rounded-sm border bg-sunken py-1 pr-2 pl-8 font-mono text-[0.8125rem] text-ink outline-none transition-[width,border-color] duration-200 placeholder:font-sans placeholder:text-ink-faint focus:w-64 focus:border-accent lg:w-52 ${
          error ? 'border-[var(--band-high)]' : 'border-line'
        }`}
      />
      {busy && (
        <Loader2 className="absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-faint" aria-hidden="true" />
      )}
      {error && (
        <p role="alert" className="absolute top-full right-0 mt-1 w-64 rounded-sm border border-line bg-panel p-2 text-[0.75rem] shadow-[var(--shadow-pop)]" style={{ color: 'var(--band-high)' }}>
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Demo addresses in the workspace: an overflow menu.
 *
 * Discoverable, never a primary action, and out of the way of the analysis --
 * which is the whole point of moving them here from the panel they used to
 * share with the address input.
 */
function DemoMenu({ demos = [], onSelect, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (demos.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        Examples
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </Button>

      {open && (
        <div
          role="menu"
          className="anim-fade absolute top-full right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-md border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
        >
          {demos.map((demo) => (
            <button
              key={demo.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(demo.address);
              }}
              className="block w-full rounded-sm px-2.5 py-2 text-left hover:bg-hover"
            >
              <span className="block text-[0.8125rem] font-medium">{demo.label}</span>
              <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
                {demo.address}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Section navigation.
 *
 * ## Sections with a scrollspy, not tabs
 *
 * Tabs would show less at once, which is the obvious way to cut cognitive load.
 * They were rejected because the investigative task is corroboration: reading an
 * evidence item against the graph, or a profile figure against the finding that
 * cites it. Tabs make every one of those comparisons a round trip, and they also
 * break find-in-page, printing, and the ability to hand somebody one scrollable
 * artefact.
 *
 * So the analysis stays a single document, and simultaneous load is cut INSIDE
 * each section instead -- collapsed evidence, capped graphs, disclosed detail.
 * This rail buys back the thing tabs would have given: a visible map of what
 * exists, direct access to it, and a sense of place while scrolling.
 */
export function SectionNav({ sections }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter(Boolean);
    if (elements.length === 0) return undefined;

    // Bias the detection band towards the top of the viewport so the highlighted
    // entry is the section being READ, not merely the one occupying the most
    // pixels -- a tall section otherwise stays lit long after the reader has
    // moved past its heading.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-88px 0px -62% 0px', threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Sections of this analysis" className="no-print">
      {/* Wide: a vertical rail that stays put. */}
      <ul className="sticky top-24 hidden lg:block">
        {sections.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? 'true' : undefined}
                className={`flex items-baseline gap-2 border-l-2 py-1.5 pl-3 text-[0.875rem] transition-colors ${
                  current
                    ? 'border-accent font-medium text-ink'
                    : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-muted'
                }`}
              >
                <span className="min-w-0 flex-1">{section.label}</span>
                {section.count !== undefined && section.count !== null && (
                  <span className="num text-[0.75rem] text-ink-faint">{section.count}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>

      {/* Narrow: a horizontally scrollable strip pinned under the top bar. */}
      <div className="sticky top-[3.4rem] z-30 -mx-4 border-b border-line bg-page/90 px-4 backdrop-blur-md lg:hidden">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((section) => {
            const current = section.id === active;
            return (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${section.id}`}
                  aria-current={current ? 'true' : undefined}
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors ${
                    current ? 'bg-accent-soft font-medium text-accent' : 'text-ink-faint'
                  }`}
                >
                  {section.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
