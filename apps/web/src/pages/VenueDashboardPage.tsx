import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import GooglePlacePicker from '../components/GooglePlacePicker';
import type { GooglePlacePick } from '../components/GooglePlacePicker';
import { googleMapsKey } from '../lib/googleMaps';
import {
  cancelBookingAction,
  checkInTicketAction,
  createVenueAction,
  createVenueSlotAction,
  respondBookingAction,
} from '../lib/api';
import { fetchMyBookings, fetchMyTickets, fetchMyVenues, fetchVenueBookings, fetchVenueSlots, fetchVenueTickets, fetchVenues } from '../lib/venues';
import type { Booking, Ticket, VenueSlot } from '../lib/venues';
import type { Venue } from '@chabuka/shared';

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

// Venue dashboard (Amendment 3): register a venue, publish free schedule
// slots, confirm/decline bookings, and check in free tickets.
export default function VenueDashboardPage() {
  const { session, user } = useAuth();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [slotsByVenue, setSlotsByVenue] = useState<Record<string, VenueSlot[]>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [allVenues, setAllVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New venue form
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [sports, setSports] = useState('Football');
  const [facilities, setFacilities] = useState('');
  const [contact, setContact] = useState('');

  const onPlacePick = (pick: GooglePlacePick) => {
    if (pick.areaText) setArea(pick.areaText);
    setLat(typeof pick.lat === 'number' ? pick.lat : null);
    setLng(typeof pick.lng === 'number' ? pick.lng : null);
    setPlaceId(pick.placeId ?? null);
    if (pick.venueName && !name.trim()) setName(pick.venueName.slice(0, 80));
  };
  // New slot form (per venue id)
  const [slotStart, setSlotStart] = useState<Record<string, string>>({});
  const [slotEnd, setSlotEnd] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!user) return;
    const mine = await fetchMyVenues(user.id);
    setVenues(mine);
    const slotMap: Record<string, VenueSlot[]> = {};
    for (const v of mine) slotMap[v.id] = await fetchVenueSlots(v.id);
    setSlotsByVenue(slotMap);
    const all = await fetchVenueBookings(mine.map((v) => v.id));
    setBookings(all);
    setTickets(await fetchVenueTickets(all.map((b) => b.id)));
    setMyBookings(await fetchMyBookings(user.id).catch(() => []));
    setMyTickets(await fetchMyTickets(user.id).catch(() => []));
    setAllVenues(await fetchVenues().catch(() => []));
  }, [user]);

  useEffect(() => {
    reload().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not load your venues.'),
    );
  }, [reload]);

  const token = session?.access_token;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const createVenue = (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    void act(
      () =>
        createVenueAction(
          {
            name: name.trim(),
            area: area.trim(),
            lat: lat ?? undefined,
            lng: lng ?? undefined,
            googlePlaceId: placeId ?? undefined,
            sports: sports.split(',').map((s) => s.trim()).filter(Boolean),
            facilityTypes: facilities.split(',').map((s) => s.trim()).filter(Boolean),
            contact: contact.trim() || undefined,
            priceNote: 'Free — MVP demo',
          },
          token,
        ),
      'Venue registered. Add schedule slots below.',
    );
    setName('');
    setArea('');
    setLat(null);
    setLng(null);
    setPlaceId(null);
    setFacilities('');
    setContact('');
  };

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? 'Venue';
  const ticketFor = (bookingId: string) => tickets.find((t) => t.booking_id === bookingId);
  const anyVenueName = (id: string) =>
    venues.find((v) => v.id === id)?.name ?? allVenues.find((v) => v.id === id)?.name ?? 'Venue';
  const myTicketFor = (bookingId: string) => myTickets.find((t) => t.booking_id === bookingId);

  return (
    <div className="page">
      <p><Link to="/explore">← Explore</Link></p>
      <div className="page-head">
        <span className="eyebrow">Run the venue</span>
        <h1>Venue dashboard</h1>
        <p>Bookings and tickets are free in this MVP — no payment step.</p>
      </div>

      {myBookings.length > 0 ? (
        <section aria-label="Your booking requests">
          <h2>Your booking requests</h2>
          {myBookings.map((b) => {
            const ticket = myTicketFor(b.id);
            return (
              <article className="card" key={b.id}>
                <div className="row">
                  <strong>{anyVenueName(b.venue_id)}</strong>
                  <span className="tag">{b.status}</span>
                </div>
                <p className="muted">
                  {b.requested_starts_at ? fmt.format(new Date(b.requested_starts_at)) : 'Time to confirm'}
                  {ticket ? ` · Free ticket ${ticket.code}` : ''}
                </p>
                {b.status === 'requested' ? (
                  <div className="actions-row">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={busy || !token}
                      onClick={() => token && void act(() => cancelBookingAction(b.id, token), 'Booking cancelled.')}
                    >
                      Cancel request
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      <form className="card" onSubmit={createVenue}>
        <strong>Register a venue (free)</strong>
        <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label className="field">
          Location — search or drop a pin
          <GooglePlacePicker onPick={onPlacePick} />
        </label>
        {area ? <p className="muted">Picked: {area}</p> : null}
        {!googleMapsKey() ? (
          <label className="field">
            Area (manual — Google search is off)
            <input className="input" value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} />
          </label>
        ) : null}
        <label className="field">Sports (comma separated)<input className="input" value={sports} onChange={(e) => setSports(e.target.value)} /></label>
        <label className="field">Facilities (comma separated)<input className="input" value={facilities} onChange={(e) => setFacilities(e.target.value)} placeholder="grass pitch, floodlights" /></label>
        <label className="field">Contact (optional)<input className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || !token}>Register venue</button>
      </form>

      {venues.length === 0 ? <p className="hint">No venues yet — register one above to publish a schedule.</p> : null}

      {venues.map((venue) => (
        <section key={venue.id}>
          <h2>{venue.name}</h2>
          <p className="muted">{venue.area} · <Link to={`/venues/${venue.id}`}>View profile</Link></p>
          <div className="card">
            <strong>Add a free schedule slot</strong>
            <label className="field">Starts<input className="input" type="datetime-local" value={slotStart[venue.id] ?? ''} onChange={(e) => setSlotStart({ ...slotStart, [venue.id]: e.target.value })} /></label>
            <label className="field">Ends<input className="input" type="datetime-local" value={slotEnd[venue.id] ?? ''} onChange={(e) => setSlotEnd({ ...slotEnd, [venue.id]: e.target.value })} /></label>
            <button
              className="btn"
              type="button"
              disabled={busy || !token || !slotStart[venue.id] || !slotEnd[venue.id]}
              onClick={() =>
                token &&
                void act(
                  () =>
                    createVenueSlotAction(
                      {
                        venueId: venue.id,
                        startsAt: new Date(slotStart[venue.id] as string).toISOString(),
                        endsAt: new Date(slotEnd[venue.id] as string).toISOString(),
                        capacity: 1,
                      },
                      token,
                    ),
                  'Slot published.',
                )
              }
            >
              Publish slot
            </button>
            {(slotsByVenue[venue.id] ?? []).map((slot) => (
              <p className="muted" key={slot.id}>
                {fmt.format(new Date(slot.starts_at))} – {fmt.format(new Date(slot.ends_at))} · capacity {slot.capacity}
              </p>
            ))}
          </div>

          {bookings.filter((b) => b.venue_id === venue.id).map((booking) => {
            const ticket = ticketFor(booking.id);
            return (
              <article className="card" key={booking.id}>
                <div className="row">
                  <strong>{booking.status}</strong>
                  {ticket ? <span className="tag">Free ticket {ticket.code} · {ticket.status}</span> : <span className="tag">Free</span>}
                </div>
                <p className="muted">
                  {venueName(booking.venue_id)}
                  {booking.requested_starts_at ? ` · ${fmt.format(new Date(booking.requested_starts_at))}` : ''}
                </p>
                {booking.status === 'requested' ? (
                  <div className="actions-row">
                    <button className="btn btn-primary" type="button" disabled={busy || !token} onClick={() => token && void act(() => respondBookingAction({ bookingId: booking.id, decision: 'confirm' }, token), 'Confirmed — free ticket issued.')}>Confirm</button>
                    <button className="btn" type="button" disabled={busy || !token} onClick={() => token && void act(() => respondBookingAction({ bookingId: booking.id, decision: 'decline' }, token), 'Declined.')}>Decline</button>
                  </div>
                ) : null}
                {ticket?.status === 'issued' ? (
                  <button className="btn" type="button" disabled={busy || !token} onClick={() => token && void act(() => checkInTicketAction(ticket.id, token), 'Ticket checked in.')}>Check in ticket</button>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}
      {notice ? <p>{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
