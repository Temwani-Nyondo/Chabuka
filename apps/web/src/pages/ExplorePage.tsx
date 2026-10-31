import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ChallengeCard from '../components/ChallengeCard';
import ExploreMap from '../components/ExploreMap';
import MatchCard from '../components/MatchCard';
import { useAuth } from '../auth/AuthContext';
import { fetchOpenMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchOpenChallenges } from '../lib/teams';
import type { ChallengeListing } from '../lib/teams';
import { fetchVenues } from '../lib/venues';
import type { Venue } from '@chabuka/shared';
import { Link } from 'react-router-dom';
import { useMatchActions } from '../lib/useMatchActions';

export default function ExplorePage() {
  const { user } = useAuth();
  const [listings, setListings] = useState<MatchListing[]>([]);
  const [challenges, setChallenges] = useState<ChallengeListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<MatchListing | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueQuery, setVenueQuery] = useState('');

  const reload = useCallback(async () => {
    if (!user) return;
    const [rows, open] = await Promise.all([
      fetchOpenMatches(user.id),
      fetchOpenChallenges(user.id),
    ]);
    setListings(rows);
    setChallenges(open);
    setVenues(await fetchVenues().catch(() => []));
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
      <p className="muted">Open games near you.</p>
      <div className="chips" role="tablist" aria-label="Explore view">
        <button
          type="button"
          className={view === 'list' ? 'chip chip-active' : 'chip'}
          onClick={() => setView('list')}
        >
          List
        </button>
        <button
          type="button"
          className={view === 'map' ? 'chip chip-active' : 'chip'}
          onClick={() => setView('map')}
        >
          Map
        </button>
      </div>
      {view === 'map' && !loading ? (
        <>
          <ExploreMap listings={listings} onSelect={setSelected} />
          {selected ? (
            <MatchCard
              listing={selected}
              busy={busyId === selected.match.id}
              onJoin={onJoin}
              onWithdraw={onWithdraw}
            />
          ) : (
            <p className="hint">Tap a green pin to see that match.</p>
          )}
        </>
      ) : null}
      {loading ? <p className="loading">Loading matches…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}
      {!loading && !error && listings.length === 0 ? (
        <EmptyState
          title="No open games yet"
          hint="Be the first: tap + below and create a match."
        />
      ) : null}
      {view === 'list'
        ? listings.map((listing) => (
            <MatchCard
              key={listing.match.id}
              listing={listing}
              busy={busyId === listing.match.id}
              onJoin={onJoin}
              onWithdraw={onWithdraw}
            />
          ))
        : null}
      <div className="row">
        <h2>Venues</h2>
        <Link className="btn btn-ghost" to="/venues/dashboard">Venue dashboard</Link>
      </div>
      <input
        className="input"
        value={venueQuery}
        onChange={(e) => setVenueQuery(e.target.value)}
        placeholder="Search venues, areas, sports"
        aria-label="Search venues"
      />
      {venues
        .filter((v) => {
          const q = venueQuery.trim().toLowerCase();
          if (!q) return true;
          return (
            v.name.toLowerCase().includes(q) ||
            (v.area ?? '').toLowerCase().includes(q) ||
            v.sports.some((s) => s.toLowerCase().includes(q))
          );
        })
        .map((venue) => (
          <article className="card" key={venue.id}>
            <div className="row">
              <strong>{venue.name}</strong>
              <span className="tag">Free booking</span>
            </div>
            <p className="muted">
              {[venue.area, venue.sports.join(', '), venue.facility_types.join(', '), venue.price_note]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <Link className="btn" to={`/venues/${venue.id}`}>View venue &amp; book free</Link>
          </article>
        ))}
      {venues.length === 0 ? (
        <p className="hint">No listed venues yet — venues appear here once registered or seeded.</p>
      ) : null}
      {challenges.length > 0 ? <h2>Teams looking for opponents</h2> : null}
      {challenges.map((listing) => (
        <ChallengeCard key={listing.challenge.id} listing={listing} onChanged={reload} />
      ))}
    </div>
  );
}
