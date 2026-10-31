import { useState } from 'react';
import { CTA_LABELS, LEVEL_LABELS, availableActions, googleCalendarUrl } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { downloadMatchIcs } from '../lib/api';
import type { MatchListing } from '../lib/matches';

interface Props {
  listing: MatchListing;
  busy: boolean;
  onJoin: (matchId: string) => void;
  onWithdraw: (matchId: string) => void;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export default function MatchCard({ listing, busy, onJoin, onWithdraw }: Props) {
  const { match, sport, venue, joinedCount, isParticipant, isOrganiser } = listing;
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const actions = availableActions({
    status: match.status,
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

  const act = (fn: (id: string) => void) => () => {
    setError(null);
    fn(match.id);
  };

  return (
    <article className="card">
      <div className="row">
        <strong>{match.title}</strong>
        {isOrganiser ? <span className="tag">You host</span> : null}
      </div>
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
      {error ? <p className="error">{error}</p> : null}
      {actions.length > 0 ? (
        <div className="actions-row">
          {actions.includes('join') ? (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={act(onJoin)}>
              {CTA_LABELS['join']}
            </button>
          ) : null}
          {actions.includes('withdraw') ? (
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
        <p className="hint">{match.status === 'full' || joinedCount >= match.capacity ? 'Full' : match.status}</p>
      )}
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
              location: venue?.name ?? match.venue_name ?? match.area ?? null,
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
