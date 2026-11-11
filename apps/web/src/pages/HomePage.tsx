import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import MatchCard from '../components/MatchCard';
import MatchFoundOverlay from '../components/MatchFoundOverlay';
import { useAuth } from '../auth/AuthContext';
import { fetchMyMatches, fetchOpenMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchForYouProfile, pickForYou } from '../lib/forYou';
import { peekPendingInvite } from '../lib/pendingInvite';
import { useMatchActions } from '../lib/useMatchActions';

export default function HomePage() {
  const { user, profile } = useAuth();
  const firstName = profile?.name ? profile.name.split(' ')[0] : null;
  const [listings, setListings] = useState<MatchListing[]>([]);
  const [nudge, setNudge] = useState<MatchListing | null>(null);
  const [forYou, setForYou] = useState<MatchListing[]>([]);
  const [forYouTuned, setForYouTuned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);

  useEffect(() => {
    setPendingInvite(peekPendingInvite());
  }, []);

  const reload = useCallback(async () => {
    if (!user) return;
    const [mine, open, tuned] = await Promise.all([
      fetchMyMatches(user.id),
      fetchOpenMatches(user.id),
      fetchForYouProfile(user.id).catch(() => null),
    ]);
    setListings(mine);
    const joined = new Set(mine.map((l) => l.match.id));
    const mineArea = profile?.area?.toLowerCase() ?? '';
    const candidate =
      open.find((l) => !joined.has(l.match.id) && (l.match.area ?? '').toLowerCase() === mineArea) ??
      open.find((l) => !joined.has(l.match.id)) ??
      null;
    setNudge(candidate);
    if (tuned) {
      setForYou(pickForYou(open, tuned, mineArea, joined));
      setForYouTuned(tuned.slots.size > 0 || tuned.sports.size > 0);
    }
  }, [user, profile?.area]);

  useEffect(() => {
    reload()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load your matches.'),
      )
      .finally(() => setLoading(false));
  }, [reload]);

  const { busyId, actionError, onJoin, onWithdraw, celebration, dismissCelebration } =
    useMatchActions(reload);

  return (
    <div className="page floodlight">
      {celebration ? (
        <MatchFoundOverlay title={celebration.title} onClose={dismissCelebration} />
      ) : null}
      <div className="page-head">
        <span className="eyebrow">Home ground</span>
        <h1>What are you playing{firstName ? `, ${firstName}` : ''}?</h1>
        <p>Your games, your nudge, your way in.</p>
      </div>
      {loading ? <p className="loading">Loading your games…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}
      {pendingInvite && !loading ? (
        <div className="card card-highlight">
          <div className="row">
            <strong>You have a pending invite</strong>
            <span className="tag">{pendingInvite}</span>
          </div>
          <p className="muted">Someone invited you — claim it to join them.</p>
          <Link className="btn btn-primary" to={`/invite/${encodeURIComponent(pendingInvite)}`}>
            Claim invite
          </Link>
        </div>
      ) : null}
      {!loading && listings.length === 0 ? (
        <EmptyState
          title="No games yet"
          hint="Find an open game on Explore, or tap Create to start one."
        />
      ) : null}
      {nudge && !loading ? (
        <div className="card nudge">
          <div className="row">
            <strong>
              {nudge.sport ? `${nudge.sport.name} · ` : ''}
              {new Date(nudge.match.starts_at).toLocaleDateString(undefined, {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </strong>
            <span className="tag">
              {nudge.joinedCount}/{nudge.match.capacity} in
            </span>
          </div>
          <p className="muted">
            {nudge.match.title} · {nudge.match.area ?? 'Area TBC'}
            {(profile?.area ?? '').toLowerCase() === (nudge.match.area ?? '').toLowerCase()
              ? ' · fits your area'
              : ''}
          </p>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busyId === nudge.match.id}
            onClick={() => onJoin(nudge.match.id)}
          >
            Join
          </button>
        </div>
      ) : null}
      {listings.map((listing) => (
        <MatchCard
          key={listing.match.id}
          listing={listing}
          busy={busyId === listing.match.id}
          onJoin={onJoin}
          onWithdraw={onWithdraw}
          onTicketingChanged={() => void reload()}
        />
      ))}
      {forYou.length > 0 ? (
        <section aria-label="For you">
          <div className="section-head">
            <h2>For you</h2>
            <Link to="/profile">{forYouTuned ? 'Tuned to your week' : 'Tune on profile'}</Link>
          </div>
          <p className="muted">
            {forYouTuned
              ? 'Your sports, your free slots, your area — best first.'
              : 'Set your sports and week on your profile and this feed sharpens up.'}
          </p>
          {forYou.map((listing) => (
            <MatchCard
              key={listing.match.id}
              listing={listing}
              busy={busyId === listing.match.id}
              onJoin={onJoin}
              onWithdraw={onWithdraw}
            />
          ))}
        </section>
      ) : null}
      <nav className="home-links" aria-label="Quick links">
        <Link className="home-link" to="/explore">
          <strong>Browse open games</strong>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="home-link" to="/teams">
          <strong>Teams and challenges</strong>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="home-link" to="/board">
          <strong>Season board</strong>
          <span aria-hidden="true">→</span>
        </Link>
      </nav>
    </div>
  );
}
