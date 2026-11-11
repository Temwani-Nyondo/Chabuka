import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import VenuePhoto from '../components/VenuePhoto';
import type { Venue } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { cancelBookingAction, claimVenueAction, requestBookingAction } from '../lib/api';
import LinkedVenueBooking from '../components/LinkedVenueBooking';
import {
  fetchMyBookings,
  fetchMyTickets,
  fetchVenueById,
  fetchSlotLoad,
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

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

// Local calendar day, Mon-first grid. Days holding slots are tappable.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function SlotCalendar({
  slots,
  viewYear,
  viewMonth,
  onPrevMonth,
  onNextMonth,
  selectedDay,
  onSelectDay,
}: {
  slots: VenueSlot[];
  viewYear: number;
  viewMonth: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const counts = new Map<string, number>();
  const today = dayKey(new Date());
  for (const s of slots) {
    const k = dayKey(new Date(s.starts_at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const first = new Date(viewYear, viewMonth, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(lead).fill(null)];
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="card cal">
      <div className="row">
        <button className="btn btn-ghost cal-nav" type="button" onClick={onPrevMonth} aria-label="Previous month">
          ←
        </button>
        <strong>{monthFmt.format(first)}</strong>
        <button className="btn btn-ghost cal-nav" type="button" onClick={onNextMonth} aria-label="Next month">
          →
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label="Days with free slots">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
          <span key={i} className="cal-dow">{w}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`b-${i}`} />;
          const key = dayKey(new Date(viewYear, viewMonth, d));
          const n = counts.get(key) ?? 0;
          const past = key < today;
          if (n === 0 || past) {
            return (
              <span key={key} className={key === today ? 'cal-day cal-today' : 'cal-day cal-empty'}>
                {d}
              </span>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className={selectedDay === key ? 'cal-day cal-active' : 'cal-day cal-free'}
              aria-pressed={selectedDay === key}
              aria-label={`${d}: ${n} free slot${n === 1 ? '' : 's'}`}
              onClick={() => onSelectDay(selectedDay === key ? null : key)}
            >
              {d}
              <span className="cal-count">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Venue profile: listed details, schedule, booking, and claiming an unowned listing.
export default function VenueProfilePage() {
  const { venueId } = useParams();
  const { session, user } = useAuth();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [slots, setSlots] = useState<VenueSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [load, setLoad] = useState<Map<string, number>>(new Map());
  const [claimText, setClaimText] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!venueId || !user) return;
    const [v, s, b, t, l] = await Promise.all([
      fetchVenueById(venueId),
      fetchVenueSlots(venueId),
      fetchMyBookings(user.id),
      fetchMyTickets(user.id),
      fetchSlotLoad(venueId),
    ]);
    setLoad(l);
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
      <div className="page-head">
        <span className="eyebrow">Book the court</span>
        <h1>{venue?.name ?? 'Venue'}</h1>
        {venue ? (
          <p>
            {[venue.area, venue.sports.join(', '), venue.facility_types.join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </div>
      {venue ? (
        <>
          <VenuePhoto photos={venue.photos} name={venue.name} banner />
          <div className="card">
            {venue.status === 'pending' ? (
              <p className="hint"><span className="tag">Waiting for approval</span> Only you can see this venue until an admin approves it.</p>
            ) : null}
            {venue.status === 'rejected' ? (
              <p className="error"><span className="tag">Not approved</span> {venue.review_note ?? ''}</p>
            ) : null}
            <div className="row">
              <strong>Booking</strong>
              <span className="tag">Request, then the venue confirms</span>
            </div>
            <p className="muted">{venue.price_note || 'Ask the venue about prices.'}</p>
            {venue.hours ? <p className="muted">Hours: {venue.hours}</p> : null}
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

          {venue.waitapp_restaurant_id ? (
            <LinkedVenueBooking venueId={venue.id} />
          ) : (
            <>
          <h2>Schedule — pick a day</h2>
          {slots.length === 0 ? (
            <p className="hint">No listed slots yet. Request a time below and the venue confirms.</p>
          ) : (
            <SlotCalendar
              slots={slots}
              viewYear={viewYear}
              viewMonth={viewMonth}
              onPrevMonth={() => {
                const d = new Date(viewYear, viewMonth - 1, 1);
                const now = new Date();
                if (d.getFullYear() < now.getFullYear() || (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())) return;
                setViewYear(d.getFullYear());
                setViewMonth(d.getMonth());
                setSelectedDay(null);
              }}
              onNextMonth={() => {
                const d = new Date(viewYear, viewMonth + 1, 1);
                setViewYear(d.getFullYear());
                setViewMonth(d.getMonth());
                setSelectedDay(null);
              }}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          )}
          {selectedDay ? (
            slots
              .filter((slot) => dayKey(new Date(slot.starts_at)) === selectedDay)
              .map((slot) => {
                const mine = bookings.find(
                  (b) => b.slot_id === slot.id && (b.status === 'requested' || b.status === 'confirmed'),
                );
                return (
                  <article className="card" key={slot.id}>
                    <div className="row">
                      <strong>
                        {slotFmt.format(new Date(slot.starts_at))} – {slotFmt.format(new Date(slot.ends_at))}
                      </strong>
                      <span className="tag">{slot.price != null && slot.price > 0 ? `${slot.currency ?? ''} ${slot.price}` : 'Free'}</span>
                    </div>
                    {mine ? (
                      <p className="muted">Your booking: {mine.status}</p>
                    ) : (load.get(slot.id) ?? 0) >= slot.capacity ? (
                      <p className="hint"><span className="tag">Full</span> This slot has no places left.</p>
                    ) : slot.price != null && slot.price > 0 ? (
                      <p className="hint">Paid booking opens soon.</p>
                    ) : (
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={busy || !token}
                        onClick={() =>
                          token &&
                          void act(
                            () => requestBookingAction({ venueId: venue.id, slotId: slot.id }, token),
                            'Requested. The venue confirms, then your ticket appears here.',
                          )
                        }
                      >
                        Request to book
                      </button>
                    )}
                  </article>
                );
              })
          ) : slots.length > 0 ? (
            <p className="hint">Tap a highlighted day to see its slots.</p>
          ) : null}

          {!venue.owner_id && venue.status === 'approved' ? (
            <div className="card">
              <strong>Is this your venue?</strong>
              <p className="muted">
                Nobody manages this listing yet. Tell us how you are connected to it and an admin will review your claim.
              </p>
              <label className="field">
                How are you connected to this venue?
                <input
                  className="input"
                  value={claimText}
                  maxLength={500}
                  onChange={(e) => setClaimText(e.target.value)}
                  placeholder="I am the manager. You can reach me on 097..."
                />
              </label>
              <button
                className="btn"
                type="button"
                disabled={claiming || !token || claimText.trim().length < 5}
                onClick={() => {
                  if (!token) return;
                  setClaiming(true);
                  void act(() => claimVenueAction(venue.id, claimText.trim(), token), 'Claim sent. An admin will review it.').finally(() => {
                    setClaiming(false);
                    setClaimText('');
                  });
                }}
              >
                Claim this venue
              </button>
            </div>
          ) : null}

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

            </>
          )}

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
