import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDataChanged } from '../lib/dataChanged';
import { Link } from 'react-router-dom';
import { Building, CalendarDays, Plus, Radio, Settings, Shield } from 'lucide-react';
import { LEVEL_LABELS, ageBand } from '@chabuka/shared';
import type { Level } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchMyMatches, fetchMyPastMatches, fetchSports } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchMyTeams } from '../lib/teams';
import type { MyTeam } from '../lib/teams';
import { fetchCircles } from '../lib/circles';
import type { CircleListing } from '../lib/circles';
import { fetchMyBookingsAll, fetchMyVenues as fetchRunVenues } from '../lib/venueBooking';
import type { MyBooking, MyVenue } from '../lib/venueBooking';
import { fetchMyRaces } from '../lib/races';
import { fetchMyRecord } from '../lib/records';
import type { MyRecordView } from '../lib/records';
import { FreeTonightCard, RecordCard } from '../components/Records';
import { GolfRecord } from '../components/golf/GolfRecord';
import type { Sport } from '@chabuka/shared';
import type { MyRace } from '../lib/races';
import { formatDuration, pace } from '@chabuka/shared';
import { dayShort, sportLabel, statusBadge, timeLabel } from '../components/GameCard';
import { requestCreate } from '../components/AppShell';
import { Avatar, Badge, ButtonLink, Card, Crest, EmptyState, ListRow, Section, SectionLink, Skeleton, StatTile, cx } from '../components/ui';

interface SportLevel {
  name: string;
  level: Level | null;
}

