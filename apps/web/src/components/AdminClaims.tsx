import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from './EmptyState';
import { addVenueAction, fetchClaims, reviewClaimAction } from '../lib/admin';
import type { ClaimRow } from '../lib/admin';

interface Props {
  token: string | undefined;
  view: 'claims' | 'add';
}

// Admin: decide venue ownership claims, and pre-list a real venue so its owner
// can be assigned straight away or claim it later.
export default function AdminClaims({ token, view }: Props) {
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [sports, setSports] = useState('');
  const [facilities, setFacilities] = useState('');
  const [contact, setContact] = useState('');
  const [priceNote, setPriceNote] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  const load = useCallback(async () => {
    if (!token || view !== 'claims') return;
    setLoading(true);
    setError(null);
    try {
      setClaims(await fetchClaims(token, 'pending'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load claims.');
    } finally {
      setLoading(false);
    }
  }, [token, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    if (!token) return;
    const note = notes[id]?.trim();
    if (decision === 'reject' && !note) {
      setError('Say why you are rejecting the claim.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewClaimAction(token, id, decision, note);
      setNotice(decision === 'approve' ? 'Claim approved. They now manage the venue.' : 'Claim rejected.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  };

  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const latN = lat.trim() ? Number(lat) : undefined;
        const lngN = lng.trim() ? Number(lng) : undefined;
        if ((latN !== undefined && !Number.isFinite(latN)) || (lngN !== undefined && !Number.isFinite(lngN))) {
          throw new Error('Latitude and longitude must be numbers.');
        }
        const result = await addVenueAction(token, {
          name: name.trim(),
          area: area.trim(),
          sports: list(sports),
          facilityTypes: list(facilities),
          contact: contact.trim() || undefined,
          priceNote: priceNote.trim() || undefined,
          lat: latN,
          lng: lngN,
          ownerEmail: ownerEmail.trim() || undefined,
        });
        setNotice(result.ownerId ? 'Venue added and assigned to its owner.' : 'Venue added. Its owner can claim it.');
        setName('');
        setArea('');
        setSports('');
        setFacilities('');
        setContact('');
        setPriceNote('');
        setLat('');
        setLng('');
        setOwnerEmail('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add the venue.');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (view === 'add') {
    return (
      <form className="card" onSubmit={add}>
        <strong>Add a venue</strong>
        <p className="muted">
          Pre-list a real Lusaka venue. It goes live at once. Give the owner's email to assign it now, or leave it empty so
          the owner can claim it.
        </p>
        <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label className="field">Area<input className="input" value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} /></label>
        <label className="field">Sports (comma separated)<input className="input" value={sports} onChange={(e) => setSports(e.target.value)} /></label>
        <label className="field">Facilities (comma separated)<input className="input" value={facilities} onChange={(e) => setFacilities(e.target.value)} /></label>
        <label className="field">Contact<input className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} /></label>
        <label className="field">Prices<input className="input" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={120} /></label>
        <label className="field">Latitude (optional)<input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-15.4189" /></label>
        <label className="field">Longitude (optional)<input className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="28.3489" /></label>
        <label className="field">Owner's Chabuka email (optional)<input className="input" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} /></label>
        {notice ? <p>{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !token || !name.trim() || !area.trim()}>
          {busy ? 'Adding…' : 'Add venue'}
        </button>
      </form>
    );
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {loading ? <p className="loading">Loading…</p> : null}
      {!loading && claims.length === 0 ? <EmptyState title="No claims waiting" hint="Ownership claims show up here." /> : null}
      {claims.map((c) => (
        <article className="card" key={c.id}>
          <div className="row">
            <strong>{c.venue_name}</strong>
            <span className="tag">{new Date(c.created_at).toLocaleDateString()}</span>
          </div>
          <p className="muted">From {c.user_name ?? 'an unknown user'}</p>
          <p>{c.message}</p>
          <label className="field">
            Note to them (required to reject)
            <input className="input" value={notes[c.id] ?? ''} maxLength={300} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
          </label>
          <div className="actions-row">
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void decide(c.id, 'approve')}>
              Approve
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => void decide(c.id, 'reject')}>
              Reject
            </button>
          </div>
        </article>
      ))}
    </>
  );
}
