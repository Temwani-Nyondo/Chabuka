import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { describeNote, markAllRead } from '../lib/notifications';
import type { Note } from '../lib/notifications';
import { supabase } from '../lib/supabase';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !supabase) return;
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase!
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (cancelled) return;
      if (err) setError(err.message);
      else {
        // Keep this visit's unread highlighting, then mark everything read so
        // the nav badge clears.
        setNotes((data ?? []) as Note[]);
        void markAllRead(user.id);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Never miss tip-off</span>
        <h1>Notifications</h1>
        <p>Joins, bookings, results and circle events.</p>
      </div>
      {loading ? <p className="loading">Loading…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !error && notes.length === 0 ? (
        <EmptyState title="All quiet" hint="Joins, results and circle events land here." />
      ) : null}
      {notes.map((n) => {
        const d = describeNote(n);
        return (
          <div className={n.read_at === null ? 'card note-unread' : 'card'} key={n.id}>
            <div className="row">
              <strong>{d.title}</strong>
              <span className="tag">{new Date(n.created_at).toLocaleDateString()}</span>
            </div>
            {d.body ? <p className="muted">{d.body}</p> : null}
            {d.href ? <Link to={d.href}>View</Link> : null}
          </div>
        );
      })}
    </div>
  );
}
