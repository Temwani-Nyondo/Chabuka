import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import EmptyState from '../components/EmptyState';
import { fetchVenuesForReview, reviewVenueAction } from '../lib/admin';
import type { ReviewVenueRow } from '../lib/admin';

type Tab = 'pending' | 'approved' | 'rejected';

// Platform admins decide which venues go live. The server refuses anyone who
// is not an admin, so a non-admin who opens this page just sees a message.
export default function AdminVenuesPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<ReviewVenueRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchVenuesForReview(token, tab));
      setDenied(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load venues.';
      if (/admins only/i.test(msg)) setDenied(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [token, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (venueId: string, decision: 'approve' | 'reject') => {
    if (!token) return;
    const note = notes[venueId]?.trim();
    if (decision === 'reject' && !note) {
      setError('Say why you are rejecting it, so the owner can fix it.');
      return;
    }
    setBusyId(venueId);
    setError(null);
    try {
      await reviewVenueAction(token, venueId, decision, note);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the decision.');
    } finally {
      setBusyId(null);
    }
  };

  if (denied) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Venue review</h1>
          <p>This page is for Chabuka admins only.</p>
        </div>
        <Link className="btn" to="/home">Back to Home</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Admin</span>
        <h1>Venue review</h1>
        <p>A venue goes live only when you approve it.</p>
      </div>
      <div className="chips" role="tablist" aria-label="Venue status">
        {(['pending', 'approved', 'rejected'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'chip chip-active' : 'chip'}
            onClick={() => setTab(t)}
          >
            {t === 'pending' ? 'Waiting' : t === 'approved' ? 'Approved' : 'Rejected'}
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="loading">Loading…</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState title="Nothing here" hint={tab === 'pending' ? 'No venues are waiting for approval.' : 'No venues in this list.'} />
      ) : null}
      {rows.map((v) => {
        const map =
          v.lat != null && v.lng != null ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}` : null;
        return (
          <article className="card" key={v.id}>
            <div className="row">
              <strong>{v.name}</strong>
              <span className="tag">{v.area ?? 'No area'}</span>
            </div>
            <p className="muted">
              {v.sports.join(', ') || 'No sports listed'}
              {v.facility_types.length ? ` · ${v.facility_types.join(', ')}` : ''}
            </p>
            <p className="muted">
              Submitted by {v.owner_name ?? 'an unknown user'}
              {v.contact ? ` · Contact: ${v.contact}` : ''}
              {map ? (
                <>
                  {' '}
                  · <a href={map} target="_blank" rel="noreferrer">See on map</a>
                </>
              ) : null}
            </p>
            {v.review_note ? <p className="hint">Note: {v.review_note}</p> : null}
            {tab !== 'approved' ? (
              <label className="field">
                Note to the owner {tab === 'pending' ? '(required to reject)' : ''}
                <input
                  className="input"
                  value={notes[v.id] ?? ''}
                  maxLength={300}
                  onChange={(e) => setNotes({ ...notes, [v.id]: e.target.value })}
                />
              </label>
            ) : null}
            <div className="actions-row">
              {tab !== 'approved' ? (
                <button className="btn btn-primary" type="button" disabled={busyId === v.id} onClick={() => void decide(v.id, 'approve')}>
                  Approve
                </button>
              ) : null}
              {tab !== 'rejected' ? (
                <button className="btn" type="button" disabled={busyId === v.id} onClick={() => void decide(v.id, 'reject')}>
                  {tab === 'approved' ? 'Take down' : 'Reject'}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
