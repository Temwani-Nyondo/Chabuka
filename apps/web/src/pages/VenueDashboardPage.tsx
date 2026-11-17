import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Building, Link2, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import GooglePlacePicker from '../components/GooglePlacePicker';
import type { GooglePlacePick } from '../components/GooglePlacePicker';
import { googleMapsKey } from '../lib/googleMaps';
import { createVenueAction } from '../lib/api';
import { fetchMyVenues } from '../lib/venueBooking';
import type { MyVenue } from '../lib/venueBooking';
import { Badge, Button, Card, EmptyState, ErrorNote, ListRow, PageHeader, Sheet, Skeleton } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

// My venues: every venue you own or help run. Each opens its manage screen (calendar, requests, today, setup, numbers).
export default function VenueDashboardPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [venues, setVenues] = useState<MyVenue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setVenues(await fetchMyVenues(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your venues.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4">
      <PageHeader
        title="My venues"
        sub="Run bookings for your pitches, courts and halls."
        actions={<Button size="sm" variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>List a venue</Button>}
      />
      {notice ? <p className="m-0 rounded-xl bg-brand-soft px-3 py-2 text-[14px] font-semibold text-brand-text">{notice}</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!venues ? (
        <Skeleton className="h-32" />
      ) : venues.length === 0 ? (
        <EmptyState
          icon={<Building size={22} />}
          title="No venues yet"
          body="List your venue, add its pitches or courts and opening hours, and players can book it. An admin approves new venues first."
          action={<Button variant="primary" onClick={() => setAdding(true)}>List a venue</Button>}
        />
      ) : (
        <Card>
          {venues.map((v) => (
            <ListRow
              key={v.id}
              to={`/venues/${v.id}/manage${v.waiting > 0 ? '?tab=requests' : ''}`}
              leading={
                v.photo ? (
                  <img src={v.photo} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted"><Building size={20} /></span>
                )
              }
              title={v.name}
              sub={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {v.area ?? ''}
                  {v.role === 'manager' ? <Badge tone="muted">Manager</Badge> : null}
                  {v.linked ? <Badge tone="brand"><Link2 size={12} />WaitApp</Badge> : null}
                  {v.status !== 'approved' ? <Badge tone="hl">{v.status === 'pending' ? 'Waiting for approval' : 'Not approved'}</Badge> : null}
                </span>
              }
              trailing={v.waiting > 0 ? <Badge tone="live">{v.waiting} waiting</Badge> : null}
            />
          ))}
        </Card>
      )}
      {token ? (
        <AddVenueSheet
          open={adding}
          token={token}
          onClose={() => setAdding(false)}
          onDone={(msg) => {
            setAdding(false);
            setNotice(msg);
            void load();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function AddVenueSheet({ open, token, onClose, onDone, onError }: { open: boolean; token: string; onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [sports, setSports] = useState('Football');
  const [facilities, setFacilities] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const onPlacePick = (pick: GooglePlacePick) => {
    if (pick.areaText) setArea(pick.areaText);
    setLat(typeof pick.lat === 'number' ? pick.lat : null);
    setLng(typeof pick.lng === 'number' ? pick.lng : null);
    setPlaceId(pick.placeId ?? null);
    if (pick.venueName && !name.trim()) setName(pick.venueName.slice(0, 80));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createVenueAction(
        {
          name: name.trim(),
          area: area.trim(),
          lat: lat ?? undefined,
          lng: lng ?? undefined,
          googlePlaceId: placeId ?? undefined,
          sports: sports.split(',').map((s) => s.trim()).filter(Boolean),
          facilityTypes: facilities.split(',').map((s) => s.trim()).filter(Boolean),
          contact: contact.trim() || undefined,
        },
        token,
      );
      setName('');
      setArea('');
      setFacilities('');
      setContact('');
      onDone('Venue sent for approval. Open it to add your spaces and opening hours while you wait.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not list the venue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="List a venue">
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <Field label="Name">
          <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <div className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Location: search or drop a pin
          <GooglePlacePicker onPick={onPlacePick} />
          {area ? <span className="font-normal text-muted">Picked: {area}</span> : null}
        </div>
        {!googleMapsKey() ? (
          <Field label="Area">
            <input className={fieldCls} value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} />
          </Field>
        ) : null}
        <Field label="Sports" hint="Separate with commas">
          <input className={fieldCls} value={sports} onChange={(e) => setSports(e.target.value)} />
        </Field>
        <Field label="Facilities" hint="e.g. floodlights, changing rooms, parking">
          <input className={fieldCls} value={facilities} onChange={(e) => setFacilities(e.target.value)} />
        </Field>
        <Field label="Contact (optional)">
          <input className={fieldCls} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
        </Field>
        <p className="m-0 text-[13px] text-muted">Want players to pay online when they book? Once your venue is approved, you can turn it on in one step from its Setup.</p>
        <Button type="submit" variant="primary" block disabled={busy || !name.trim() || !area.trim()}>
          {busy ? 'Sending…' : 'Send for approval'}
        </Button>
      </form>
    </Sheet>
  );
}
