import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  bookVenueSpace,
  fetchMySpaceBookings,
  fetchSpaceAvailability,
  fetchVenueSpaces,
} from '../lib/spaces';
import type { SpaceAvailability, SpaceBooking, SpacesInfo, VenueSpace } from '../lib/spaces';

const todayYmd = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const money = (n: number, currency: string | null) => `${currency ?? ''} ${n % 1 === 0 ? n : n.toFixed(2)}`.trim();

const STATUS_TEXT: Record<SpaceBooking['status'], string> = {
  pending: 'Waiting for the venue',
  accepted: 'Confirmed, payment due',
  paid: 'Paid and confirmed',
  cancelled: 'Cancelled',
};

// A linked venue keeps its spaces and calendar on WaitApp. The player picks a space, a day and a free time here; the
// booking is made on WaitApp, which takes the payment, and this screen shows its state as it changes.
export default function LinkedVenueBooking({
  venueId,
  matchId,
  startsAt,
  onBooked,
}: {
  venueId: string;
  /** Booking the space for this game: the game's time prefills the day and start, and the booking is tied to it. */
  matchId?: string;
  startsAt?: string;
  onBooked?: () => void;
}) {
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const [info, setInfo] = useState<SpacesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const gameStart = startsAt ? new Date(startsAt) : null;
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(gameStart ? ymd(gameStart) : todayYmd());
  const [avail, setAvail] = useState<SpaceAvailability | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [hours, setHours] = useState(1);
  const [people, setPeople] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<SpaceBooking[]>([]);

  useEffect(() => {
    if (!token) return;
    fetchVenueSpaces(token, venueId).then(setInfo).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the spaces.'));
  }, [token, venueId]);

  const reloadMine = () => {
    if (!token) return;
    fetchMySpaceBookings(token)
      .then((all) => setMine(all.filter((b) => b.venueId === venueId && (!matchId || b.matchId === matchId))))
      .catch(() => undefined);
  };
  useEffect(reloadMine, [token, venueId]);

  useEffect(() => {
    if (profile) {
      setName((n) => n || profile.name || '');
    }
  }, [profile]);

  const space: VenueSpace | null = useMemo(() => info?.spaces.find((s) => s.id === spaceId) ?? null, [info, spaceId]);

  useEffect(() => {
    if (!token || !space) {
      setAvail(null);
      return;
    }
    let cancelled = false;
    setLoadingAvail(true);
    setStart(null);
    fetchSpaceAvailability(token, venueId, space.id, date)
      .then((a) => !cancelled && setAvail(a))
      .catch((e: unknown) => {
        if (!cancelled) {
          setAvail(null);
          setError(e instanceof Error ? e.message : 'Could not load the free times.');
        }
      })
      .finally(() => !cancelled && setLoadingAvail(false));
    return () => {
      cancelled = true;
    };
  }, [token, venueId, space, date]);

  // For a game, pre-select the slot that matches its start time when the venue has it free.
  useEffect(() => {
    if (!gameStart || !avail || start) return;
    const hhmm = `${String(gameStart.getHours()).padStart(2, '0')}:${String(gameStart.getMinutes()).padStart(2, '0')}`;
    if (avail.slots.some((s) => s.start === hhmm)) setStart(hhmm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail]);

  const slot = avail?.slots.find((s) => s.start === start) ?? null;
  const maxHours = slot?.maxHours ?? 1;
  useEffect(() => {
    if (hours > maxHours) setHours(maxHours);
  }, [maxHours, hours]);

  const total = space ? (space.pricingUnit === 'session' ? space.price : space.price * hours) : 0;
  const canBook = !!token && !!space && !!slot && name.trim().length > 1 && phone.trim().length > 5 && !busy;

  const book = () => {
    if (!token || !space || !slot) return;
    setBusy(true);
    setError(null);
    bookVenueSpace(token, venueId, {
      typeId: space.id,
      spaceName: space.name,
      date,
      startTime: slot.start,
      hours,
      people,
      name: name.trim(),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(matchId ? { matchId } : {}),
    })
      .then((b) => {
        // An instant space is already confirmed: go and pay now. A request waits for the venue.
        if (b.checkoutUrl) window.location.href = b.checkoutUrl;
        else {
          reloadMine();
          setStart(null);
          onBooked?.();
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not make the booking.'))
      .finally(() => setBusy(false));
  };

  if (error && !info) return <p className="error">{error}</p>;
  if (!info) return <p className="loading">Loading the venue calendar…</p>;

  return (
    <div className="card">
      <strong>Book a space</strong>
      <p className="muted">Booked and paid on WaitApp. Pick a space, a day and a free time.</p>
      {info.spaces.length === 0 ? <p className="hint">This venue has not added any spaces yet.</p> : null}
      <div className="chips" role="group" aria-label="Spaces">
        {info.spaces.map((s) => (
          <button key={s.id} type="button" className={spaceId === s.id ? 'chip chip-active' : 'chip'} aria-pressed={spaceId === s.id} onClick={() => setSpaceId(s.id)}>
            {s.name} · {money(s.price, s.currency)}/{s.pricingUnit === 'session' ? 'session' : 'hr'}
          </button>
        ))}
      </div>

      {space ? (
        <>
          <label className="field">
            Day
            <input className="input" type="date" value={date} min={todayYmd()} onChange={(e) => setDate(e.target.value)} />
          </label>
          {loadingAvail ? <p className="loading">Checking free times…</p> : null}
          {avail?.closed ? <p className="hint">Closed that day. Try another date.</p> : null}
          {avail && !avail.closed && avail.slots.length === 0 ? <p className="hint">Fully booked that day. Try another date.</p> : null}
          <div className="chips" role="group" aria-label="Free times">
            {avail?.slots.map((s) => (
              <button key={s.start} type="button" className={start === s.start ? 'chip chip-active' : 'chip'} aria-pressed={start === s.start} onClick={() => setStart(s.start)}>
                {s.start}
              </button>
            ))}
          </div>
          {slot ? (
            <>
              {space.pricingUnit === 'hour' ? (
                <label className="field">
                  How long
                  <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                    {Array.from({ length: maxHours }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                People
                <input className="input" type="number" min={1} max={space.capacity ?? 500} value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field">Your name<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
              <label className="field">Phone<input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></label>
              <label className="field">Email (optional)<input className="input" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} /></label>
              <p className="muted">
                {space.name}, {slot.start}{space.pricingUnit === 'hour' ? ` for ${hours}h` : ''}: <strong>{money(total, space.currency)}</strong>.{' '}
                {avail?.bookingMode === 'instant' ? 'You pay next and the time is yours at once.' : 'The venue confirms first, then you pay.'}
              </p>
              {error ? <p className="error">{error}</p> : null}
              <button className="btn btn-primary" type="button" disabled={!canBook} onClick={book}>
                {busy ? 'Booking…' : avail?.bookingMode === 'instant' ? 'Continue to payment' : 'Send request'}
              </button>
            </>
          ) : null}
        </>
      ) : null}

      {mine.length > 0 ? (
        <div>
          <strong>Your bookings here</strong>
          {mine.map((b) => (
            <div className="row" key={b.id}>
              <span>
                {b.spaceName} · {new Date(b.startsAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="tag">{STATUS_TEXT[b.status]}</span>
              {b.checkoutUrl ? <a className="btn" href={b.checkoutUrl}>Pay now</a> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
