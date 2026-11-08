import { useEffect, useRef, useState } from 'react';
import { CTA_LABELS, LEVEL_LABELS, availableActions, formatEventLocation, googleCalendarUrl } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { downloadMatchIcs } from '../lib/api';
import type { MatchListing } from '../lib/matches';
import { checkoutLink, priceLabel, ticketLookupUrl } from '../lib/waitapp';
import TicketingPanel from './TicketingPanel';

interface Props {
  listing: MatchListing;
  busy: boolean;
  onJoin: (matchId: string, before?: number, title?: string) => void;
  onWithdraw: (matchId: string) => void;
  highlighted?: boolean;
  // Called after ticket sales are set up or refreshed so the list reloads.
  onTicketingChanged?: () => void;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export default function MatchCard({ listing, busy, onJoin, onWithdraw, highlighted, onTicketingChanged }: Props) {
  const { match, sport, venue, joinedCount, isParticipant, isOrganiser, ticketing, myTickets } = listing;
  const { session, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: 'center' });
  }, [highlighted]);
  const actions = availableActions({
    status: match.status,
    kind: match.kind,
    isOrganiser,
    isParticipant,
    joinedCount,
    capacity: match.capacity,
  });
  const destLat = match.lat ?? venue?.lat;
  const destLng = match.lng ?? venue?.lng;
  const directionsUrl =
    destLat != null && destLng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`
      : null;

  const act = (fn: (id: string, before?: number, title?: string) => void) => () => {
    setError(null);
    fn(match.id, joinedCount, match.title);
  };

  return (
    <article ref={cardRef} className={highlighted ? 'card card-highlight' : 'card'}>
      <div className="row">
        <strong>{match.title}</strong>
        {isOrganiser ? <span className="tag">You host</span> : null}
        <span className="tag">{match.kind === 'team-vs-team' ? 'Team game' : 'Join to play'}</span>
        <span className="tag">{ticketing ? priceLabel(ticketing) : 'Free'}</span>
      </div>
      <p className="muted">
        {match.kind === 'team-vs-team'
          ? 'For teams — register your side.'
          : ticketing
            ? 'Tickets are sold through WaitApp. Buy one to join.'
            : 'Open to anyone — tap Join to play.'}
      </p>
      <p className="muted">
        {sport ? `${sport.name}${match.format ? ` · ${match.format}` : ''} · ` : ''}
        {dateFmt.format(new Date(match.starts_at))}
      </p>
      <p className="muted">
        {venue ? `${venue.name} · ` : match.venue_name ? `${match.venue_name} · ` : ''}
        {match.area ?? venue?.area ?? 'Area to be confirmed'}
        {match.level ? ` · ${LEVEL_LABELS[match.level]}` : ''} · {joinedCount}/{match.capacity}{' '}
        players in
      </p>
      {match.notes ? <p>{match.notes}</p> : null}
      {ticketing && myTickets ? (
        <p className="hint">
          You have {myTickets.total} ticket{myTickets.total === 1 ? '' : 's'}
          {myTickets.checkedIn > 0 ? ` (${myTickets.checkedIn} checked in)` : ''}. Your QR ticket was sent by email.{' '}
          <a href={ticketLookupUrl(ticketing)} target="_blank" rel="noreferrer">
            Find my ticket
          </a>
        </p>
      ) : null}
      {match.status === 'cancelled' ? <p className="error">This game was cancelled.{ticketing ? ' Ticket holders are refunded by WaitApp.' : ''}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {actions.length > 0 ? (
        <div className="actions-row">
          {actions.includes('join') && ticketing ? (
            ticketing.status === 'on_sale' && user ? (
              <a className="btn btn-primary" href={checkoutLink(ticketing, user.id)} target="_blank" rel="noreferrer">
                Buy ticket
              </a>
            ) : (
              <p className="hint">Tickets are not on sale yet.</p>
            )
          ) : null}
          {actions.includes('join') && !ticketing ? (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={act(onJoin)}>
              {CTA_LABELS['join']}
            </button>
          ) : null}
          {actions.includes('withdraw') && ticketing ? (
            <p className="hint">You have a ticket. Ask for a refund through WaitApp to give up your spot.</p>
          ) : null}
          {actions.includes('withdraw') && !ticketing ? (
            <button className="btn" type="button" disabled={busy} onClick={act(onWithdraw)}>
              {CTA_LABELS['withdraw']}
            </button>
          ) : null}
          {actions.includes('directions') && directionsUrl ? (
            <a className="btn" href={directionsUrl} target="_blank" rel="noreferrer">
              {CTA_LABELS['directions']}
            </a>
          ) : null}
        </div>
      ) : (
        <p className="hint">{match.kind === 'team-vs-team' ? 'Team game — sides are set through challenges. See the Teams tab.' : match.status === 'full' || joinedCount >= match.capacity ? 'Full' : match.status}</p>
      )}
      {isOrganiser && match.kind === 'players' ? (
        <TicketingPanel matchId={match.id} ticketing={ticketing} onChanged={() => onTicketingChanged?.()} />
      ) : null}
      <div className="actions-row">
          <button
            className="btn"
            type="button"
            disabled={busy || !session?.access_token}
            onClick={() => {
              const token = session?.access_token;
              if (!token) {
                setError('Sign in to add this to your calendar.');
                return;
              }
              void downloadMatchIcs(match.id, token).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : 'Could not download the calendar file.'),
              );
            }}
          >
            Add to calendar (.ics)
          </button>
          <a
            className="btn btn-ghost"
            href={googleCalendarUrl({
              title: match.title,
              startsAt: match.starts_at,
              location: formatEventLocation({
                name: venue?.name ?? match.venue_name,
                area: match.area ?? venue?.area,
                lat: match.lat ?? venue?.lat ?? null,
                lng: match.lng ?? venue?.lng ?? null,
              }),
            })}
            target="_blank"
            rel="noreferrer"
          >
            Google Calendar
          </a>
      </div>
    </article>
  );
}
