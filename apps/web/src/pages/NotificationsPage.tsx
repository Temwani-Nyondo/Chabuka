import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Building, CalendarClock, CircleX, Radio, Shield, Shirt as ShirtIcon, Ticket, Timer, Trophy, UserPlus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { describeNote, markAllRead } from '../lib/notifications';
import type { Note } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Skeleton, cx } from '../components/ui';

const PAGE = 30;

function iconFor(type: string): ReactNode {
  if (type === 'player_joined' || type.startsWith('team_join')) return <UserPlus size={18} />;
  if (type === 'lineup_published') return <ShirtIcon size={18} />;
  if (type === 'availability_requested') return <CalendarClock size={18} />;
  if (type.startsWith('team_')) return <Shield size={18} />;
  if (type === 'timekeeper_appointed') return <Timer size={18} />;
  if (type === 'circle_event') return <Radio size={18} />;
  if (type === 'poll_created') return <Shield size={18} />;
  if (type === 'game_cancelled') return <CircleX size={18} />;
  if (type === 'game_postponed') return <CalendarClock size={18} />;
  if (type.startsWith('scoreboard')) return <Timer size={18} />;
  if (type === 'game_result' || type === 'result_posted') return <Trophy size={18} />;
  if (type.startsWith('ticket')) return <Ticket size={18} />;
  if (type.includes('booking') || type.startsWith('venue')) return <Building size={18} />;
  return <Bell size={18} />;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      if (!user || !supabase) return;
      const { data, error: err } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (err) {
        setError(err.message);
        return;
      }
      const rows = (data ?? []) as Note[];
      setNotes((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setMore(rows.length === PAGE);
    },
    [user],
  );

  useEffect(() => {
    if (!user) return;
    // Keep this visit's unread highlighting, then mark everything read so the
    // badge clears.
    void load(0)
      .then(() => markAllRead(user.id))
      .finally(() => setLoading(false));
  }, [user, load]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups: { label: string; items: Note[] }[] = [
    { label: 'Today', items: notes.filter((n) => new Date(n.created_at) >= today) },
    { label: 'Earlier', items: notes.filter((n) => new Date(n.created_at) < today) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pt-4">
      <PageHeader title="Notifications" sub="Joins, bookings, results and news from your circles." />
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <Skeleton className="h-48" />
      ) : notes.length === 0 ? (
        <EmptyState icon={<Bell size={22} />} title="All quiet" body="When players join your games, bookings are answered or results come in, you will see it here." />
      ) : (
        groups.map((g) => (
          <section key={g.label} className="flex flex-col gap-2" aria-label={g.label}>
            <h2 className="m-0 text-[13px] font-bold uppercase tracking-[0.06em] text-muted">{g.label}</h2>
            <Card className="overflow-hidden">
              {g.items.map((n) => {
                const d = describeNote(n);
                const unread = n.read_at === null;
                const inner = (
                  <>
                    <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', unread ? 'bg-brand-soft text-brand-text' : 'bg-surface-2 text-muted')}>
                      {iconFor(n.type)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cx('text-[14px]', unread ? 'font-bold' : 'font-semibold')}>{d.title}</span>
                      {d.body ? <span className="text-[13px] text-muted">{d.body}</span> : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[12px] text-muted">{ago(n.created_at)}</span>
                      {unread ? <span className="h-2 w-2 rounded-full bg-brand" aria-label="New" /> : null}
                    </span>
                  </>
                );
                const cls = 'flex items-start gap-3 px-3.5 py-3 text-ink no-underline [&+&]:border-t [&+&]:border-line';
                return d.href ? (
                  <Link key={n.id} to={d.href} className={cx(cls, 'hover:bg-surface-2/60')}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} className={cls}>
                    {inner}
                  </div>
                );
              })}
            </Card>
          </section>
        ))
      )}
      {more ? (
        <Button className="self-center" onClick={() => void load(notes.length)}>
          Show older
        </Button>
      ) : null}
    </div>
  );
}
