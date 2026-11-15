import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Building, List, Map as MapIcon, Radio, Search, Swords, Trophy, Volleyball } from 'lucide-react';
import { CATEGORY_LABELS, COMPETITION_STATUS_LABELS, FORMAT_LABELS } from '@chabuka/shared';
import type { Competition, Sport, Venue } from '@chabuka/shared';
import ChallengeCard from '../components/ChallengeCard';
import ExploreMap from '../components/ExploreMap';
import GameCard, { sportLabel } from '../components/GameCard';
import MatchFoundOverlay from '../components/MatchFoundOverlay';
import { requestCreate } from '../components/AppShell';
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, ListRow, Segmented, Skeleton } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { fetchOpenMatches, fetchSports } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchOpenChallenges } from '../lib/teams';
import type { ChallengeListing } from '../lib/teams';
import { fetchVenues } from '../lib/venues';
import { fetchCompetitions } from '../lib/competitions';
import { fetchCircles } from '../lib/circles';
import type { CircleListing } from '../lib/circles';
import { useMatchActions } from '../lib/useMatchActions';
import { fetchForYouProfile, pickForYou } from '../lib/forYou';
import type { ForYouProfile } from '../lib/forYou';

type Tab = 'games' | 'teams' | 'competitions' | 'venues' | 'circles';
type When = 'any' | 'today' | 'week' | 'weekend';

const TABS: { value: Tab; label: string }[] = [
  { value: 'games', label: 'Games' },
  { value: 'teams', label: 'Teams' },
  { value: 'competitions', label: 'Leagues' },
  { value: 'venues', label: 'Venues' },
  { value: 'circles', label: 'Circles' },
];

function inWindow(iso: string, when: When): boolean {
  if (when === 'any') return true;
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 86400000;
  const days = (d.getTime() - startOfToday.getTime()) / dayMs;
  if (when === 'today') return days >= 0 && days < 1;
  if (when === 'week') return days >= 0 && days < 7;
  // Weekend: the coming Saturday and Sunday (or today, if it is one).
  const dow = d.getDay();
  return days >= 0 && days < 8 && (dow === 6 || dow === 0);
}

function matches(text: (string | null | undefined)[], q: string): boolean {
  if (!q) return true;
  return text.some((t) => (t ?? '').toLowerCase().includes(q));
}

type CompetitionRow = Awaited<ReturnType<typeof fetchCompetitions>>[number];

