import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BAND_LABELS,
  RATING_START,
  activityGrid,
  buildRecord,
  distanceKm,
  eloUpdate,
  endOfTonightLusaka,
  freeTonightSchema,
  gameScore,
  headToHead,
  notifyFreePlayersSchema,
  opponentScore,
  ratingBand,
  seasonRecap,
  sharedFreeSlots,
  teamRecord,
  weekStreak,
  type Band,
  type GameResult,
  type StatLine,
  type TeamGame,
} from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';
import { requireAdmin } from './venues.js';

// Phase 6: records from games only, team ratings shown as bands, matchmaking, Free tonight.
// onGameFinished is the one place a finished game turns into player lines and a rating change. It is idempotent:
// it rebuilds that game's lines from scratch and, if the score changed, reverses the old rating change first.

type Source = 'match' | 'fixture';
type Deps = { now?: Date };

interface Facts {
  source: Source;
  id: string;
  sportId: string | null;
  playedAt: string;
  finished: boolean;
  homeTeam: string | null;
  awayTeam: string | null;
  homeName: string | null;
  awayName: string | null;
  homeScore: number | null;
  awayScore: number | null;
  participants: string[];
}

async function teamNames(svc: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const u = [...new Set(ids.filter(Boolean))];
  if (!u.length) return m;
  const { data } = await svc.from('teams').select('id,name').in('id', u);
  for (const t of (data ?? []) as { id: string; name: string }[]) m.set(t.id, t.name);
  return m;
}

async function factsOf(svc: SupabaseClient, source: Source, id: string): Promise<Facts | null> {
  if (source === 'match') {
    const { data } = await svc.from('matches').select('id,sport_id,starts_at,status,home_score,away_score').eq('id', id).maybeSingle();
    const m = data as { id: string; sport_id: string; starts_at: string; status: string; home_score: number | null; away_score: number | null } | null;
    if (!m) return null;
    let home: string | null = null;
    let away: string | null = null;
    const { data: ch } = await svc.from('challenges').select('team_id,opponent_team_id').eq('match_id', id).maybeSingle();
    if (ch) {
      home = (ch as { team_id: string }).team_id;
      away = (ch as { opponent_team_id: string | null }).opponent_team_id;
    } else {
      const { data: b } = await svc.from('scoreboards').select('home_team_id,away_team_id').eq('match_id', id).maybeSingle();
      home = (b as { home_team_id: string | null } | null)?.home_team_id ?? null;
      away = (b as { away_team_id: string | null } | null)?.away_team_id ?? null;
    }
    const { data: parts } = await svc.from('match_participants').select('user_id,status').eq('match_id', id);
    const names = await teamNames(svc, [home ?? '', away ?? '']);
    return {
      source,
      id,
      sportId: m.sport_id,
      playedAt: m.starts_at,
      finished: m.status === 'finished',
      homeTeam: home,
      awayTeam: away,
      homeName: home ? (names.get(home) ?? null) : null,
      awayName: away ? (names.get(away) ?? null) : null,
      homeScore: m.home_score,
      awayScore: m.away_score,
      participants: ((parts ?? []) as { user_id: string; status: string }[]).filter((p) => p.status === 'joined').map((p) => p.user_id),
    };
  }
  const { data } = await svc.from('fixtures').select('id,competition_id,home_team_id,away_team_id,home_score,away_score,status,starts_at,created_at').eq('id', id).maybeSingle();
  const f = data as { id: string; competition_id: string; home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; status: string; starts_at: string | null; created_at: string } | null;
  if (!f) return null;
  const { data: c } = await svc.from('competitions').select('sport_id').eq('id', f.competition_id).maybeSingle();
  const names = await teamNames(svc, [f.home_team_id ?? '', f.away_team_id ?? '']);
  return {
    source,
    id,
    sportId: (c as { sport_id: string } | null)?.sport_id ?? null,
    playedAt: f.starts_at ?? f.created_at,
    finished: f.status === 'finished',
    homeTeam: f.home_team_id,
    awayTeam: f.away_team_id,
    homeName: f.home_team_id ? (names.get(f.home_team_id) ?? null) : null,
    awayName: f.away_team_id ? (names.get(f.away_team_id) ?? null) : null,
    homeScore: f.home_score,
    awayScore: f.away_score,
    participants: [],
  };
}

