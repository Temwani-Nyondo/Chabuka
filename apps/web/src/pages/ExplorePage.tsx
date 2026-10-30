import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ChallengeCard from '../components/ChallengeCard';
import MatchCard from '../components/MatchCard';
import { useAuth } from '../auth/AuthContext';
import { fetchOpenMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchOpenChallenges } from '../lib/teams';
import type { ChallengeListing } from '../lib/teams';
import { useMatchActions } from '../lib/useMatchActions';

export default function ExplorePage() {
  const { user } = useAuth();
  const [listings, setListings] = useState<MatchListing[]>([]);
  const [challenges, setChallenges] = useState<ChallengeListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [rows, open] = await Promise.all([
      fetchOpenMatches(user.id),
      fetchOpenChallenges(user.id),
    ]);
    setListings(rows);
    setChallenges(open);
  }, [user]);

  useEffect(() => {
    reload()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load matches.'),
      )
      .finally(() => setLoading(false));
  }, [reload]);

  const { busyId, actionError, onJoin, onWithdraw } = useMatchActions(reload);

  return (
    <div className="page">
      <h1>Explore</h1>
      <p className="muted">Open games near you. Map view arrives Thu 29 Oct.</p>
      {loading ? <p className="loading">Loading matches…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}
      {!loading && !error && listings.length === 0 ? (
        <EmptyState
          title="No open games yet"
          hint="Be the first: tap + below and create a match."
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
      {challenges.length > 0 ? <h2>Teams looking for opponents</h2> : null}
      {challenges.map((listing) => (
        <ChallengeCard key={listing.challenge.id} listing={listing} onChanged={reload} />
      ))}
    </div>
  );
}
