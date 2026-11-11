import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchMySpaceBookings } from '../lib/spaces';
import type { SpaceBooking } from '../lib/spaces';
import LinkedVenueBooking from './LinkedVenueBooking';

const STATUS_TEXT: Record<SpaceBooking['status'], string> = {
  pending: 'Venue space requested, waiting for the venue',
  accepted: 'Venue space confirmed, payment due',
  paid: 'Venue space booked and paid',
  cancelled: 'Venue space booking cancelled',
};

// On a game's card, for its organiser, when the game is at a venue whose calendar lives on WaitApp: book the venue's
// space for the game's time (the booking is tied to the game), or see where that booking stands.
export default function GameVenueBooking({ matchId, venueId, startsAt }: { matchId: string; venueId: string; startsAt: string }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [booking, setBooking] = useState<SpaceBooking | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    fetchMySpaceBookings(token)
      .then((all) => setBooking(all.find((b) => b.matchId === matchId && b.status !== 'cancelled') ?? null))
      .catch(() => setBooking(null));
  }, [token, matchId]);
  useEffect(load, [load]);

  if (booking === undefined) return null;

  if (booking) {
    return (
      <div className="hint">
        <span className="tag">{STATUS_TEXT[booking.status]}</span>
        {booking.checkoutUrl ? (
          <>
            {' '}
            <a className="btn" href={booking.checkoutUrl}>Pay now</a>
          </>
        ) : null}
      </div>
    );
  }

  return open ? (
    <LinkedVenueBooking
      venueId={venueId}
      matchId={matchId}
      startsAt={startsAt}
      onBooked={() => {
        setOpen(false);
        load();
      }}
    />
  ) : (
    <button className="btn" type="button" onClick={() => setOpen(true)}>
      Book the venue space for this game
    </button>
  );
}
