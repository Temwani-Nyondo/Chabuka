import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Venue } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { cancelBookingAction, requestBookingAction } from '../lib/api';
import {
  fetchMyBookings,
  fetchMyTickets,
  fetchVenueById,
  fetchVenueSlots,
} from '../lib/venues';
import type { Booking, Ticket, VenueSlot } from '../lib/venues';

const slotFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

// Venue profile (Amendment 3): listed details, free schedule, booking.
// Every booking is free in the MVP — no payment step anywhere.
export default function VenueProfilePage() {
  const { venueId } = useParams();
  const { session, user } = useAuth();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [slots, setSlots] = useState<VenueSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customTime, setCustomTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!venueId || !user) return;
    const [v, s, b, t] = await Promise.all([
      fetchVenueById(venueId),
      fetchVenueSlots(venueId),
      fetchMyBookings(user.id),
      fetchMyTickets(user.id),
    ]);
    setVenue(v);
    setSlots(s);
    setBookings(b.filter((x) => x.venue_id === venueId));
    setTickets(t);
  }, [venueId, user]);

  useEffect(() => {
    reload().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not load this venue.'),
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

  if (!venue && !error) return <div className="page"><p className="loading">Loading venue…</p></div>;

  const myTicketFor = (bookingId: string) => tickets.find((t) => t.booking_id === bookingId);
  const directions =
    venue?.lat != null && venue?.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`
      : null;

  return (
    <div className="page">
      <p><Link to="/explore">← Explore</Link></p>
      <h1>{venue?.name ?? 'Venue'}</h1>
      {venue ? (
        <>
          <p className="muted">
            {[venue.area, venue.sports.join(', '), venue.facility_types.join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="card">
            <div className="row">
              <strong>Free booking</strong>
              <span className="tag">Free — MVP demo</span>
            </div>
            <p className="muted">{venue.price_note ?? 'Free — MVP demo'}</p>
            {venue.contact ? <p className="muted">Contact: {venue.contact}</p> : null}
            {directions ? (
              <a className="btn" href={directions} target="_blank" rel="noreferrer">
                Directions
              </a>
            ) : null}
            {venue.owner_id === user?.id ? (
              <Link className="btn" to="/venues/dashboard">Open venue dashboard</Link>
            ) : null}
          </div>

          <h2>Schedule — book a free slot</h2>
          {slots.length === 0 ? (
            <p className="hint">No listed slots yet. Request a time below and the venue confirms.</p>
          ) : (
            slots.map((slot) => {
              const mine = bookings.find(
                (b) => b.slot_id === slot.id && (b.status === 'requested' || b.status === 'confirmed'),
              );
              return (
                <article className="card" key={slot.id}>
                  <div className="row">
                    <strong>
                      {slotFmt.format(new Date(slot.starts_at))} – {slotFmt.format(new Date(slot.ends_at))}
                    </strong>
                    <span className="tag">{slot.capacity} court(s)/pitch(es)</span>
                  </div>
                  {mine ? (
                    <p className="muted">Your booking: {mine.status}</p>
                  ) : (
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busy || !token}
                      onClick={() =>
                        token &&
                        void act(
                          () => requestBookingAction({ venueId: venue.id, slotId: slot.id }, token),
                          'Requested — the venue confirms, then your free ticket appears here.',
                        )
                      }
                    >
                      Book free
                    </button>
                  )}
                </article>
              );
            })
          )}

          <div className="card">
            <strong>Request another time</strong>
            <label className="field">
              Starts
              <input
                className="input"
                type="datetime-local"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
              />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy || !token || !customTime}
              onClick={() =>
                token &&
                void act(
                  () =>
                    requestBookingAction(
                      { venueId: venue.id, requestedStartsAt: new Date(customTime).toISOString() },
                      token,
                    ),
                  'Requested — the venue confirms, then your free ticket appears here.',
                )
              }
            >
              Request free booking
            </button>
          </div>

          <h2>My bookings &amp; free tickets here</h2>
          {bookings.length === 0 ? <p className="hint">None yet.</p> : null}
          {bookings.map((booking) => {
            const ticket = myTicketFor(booking.id);
            return (
              <article className="card" key={booking.id}>
                <div className="row">
                  <strong>{booking.status}</strong>
                  {ticket ? <span className="tag">Ticket {ticket.code}</span> : null}
                </div>
                <p className="muted">
                  {booking.requested_starts_at
                    ? slotFmt.format(new Date(booking.requested_starts_at))
                    : 'Time to confirm'}
                  {ticket ? ` · Free ticket: ${ticket.status}` : ' · Free'}
                </p>
                {booking.status === 'requested' || booking.status === 'confirmed' ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy || !token}
                    onClick={() =>
                      token && void act(() => cancelBookingAction(booking.id, token), 'Booking cancelled.')
                    }
                  >
                    Cancel booking
                  </button>
                ) : null}
              </article>
            );
          })}
        </>
      ) : null}
      {notice ? <p>{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
