import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Moon, Sun } from 'lucide-react';

/**
 * Shared primitives.
 *
 * Every panel, chip, disclosure and heading in the app comes from here. The old
 * build had two competing section-header treatments, five corner radii and four
 * different focus styles because each component styled itself from scratch;
 * centralising the handful of shapes that actually repeat is what makes visual
 * consistency the default rather than a thing to remember.
 */

// ---------------------------------------------------------------------------
// Band vocabulary. One definition, used by the arc, the chips and the copy.
// ---------------------------------------------------------------------------

export const BAND_META = {
  Low: { color: 'var(--band-low)', soft: 'var(--band-low-soft)', range: [0, 25] },
  Moderate: { color: 'var(--band-moderate)', soft: 'var(--band-moderate-soft)', range: [25, 50] },
  Elevated: { color: 'var(--band-elevated)', soft: 'var(--band-elevated-soft)', range: [50, 75] },
  High: { color: 'var(--band-high)', soft: 'var(--band-high-soft)', range: [75, 100] },
};

export const bandMeta = (band) => BAND_META[band] ?? BAND_META.Low;

// ---------------------------------------------------------------------------
// Panels and headings
// ---------------------------------------------------------------------------

/** A card. One radius, one border, one shadow, everywhere. */
export function Card({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag
      className={`rounded-lg border border-line bg-panel shadow-[var(--shadow-panel)] ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A top-level section of the investigation.
 *
 * `meta` is a fact about the section's contents -- a count, a state -- rather
 * than an ordinal. A number beside a heading should tell the reader something
 * they did not already know from the heading itself; "3" next to "Evidence"
 * does, "02" does not.
 */
export function Section({ id, title, meta, description, action, children, className = '' }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`scroll-mt-24 ${className}`}
      data-section={id}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`${id}-heading`} className="text-[1.35rem] leading-tight font-semibold tracking-[-0.015em]">
              {title}
            </h2>
            {meta && <span className="num text-[0.8125rem] text-ink-faint">{meta}</span>}
          </div>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </div>
        {action && <div className="no-print shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Small uppercase label above a group of values. */
export function Eyebrow({ children, className = '' }) {
  return (
    <div
      className={`text-[0.6875rem] font-semibold tracking-[0.12em] uppercase text-ink-faint ${className}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function Chip({ children, color, soft, className = '', title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium ${className}`}
      style={
        color
          ? { color, backgroundColor: soft ?? 'transparent', boxShadow: `inset 0 0 0 1px ${color}33` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

/**
 * The band, as a chip. Carries a filled dot as well as the colour so the band is
 * still distinguishable in greyscale and to a colour-blind reader -- the word
 * is doing the work, the colour only reinforces it.
 */
export function BandChip({ band, score, className = '' }) {
  const meta = bandMeta(band);
  return (
    <Chip color={meta.color} soft={meta.soft} className={className}>
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {band}
      {score !== undefined && <span className="num opacity-70">{score}</span>}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-sm text-[0.875rem] font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-55';

const VARIANTS = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover shadow-[var(--shadow-panel)]',
  secondary: 'border border-line-strong bg-panel text-ink hover:bg-hover',
  ghost: 'text-ink-muted hover:bg-hover hover:text-ink',
  quiet: 'text-accent hover:bg-accent-soft',
};

const SIZES = {
  sm: 'h-8 px-2.5',
  md: 'h-10 px-4',
  lg: 'h-12 px-6 text-[0.9375rem]',
};

export function Button({
  as: Tag = 'button',
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}) {
  return (
    <Tag className={`${BUTTON_BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Toggle button group. Used for weight presets and graph filters.
 * `aria-pressed` rather than a radio group: these are toggles that apply an
 * effect immediately, not a form field awaiting submission.
 */
export function Segmented({ options, value, onChange, label, size = 'sm' }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-md bg-sunken p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`${BUTTON_BASE} ${SIZES[size]} ${
              active
                ? 'bg-panel text-ink shadow-[var(--shadow-panel)]'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * Clipboard write with a settled state.
 *
 * The confirmation is the whole point: a copy button that looks identical
 * before and after being pressed gives the user no way to know it worked, and
 * they press it again. Falls back to a hidden textarea because
 * navigator.clipboard is unavailable on insecure origins, which includes an
 * IP-address dev server -- exactly where this gets demonstrated.
 */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          document.body.removeChild(area);
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
        return true;
      } catch {
        return false;
      }
    },
    [resetMs],
  );

  return { copied, copy };
}

export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', size = 'sm', variant = 'ghost', className = '' }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={`no-print ${className}`}
      onClick={() => copy(value)}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </Button>
  );
}

/** A Bitcoin address: monospace, wrapping, with the copy affordance attached. */
export function AddressText({ value, className = '', truncate = false }) {
  if (!value) return null;
  const shown = truncate && value.length > 22 ? `${value.slice(0, 10)}\u2026${value.slice(-8)}` : value;
  return (
    <span
      title={truncate ? value : undefined}
      className={`font-mono text-[0.875rem] tracking-tight ${truncate ? '' : 'break-all'} ${className}`}
    >
      {shown}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

/**
 * An accordion row.
 *
 * Chosen over hover cards and popovers for the evidence list, and the reasoning
 * generalises to every collapsed thing in the app: a hover card cannot be
 * opened on a touch screen, cannot hold four paragraphs and a data table, and
 * disappears the moment the reader moves the pointer towards the thing they
 * wanted to compare it with. A disclosure is keyboard-native, printable, and
 * two of them can be open at once -- which matters, because the task here is
 * corroborating one finding against another.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = '',
  summaryClassName = '',
  panelClassName = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={className} data-print-open={open ? '' : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 text-left ${summaryClassName}`}
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
        <span className="min-w-0 flex-1">{summary}</span>
      </button>
      {open && (
        <div id={id} className={`anim-fade ${panelClassName}`}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME_KEY = 'chainmark-theme';

export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'light',
  );

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* private browsing; the theme still applies for this session */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`}
      className="no-print w-8 px-0"
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Empty and warning states
// ---------------------------------------------------------------------------

export function Empty({ icon: Icon, title, children, tone = 'neutral' }) {
  const color = tone === 'good' ? 'var(--band-low)' : 'var(--ink-faint)';
  return (
    <div className="rounded-md border border-dashed border-line bg-sunken px-6 py-10 text-center">
      {Icon && (
        <Icon className="mx-auto mb-3 h-6 w-6" style={{ color }} aria-hidden="true" />
      )}
      <p className="font-medium text-ink">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-md text-[0.875rem] leading-relaxed text-ink-muted">
          {children}
        </p>
      )}
    </div>
  );
}

export function Note({ tone = 'neutral', icon: Icon, children, className = '' }) {
  const styles =
    tone === 'warn'
      ? { color: 'var(--warn)', background: 'var(--warn-soft)', borderColor: 'var(--warn-line)' }
      : { color: 'var(--ink-muted)', background: 'var(--s-sunken)', borderColor: 'var(--line)' };

  return (
    <div
      className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-[0.8125rem] leading-relaxed ${className}`}
      style={styles}
    >
      {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
