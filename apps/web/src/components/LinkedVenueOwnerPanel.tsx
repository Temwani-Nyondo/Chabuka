import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Row {
  id: string;
  user_id: string;
  match_id: string | null;
  space_name: string;
  starts_at: string;
  status: 'pending' | 'accepted' | 'paid' | 'cancelled';
}

const STATUS_TEXT: Record<Row['status'], string> = {
  pending: 'Waiting for you on WaitApp',
  accepted: 'Confirmed, payment due',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

// A linked venue's calendar, requests and money live on WaitApp, so its old Chabuka slots are hidden. This shows what
// Chabuka players have booked, read from Chabuka's own record of those bookings (the venue owner may read them).
export default function LinkedVenueOwnerPanel({ venueId }: { venueId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    void (async () => {
      const { data } = await client
        .from('waitapp_bookings')
        .select('id,user_id,match_id,space_name,starts_at,status')
        .eq('venue_id', venueId)
        .order('starts_at', { ascending: false })
        .limit(30);
      const list = (data ?? []) as Row[];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.user_id))];
      if (ids.length > 0) {
        const { data: profiles } = await client.from('profiles').select('id,name').in('id', ids);
        setNames(Object.fromEntries(((profiles ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name ?? 'Player'])));
      }
    })();
  }, [venueId]);

  return (
    <div className="card">
      <strong>Bookings from Chabuka</strong>
      <p className="muted">
        Your spaces, calendar and payments are managed on WaitApp. Accept or decline requests and see your payouts there.
      </p>
      <a className="btn" href="https://waitapp.online/admin/reservations" target="_blank" rel="noreferrer">Open WaitApp bookings</a>
      {rows.length === 0 ? <p className="hint">No bookings from Chabuka players yet.</p> : null}
      {rows.map((r) => (
        <div className="row" key={r.id}>
          <span>
            {names[r.user_id] ?? 'Player'} · {r.space_name} ·{' '}
            {new Date(r.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {r.match_id ? ' · for a game' : ''}
          </span>
          <span className="tag">{STATUS_TEXT[r.status]}</span>
        </div>
      ))}
    </div>
  );
}
