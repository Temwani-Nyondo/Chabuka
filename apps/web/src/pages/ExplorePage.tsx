import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchEvent } from 'react';
import EmptyState from '../components/EmptyState';
import ChallengeCard from '../components/ChallengeCard';
import ExploreMap from '../components/ExploreMap';
import MatchCard from '../components/MatchCard';
import MatchFoundOverlay from '../components/MatchFoundOverlay';
import VenuePhoto from '../components/VenuePhoto';
import { useAuth } from '../auth/AuthContext';
import { fetchOpenMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchOpenChallenges } from '../lib/teams';
import type { ChallengeListing } from '../lib/teams';
import { fetchVenues } from '../lib/venues';
import type { Venue } from '@chabuka/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { useMatchActions } from '../lib/useMatchActions';
import { fetchForYouProfile, pickForYou } from '../lib/forYou';
import type { ForYouProfile } from '../lib/forYou';

type ExploreTab = 'play' | 'teams' | 'venues';
const TABS: ExploreTab[] = ['play', 'teams', 'venues'];
const TAB_LABELS: Record<ExploreTab, string> = {
  play: 'Play',
  teams: 'Teams',
  venues: 'Venues',
};
const SWIPE_PX = 60;

export default function ExplorePage() {
  const { user, profile } = useAuth();
  const [listings, setListings] = useState<MatchListing[]>([]);
  const [challenges, setChallenges] = useState<ChallengeListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ExploreTab>('play');
  const [mode, setMode] = useState<'list' | 'map'>('list');
  // Deep link from Gaffer ("View your game"): jump to the Play tab in
  // list mode and flash the created card.
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  useEffect(() => {
    if (highlightId) {
      setTab('play');
      setMode('list');
    }
  }, [highlightId]);
  const [selected, setSelected] = useState<MatchListing | null>(null);
  const [sport, setSport] = useState('All');
  const [query, setQuery] = useState('');
  const [forYouOnly, setForYouOnly] = useState(false);
  const [tuned, setTuned] = useState<ForYouProfile | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueQuery, setVenueQuery] = useState('');
  const touchX = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [rows, open, forYou] = await Promise.all([
      fetchOpenMatches(user.id),
      fetchOpenChallenges(user.id),
      fetchForYouProfile(user.id).catch(() => null),
    ]);
    setListings(rows);
    setChallenges(open);
    setTuned(forYou);
    setVenues(await fetchVenues().catch(() => []));
  }, [user]);

  useEffect(() => {
    reload()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load matches.'),
      )
      .finally(() => setLoading(false));
  }, [reload]);

  const { busyId, actionError, onJoin, onWithdraw, celebration, dismissCelebration } =
    useMatchActions(reload);

  const onTouchStart = (e: TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (touchX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchX.current;
    const dx = endX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < SWIPE_PX) return;
    const i = TABS.indexOf(tab);
    // Swipe left goes forward, swipe right goes back.
    const next = dx < 0 ? Math.min(TABS.length - 1, i + 1) : Math.max(0, i - 1);
    if (TABS[next] !== tab) setTab(TABS[next] as ExploreTab);
  };

  const sports = ['All', ...new Set(listings.map((l) => l.sport?.name).filter(Boolean) as string[])];
  const baseGames = listings.filter((l) => {
    if (sport !== 'All' && l.sport?.name !== sport) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      l.match.title.toLowerCase().includes(q) ||
      (l.match.area ?? '').toLowerCase().includes(q) ||
      (l.sport?.name ?? '').toLowerCase().includes(q)
    );
  });
  const joinedIds = new Set(listings.filter((l) => l.isParticipant).map((l) => l.match.id));
  const visibleGames =
    forYouOnly && tuned
      ? pickForYou(baseGames, tuned, (profile?.area ?? '').toLowerCase(), joinedIds, 100)
      : baseGames;
  const forYouTuned = tuned !== null && (tuned.slots.size > 0 || tuned.sports.size > 0);
  // Bucketed into sport cards when browsing everything.
  const grouped = sport === 'All' && !query.trim() && !forYouOnly;
  const groups = new Map<string, MatchListing[]>();
  if (grouped) {
    for (const l of visibleGames) {
      const key = l.sport?.name ?? 'Other sports';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(l);
    }
  }

  return (
    <div className="page">
      {celebration ? (
        <MatchFoundOverlay title={celebration.title} onClose={dismissCelebration} />
      ) : null}
      <div className="page-head">
        <span className="eyebrow">Games · Teams · Venues</span>
        <h1>Explore</h1>
        <p>Swipe or tap: games to play, teams to face, venues to book.</p>
      </div>
      <div className="chips" role="tablist" aria-label="Explore sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'chip chip-active' : 'chip'}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            {t === 'play' ? ` (${listings.length})` : null}
            {t === 'teams' ? ` (${challenges.length})` : null}
          </button>
        ))}
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {tab === 'play' ? (
          <>
            <div className="chips" role="group" aria-label="Filter by sport">
              <button
                type="button"
                className={forYouOnly ? 'chip chip-active' : 'chip'}
                aria-pressed={forYouOnly}
                onClick={() => setForYouOnly((v) => !v)}
              >
                For you
              </button>
              {sports.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={sport === s ? 'chip chip-active' : 'chip'}
                  aria-pressed={sport === s}
                  onClick={() => setSport(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {forYouOnly && !forYouTuned ? (
              <p className="hint">
                Set your sports and week on your <Link to="/profile">profile</Link> to tune this feed.
              </p>
            ) : null}
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search games, areas, sports"
              aria-label="Search games"
            />
            <div className="chips" role="tablist" aria-label="Games view">
              <button
                type="button"
                className={mode === 'list' ? 'chip chip-active' : 'chip'}
                onClick={() => setMode('list')}
              >
                List
              </button>
              <button
                type="button"
                className={mode === 'map' ? 'chip chip-active' : 'chip'}
                onClick={() => setMode('map')}
              >
                Map
              </button>
            </div>
            {mode === 'map' && !loading ? (
              <>
                <ExploreMap listings={visibleGames} onSelect={setSelected} />
                {selected ? (
                  <MatchCard
                    listing={selected}
                    highlighted={selected.match.id === highlightId}
                    busy={busyId === selected.match.id}
                    onJoin={onJoin}
                    onWithdraw={onWithdraw}
                    onTicketingChanged={() => void reload()}
                  />
                ) : (
                  <p className="hint">Tap a green pin to see that match.</p>
                )}
              </>
            ) : null}
            {loading ? <p className="loading">Loading matches…</p> : null}
            {error ? <p className="error">{error}</p> : null}
            {actionError ? <p className="error">{actionError}</p> : null}
            {!loading && !error && visibleGames.length === 0 ? (
              <EmptyState
                title="No open games yet"
                hint="Be the first: tap + below and create a match."
              />
            ) : null}
            {mode === 'list' && grouped
              ? [...groups.entries()].map(([sportName, rows]) => (
                  <section key={sportName} aria-label={sportName}>
                    <h2>{sportName}</h2>
                    {rows.map((listing) => (
                      <MatchCard
                        key={listing.match.id}
                        listing={listing}
                        highlighted={listing.match.id === highlightId}
                        busy={busyId === listing.match.id}
                        onJoin={onJoin}
                        onWithdraw={onWithdraw}
                        onTicketingChanged={() => void reload()}
                      />
                    ))}
                  </section>
                ))
              : null}
            {mode === 'list' && !grouped
              ? visibleGames.map((listing) => (
                  <MatchCard
                    key={listing.match.id}
                    listing={listing}
                    highlighted={listing.match.id === highlightId}
                    busy={busyId === listing.match.id}
                    onJoin={onJoin}
                    onWithdraw={onWithdraw}
                    onTicketingChanged={() => void reload()}
                  />
                ))
              : null}
          </>
        ) : null}
        {tab === 'teams' ? (
          <>
            <p className="muted">Team-vs-team challenges. Register your side and face them.</p>
            {challenges.length === 0 && !loading ? (
              <EmptyState
                title="No open challenges"
                hint="No teams are looking for opponents right now."
              />
            ) : null}
            {challenges.map((listing) => (
              <ChallengeCard key={listing.challenge.id} listing={listing} onChanged={reload} />
            ))}
          </>
        ) : null}
        {tab === 'venues' ? (
          <>
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
                  <VenuePhoto photos={venue.photos} name={venue.name} />
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
          </>
        ) : null}
      </div>
    </div>
  );
}
