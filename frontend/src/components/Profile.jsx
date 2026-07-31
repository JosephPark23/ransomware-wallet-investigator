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
import { Card, Eyebrow, Note, Section } from './ui.jsx';

/**
 * What this address has actually done on chain.
 *
 * The lifetime-versus-window split from the previous build is preserved intact,
 * because it is the most important correctness detail on this card and it is
 * easy to lose in a redesign. The backend caps chain retrieval at the fifty most
 * recent transactions, so two different kinds of number arrive in one object:
 *
 *   Lifetime  tx_count, total_received, total_sent, balance -- the whole history
 *   Window    the dates, the unique counterparty counts, the active-day count --
 *             derived only from the transactions that were retrieved
 *
 * Printing `window_first_seen` under a bare "First seen" label is a lie on any
 * busy address: a 2013 wallet with ten thousand transactions reports a
 * first-seen date from last month, because that is where the fifty-transaction
 * window starts. The two groups therefore keep separate headings, the window
 * states its own size, and the labels change wording when the window is a
 * sample rather than the full history.
 *
 * What changed is only presentation: the caveat used to be a paragraph of amber
 * body text competing with the figures, and is now a labelled note attached to
 * the group it qualifies.
 */

const MISSING = <span className="text-ink-faint italic">Not recorded</span>;

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[0.75rem] text-ink-faint">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="num mt-1 text-[0.9375rem] font-medium text-ink" title={hint}>
        {value ?? MISSING}
      </dd>
    </div>
  );
}

const btcHint = (v) => (v === null || v === undefined ? undefined : `${v} BTC`);

export default function Profile({ profile }) {
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

  // `window_complete: true` is the contract's default, so an older payload reads
  // as complete rather than shouting a caveat it has no evidence for.
  const truncated = window_complete === false;

  return (
    <Section
      id="profile"
      title="Wallet profile"
      description="The on-chain activity the findings above were derived from. Amounts are rounded for display."
    >
      <Card className="p-5 sm:p-6">
        <Eyebrow>Lifetime</Eyebrow>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat icon={Activity} label="Transactions" value={formatCount(tx_count)} />
          <Stat icon={Wallet} label="Balance" value={formatBtcAmount(balance)} hint={btcHint(balance)} />
          <Stat icon={ArrowDownLeft} label="Total received" value={formatBtcAmount(total_received)} hint={btcHint(total_received)} />
          <Stat icon={ArrowUpRight} label="Total sent" value={formatBtcAmount(total_sent)} hint={btcHint(total_sent)} />
        </dl>

        <div className="mt-7 border-t border-line pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Eyebrow>Analysed window</Eyebrow>
            <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-faint">
              <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="num">{formatCount(window_txs)}</span>
              {truncated ? ' most recent transactions' : ' transactions'}
            </span>
          </div>

          <Note tone={truncated ? 'warn' : 'neutral'} className="mt-2.5">
            {truncated
              ? 'This window is a sample, not the full history. The figures below describe only the transactions retrieved, so the dates are not this address\u2019s true first and last activity.'
              : 'This window covers the address\u2019s complete transaction history, so these figures are lifetime figures too.'}
          </Note>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            <Stat
              icon={CalendarClock}
              label={truncated ? 'Earliest in window' : 'First seen'}
              value={window_first_seen ? <time dateTime={window_first_seen}>{formatDate(window_first_seen)}</time> : null}
              hint={window_first_seen ?? undefined}
            />
            <Stat
              icon={CalendarClock}
              label={truncated ? 'Latest in window' : 'Last seen'}
              value={window_last_seen ? <time dateTime={window_last_seen}>{formatDate(window_last_seen)}</time> : null}
              hint={window_last_seen ?? undefined}
            />
            <Stat icon={Activity} label="Active days" value={formatCount(window_active_days)} />
            <Stat icon={Users} label="Unique senders" value={formatCount(window_unique_senders)} />
            <Stat icon={Users} label="Unique recipients" value={formatCount(window_unique_recipients)} />
            <Stat icon={ArrowDownLeft} label="Received in window" value={formatBtcAmount(window_received)} hint={btcHint(window_received)} />
            <Stat icon={ArrowUpRight} label="Sent in window" value={formatBtcAmount(window_sent)} hint={btcHint(window_sent)} />
          </dl>
        </div>
      </Card>
    </Section>
  );
}
