import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import MatchCard from '../components/MatchCard';
import { useAuth } from '../auth/AuthContext';
import { fetchMyMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { useMatchActions } from '../lib/useMatchActions';

export default function HomePage() {
  const { user, profile } = useAuth();
  const firstName = profile?.name ? profile.name.split(' ')[0] : null;
  const [listings, setListings] = useState<MatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setListings(await fetchMyMatches(user.id));
  }, [user]);

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
      <EmptyState title="Challenges" hint="Team challenges arrive Fri 30 Oct." />
      <EmptyState title="Competitions" hint="The tournament board arrives Sat 31 Oct." />
    </div>
  );
}
