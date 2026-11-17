import { useCallback, useEffect, useState } from 'react';
import { useDataChanged } from '../lib/dataChanged';
import { Link } from 'react-router-dom';
import { CalendarDays, Radio, Shield, Ticket } from 'lucide-react';
import GameCard, { dayLabel, dayShort, timeLabel } from '../components/GameCard';
import MatchFoundOverlay from '../components/MatchFoundOverlay';
import { requestCreate } from '../components/AppShell';
import { Button, ButtonLink, Card, Crest, EmptyState, ErrorNote, FormGuide, ListRow, Section, SectionLink, Skeleton } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { fetchMyMatches, fetchMyPastMatches, fetchOpenMatches } from '../lib/matches';
import type { MatchListing } from '../lib/matches';
import { fetchForYouProfile, pickForYou } from '../lib/forYou';
import { peekPendingInvite } from '../lib/pendingInvite';
import { useMatchActions } from '../lib/useMatchActions';
import { fetchCircleUpdates, fetchNeedsYou, fetchTeamSummaries } from '../lib/today';
import { fetchFollowing } from '../lib/social';
import type { FeedItem } from '../lib/social';
import { FeedCard } from './CirclesPage';
import type { CircleUpdate, NeedsItem, TeamSummary } from '../lib/today';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export default function HomePage() {
  const { user, profile, session } = useAuth();
  const token = session?.access_token;
  const firstName = profile?.name ? profile.name.split(' ')[0] : null;
  const [upcoming, setUpcoming] = useState<MatchListing[]>([]);
  const [nearby, setNearby] = useState<MatchListing[]>([]);
  const [needs, setNeeds] = useState<NeedsItem[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [circleUpdates, setCircleUpdates] = useState<CircleUpdate[]>([]);
  const [inCircles, setInCircles] = useState(0);
  // Each section shows as soon as its own data lands; none waits on another.
  const [loading, setLoading] = useState(true);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [circlesLoading, setCirclesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);

  useEffect(() => setPendingInvite(peekPendingInvite()), []);

  const reload = useCallback(async () => {
    if (!user) return;
    const mineP = fetchMyMatches(user.id);
    const joinedP = mineP.then((m) => new Set(m.map((l) => l.match.id))).catch(() => new Set<string>());
    const teamsP = fetchTeamSummaries(user.id).catch(() => [] as TeamSummary[]);
    const pastP = fetchMyPastMatches(user.id, 20).catch(() => [] as MatchListing[]);

    const upcomingDone = mineP.then((mine) => {
      setUpcoming(mine.filter((l) => l.match.status !== 'cancelled'));
      setLoading(false);
    });
    const nearbyDone = Promise.all([fetchOpenMatches(user.id).catch(() => [] as MatchListing[]), fetchForYouProfile(user.id).catch(() => null), joinedP]).then(
      ([open, tuned, joined]) => {
        const area = (profile?.area ?? '').toLowerCase();
        setNearby(tuned ? pickForYou(open, tuned, area, joined, 6) : open.filter((l) => !joined.has(l.match.id)).slice(0, 6));
      },
    );
    const teamsDone = teamsP.then((rows) => {
      setTeams(rows);
      setTeamsLoading(false);
    });
    const circlesDone = Promise.all([fetchCircleUpdates(user.id).catch(() => ({ circles: [], updates: [] })), joinedP]).then(([circles, joined]) => {
      setCircleUpdates(circles.updates.filter((u) => !joined.has(u.match.id)));
      setInCircles(circles.circles.length);
      setCirclesLoading(false);
    });
    const needsDone = Promise.all([pastP, teamsP])
      .then(([past, rows]) => fetchNeedsYou(user.id, past, rows, token))
      .then(setNeeds)
      .catch(() => undefined);
    await Promise.all([upcomingDone, nearbyDone, teamsDone, circlesDone, needsDone]);
  }, [user, profile?.area, token]);
  useDataChanged(useCallback(() => { void reload().catch(() => undefined); }, [reload]));

  useEffect(() => {
    reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load your day.'))
      .finally(() => {
        setLoading(false);
        setTeamsLoading(false);
        setCirclesLoading(false);
      });
  }, [reload]);

  const { busyId, actionError, onJoin, celebration, dismissCelebration } = useMatchActions(reload);
  const join = (l: MatchListing) => onJoin(l.match.id, l.joinedCount, l.match.title);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 pt-4">
      {celebration ? <MatchFoundOverlay title={celebration.title} onClose={dismissCelebration} /> : null}

      <div>
        <p className="m-0 text-[13px] font-semibold text-muted">{longDate.format(new Date())}</p>
        <h1 className="m-0">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
      </div>

      <ErrorNote>{error ?? actionError}</ErrorNote>

      {pendingInvite && !loading ? (
        <Card className="flex items-center gap-3 p-3.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hl text-hl-text">
            <Ticket size={20} />
          </span>
          <span className="flex-1">
            <strong>You have an invite</strong>
            <br />
            <span className="text-[13px] text-muted">Someone asked you to join them.</span>
          </span>
          <ButtonLink to={`/invite/${encodeURIComponent(pendingInvite)}`} variant="primary" size="sm">
            Open
          </ButtonLink>
        </Card>
      ) : null}

      <Section title="Next up" action={upcoming.length > 0 ? <SectionLink to="/you#schedule">Schedule</SectionLink> : undefined}>
        {loading ? (
          <div className="flex gap-2.5 overflow-hidden">
            <Skeleton className="h-[188px] w-[272px] shrink-0" />
            <Skeleton className="h-[188px] w-[272px] shrink-0" />
          </div>
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="Nothing on the calendar"
            body="Join a game near you or host one. It shows up here with everything you need on the day."
            action={
              <div className="flex gap-2">
                <ButtonLink to="/explore" variant="primary" size="sm">
                  Find a game
                </ButtonLink>
              </div>
            }
          />
        ) : (
          <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
            {upcoming.map((l) => (
              <GameCard key={l.match.id} listing={l} variant="tile" />
            ))}
          </div>
        )}
      </Section>

      {needs.length > 0 ? (
        <Section title="Needs you" count={needs.length}>
          <Card className="overflow-hidden">
            {needs.map((n) => (
              <ListRow
                key={n.id}
                to={n.to}
                chevron={false}
                title={n.title}
                sub={n.sub}
                trailing={<span className="shrink-0 rounded-[10px] bg-brand px-3 py-2 text-[13px] font-bold text-on-brand">{n.cta}</span>}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {teamsLoading ? (
        <Skeleton className="h-28" />
      ) : (
        <Section title="Your teams" action={teams.length > 0 ? <SectionLink to="/teams">All teams</SectionLink> : undefined}>
          {teams.length === 0 ? (
            <EmptyState
              icon={<Shield size={22} />}
              title="No team yet"
              body="Start one for your regular side, or join with an invite link from your captain."
              action={<ButtonLink to="/teams" size="sm">Teams</ButtonLink>}
            />
          ) : (
            <Card className="overflow-hidden">
              {teams.map((t) => (
                <ListRow
                  key={t.team.id}
                  to={`/teams/${t.team.id}`}
                  chevron={false}
                  leading={<Crest id={t.team.id} name={t.team.name} src={t.team.logo_url} />}
                  title={t.team.name}
                  sub={
                    t.next
                      ? `Next: ${t.next.opponent}${t.next.when ? ` · ${dayLabel(t.next.when)} ${timeLabel(t.next.when)}` : ''}`
                      : t.last
                        ? `Last: ${resultWord(t.last.us, t.last.them)} ${t.last.us}–${t.last.them} vs ${t.last.opponent}`
                        : 'No games yet'
                  }
                  trailing={<FormGuide results={t.form} />}
                />
              ))}
            </Card>
          )}
        </Section>
      )}

      {token ? <TodayFollowing token={token} /> : null}

      {circlesLoading ? null : (
        <Section title="From your circles" action={<SectionLink to="/circles">{inCircles > 0 ? 'Circles' : 'Find circles'}</SectionLink>}>
          {circleUpdates.length === 0 ? (
            <Card className="flex items-center gap-3 p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                <Radio size={20} />
              </span>
              <span className="text-[14px] text-muted">
                {inCircles > 0 ? 'No new games in your circles this week.' : 'Join a circle for your sport and area to hear about its games first.'}
              </span>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {circleUpdates.map((u) => (
                <ListRow
                  key={u.match.id}
                  to={`/games/${u.match.id}`}
                  leading={
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
                      <span className="text-[10px] font-bold uppercase text-brand-text">{dayShort(u.match.starts_at)}</span>
                      <span className="tnum text-[13px] font-extrabold">{timeLabel(u.match.starts_at)}</span>
                    </span>
                  }
                  title={u.match.title}
                  sub={u.circle.name}
                />
              ))}
            </Card>
          )}
        </Section>
      )}

      {nearby.length > 0 ? (
        <Section title="Games near you" action={<SectionLink to="/explore">Explore</SectionLink>}>
          <div className="flex flex-col gap-2.5">
            {nearby.map((l) => (
              <GameCard key={l.match.id} listing={l} onJoin={join} busy={busyId === l.match.id} />
            ))}
          </div>
        </Section>
      ) : null}

      {!loading && upcoming.length === 0 && nearby.length === 0 ? (
        <Button variant="primary" block onClick={() => requestCreate('match')}>
          Host the first game in your area
        </Button>
      ) : null}
      <p className="m-0 pb-2 text-center text-[12px] text-muted">
        <Link to="/notifications" className="text-muted">
          Notifications
        </Link>
      </p>
    </div>
  );
}

function resultWord(us: number | null, them: number | null): string {
  if (us == null || them == null) return '';
  return us > them ? 'Won' : us < them ? 'Lost' : 'Drew';
}

// The latest three things from the creators, teams and events you follow. Hidden until you follow something.
function TodayFollowing({ token }: { token: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  useEffect(() => {
    fetchFollowing(token)
      .then((f) => setItems(f.items.slice(0, 3)))
      .catch(() => setItems([]));
  }, [token]);
  if (!items || items.length === 0) return null;
  return (
    <Section title="Following" action={<SectionLink to="/circles?tab=following">All</SectionLink>}>
      <div className="flex flex-col gap-3">
        {items.map((it, i) => (
          <FeedCard key={i} item={it} />
        ))}
      </div>
    </Section>
  );
}
