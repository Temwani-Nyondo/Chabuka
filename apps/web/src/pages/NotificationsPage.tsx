import { useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface Note {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

const TITLES: Record<string, string> = {
  circle_event: 'New event in your circle',
  player_joined: 'A player joined your match',
  result_posted: 'New result on a board you follow',
  booking_answered: 'Your booking was answered',
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !supabase) return;
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setNotes((data ?? []) as Note[]);
        setLoading(false);
      });
  }, [user]);

  return (
    <div className="page">
      <h1>Notifications</h1>
      {loading ? <p className="loading">Loading…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && notes.length === 0 ? (
        <EmptyState title="All quiet" hint="Joins, results and circle events land here." />
      ) : null}
      {notes.map((n) => (
        <div className="card" key={n.id}>
          <div className="row">
            <strong>{TITLES[n.type] ?? 'Update'}</strong>
            <span className="tag">{new Date(n.created_at).toLocaleDateString()}</span>
          </div>
          <p className="muted">{String(n.payload.title ?? n.payload.decision ?? '')}</p>
        </div>
      ))}
    </div>
  );
}