/** Goals, assists, cards and best player per user, from a scoreboard that ran on this game (if any). */
async function boardStats(svc: SupabaseClient, source: Source, id: string) {
  const { data } = await svc.from('scoreboards').select('id,mvp_player_id,result_posted').eq(source === 'match' ? 'match_id' : 'fixture_id', id).maybeSingle();
  const board = data as { id: string; mvp_player_id: string | null; result_posted: boolean } | null;
  if (!board) return null;
  const { data: players } = await svc.from('scoreboard_players').select('id,user_id,side').eq('scoreboard_id', board.id);
  const { data: events } = await svc.from('scoreboard_events').select('type,payload,voided').eq('scoreboard_id', board.id);
  const byPlayer = new Map<string, { userId: string | null; side: 'home' | 'away'; goals: number; assists: number; cards: number; mvp: boolean }>();
  for (const p of (players ?? []) as { id: string; user_id: string | null; side: 'home' | 'away' }[]) {
    byPlayer.set(p.id, { userId: p.user_id, side: p.side, goals: 0, assists: 0, cards: 0, mvp: p.id === board.mvp_player_id });
  }
  for (const e of (events ?? []) as { type: string; payload: Record<string, unknown> | null; voided: boolean }[]) {
    if (e.voided) continue;
    const p = e.payload ?? {};
    if (e.type === 'goal' && !p['ownGoal']) {
      const scorer = byPlayer.get(String(p['playerId'] ?? ''));
      if (scorer) scorer.goals += typeof p['points'] === 'number' ? (p['points'] as number) : 1;
      const assist = byPlayer.get(String(p['assistId'] ?? ''));
      if (assist) assist.assists += 1;
    }
    if (e.type === 'card') {
      const carded = byPlayer.get(String(p['playerId'] ?? ''));
      if (carded) carded.cards += 1;
    }
  }
  return [...byPlayer.values()].filter((x): x is typeof x & { userId: string } => !!x.userId);
}

