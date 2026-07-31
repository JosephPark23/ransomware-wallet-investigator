import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  Layers,
  Users,
  Wallet,
} from 'lucide-react';

import { formatBtcAmount, formatCount, formatDate } from '../lib/format.js';

/**
 * The `profile` object: what this address has actually done on-chain.
 *
 * This is the raw activity the signals were derived FROM, which is why it sits
 * near the bottom -- a reader arrives at the score first, then drills into the
 * signals, and only then asks "what does this address look like?". Several
 * signals quote these exact numbers in their evidence (the funnel pattern cites
 * window_unique_senders and window_unique_recipients; the burst pattern cites
 * the window dates), so the two have to agree on screen.
 *
 * ## Lifetime versus window -- the reason this card is split in two
 *
 * The backend caps chain retrieval at the 50 most recent transactions, so the
 * profile carries two kinds of number and they are NOT interchangeable:
 *
 *   - Lifetime, from the address-stats call: tx_count, total_received,
 *     total_sent, balance. These cover the whole history.
 *   - Window, derived from the retrieved transactions only: the dates, the
 *     unique counterparty counts, the active-day count.
 *
 * Presenting `window_first_seen` under a bare "First seen" label is a lie on any
 * busy address -- a 2013-era wallet with 10,000 transactions reports a first-seen
 * date from last month, because that is where the 50-transaction window starts.
 * The backend renamed these fields precisely so the frontend could not read them
 * as lifetime figures by accident; this card honours that by grouping them under
 * their own heading and stating the window size next to it.
 *
 * When `window_complete` is false the heading says so explicitly. When it is
 * true the window IS the whole history and the distinction is noted as such
 * rather than hidden, so the reader learns the caveat exists before meeting an
 * address where it bites.
 *
 * BTC amounts are rounded for display by lib/format.js. A total_received of
 * 7.99999999 is float accumulation in the backend, not a meaningfully precise
 * number -- printing it raw makes the reader do the rounding in their head and
 * invites them to distrust the rest of the page. Scoring never sees these
 * strings.
 */

const MISSING = <span className="text-slate-600 italic">Not recorded</span>;

/** One stat. `value` is already formatted, or null when the field is absent. */
function Stat({ Icon, label, value, hint }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      {/* Wraps rather than truncates. A clipped "Mar 1, 2024, 12:00 PM UTC" is
          the one value on this card a reader cannot reconstruct from context. */}
      <dd className="mt-1 text-sm font-medium tabular-nums text-slate-200" title={hint}>
        {value ?? MISSING}
      </dd>
    </div>
  );
}

const btcHint = (v) => (v === null || v === undefined ? undefined : `${v} BTC`);

export default function ProfileStats({ profile }) {
  if (!profile) return null;

  const {
    tx_count,
    total_received,
    total_sent,
    balance,
    window_txs,
    window_complete,
    window_first_seen,
    window_last_seen,
    window_received,
    window_sent,
    window_unique_senders,
    window_unique_recipients,
    window_active_days,
  } = profile;

  // `window_complete: true` is the default in the contract, so an older or
  // partial payload reads as complete rather than shouting a caveat it has no
  // evidence for. Truncation is only claimed when the backend says so.
  const truncated = window_complete === false;

  return (
    <section
      className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800"
      aria-label="Address activity profile"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
        Address profile
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        On-chain activity the signals above were derived from. Amounts are rounded for display.
      </p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Lifetime
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Stat Icon={Activity} label="Transactions" value={formatCount(tx_count)} />
        <Stat
          Icon={Wallet}
          label="Balance"
          value={formatBtcAmount(balance)}
          hint={btcHint(balance)}
        />
        <Stat
          Icon={ArrowDownLeft}
          label="Total received"
          value={formatBtcAmount(total_received)}
          hint={btcHint(total_received)}
        />
        <Stat
          Icon={ArrowUpRight}
          label="Total sent"
          value={formatBtcAmount(total_sent)}
          hint={btcHint(total_sent)}
        />
      </dl>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Analyzed window
        </h3>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formatCount(window_txs)}
          {truncated ? ' most recent transactions' : ' transactions'}
        </span>
      </div>
      <p className={`mt-1 text-xs ${truncated ? 'text-amber-300/80' : 'text-slate-500'}`}>
        {truncated
          ? 'The window is a sample, not the full history — these figures describe the retrieved transactions only, so the dates below are not the address’s true first and last activity.'
          : 'The window covers this address’s complete transaction history, so these figures are lifetime figures too.'}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* The two dates carry their raw ISO value on the <time> element, so a
            copy-paste out of the page is still machine-readable. */}
        <Stat
          Icon={CalendarClock}
          label={truncated ? 'Earliest in window' : 'First seen'}
          value={
            window_first_seen ? (
              <time dateTime={window_first_seen}>{formatDate(window_first_seen)}</time>
            ) : null
          }
          hint={window_first_seen ?? undefined}
        />
        <Stat
          Icon={CalendarClock}
          label={truncated ? 'Latest in window' : 'Last seen'}
          value={
            window_last_seen ? (
              <time dateTime={window_last_seen}>{formatDate(window_last_seen)}</time>
            ) : null
          }
          hint={window_last_seen ?? undefined}
        />
        <Stat Icon={Activity} label="Active days" value={formatCount(window_active_days)} />
        <Stat Icon={Users} label="Unique senders" value={formatCount(window_unique_senders)} />
        <Stat
          Icon={Users}
          label="Unique recipients"
          value={formatCount(window_unique_recipients)}
        />
        <Stat
          Icon={ArrowDownLeft}
          label="Received in window"
          value={formatBtcAmount(window_received)}
          hint={btcHint(window_received)}
        />
        <Stat
          Icon={ArrowUpRight}
          label="Sent in window"
          value={formatBtcAmount(window_sent)}
          hint={btcHint(window_sent)}
        />
      </dl>
    </section>
  );
}
