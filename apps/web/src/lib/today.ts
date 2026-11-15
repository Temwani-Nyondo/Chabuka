import type { Team, TeamRole } from '@chabuka/shared';
import { supabase } from './supabase';
import { fetchMyTeams, isCaptainRole } from './teams';
import { fetchMyVenues, fetchVenueBookings } from './venues';
import { fetchCircles, fetchCircleEvents } from './circles';
import type { CircleListing } from './circles';
import type { MatchListing } from './matches';
import type { Match } from '@chabuka/shared';

export type Result = 'W' | 'D' | 'L';

// Something only this player can move forward. Each one links to the
// screen where it is done, with the button label it needs.
export interface NeedsItem {
  id: string;
  kind: 'result' | 'challenge' | 'booking' | 'week' | 'confirm' | 'entries' | 'dispute';
  title: string;
  sub: string;
  to: string;
  cta: string;
}

export interface TeamGame {
  opponent: string;
  us: number | null;
  them: number | null;
  when: string | null;
  competition: string | null;
}

export interface TeamSummary {
  team: Team;
  role: TeamRole;
  form: Result[];
  last: TeamGame | null;
  next: TeamGame | null;
}

export interface CircleUpdate {
  circle: CircleListing['circle'];
  match: Match;
}

function resultOf(us: number, them: number): Result {
  return us > them ? 'W' : us < them ? 'L' : 'D';
}