function resultOf(side: 'home' | 'away', hs: number, as: number): GameResult {
  const mine = side === 'home' ? hs : as;
  const theirs = side === 'home' ? as : hs;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

async function ratingRow(svc: SupabaseClient, teamId: string, sportId: string) {
  const { data } = await svc.from('team_ratings').select('*').eq('team_id', teamId).eq('sport_id', sportId).maybeSingle();
  return (data as { rating: number; games: number } | null) ?? { rating: RATING_START, games: 0 };
}

async function sportRatings(svc: SupabaseClient, sportId: string): Promise<{ team_id: string; rating: number; games: number; last_delta: number }[]> {
  const { data } = await svc.from('team_ratings').select('team_id,rating,games,last_delta').eq('sport_id', sportId);
  return (data ?? []) as { team_id: string; rating: number; games: number; last_delta: number }[];
}

function bandOf(team: { rating: number; games: number }, all: { rating: number; games: number }[]): Band {
  return ratingBand(team.rating, team.games, all.filter((r) => r.games >= 5).map((r) => r.rating));
}

async function reverseRating(svc: SupabaseClient, sourceId: string) {
  const { data } = await svc.from('rating_events').select('*').eq('source_id', sourceId).maybeSingle();
  const ev = data as { sport_id: string; home_team_id: string; away_team_id: string; home_before: number; away_before: number; home_after: number; away_after: number } | null;
  if (!ev) return null;
  for (const [team, before, after] of [
    [ev.home_team_id, ev.home_before, ev.home_after],
    [ev.away_team_id, ev.away_before, ev.away_after],
  ] as const) {
    const cur = await ratingRow(svc, team, ev.sport_id);
    await svc.from('team_ratings').upsert({ team_id: team, sport_id: ev.sport_id, rating: cur.rating - (after - before), games: Math.max(0, cur.games - 1), updated_at: new Date().toISOString() });
  }
  await svc.from('rating_events').delete().eq('source_id', sourceId);
  return ev;
}

/**
 * People who follow a team (and are not in either squad, who already know) hear its result once, when it is first scored.
 * Someone following both teams gets one notification. Best effort.
 */
async function tellTeamFollowers(svc: SupabaseClient, homeId: string, awayId: string, score: string, homeName: string | null, awayName: string | null) {
  try {
    const { data: follows } = await svc.from('user_follows').select('user_id,subject_id').eq('subject_type', 'team').in('subject_id', [homeId, awayId]);
    const rows = (follows ?? []) as { user_id: string; subject_id: string }[];
    if (!rows.length) return;
    const { data: members } = await svc.from('team_members').select('user_id').in('team_id', [homeId, awayId]);
    const squad = new Set(((members ?? []) as { user_id: string }[]).map((m) => m.user_id));
    const byTeam = new Map<string, string[]>();
    const told = new Set<string>();
    for (const r of rows) {
      if (squad.has(r.user_id) || told.has(r.user_id)) continue;
      told.add(r.user_id);
      byTeam.set(r.subject_id, [...(byTeam.get(r.subject_id) ?? []), r.user_id]);
    }
    for (const [teamId, users] of byTeam) {
      await notifyUsers(users, 'followed_team_result', { teamId, title: (teamId === homeId ? homeName : awayName) ?? 'A team you follow', score });
    }
  } catch {
    // Never blocks the result.
  }
}

/** A game finished (or its score changed): rebuild its player lines and its rating change. Never throws. */
export async function onGameFinished(svc: SupabaseClient, source: Source, id: string): Promise<void> {
  try {
    const f = await factsOf(svc, source, id);
    if (!f) return;
    await svc.from('player_stats').delete().eq('source', source).eq('source_id', id);
    const scored = f.homeScore != null && f.awayScore != null;
    const teamGame = !!f.homeTeam && !!f.awayTeam && f.homeTeam !== f.awayTeam;
    if (!f.finished) {
      await reverseRating(svc, id);
      return;
    }

    // Player lines: scoreboard roster when one ran, otherwise the players who joined the game.
    const stats = await boardStats(svc, source, id);
    const lines: Record<string, unknown>[] = [];
    if (stats && stats.length) {
      for (const s of stats) {
        lines.push({
          user_id: s.userId,
          source,
          source_id: id,
          sport_id: f.sportId,
          team_id: s.side === 'home' ? f.homeTeam : f.awayTeam,
          opponent: s.side === 'home' ? f.awayName : f.homeName,
          played_at: f.playedAt,
          result: scored ? resultOf(s.side, f.homeScore!, f.awayScore!) : null,
          goals: s.goals,
          assists: s.assists,
          cards: s.cards,
          mvp: s.mvp,
        });
      }
    } else if (f.participants.length) {
      let homeMembers = new Set<string>();
      let awayMembers = new Set<string>();
      if (teamGame) {
        const { data: hm } = await svc.from('team_members').select('user_id').eq('team_id', f.homeTeam!);
        const { data: am } = await svc.from('team_members').select('user_id').eq('team_id', f.awayTeam!);
        homeMembers = new Set(((hm ?? []) as { user_id: string }[]).map((m) => m.user_id));
        awayMembers = new Set(((am ?? []) as { user_id: string }[]).map((m) => m.user_id));
      }
      for (const u of [...new Set(f.participants)]) {
        const side: 'home' | 'away' | null = homeMembers.has(u) ? 'home' : awayMembers.has(u) ? 'away' : null;
        lines.push({
          user_id: u,
          source,
          source_id: id,
          sport_id: f.sportId,
          team_id: side === 'home' ? f.homeTeam : side === 'away' ? f.awayTeam : null,
          opponent: side === 'home' ? f.awayName : side === 'away' ? f.homeName : null,
          played_at: f.playedAt,
          result: side && scored ? resultOf(side, f.homeScore!, f.awayScore!) : null,
          goals: 0,
          assists: 0,
          cards: 0,
          mvp: false,
        });
      }
    }
    for (const l of lines) await svc.from('player_stats').upsert(l);

    // Rating: team against team, with a score, once per game (a changed score is reversed and re-rated).
    if (!teamGame || !scored || !f.sportId) {
      await reverseRating(svc, id);
      return;
    }
    const { data: existing } = await svc.from('rating_events').select('home_score,away_score').eq('source_id', id).maybeSingle();
    const ex = existing as { home_score: number; away_score: number } | null;
    if (ex && ex.home_score === f.homeScore && ex.away_score === f.awayScore) return;
    if (ex) await reverseRating(svc, id);

    const all = await sportRatings(svc, f.sportId);
    const h = await ratingRow(svc, f.homeTeam!, f.sportId);
    const a = await ratingRow(svc, f.awayTeam!, f.sportId);
    const bandsBefore = { home: bandOf(h, all), away: bandOf(a, all) };
    const result = resultOf('home', f.homeScore!, f.awayScore!);
    const next = eloUpdate(h, a, result, { goalDiff: f.homeScore! - f.awayScore! });
    const now = new Date().toISOString();
    await svc.from('team_ratings').upsert({ team_id: f.homeTeam, sport_id: f.sportId, rating: next.home, games: h.games + 1, last_delta: next.home - h.rating, updated_at: now });
    await svc.from('team_ratings').upsert({ team_id: f.awayTeam, sport_id: f.sportId, rating: next.away, games: a.games + 1, last_delta: next.away - a.rating, updated_at: now });
    await svc.from('rating_events').insert({
      sport_id: f.sportId,
      source,
      source_id: id,
      home_team_id: f.homeTeam,
      away_team_id: f.awayTeam,
      home_before: h.rating,
      away_before: a.rating,
      home_after: next.home,
      away_after: next.away,
      home_score: f.homeScore,
      away_score: f.awayScore,
    });
    const after = await sportRatings(svc, f.sportId);
    if (!ex) await tellTeamFollowers(svc, f.homeTeam!, f.awayTeam!, `${f.homeName ?? 'Home'} ${f.homeScore}-${f.awayScore} ${f.awayName ?? 'Away'}`, f.homeName, f.awayName);
    for (const [team, before, row] of [
      [f.homeTeam!, bandsBefore.home, { rating: next.home, games: h.games + 1 }],
      [f.awayTeam!, bandsBefore.away, { rating: next.away, games: a.games + 1 }],
    ] as const) {
      const band = bandOf(row, after);
      if (band !== before && band !== 'new') {
        const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', team);
        const names = await teamNames(svc, [team]);
        await notifyUsers(((members ?? []) as { user_id: string }[]).map((m) => m.user_id), 'team_band_changed', {
          teamId: team,
          title: names.get(team) ?? 'Your team',
          band,
          label: BAND_LABELS[band],
          up: (row.rating ?? 0) > (team === f.homeTeam ? h.rating : a.rating),
        });
      }
    }
  } catch {
    // Records never block the action that finished the game.
  }
}

// --- Reads: player records ----------------------------------------------------------------------

export async function recordFor(svc: SupabaseClient, userId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const { data } = await svc.from('player_stats').select('*').eq('user_id', userId).order('played_at', { ascending: false }).limit(1000);
  const rows = (data ?? []) as { source_id: string; sport_id: string | null; played_at: string; result: GameResult | null; goals: number; assists: number; cards: number; mvp: boolean; opponent: string | null }[];
  const sportIds = [...new Set(rows.map((r) => r.sport_id).filter((s): s is string => !!s))];
  const { data: sports } = sportIds.length ? await svc.from('sports').select('id,name').in('id', sportIds) : { data: [] };
  const sportName = new Map(((sports ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const lines: StatLine[] = rows.map((r) => ({
    sourceId: r.source_id,
    sport: sportName.get(r.sport_id ?? '') ?? 'Other',
    playedAt: r.played_at,
    result: r.result,
    goals: r.goals,
    assists: r.assists,
    cards: r.cards,
    mvp: r.mvp,
    opponent: r.opponent,
  }));
  // Races count as activity too (only published results, only the runner's own entries).
  const { data: entries } = await svc.from('race_entries').select('id,distance_id,status').eq('user_id', userId);
  const conf = ((entries ?? []) as { id: string; distance_id: string; status: string }[]).filter((e) => e.status === 'confirmed');
  const { data: dists } = conf.length ? await svc.from('race_distances').select('id,starts_at,results_published').in('id', [...new Set(conf.map((e) => e.distance_id))]) : { data: [] };
  const raceDates = ((dists ?? []) as { starts_at: string; results_published: boolean }[]).filter((d) => d.results_published).map((d) => d.starts_at);
  const dates = [...lines.map((l) => l.playedAt), ...raceDates];
  return {
    record: buildRecord(lines),
    grid: activityGrid(dates, 52, now),
    streak: weekStreak(dates, now),
    season: seasonRecap(lines, now.getUTCFullYear()),
    recent: lines.slice(0, 10),
  };
}

// --- Reads: teams -------------------------------------------------------------------------------

async function teamGames(svc: SupabaseClient, teamIds: string[]): Promise<TeamGame[]> {
  if (!teamIds.length) return [];
  const games: TeamGame[] = [];
  const [fh, fa] = await Promise.all([
    svc.from('fixtures').select('id,home_team_id,away_team_id,home_score,away_score,status,starts_at,created_at').in('home_team_id', teamIds),
    svc.from('fixtures').select('id,home_team_id,away_team_id,home_score,away_score,status,starts_at,created_at').in('away_team_id', teamIds),
  ]);
  const seen = new Set<string>();
  for (const f of [...((fh.data ?? []) as Record<string, unknown>[]), ...((fa.data ?? []) as Record<string, unknown>[])]) {
    if (seen.has(String(f['id'])) || f['status'] !== 'finished' || f['home_score'] == null || !f['home_team_id'] || !f['away_team_id']) continue;
    seen.add(String(f['id']));
    games.push({ id: String(f['id']), playedAt: String(f['starts_at'] ?? f['created_at']), homeId: String(f['home_team_id']), awayId: String(f['away_team_id']), homeScore: Number(f['home_score']), awayScore: Number(f['away_score']) });
  }
  const [ch, co] = await Promise.all([
    svc.from('challenges').select('team_id,opponent_team_id,match_id').in('team_id', teamIds),
    svc.from('challenges').select('team_id,opponent_team_id,match_id').in('opponent_team_id', teamIds),
  ]);
  const links = [...((ch.data ?? []) as { team_id: string; opponent_team_id: string | null; match_id: string | null }[]), ...((co.data ?? []) as { team_id: string; opponent_team_id: string | null; match_id: string | null }[])].filter(
    (c) => c.match_id && c.opponent_team_id,
  );
  const mids = [...new Set(links.map((l) => l.match_id!))];
  if (mids.length) {
    const { data: ms } = await svc.from('matches').select('id,starts_at,status,home_score,away_score').in('id', mids);
    for (const m of (ms ?? []) as { id: string; starts_at: string; status: string; home_score: number | null; away_score: number | null }[]) {
      if (m.status !== 'finished' || m.home_score == null || m.away_score == null || seen.has(m.id)) continue;
      const l = links.find((x) => x.match_id === m.id)!;
      seen.add(m.id);
      games.push({ id: m.id, playedAt: m.starts_at, homeId: l.team_id, awayId: l.opponent_team_id!, homeScore: m.home_score, awayScore: m.away_score });
    }
  }
  return games.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
}

export async function bandsFor(svc: SupabaseClient, sportId: string, teamIds: string[]): Promise<Map<string, { band: Band; label: string; trend: number }>> {
  const all = await sportRatings(svc, sportId);
  const out = new Map<string, { band: Band; label: string; trend: number }>();
  for (const t of teamIds) {
    const r = all.find((x) => x.team_id === t) ?? { rating: RATING_START, games: 0, last_delta: 0 };
    const band = bandOf(r, all);
    out.set(t, { band, label: BAND_LABELS[band], trend: Math.sign(r.last_delta) });
  }
  return out;
}

export async function getTeamRecord(svc: SupabaseClient, teamId: string) {
  const { data: t } = await svc.from('teams').select('id,name,sport_id').eq('id', teamId).maybeSingle();
  const team = t as { id: string; name: string; sport_id: string } | null;
  if (!team) throw new ActionError(404, 'Team not found.');
  const games = await teamGames(svc, [teamId]);
  const rec = teamRecord(teamId, games);
  const opponents = [...new Set(games.map((g) => (g.homeId === teamId ? g.awayId : g.homeId)))];
  const names = await teamNames(svc, opponents);
  const recentOpp = [...games].reverse().map((g) => (g.homeId === teamId ? g.awayId : g.homeId)).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 5);
  const band = (await bandsFor(svc, team.sport_id, [teamId])).get(teamId)!;
  return {
    team: { id: team.id, name: team.name },
    band,
    record: { ...rec, biggestWin: rec.biggestWin ? { ...rec.biggestWin, opponent: names.get(rec.biggestWin.homeId === teamId ? rec.biggestWin.awayId : rec.biggestWin.homeId) ?? 'Opponent' } : null },
    headToHead: recentOpp.map((o) => ({ teamId: o, name: names.get(o) ?? 'Opponent', ...headToHead(games, teamId, o) })),
  };
}

/** Head-to-head and both bands for a versus header. */
export async function versus(svc: SupabaseClient, homeId: string, awayId: string) {
  const { data: t } = await svc.from('teams').select('id,sport_id').eq('id', homeId).maybeSingle();
  const sportId = (t as { sport_id: string } | null)?.sport_id;
  if (!sportId) throw new ActionError(404, 'Team not found.');
  const games = await teamGames(svc, [homeId]);
  const bands = await bandsFor(svc, sportId, [homeId, awayId]);
  return { home: bands.get(homeId), away: bands.get(awayId), headToHead: headToHead(games, homeId, awayId) };
}

async function teamSlots(svc: SupabaseClient, teamId: string): Promise<Set<string>> {
  const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', teamId);
  const ids = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (!ids.length) return new Set();
  const { data } = await svc.from('user_availability').select('user_id,day,time_band').in('user_id', ids);
  // A slot counts when at least a third of the squad (and at least two people) is free then.
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { day: number; time_band: string }[]) counts.set(`${r.day}-${r.time_band}`, (counts.get(`${r.day}-${r.time_band}`) ?? 0) + 1);
  const need = Math.max(2, Math.ceil(ids.length / 3));
  return new Set([...counts.entries()].filter(([, n]) => n >= Math.min(need, ids.length)).map(([k]) => k));
}

export async function suggestOpponents(svc: SupabaseClient, userId: string, teamId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const { data: t } = await svc.from('teams').select('id,name,sport_id,area,lat,lng').eq('id', teamId).maybeSingle();
  const team = t as { id: string; name: string; sport_id: string; area: string | null; lat: number | null; lng: number | null } | null;
  if (!team) throw new ActionError(404, 'Team not found.');
  const { data: me } = await svc.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (!me) throw new ActionError(403, 'Only team members can see suggestions.');
  const { data: cands } = await svc.from('teams').select('id,name,logo_url,area,lat,lng,sport_id').eq('sport_id', team.sport_id).limit(300);
  const others = ((cands ?? []) as { id: string; name: string; logo_url: string | null; area: string | null; lat: number | null; lng: number | null }[]).filter((c) => c.id !== teamId);
  if (!others.length) return { suggestions: [] };
  const ratings = await sportRatings(svc, team.sport_id);
  const mine = ratings.find((r) => r.team_id === teamId);
  const games = await teamGames(svc, [teamId]);
  const mySlots = await teamSlots(svc, teamId);
  const bands = await bandsFor(svc, team.sport_id, others.map((o) => o.id));
  const recentCut = now.getTime() - 14 * 86_400_000;
  const scored = [];
  for (const o of others.slice(0, 60)) {
    const r = ratings.find((x) => x.team_id === o.id);
    const gap = mine && r && mine.games >= 3 && r.games >= 3 ? r.rating - mine.rating : null;
    const km = team.lat != null && team.lng != null && o.lat != null && o.lng != null ? distanceKm({ lat: team.lat, lng: team.lng }, { lat: o.lat, lng: o.lng }) : null;
    const sameArea = !!team.area && !!o.area && team.area.toLowerCase() === o.area.toLowerCase();
    const playedRecently = games.some((g) => (g.homeId === o.id || g.awayId === o.id) && new Date(g.playedAt).getTime() > recentCut);
    const shared = sharedFreeSlots(mySlots, await teamSlots(svc, o.id));
    const s = opponentScore({ ratingGap: gap, km, sameArea, sharedSlots: shared, playedRecently });
    scored.push({ team: o, ...s, band: bands.get(o.id)!, sharedSlots: shared });
  }
  return { suggestions: scored.sort((a, b) => b.score - a.score).slice(0, 8) };
}

// --- Reads: games for you -----------------------------------------------------------------------

export async function gamesForYou(svc: SupabaseClient, userId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const [{ data: prof }, { data: mySports }, { data: avail }, { data: games }, { data: joined }] = await Promise.all([
    svc.from('profiles').select('lat,lng,area').eq('id', userId).maybeSingle(),
    svc.from('user_sports').select('sport_id,level').eq('user_id', userId),
    svc.from('user_availability').select('day,time_band').eq('user_id', userId),
    svc.from('matches').select('id,sport_id,starts_at,lat,lng,area,level,capacity,status,visibility').eq('status', 'open').gt('starts_at', now.toISOString()).limit(300),
    svc.from('match_participants').select('match_id,status').eq('user_id', userId),
  ]);
  const p = (prof ?? {}) as { lat: number | null; lng: number | null; area: string | null };
  const sports = new Map(((mySports ?? []) as { sport_id: string; level: string }[]).map((s) => [s.sport_id, s.level]));
  const slots = new Set(((avail ?? []) as { day: number; time_band: string }[]).map((a) => `${a.day}-${a.time_band}`));
  const mine = new Set(((joined ?? []) as { match_id: string; status: string }[]).filter((j) => j.status === 'joined').map((j) => j.match_id));
  const list = ((games ?? []) as { id: string; sport_id: string; starts_at: string; lat: number | null; lng: number | null; area: string | null; level: string | null; capacity: number; visibility: string }[]).filter(
    (g) => g.visibility !== 'private' && !mine.has(g.id),
  );
  const ids = list.map((g) => g.id);
  const { data: parts } = ids.length ? await svc.from('match_participants').select('match_id,status').in('match_id', ids) : { data: [] };
  const counts = new Map<string, number>();
  for (const r of (parts ?? []) as { match_id: string; status: string }[]) if (r.status === 'joined') counts.set(r.match_id, (counts.get(r.match_id) ?? 0) + 1);
  const ranked = list.map((g) => {
    const local = new Date(new Date(g.starts_at).getTime() + 2 * 3_600_000);
    const h = local.getUTCHours();
    const band = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const s = gameScore({
      sportMatch: sports.has(g.sport_id),
      levelMatch: g.level && sports.has(g.sport_id) ? sports.get(g.sport_id) === g.level : null,
      km: p.lat != null && p.lng != null && g.lat != null && g.lng != null ? distanceKm({ lat: p.lat, lng: p.lng }, { lat: g.lat, lng: g.lng }) : null,
      sameArea: !!p.area && !!g.area && p.area.toLowerCase() === g.area.toLowerCase(),
      slotMatch: slots.has(`${local.getUTCDay()}-${band}`),
      spotsLeft: Math.max(0, g.capacity - (counts.get(g.id) ?? 0)),
      hoursAway: (new Date(g.starts_at).getTime() - now.getTime()) / 3_600_000,
    });
    return { matchId: g.id, ...s };
  });
  return { ranked: ranked.sort((a, b) => b.score - a.score).slice(0, 30) };
}

// --- Free tonight -------------------------------------------------------------------------------

export async function setFreeTonight(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = freeTonightSchema.parse(raw);
  const now = deps.now ?? new Date();
  let { lat, lng } = input;
  if (lat == null || lng == null) {
    const { data } = await svc.from('profiles').select('lat,lng').eq('id', userId).maybeSingle();
    lat = (data as { lat: number | null } | null)?.lat ?? null;
    lng = (data as { lng: number | null } | null)?.lng ?? null;
  }
  if (lat == null || lng == null) throw new ActionError(400, 'Add your area in Settings (or allow location) so nearby organisers can find you.');
  const until = endOfTonightLusaka(now);
  const { data: existing } = await svc.from('free_tonight').select('notified_at,until').eq('user_id', userId).maybeSingle();
  const keepNotified = existing && new Date((existing as { until: string }).until) > now ? (existing as { notified_at: string | null }).notified_at : null;
  await svc.from('free_tonight').upsert({ user_id: userId, sports: input.sports, lat, lng, radius_km: Math.round(input.radiusKm), until, notified_at: keepNotified });
  return { state: 'on', until };
}

export async function clearFreeTonight(svc: SupabaseClient, userId: string) {
  await svc.from('free_tonight').delete().eq('user_id', userId);
  return { state: 'off' };
}

export async function myFreeTonight(svc: SupabaseClient, userId: string, deps: Deps = {}) {
  const { data } = await svc.from('free_tonight').select('sports,radius_km,until').eq('user_id', userId).maybeSingle();
  const row = data as { sports: string[]; radius_km: number; until: string } | null;
  return row && new Date(row.until) > (deps.now ?? new Date()) ? { on: true, ...row } : { on: false };
}

async function organiserGame(svc: SupabaseClient, userId: string, matchId: string) {
  const { data } = await svc.from('matches').select('id,title,organiser_id,sport_id,starts_at,lat,lng,venue_id,status,free_notified_at').eq('id', matchId).maybeSingle();
  const m = data as { id: string; title: string; organiser_id: string; sport_id: string; starts_at: string; lat: number | null; lng: number | null; venue_id: string | null; status: string; free_notified_at: string | null } | null;
  if (!m) throw new ActionError(404, 'Game not found.');
  if (m.organiser_id !== userId) throw new ActionError(403, 'Only the organiser can see this.');
  let { lat, lng } = m;
  if ((lat == null || lng == null) && m.venue_id) {
    const { data: v } = await svc.from('venues').select('lat,lng').eq('id', m.venue_id).maybeSingle();
    lat = (v as { lat: number | null } | null)?.lat ?? null;
    lng = (v as { lng: number | null } | null)?.lng ?? null;
  }
  return { ...m, lat, lng };
}

async function freePlayersFor(svc: SupabaseClient, game: Awaited<ReturnType<typeof organiserGame>>, now: Date) {
  if (game.lat == null || game.lng == null) return [];
  const { data } = await svc.from('free_tonight').select('*').gt('until', now.toISOString());
  const { data: parts } = game.id ? await svc.from('match_participants').select('user_id,status').eq('match_id', game.id) : { data: [] };
  const inGame = new Set(((parts ?? []) as { user_id: string; status: string }[]).filter((p) => p.status === 'joined').map((p) => p.user_id));
  return ((data ?? []) as { user_id: string; sports: string[]; lat: number; lng: number; radius_km: number; notified_at: string | null }[]).filter(
    (f) => f.user_id !== game.organiser_id && !inGame.has(f.user_id) && f.sports.includes(game.sport_id) && distanceKm({ lat: f.lat, lng: f.lng }, { lat: game.lat!, lng: game.lng! }) <= f.radius_km,
  );
}

/** How many players are free tonight near this game. A count only: organisers never see who. */
export async function freeNearby(svc: SupabaseClient, userId: string, matchId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const game = await organiserGame(svc, userId, matchId);
  const sameEvening = new Date(game.starts_at).getTime() < new Date(endOfTonightLusaka(now)).getTime() && new Date(game.starts_at) > now;
  if (!sameEvening) return { count: 0, eligible: false, reason: 'Free tonight is for games starting later today.' };
  if (game.lat == null) return { count: 0, eligible: false, reason: 'Set the game location to see players free nearby.' };
  const free = await freePlayersFor(svc, game, now);
  const startOfTonight = new Date(new Date(endOfTonightLusaka(now)).getTime() - 86_400_000);
  return { count: free.length, eligible: true, alreadyTold: !!game.free_notified_at && new Date(game.free_notified_at) > startOfTonight };
}

/** Below this, the preview says nothing: moving a pin around must never reveal where one person is. */
export const FREE_PREVIEW_MIN = 3;

/**
 * While a game is being created (so there is no game yet): roughly how many players are free tonight near this place
 * for this sport. A count only, and only when there are at least FREE_PREVIEW_MIN, so it can't locate anyone.
 */
export async function freeNearbyPreview(
  svc: SupabaseClient,
  userId: string,
  q: { sportId?: string; startsAt?: string; lat?: number | null; lng?: number | null; venueId?: string | null },
  deps: Deps = {},
) {
  const now = deps.now ?? new Date();
  if (!q.sportId || !q.startsAt) return { count: 0, eligible: false };
  const starts = new Date(q.startsAt);
  if (Number.isNaN(starts.getTime()) || starts <= now || starts.getTime() >= new Date(endOfTonightLusaka(now)).getTime()) return { count: 0, eligible: false };
  let lat = q.lat ?? null;
  let lng = q.lng ?? null;
  if ((lat == null || lng == null) && q.venueId) {
    const { data: v } = await svc.from('venues').select('lat,lng').eq('id', q.venueId).maybeSingle();
    lat = (v as { lat: number | null } | null)?.lat ?? null;
    lng = (v as { lng: number | null } | null)?.lng ?? null;
  }
  if (lat == null || lng == null) return { count: 0, eligible: false };
  const free = await freePlayersFor(svc, { id: '', organiser_id: userId, sport_id: q.sportId, lat, lng } as never, now);
  return free.length >= FREE_PREVIEW_MIN ? { count: free.length, eligible: true } : { count: 0, eligible: true };
}

export async function notifyFreePlayers(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const { matchId } = notifyFreePlayersSchema.parse(raw);
  const now = deps.now ?? new Date();
  const game = await organiserGame(svc, userId, matchId);
  if (game.status !== 'open') throw new ActionError(409, 'This game is not open for players.');
  const startOfTonight = new Date(new Date(endOfTonightLusaka(now)).getTime() - 86_400_000);
  if (game.free_notified_at && new Date(game.free_notified_at) > startOfTonight) throw new ActionError(409, 'You have already told the free players about this game tonight.');
  const free = (await freePlayersFor(svc, game, now)).filter((f) => !f.notified_at || new Date(f.notified_at) <= startOfTonight);
  const ids = free.map((f) => f.user_id);
  await notifyUsers(ids, 'free_tonight_game', { matchId: game.id, title: game.title, startsAt: game.starts_at });
  for (const id of ids) await svc.from('free_tonight').update({ notified_at: now.toISOString() }).eq('user_id', id);
  await svc.from('matches').update({ free_notified_at: now.toISOString() }).eq('id', game.id);
  return { state: 'told', count: ids.length };
}

// --- Backfill (once, by a platform admin) ----------------------------------------------------------

export async function backfillRecords(svc: SupabaseClient, adminId: string) {
  await requireAdmin(svc, adminId);
  const { data: ms } = await svc.from('matches').select('id,starts_at').eq('status', 'finished');
  const { data: fs } = await svc.from('fixtures').select('id,starts_at,created_at').eq('status', 'finished');
  const all = [
    ...((ms ?? []) as { id: string; starts_at: string }[]).map((m) => ({ source: 'match' as const, id: m.id, at: m.starts_at })),
    ...((fs ?? []) as { id: string; starts_at: string | null; created_at: string }[]).map((f) => ({ source: 'fixture' as const, id: f.id, at: f.starts_at ?? f.created_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  for (const g of all) await onGameFinished(svc, g.source, g.id);
  return { state: 'done', games: all.length };
}