export default function ExplorePage() {
  const { user, profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'games') as Tab;
  const setTab = (t: Tab) => {
    params.set('tab', t);
    setParams(params, { replace: true });
  };

  const [games, setGames] = useState<MatchListing[]>([]);
  const [challenges, setChallenges] = useState<ChallengeListing[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [circles, setCircles] = useState<CircleListing[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [tuned, setTuned] = useState<ForYouProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<string>('all');
  const [when, setWhen] = useState<When>('any');
  const [forYou, setForYou] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<MatchListing | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [g, ch, comps, vs, cs, sp, fy] = await Promise.all([
      fetchOpenMatches(user.id),
      fetchOpenChallenges(user.id).catch(() => []),
      fetchCompetitions().catch(() => []),
      fetchVenues().catch(() => []),
      fetchCircles(user.id).catch(() => []),
      fetchSports().catch(() => []),
      fetchForYouProfile(user.id).catch(() => null),
    ]);
    setGames(g);
    setChallenges(ch);
    setCompetitions(comps);
    setVenues(vs);
    setCircles(cs);
    setSports(sp);
    setTuned(fy);
  }, [user]);

  useEffect(() => {
    reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load Explore.'))
      .finally(() => setLoading(false));
  }, [reload]);

  const { busyId, actionError, onJoin, celebration, dismissCelebration } = useMatchActions(reload);
  const q = query.trim().toLowerCase();
  const sportName = sport === 'all' ? null : (sports.find((s) => s.id === sport)?.name ?? null);

  const visibleGames = useMemo(() => {
    const base = games.filter(
      (l) =>
        (sport === 'all' || l.match.sport_id === sport) &&
        inWindow(l.match.starts_at, when) &&
        matches([l.match.title, l.match.area, l.sport?.name, l.venue?.name, l.match.venue_name], q),
    );
    if (!forYou || !tuned) return base;
    const joined = new Set(base.filter((l) => l.isParticipant).map((l) => l.match.id));
    return pickForYou(base, tuned, (profile?.area ?? '').toLowerCase(), joined, 100);
  }, [games, sport, when, q, forYou, tuned, profile?.area]);

  // Sports that actually have games, so the chips never lead to nothing.
  const gameSports = useMemo(() => {
    const ids = new Set(games.map((l) => l.match.sport_id));
    return sports.filter((s) => ids.has(s.id));
  }, [games, sports]);

  const legacyHighlight = params.get('highlight');
  if (legacyHighlight) return <Navigate to={`/games/${legacyHighlight}`} replace />;

  const visibleChallenges = challenges.filter(
    (c) => (sport === 'all' || c.challenge.sport_id === sport) && matches([c.team?.name, c.challenge.area, c.sport?.name], q),
  );
  const visibleComps = competitions.filter(
    (c) => (sport === 'all' || c.competition.sport_id === sport) && matches([c.competition.name, c.competition.area], q),
  );
  const visibleVenues = venues.filter(
    (v) => (!sportName || v.sports.some((s) => s.toLowerCase() === sportName.toLowerCase())) && matches([v.name, v.area, ...v.sports], q),
  );
  const visibleCircles = circles.filter(
    (c) => (sport === 'all' || !c.circle.sport_id || c.circle.sport_id === sport) && matches([c.circle.name, c.circle.area, c.circle.description], q),
  );

  const counts: Record<Tab, number> = {
    games: visibleGames.length,
    teams: visibleChallenges.length,
    competitions: visibleComps.length,
    venues: visibleVenues.length,
    circles: visibleCircles.length,
  };

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-4 pt-4">
      {celebration ? <MatchFoundOverlay title={celebration.title} onClose={dismissCelebration} /> : null}
      <h1 className="m-0">Explore</h1>

      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games, teams, venues, areas"
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-10 pr-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>

      <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
        <Segmented
          label="Explore sections"
          value={tab}
          onChange={setTab}
          className="min-w-max"
          options={TABS.map((t) => ({
            value: t.value,
            label: (
              <>
                {t.label}
                {!loading ? <span className="tnum ml-1 font-semibold opacity-60">{counts[t.value]}</span> : null}
              </>
            ),
          }))}
        />
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Filter by sport">
        <Chip on={sport === 'all'} onClick={() => setSport('all')}>
          All sports
        </Chip>
        {(tab === 'games' ? gameSports : sports).map((s) => (
          <Chip key={s.id} on={sport === s.id} onClick={() => setSport(sport === s.id ? 'all' : s.id)}>
            {sportLabel(s.name)}
          </Chip>
        ))}
      </div>

      <ErrorNote>{error ?? actionError}</ErrorNote>

      {tab === 'games' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="no-scrollbar flex gap-2 overflow-x-auto" role="group" aria-label="When">
              {(
                [
                  ['any', 'Any time'],
                  ['today', 'Today'],
                  ['week', 'This week'],
                  ['weekend', 'Weekend'],
                ] as [When, string][]
              ).map(([v, label]) => (
                <Chip key={v} on={when === v} onClick={() => setWhen(v)}>
                  {label}
                </Chip>
              ))}
              <Chip on={forYou} onClick={() => setForYou((x) => !x)}>
                For you
              </Chip>
            </div>
            <div className="flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="View">
              <button
                type="button"
                aria-pressed={view === 'list'}
                aria-label="List"
                onClick={() => setView('list')}
                className={`flex h-9 w-10 cursor-pointer items-center justify-center rounded-[10px] border-0 ${view === 'list' ? 'bg-surface-2 text-ink' : 'bg-transparent text-muted'}`}
              >
                <List size={18} />
              </button>
              <button
                type="button"
                aria-pressed={view === 'map'}
                aria-label="Map"
                onClick={() => setView('map')}
                className={`flex h-9 w-10 cursor-pointer items-center justify-center rounded-[10px] border-0 ${view === 'map' ? 'bg-surface-2 text-ink' : 'bg-transparent text-muted'}`}
              >
                <MapIcon size={18} />
              </button>
            </div>
          </div>
          {forYou && tuned && tuned.slots.size === 0 && tuned.sports.size === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              Set your sports and free times in <Link to="/you/settings#week">Settings</Link> and this list ranks around them.
            </p>
          ) : null}

          {loading ? (
            <div className="flex flex-col gap-2.5">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : view === 'map' ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-2xl border border-line">
                <ExploreMap listings={visibleGames} onSelect={setSelected} />
              </div>
              {selected ? (
                <GameCard listing={selected} onJoin={(l) => onJoin(l.match.id, l.joinedCount, l.match.title)} busy={busyId === selected.match.id} />
              ) : (
                <p className="m-0 text-[13px] text-muted">Tap a pin to see the game.</p>
              )}
            </div>
          ) : visibleGames.length === 0 ? (
            <EmptyState
              icon={<Volleyball size={22} />}
              title={games.length === 0 ? 'No open games yet' : 'No games match'}
              body={games.length === 0 ? 'Host one and players nearby will see it here.' : 'Try another sport or time, or clear the search.'}
              action={
                <Button variant="primary" size="sm" onClick={() => requestCreate('match')}>
                  Host a game
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {visibleGames.map((l) => (
                <GameCard key={l.match.id} listing={l} onJoin={(x) => onJoin(x.match.id, x.joinedCount, x.match.title)} busy={busyId === l.match.id} />
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === 'teams' ? (
        <>
          <p className="m-0 text-[14px] text-muted">Teams looking for an opponent. Captains can accept for their side or propose another time.</p>
          {loading ? (
            <Skeleton className="h-40" />
          ) : visibleChallenges.length === 0 ? (
            <EmptyState
              icon={<Swords size={22} />}
              title="No open challenges"
              body="Post one for your team and sides nearby can take you on."
              action={
                <Button variant="primary" size="sm" onClick={() => requestCreate('opponent')}>
                  Challenge a team
                </Button>
              }
            />
          ) : (
            visibleChallenges.map((c) => <ChallengeCard key={c.challenge.id} listing={c} onChanged={reload} />)
          )}
        </>
      ) : null}

      {tab === 'competitions' ? (
        loading ? (
          <Skeleton className="h-40" />
        ) : visibleComps.length === 0 ? (
          <EmptyState
            icon={<Trophy size={22} />}
            title="No leagues or tournaments yet"
            body="Run one: entries, fixtures and a live table in one place."
            action={
              <Link to="/competitions/new" className="text-[14px] font-bold text-brand-text">
                Start a competition
              </Link>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            {visibleComps.map(({ competition, entryTeamIds }) => (
              <ListRow
                key={competition.id}
                to={`/competitions/${competition.id}`}
                leading={
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                    <Trophy size={20} />
                  </span>
                }
                title={competition.name}
                sub={compSub(competition, entryTeamIds.length, sports)}
                trailing={<Badge tone={competition.status === 'registration' ? 'hl' : competition.status === 'live' ? 'brand' : 'muted'}>{COMPETITION_STATUS_LABELS[competition.status]}</Badge>}
              />
            ))}
          </Card>
        )
      ) : null}

      {tab === 'venues' ? (
        loading ? (
          <Skeleton className="h-40" />
        ) : visibleVenues.length === 0 ? (
          <EmptyState
            icon={<Building size={22} />}
            title="No venues listed"
            body="Run a pitch or court? List it and take bookings here."
            action={
              <Link to="/venues/dashboard" className="text-[14px] font-bold text-brand-text">
                List a venue
              </Link>
            }
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visibleVenues.map((v) => (
              <Link key={v.id} to={`/venues/${v.id}`} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink no-underline hover:border-line-strong">
                {v.photos[0] ? (
                  <img src={v.photos[0]} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <span className="flex h-32 items-center justify-center bg-surface-2 text-muted">
                    <Building size={28} />
                  </span>
                )}
                <span className="flex flex-col gap-1 p-3">
                  <strong>{v.name}</strong>
                  <span className="text-[13px] text-muted">{[v.area, v.sports.join(', ')].filter(Boolean).join(' · ')}</span>
                  {v.price_note ? <span className="text-[13px] font-semibold">{v.price_note}</span> : null}
                </span>
              </Link>
            ))}
          </div>
        )
      ) : null}

      {tab === 'circles' ? (
        loading ? (
          <Skeleton className="h-40" />
        ) : visibleCircles.length === 0 ? (
          <EmptyState icon={<Radio size={22} />} title="No circles here yet" body="Start one for your sport and area." action={<Link to="/circles?create=1" className="text-[14px] font-bold text-brand-text">Start a circle</Link>} />
        ) : (
          <Card className="overflow-hidden">
            {visibleCircles.map(({ circle, memberCount, isMember }) => (
              <ListRow
                key={circle.id}
                to="/circles"
                leading={
                  circle.photo_url ? (
                    <img src={circle.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                      <Radio size={20} />
                    </span>
                  )
                }
                title={circle.name}
                sub={`${memberCount} member${memberCount === 1 ? '' : 's'}${circle.area ? ` · ${circle.area}` : ''}`}
                trailing={isMember ? <Badge tone="brand">Joined</Badge> : undefined}
              />
            ))}
          </Card>
        )
      ) : null}
    </div>
  );
}

function compSub(c: Competition, entries: number, sports: Sport[]): string {
  const sport = sportLabel(sports.find((s) => s.id === c.sport_id)?.name) || null;
  return [CATEGORY_LABELS[c.category], sport, FORMAT_LABELS[c.format], `${entries}/${c.max_entries} teams`, c.area].filter(Boolean).join(' · ');
}
