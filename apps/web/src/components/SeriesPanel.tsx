import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Repeat } from 'lucide-react';
import { WEEK_DAYS } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchSeries } from '../lib/competitions';
import type { SeriesView } from '../lib/competitions';
import { dayLabel, timeLabel } from './GameCard';
import { Badge, Button, Card, ErrorNote, Section, cx } from './ui';

const LONG_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

// A game that belongs to a weekly series: when it repeats, the next games,
// "Join every week" for regulars, and Skip / End for the host.
export default function SeriesPanel({ seriesId, matchId, onChanged }: { seriesId: string; matchId: string; onChanged: () => void }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<SeriesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setView(await fetchSeries(token, seriesId));
  }, [token, seriesId]);

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the series.'));
  }, [load]);

  if (!view) return error ? <ErrorNote>{error}</ErrorNote> : null;

  const run = async (fn: (t: string) => Promise<unknown>, done: string) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await fn(token);
      await load();
      onChanged();
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const when = `${view.intervalWeeks === 2 ? 'Every other ' : 'Every '}${(LONG_DAYS[view.weekday] ?? WEEK_DAYS[view.weekday] ?? '').replace(/s$/, '')} at ${view.time}`;
  const upcoming = view.upcoming.filter((u) => u.matchId !== matchId).slice(0, 4);

  return (
    <Section title="Weekly game">
      <Card className="flex flex-col gap-3 p-3.5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
            <Repeat size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block">{when}</strong>
            <span className="text-[13px] text-muted">
              {view.status === 'ended' ? 'This series has ended.' : `${view.regulars} regular${view.regulars === 1 ? '' : 's'}${view.until ? ` · until ${new Date(view.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}`}
            </span>
          </span>
          {view.isRegular ? <Badge tone="brand">Regular</Badge> : null}
        </div>
        {upcoming.length ? (
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {upcoming.map((u) => (
              <Link
                key={u.matchId}
                to={`/games/${u.matchId}`}
                className={cx(
                  'flex shrink-0 flex-col items-center rounded-xl border border-line px-3 py-2 text-ink no-underline hover:bg-surface-2',
                  u.status === 'cancelled' && 'opacity-50 line-through',
                )}
              >
                <span className="text-[11px] font-bold uppercase text-brand-text">{dayLabel(u.startsAt)}</span>
                <span className="tnum text-[14px] font-extrabold">{timeLabel(u.startsAt)}</span>
              </Link>
            ))}
          </div>
        ) : null}
        {view.status === 'active' ? (
          <div className="flex flex-wrap gap-2">
            {!view.isHost ? (
              view.isRegular ? (
                <Button size="sm" disabled={busy} onClick={() => void run((t) => runAction('leave_series', { seriesId }, t), 'You’re no longer a regular. Games you joined stay joined.')}>
                  Stop joining every week
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => void run((t) => runAction('join_series', { seriesId }, t), 'You’re a regular: you’re in every upcoming week that has room.')}
                >
                  Join every week
                </Button>
              )
            ) : (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run((t) => runAction('skip_occurrence', { matchId, reason: 'Skipping this week' }, t), 'This week is off. Players who joined are told.')}
                >
                  Skip this week
                </Button>
                {confirmEnd ? (
                  <>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void run((t) => runAction('end_series', { seriesId }, t), 'Series ended. Games already listed still go ahead.')}>
                      End the series
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>
                    End series
                  </Button>
                )}
              </>
            )}
          </div>
        ) : null}
        {notice ? <span className="text-[13px] font-semibold text-brand-text">{notice}</span> : null}
        <ErrorNote>{error}</ErrorNote>
      </Card>
    </Section>
  );
}