function weekStart(t: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const WEEKS = 16;

export default function ProfilePage() {
  const { profile, user, session } = useAuth();
  const token = session?.access_token;
  const [upcoming, setUpcoming] = useState<MatchListing[]>([]);
  const [past, setPast] = useState<MatchListing[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [circles, setCircles] = useState<CircleListing[]>([]);
  const [myVenues, setMyVenues] = useState<MyVenue[]>([]);
  const [myRaces, setMyRaces] = useState<MyRace[]>([]);
  const [myRecord, setMyRecord] = useState<MyRecordView | null>(null);
  const [allSports, setAllSports] = useState<Sport[]>([]);
  const [sports, setSports] = useState<SportLevel[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped when Gaffer (or anything else) changes the player's games, so the schedule reloads.
  const [version, setVersion] = useState(0);
  useDataChanged(useCallback(() => setVersion((v) => v + 1), []));

  useEffect(() => {
    const db = supabase;
    if (!user || !db) return;
    void (async () => {
      const [up, pa, bk, tm, cs, mv, us] = await Promise.all([
        fetchMyMatches(user.id).catch(() => []),
        fetchMyPastMatches(user.id, 100).catch(() => []),
        token ? fetchMyBookingsAll(token).catch(() => [] as MyBooking[]) : Promise.resolve([] as MyBooking[]),
        fetchMyTeams(user.id).catch(() => []),
        fetchCircles(user.id).catch(() => []),
        token ? fetchRunVenues(token).catch(() => [] as MyVenue[]) : Promise.resolve([] as MyVenue[]),
        db.from('user_sports').select('sport_id,level,sports(name)').eq('user_id', user.id),
      ]);
      setUpcoming(up.filter((l) => l.match.status !== 'cancelled'));
      setPast(pa);
      setBookings(
        bk
          .filter((b) => (b.status === 'requested' || b.status === 'confirmed') && new Date(b.endsAt).getTime() > Date.now())
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
      setTeams(tm);
      if (token) fetchMyRaces(token).then(setMyRaces).catch(() => setMyRaces([]));
      if (token) fetchMyRecord(token).then(setMyRecord).catch(() => setMyRecord(null));
      fetchSports().then(setAllSports).catch(() => setAllSports([]));
      setCircles(cs.filter((c) => c.isMember));
      setMyVenues(mv);
      const rows = (us.data ?? []) as unknown as { level: Level | null; sports: { name: string } | { name: string }[] | null }[];
      setSports(
        rows
          .map((r) => ({ name: (Array.isArray(r.sports) ? r.sports[0]?.name : r.sports?.name) ?? '', level: r.level }))
          .filter((s) => s.name),
      );
      setLoading(false);
    })();
  }, [user, token, version]);

  const record = useMemo(() => {
    const played = past.filter((l) => l.isParticipant && l.match.status === 'finished');
    const hosted = past.filter((l) => l.isOrganiser && l.match.status !== 'cancelled').length + upcoming.filter((l) => l.isOrganiser).length;
    const weeks = new Map<number, number>();
    for (const l of played) {
      const w = weekStart(new Date(l.match.starts_at).getTime());
      weeks.set(w, (weeks.get(w) ?? 0) + 1);
    }
    let streak = 0;
    let cursor = weekStart(Date.now());
    // This week only counts once it has a game; otherwise start from last week.
    if (!weeks.has(cursor)) cursor -= 7 * 86400000;
    while (weeks.has(cursor)) {
      streak += 1;
      cursor -= 7 * 86400000;
    }
    const thisWeek = weekStart(Date.now());
    const grid = Array.from({ length: WEEKS }, (_, i) => {
      const w = thisWeek - (WEEKS - 1 - i) * 7 * 86400000;
      return { w, n: weeks.get(w) ?? 0 };
    });
    const bySport = new Map<string, number>();
    for (const l of played) {
      const k = l.sport?.name ?? 'Other';
      bySport.set(k, (bySport.get(k) ?? 0) + 1);
    }
    return { played: played.length, hosted, streak, grid, bySport: [...bySport.entries()].sort((a, b) => b[1] - a[1]) };
  }, [past, upcoming]);

  const details = [profile?.area, profile ? ageBand(profile.birth_year) : null].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 pb-4">
      {/* Player card */}
      <section className="overflow-hidden border-b border-line bg-surface lg:mt-4 lg:rounded-3xl lg:border">
        {profile?.cover_url ? <img src={profile.cover_url} alt="" className="h-28 w-full object-cover" /> : <div className="h-16 bg-brand-soft" />}
        <div className="flex flex-col gap-4 px-4 pb-5">
          <div className="-mt-9 flex items-end justify-between gap-3">
            <Avatar name={profile?.name} src={profile?.photo_url} size={76} className="border-4 border-surface" />
            <ButtonLink to="/you/settings" size="sm" icon={<Settings size={15} />}>
              Settings
            </ButtonLink>
          </div>
          <div>
            <h1 className="m-0">{profile?.name ?? 'New player'}</h1>
            <p className="m-0 text-[14px] text-muted">{details || 'Add your area in Settings'}</p>
          </div>
          {sports.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {sports.map((s) => (
                <Badge key={s.name} tone="brand">
                  {sportLabel(s.name)}
                  {s.level ? <span className="font-semibold opacity-75"> · {LEVEL_LABELS[s.level]}</span> : null}
                </Badge>
              ))}
            </div>
          ) : null}
          {myRecord ? (
            <RecordCard data={myRecord} />
          ) : (
          <>
          <div className="grid grid-cols-4 gap-2">
            <StatTile value={loading ? '–' : record.played} label="Played" />
            <StatTile value={loading ? '–' : record.hosted} label="Hosted" />
            <StatTile value={loading ? '–' : `${record.streak}`} label="Wk streak" />
            <StatTile value={loading ? '–' : teams.length} label="Teams" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-bold text-muted">Last {WEEKS} weeks</span>
              {record.bySport.length > 0 ? (
                <span className="text-[12px] text-muted">{record.bySport.map(([n, c]) => `${sportLabel(n)} ${c}`).join(' · ')}</span>
              ) : null}
            </div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }} role="img" aria-label={`Games per week over the last ${WEEKS} weeks`}>
              {record.grid.map((g) => (
                <span
                  key={g.w}
                  title={`${new Date(g.w).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${g.n} game${g.n === 1 ? '' : 's'}`}
                  className={cx('h-6 rounded-[5px]', g.n === 0 ? 'bg-surface-2' : g.n === 1 ? 'bg-brand/45' : g.n === 2 ? 'bg-brand/70' : 'bg-brand')}
                />
              ))}
            </div>
          </div>
          </>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-6 px-4">
        <FreeTonightCard sports={allSports} />
        {/* Golf: shown once there is golf in their life here (or golf among their sports, to start logging rounds). */}
        <GolfRecord always={sports.some((sp) => sp.name.toLowerCase() === 'golf')} />

        <Section title="Schedule" count={upcoming.length + bookings.length} action={<SectionLink to="/explore">Find games</SectionLink>}>
          <span id="schedule" className="sr-only" />
          {loading ? (
            <Skeleton className="h-24" />
          ) : upcoming.length + bookings.length === 0 ? (
            <EmptyState icon={<CalendarDays size={22} />} title="Nothing booked" body="Games you join or host, and courts you book, line up here." />
          ) : (
            <Card className="overflow-hidden">
              {upcoming.map((l) => (
                <ListRow
                  key={l.match.id}
                  to={`/games/${l.match.id}`}
                  leading={<DateBlock iso={l.match.starts_at} />}
                  title={l.match.title}
                  sub={[sportLabel(l.sport?.name), l.isOrganiser ? 'You host' : null, statusBadge(l)?.label].filter(Boolean).join(' · ')}
                />
              ))}
              {bookings.map((b) => (
                <ListRow
                  key={b.id}
                  to={`/venues/${b.venueId}`}
                  leading={<DateBlock iso={b.startsAt} />}
                  title={`${b.venueName} · ${b.spaceName}`}
                  sub={[
                    `${timeLabel(b.startsAt)}`,
                    b.status === 'confirmed' ? (b.checkoutUrl ? 'Accepted, payment due' : 'Booked') : 'Waiting for the venue',
                    b.code ? `code ${b.code}` : null,
                    b.groupId ? 'weekly' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </Card>
          )}
        </Section>

        {past.length > 0 ? (
          <Section title="Recent games">
            <Card className="overflow-hidden">
              {past.slice(0, 6).map((l) => {
                const scored = l.match.home_score != null && l.match.away_score != null;
                return (
                  <ListRow
                    key={l.match.id}
                    to={`/games/${l.match.id}`}
                    leading={<DateBlock iso={l.match.starts_at} />}
                    title={l.match.title}
                    sub={[sportLabel(l.sport?.name), l.match.status === 'finished' ? 'Played' : statusBadge(l)?.label].filter(Boolean).join(' · ')}
                    trailing={scored ? <span className="tnum font-extrabold">{l.match.home_score}–{l.match.away_score}</span> : undefined}
                  />
                );
              })}
            </Card>
          </Section>
        ) : null}

        {myRaces.length > 0 ? <RacesSection races={myRaces} /> : null}

        <Section title="Teams" count={teams.length} action={<SectionLink to="/teams">Manage</SectionLink>}>
          {teams.length === 0 ? (
            <EmptyState
              icon={<Shield size={22} />}
              title="Not in a team yet"
              body="Start one, or ask your captain for an invite link."
              action={
                <button type="button" onClick={() => requestCreate('team')} className="cursor-pointer border-0 bg-transparent text-[14px] font-bold text-brand-text">
                  Start a team
                </button>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              {teams.map(({ team, role }) => (
                <ListRow
                  key={team.id}
                  to={`/teams/${team.id}`}
                  leading={<Crest id={team.id} name={team.name} src={team.logo_url} />}
                  title={team.name}
                  sub={[team.area, team.category].filter(Boolean).join(' · ')}
                  trailing={role !== 'player' ? <Badge tone="brand">{role === 'owner' ? 'Owner' : 'Captain'}</Badge> : undefined}
                />
              ))}
            </Card>
          )}
        </Section>

        <Section title="Circles" count={circles.length} action={<SectionLink to="/circles">{circles.length ? 'All' : 'Find circles'}</SectionLink>}>
          {circles.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">Join a circle for your sport and area to hear about its games.</p>
          ) : (
            <Card className="overflow-hidden">
              {circles.map(({ circle, memberCount }) => (
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
                  sub={`${memberCount} member${memberCount === 1 ? '' : 's'}`}
                />
              ))}
            </Card>
          )}
        </Section>

        <Section title="Venues you run" action={<SectionLink to="/venues/dashboard">{myVenues.length ? 'Dashboard' : 'List a venue'}</SectionLink>}>
          {myVenues.length === 0 ? (
            <Link to="/venues/dashboard" className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong p-3.5 text-[14px] text-muted no-underline">
              <Plus size={18} /> Own a pitch or court? List it and take bookings on Chabuka.
            </Link>
          ) : (
            <Card className="overflow-hidden">
              {myVenues.map((v) => (
                <ListRow
                  key={v.id}
                  to={`/venues/${v.id}/manage`}
                  leading={
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                      <Building size={20} />
                    </span>
                  }
                  title={v.name}
                  sub={[v.area, v.role === 'manager' ? 'Manager' : null].filter(Boolean).join(' · ')}
                  trailing={
                    v.waiting > 0 ? (
                      <Badge tone="live">{v.waiting} waiting</Badge>
                    ) : v.status !== 'approved' ? (
                      <Badge tone={v.status === 'pending' ? 'hl' : 'live'}>{v.status === 'pending' ? 'In review' : 'Not approved'}</Badge>
                    ) : undefined
                  }
                />
              ))}
            </Card>
          )}
        </Section>
      </div>
    </div>
  );
}

function DateBlock({ iso }: { iso: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
      <span className="text-[10px] font-bold uppercase text-brand-text">{dayShort(iso)}</span>
      <span className="tnum text-[13px] font-extrabold">{timeLabel(iso)}</span>
    </span>
  );
}

// Races entered and run, newest first, with personal bests per distance (from organised races only: no self-logging).
function RacesSection({ races }: { races: MyRace[] }) {
  const finished = races.filter((r) => r.result?.status === 'finished' && r.result.seconds != null && r.distance);
  const pbs = new Map<string, MyRace>();
  for (const r of finished) {
    const key = r.distance!.name;
    const best = pbs.get(key);
    if (!best || (r.result!.seconds ?? Infinity) < (best.result!.seconds ?? Infinity)) pbs.set(key, r);
  }
  return (
    <Section title="Races" count={races.length}>
      {pbs.size > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...pbs.entries()].map(([name, r]) => (
            <StatTile key={name} value={formatDuration(r.result!.seconds)} label={`${name} best`} />
          ))}
        </div>
      ) : null}
      <Card className="overflow-hidden">
        {races.slice(0, 8).map((r) => (
          <ListRow
            key={r.entryId}
            to={r.race ? `/races/${r.race.id}` : undefined}
            leading={r.distance ? <DateBlock iso={r.distance.startsAt} /> : undefined}
            title={r.race?.name ?? 'Race'}
            sub={[
              r.distance?.name,
              r.runner,
              r.result?.status === 'finished'
                ? `${formatDuration(r.result.seconds)}${r.result.overall ? `, #${r.result.overall} overall` : ''}${r.distance ? `, ${pace(r.result.seconds, r.distance.km)}` : ''}`
                : r.result
                  ? r.result.status.toUpperCase()
                  : r.status === 'pending_payment'
                    ? 'Waiting for payment'
                    : r.bib
                      ? `Bib ${r.bib}`
                      : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </Card>
    </Section>
  );
}