// Fixtures (competitions) and accepted challenges (friendlies) for every team
// the player is in, folded into last result, next game and a 5-game form.
export async function fetchTeamSummaries(userId: string): Promise<TeamSummary[]> {
  const db = supabase;
  if (!db) return [];
  const mine = await fetchMyTeams(userId);
  if (mine.length === 0) return [];
  const ids = mine.map((m) => m.team.id);
  const idList = ids.join(',');

  const [{ data: fixRows }, { data: chRows }] = await Promise.all([
    db
      .from('fixtures')
      .select('competition_id,home_team_id,away_team_id,starts_at,home_score,away_score,status')
      .or(`home_team_id.in.(${idList}),away_team_id.in.(${idList})`)
      .order('starts_at', { ascending: false })
      .limit(120),
    db
      .from('challenges')
      .select('team_id,opponent_team_id,match_id,status')
      .or(`team_id.in.(${idList}),opponent_team_id.in.(${idList})`)
      .eq('status', 'accepted')
      .not('match_id', 'is', null)
      .limit(120),
  ]);
  const fixtures = (fixRows ?? []) as {
    competition_id: string;
    home_team_id: string;
    away_team_id: string;
    starts_at: string | null;
    home_score: number | null;
    away_score: number | null;
    status: string;
  }[];
  const challenges = (chRows ?? []) as { team_id: string; opponent_team_id: string; match_id: string }[];

  const matchIds = challenges.map((c) => c.match_id);
  const matchById = new Map<string, { starts_at: string; home_score: number | null; away_score: number | null; status: string }>();
  if (matchIds.length > 0) {
    const { data: mRows } = await db.from('matches').select('id,starts_at,home_score,away_score,status').in('id', matchIds);
    for (const m of (mRows ?? []) as { id: string; starts_at: string; home_score: number | null; away_score: number | null; status: string }[]) {
      matchById.set(m.id, m);
    }
  }

  const otherIds = new Set<string>();
  for (const f of fixtures) {
    otherIds.add(f.home_team_id);
    otherIds.add(f.away_team_id);
  }
  for (const c of challenges) {
    otherIds.add(c.team_id);
    otherIds.add(c.opponent_team_id);
  }
  const names = new Map<string, string>();
  const compNames = new Map<string, string>();
  const compIds = [...new Set(fixtures.map((f) => f.competition_id))];
  const [{ data: tRows }, { data: cRows }] = await Promise.all([
    otherIds.size ? db.from('teams').select('id,name').in('id', [...otherIds]) : Promise.resolve({ data: [] }),
    compIds.length ? db.from('competitions').select('id,name').in('id', compIds) : Promise.resolve({ data: [] }),
  ]);
  for (const t of (tRows ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
  for (const c of (cRows ?? []) as { id: string; name: string }[]) compNames.set(c.id, c.name);

  const now = Date.now();
  return mine.map(({ team, role }) => {
    const games: (TeamGame & { done: boolean; at: number })[] = [];
    for (const f of fixtures) {
      const home = f.home_team_id === team.id;
      if (!home && f.away_team_id !== team.id) continue;
      const done = f.status === 'finished' && f.home_score != null && f.away_score != null;
      games.push({
        opponent: names.get(home ? f.away_team_id : f.home_team_id) ?? 'Opponent',
        us: done ? (home ? f.home_score : f.away_score) : null,
        them: done ? (home ? f.away_score : f.home_score) : null,
        when: f.starts_at,
        competition: compNames.get(f.competition_id) ?? null,
        done,
        at: f.starts_at ? new Date(f.starts_at).getTime() : 0,
      });
    }
    for (const c of challenges) {
      const home = c.team_id === team.id;
      if (!home && c.opponent_team_id !== team.id) continue;
      const m = matchById.get(c.match_id);
      if (!m) continue;
      const done = m.home_score != null && m.away_score != null;
      games.push({
        opponent: names.get(home ? c.opponent_team_id : c.team_id) ?? 'Opponent',
        us: done ? (home ? m.home_score : m.away_score) : null,
        them: done ? (home ? m.away_score : m.home_score) : null,
        when: m.starts_at,
        competition: null,
        done,
        at: new Date(m.starts_at).getTime(),
      });
    }
    const played = games.filter((g) => g.done).sort((a, b) => b.at - a.at);
    const upcoming = games.filter((g) => !g.done && g.at >= now - 3 * 3600 * 1000).sort((a, b) => a.at - b.at);
    const form = played
      .slice(0, 5)
      .reverse()
      .map((g) => resultOf(g.us ?? 0, g.them ?? 0));
    const strip = (g: (typeof games)[number] | undefined): TeamGame | null =>
      g ? { opponent: g.opponent, us: g.us, them: g.them, when: g.when, competition: g.competition } : null;
    return { team, role, form, last: strip(played[0]), next: strip(upcoming[0]) };
  });
}

// Everything waiting on this player, most urgent first.
export async function fetchNeedsYou(userId: string, past: MatchListing[], teams: TeamSummary[]): Promise<NeedsItem[]> {
  const db = supabase;
  if (!db) return [];
  const items: NeedsItem[] = [];
  const twoWeeks = Date.now() - 14 * 86400000;

  // 1. Games I hosted that have been played but have no result.
  for (const l of past) {
    if (!l.isOrganiser) continue;
    if (l.match.status === 'finished' || l.match.status === 'cancelled') continue;
    if (new Date(l.match.starts_at).getTime() < twoWeeks) continue;
    items.push({
      id: `result-${l.match.id}`,
      kind: 'result',
      title: `Add the result: ${l.match.title}`,
      sub: 'Played games count in everyone’s record once the score is in.',
      to: `/games/${l.match.id}?result=1`,
      cta: 'Add result',
    });
  }

  // 2. Challenges waiting on a team I captain.
  const captainIds = teams.filter((t) => isCaptainRole(t.role)).map((t) => t.team.id);
  if (captainIds.length > 0) {
    const list = captainIds.join(',');
    const { data } = await db
      .from('challenges')
      .select('id,team_id,opponent_team_id,status,proposed_starts_at,window_start')
      .in('status', ['open', 'reschedule_proposed'])
      .or(`opponent_team_id.in.(${list}),team_id.in.(${list})`)
      .gte('window_end', new Date().toISOString());
    const rows = (data ?? []) as {
      id: string;
      team_id: string;
      opponent_team_id: string | null;
      status: string;
      proposed_starts_at: string | null;
      window_start: string;
    }[];
    const teamName = new Map(teams.map((t) => [t.team.id, t.team.name]));
    const otherIds = [...new Set(rows.flatMap((r) => [r.team_id, r.opponent_team_id]).filter((x): x is string => !!x && !teamName.has(x)))];
    if (otherIds.length > 0) {
      const { data: tRows } = await db.from('teams').select('id,name').in('id', otherIds);
      for (const t of (tRows ?? []) as { id: string; name: string }[]) teamName.set(t.id, t.name);
    }
    for (const r of rows) {
      const theyAskUs = r.status === 'open' && r.opponent_team_id && captainIds.includes(r.opponent_team_id);
      const weMustConfirm = r.status === 'reschedule_proposed' && captainIds.includes(r.team_id);
      if (!theyAskUs && !weMustConfirm) continue;
      const ours = theyAskUs ? (r.opponent_team_id as string) : r.team_id;
      const theirs = theyAskUs ? r.team_id : (r.opponent_team_id ?? '');
      const when = r.proposed_starts_at ?? r.window_start;
      items.push({
        id: `challenge-${r.id}`,
        kind: 'challenge',
        title: theyAskUs
          ? `${teamName.get(theirs) ?? 'A team'} challenged ${teamName.get(ours) ?? 'your team'}`
          : `${teamName.get(theirs) ?? 'Your opponent'} proposed a new time`,
        sub: new Date(when).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        to: `/teams/${ours}`,
        cta: 'Answer',
      });
    }
  }

  // 2b. Competition results the other captain reported, waiting on my side.
  if (captainIds.length > 0) {
    const list = captainIds.join(',');
    const { data } = await db
      .from('fixtures')
      .select('id,competition_id,home_team_id,away_team_id,reported_side,reported_home,reported_away,status')
      .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`)
      .eq('status', 'scheduled')
      .not('reported_side', 'is', null)
      .limit(20);
    const rows = (data ?? []) as {
      id: string;
      competition_id: string;
      home_team_id: string;
      away_team_id: string;
      reported_side: 'home' | 'away';
      reported_home: number;
      reported_away: number;
    }[];
    const names = new Map(teams.map((t) => [t.team.id, t.team.name]));
    const other = [...new Set(rows.flatMap((r) => [r.home_team_id, r.away_team_id]).filter((x) => !names.has(x)))];
    if (other.length) {
      const { data: tRows } = await db.from('teams').select('id,name').in('id', other);
      for (const t of (tRows ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
    }
    for (const r of rows) {
      const myTeam = r.reported_side === 'home' ? r.away_team_id : r.home_team_id;
      if (!captainIds.includes(myTeam)) continue;
      items.push({
        id: `confirm-${r.id}`,
        kind: 'confirm',
        title: `Confirm the result: ${names.get(r.home_team_id) ?? 'Home'} ${r.reported_home}–${r.reported_away} ${names.get(r.away_team_id) ?? 'Away'}`,
        sub: 'Reported by the other captain. Confirm it or report the right score.',
        to: `/competitions/${r.competition_id}?tab=fixtures`,
        cta: 'Confirm',
      });
    }
  }

  // 2c. Competitions I organise: entries to review, results in dispute.
  const { data: mine } = await db.from('competitions').select('id,name,status').eq('organiser_id', userId).in('status', ['registration', 'live']);
  const comps = (mine ?? []) as { id: string; name: string; status: string }[];
  if (comps.length) {
    const ids = comps.map((c) => c.id);
    const [{ data: pend }, { data: disp }] = await Promise.all([
      db.from('competition_entries').select('competition_id').in('competition_id', ids).eq('status', 'pending'),
      db.from('fixtures').select('competition_id').in('competition_id', ids).eq('status', 'disputed'),
    ]);
    for (const c of comps) {
      const p = ((pend ?? []) as { competition_id: string }[]).filter((e) => e.competition_id === c.id).length;
      const d = ((disp ?? []) as { competition_id: string }[]).filter((e) => e.competition_id === c.id).length;
      if (p) items.push({ id: `entries-${c.id}`, kind: 'entries', title: `${p} team${p === 1 ? '' : 's'} waiting to enter ${c.name}`, sub: 'Approve or decline their entry.', to: `/competitions/${c.id}?tab=manage`, cta: 'Review' });
      if (d) items.push({ id: `dispute-${c.id}`, kind: 'dispute', title: `${d} disputed result${d === 1 ? '' : 's'} in ${c.name}`, sub: 'The captains disagree. Your decision is final.', to: `/competitions/${c.id}?tab=manage`, cta: 'Settle' });
    }
  }

  // 3. Booking requests at venues I run.
  const venues = await fetchMyVenues(userId).catch(() => []);
  if (venues.length > 0) {
    const bookings = await fetchVenueBookings(venues.map((v) => v.id)).catch(() => []);
    const pending = bookings.filter((b) => b.status === 'requested');
    if (pending.length > 0) {
      items.push({
        id: 'bookings',
        kind: 'booking',
        title: `${pending.length} booking request${pending.length === 1 ? '' : 's'} to answer`,
        sub: venues.length === 1 ? (venues[0]?.name ?? '') : `${venues.length} venues`,
        to: '/venues/dashboard',
        cta: 'Review',
      });
    }
  }

  // 4. No free times set: recommendations stay generic until there are.
  const { count } = await db.from('user_availability').select('day', { count: 'exact', head: true }).eq('user_id', userId);
  if ((count ?? 0) === 0) {
    items.push({
      id: 'week',
      kind: 'week',
      title: 'Tell us when you are usually free',
      sub: 'Games near you get ranked around your week.',
      to: '/you/settings#week',
      cta: 'Set',
    });
  }
  return items;
}

// The next games posted in circles I am in, soonest first.
export async function fetchCircleUpdates(userId: string): Promise<{ circles: CircleListing[]; updates: CircleUpdate[] }> {
  const all = await fetchCircles(userId).catch(() => []);
  const mine = all.filter((c) => c.isMember);
  const lists = await Promise.all(
    mine.slice(0, 6).map(async (c) => (await fetchCircleEvents(c.circle.id).catch(() => [])).map((match) => ({ circle: c.circle, match }))),
  );
  const updates = lists.flat().sort((a, b) => +new Date(a.match.starts_at) - +new Date(b.match.starts_at));
  return { circles: mine, updates: updates.slice(0, 5) };
}
