import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import MatchCard from '../components/MatchCard';
import { useAuth } from '../auth/AuthContext';
import { fetchMyMatches, fetchOpenMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { useMatchActions } from '../lib/useMatchActions';

export default function HomePage() {
  const { user, profile } = useAuth();
  const firstName = profile?.name ? profile.name.split(' ')[0] : null;
  const [listings, setListings] = useState<MatchListing[]>([]);
  const [nudge, setNudge] = useState<MatchListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [mine, open] = await Promise.all([fetchMyMatches(user.id), fetchOpenMatches(user.id)]);
    setListings(mine);
    const joined = new Set(mine.map((l) => l.match.id));
    const mineArea = profile?.area?.toLowerCase() ?? '';
    const candidate =
      open.find((l) => !joined.has(l.match.id) && (l.match.area ?? '').toLowerCase() === mineArea) ??
      open.find((l) => !joined.has(l.match.id)) ??
      null;
    setNudge(candidate);
  }, [user, profile?.area]);

  useEffect(() => {
    reload()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load your matches.'),
      )
      .finally(() => setLoading(false));
  }, [reload]);

  const { busyId, actionError, onJoin, onWithdraw } = useMatchActions(reload);

  return (
    <div className="page">
      <h1>What are you playing{firstName ? `, ${firstName}` : ''}?</h1>
      {loading ? <p className="loading">Loading your games…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}
      {!loading && listings.length === 0 ? (
        <EmptyState
          title="No games yet"
          hint="Find an open game on Explore, or tap + to create one."
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
        />
      ))}
      <p>
        <Link to="/explore">Browse open games →</Link>
      </p>
      <p>
        <Link to="/teams">Teams and challenges →</Link>
      </p>
      <p>
        <Link to="/board">Season board →</Link>
      </p>
      <p>
        <Link to="/roadmap">Coming next →</Link>
      </p>
    </div>
  );
}
