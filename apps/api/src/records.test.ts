import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';

const sent: { ids: string[]; type: string; payload: Record<string, unknown> }[] = [];
vi.mock('./actions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./actions.js')>();
  return { ...real, notifyUsers: async (ids: string[], type: string, payload: Record<string, unknown>) => void sent.push({ ids, type, payload }) };
});

const r = await import('./records.js');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPORT = id(40);
const A = id(1); // team A
const B = id(2); // team B
const C = id(3); // team C
const P1 = id(11);
const P2 = id(12);
const P3 = id(13);
const ORG = id(20);
const FREE1 = id(21);
const FREE2 = id(22);
const NOW = new Date('2026-11-20T14:00:00Z');
const GAME = id(300); // 16:00 in Lusaka

function world() {
  const names = [
    'matches', 'challenges', 'scoreboards', 'scoreboard_players', 'scoreboard_events', 'match_participants', 'fixtures', 'competitions', 'teams',
    'team_members', 'team_ratings', 'rating_events', 'player_stats', 'sports', 'race_entries', 'race_distances', 'profiles', 'user_sports',
    'user_availability', 'free_tonight', 'venues', 'platform_admins', 'user_follows',
  ];
  const t: Record<string, Map<string, Row>> = Object.fromEntries(names.map((n) => [n, new Map<string, Row>()]));
  const keys: Record<string, (x: Row) => string> = {
    match_participants: (x) => `${String(x['match_id'])}:${String(x['user_id'])}`,
    team_members: (x) => `${String(x['team_id'])}:${String(x['user_id'])}`,
    team_ratings: (x) => `${String(x['team_id'])}:${String(x['sport_id'])}`,
    rating_events: (x) => String(x['source_id']),
    player_stats: (x) => `${String(x['user_id'])}:${String(x['source'])}:${String(x['source_id'])}`,
    user_availability: (x) => `${String(x['user_id'])}:${String(x['day'])}:${String(x['time_band'])}`,
    free_tonight: (x) => String(x['user_id']),
    platform_admins: (x) => String(x['user_id']),
    user_follows: (x) => `${String(x['user_id'])}:${String(x['subject_type'])}:${String(x['subject_id'])}`,
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((x) => String(x['id'])));
    },
  } as never;
  t.sports!.set(SPORT, { id: SPORT, name: 'Football' });
  for (const [tid, name, area, lat] of [[A, 'Kabwata FC', 'Kabwata', -15.43], [B, 'Matero United', 'Matero', -15.39], [C, 'Chilenje Stars', 'Chilenje', -15.45]] as const) {
    t.teams!.set(tid, { id: tid, name, sport_id: SPORT, area, lat, lng: 28.3, logo_url: null });
  }
  t.team_members!.set(`${A}:${P1}`, { team_id: A, user_id: P1, role: 'captain' });
  t.team_members!.set(`${A}:${P2}`, { team_id: A, user_id: P2, role: 'player' });
  t.team_members!.set(`${B}:${P3}`, { team_id: B, user_id: P3, role: 'captain' });
  return { t, client };
}

function challengeGame(w: ReturnType<typeof world>, n: number, home: string, away: string, hs: number, as: number, players: string[]) {
  const mid = id(100 + n);
  w.t.matches!.set(mid, { id: mid, sport_id: SPORT, starts_at: `2026-11-${String(n).padStart(2, '0')}T15:00:00Z`, status: 'finished', home_score: hs, away_score: as });
  w.t.challenges!.set(`c${n}`, { id: `c${n}`, team_id: home, opponent_team_id: away, match_id: mid });
  for (const p of players) w.t.match_participants!.set(`${mid}:${p}`, { match_id: mid, user_id: p, status: 'joined' });
  return mid;
}

beforeEach(() => {
  sent.length = 0;
});

describe('games become records and ratings', () => {
  it('a finished challenge game rates both teams once and writes player lines', async () => {
    const w = world();
    const m = challengeGame(w, 1, A, B, 3, 1, [P1, P2, P3]);
    await r.onGameFinished(w.client, 'match', m);
    await r.onGameFinished(w.client, 'match', m);
    expect([...w.t.rating_events!.values()]).toHaveLength(1);
    const ra = w.t.team_ratings!.get(`${A}:${SPORT}`)!;
    const rb = w.t.team_ratings!.get(`${B}:${SPORT}`)!;
    expect(ra).toMatchObject({ games: 1 });
    expect(Number(ra['rating'])).toBeGreaterThan(1000);
    expect(Number(ra['rating']) - 1000).toBe(1000 - Number(rb['rating']));
    expect(w.t.player_stats!.get(`${P1}:match:${m}`)).toMatchObject({ result: 'W', team_id: A, opponent: 'Matero United' });
    expect(w.t.player_stats!.get(`${P3}:match:${m}`)).toMatchObject({ result: 'L', team_id: B });
  });

  it('followers of either team hear the result once; squad members and double followers are not told twice', async () => {
    const w = world();
    const FAN = id(30);
    const BOTH = id(31);
    w.t.user_follows!.set('f1', { user_id: FAN, subject_type: 'team', subject_id: B });
    w.t.user_follows!.set('f2', { user_id: BOTH, subject_type: 'team', subject_id: A });
    w.t.user_follows!.set('f3', { user_id: BOTH, subject_type: 'team', subject_id: B });
    w.t.user_follows!.set('f4', { user_id: P1, subject_type: 'team', subject_id: B });
    const m = challengeGame(w, 1, A, B, 3, 1, [P1, P2, P3]);
    await r.onGameFinished(w.client, 'match', m);
    await r.onGameFinished(w.client, 'match', m);
    const notes = sent.filter((x) => x.type === 'followed_team_result');
    const told = notes.flatMap((x) => x.ids);
    expect(told.sort()).toEqual([BOTH, FAN].sort());
    expect(notes.find((x) => x.ids.includes(FAN))!.payload).toMatchObject({ teamId: B, title: 'Matero United', score: 'Kabwata FC 3-1 Matero United' });
  });

  it('a corrected score re-rates instead of rating twice', async () => {
    const w = world();
    const m = challengeGame(w, 1, A, B, 3, 1, [P1]);
    await r.onGameFinished(w.client, 'match', m);
    w.t.matches!.get(m)!['home_score'] = 0;
    await r.onGameFinished(w.client, 'match', m);
    expect(w.t.team_ratings!.get(`${A}:${SPORT}`)).toMatchObject({ games: 1 });
    expect(Number(w.t.team_ratings!.get(`${A}:${SPORT}`)!['rating'])).toBeLessThan(1000);
    expect(w.t.player_stats!.get(`${P1}:match:${m}`)!['result']).toBe('L');
    // Cancelled afterwards: the rating comes back out.
    w.t.matches!.get(m)!['status'] = 'cancelled';
    await r.onGameFinished(w.client, 'match', m);
    expect(w.t.team_ratings!.get(`${A}:${SPORT}`)).toMatchObject({ games: 0, rating: 1000 });
    expect(w.t.player_stats!.size).toBe(0);
  });

  it('an open pickup game writes lines without a result', async () => {
    const w = world();
    const mid = id(150);
    w.t.matches!.set(mid, { id: mid, sport_id: SPORT, starts_at: '2026-11-10T15:00:00Z', status: 'finished', home_score: null, away_score: null });
    w.t.match_participants!.set(`${mid}:${P1}`, { match_id: mid, user_id: P1, status: 'joined' });
    await r.onGameFinished(w.client, 'match', mid);
    expect(w.t.player_stats!.get(`${P1}:match:${mid}`)).toMatchObject({ result: null });
    expect(w.t.rating_events!.size).toBe(0);
  });

  it('scoreboard goals, assists, cards and the best player become stats', async () => {
    const w = world();
    const m = challengeGame(w, 2, A, B, 2, 0, []);
    w.t.scoreboards!.set('sb', { id: 'sb', match_id: m, mvp_player_id: 'sp1', result_posted: true });
    w.t.scoreboard_players!.set('sp1', { id: 'sp1', scoreboard_id: 'sb', user_id: P1, side: 'home' });
    w.t.scoreboard_players!.set('sp2', { id: 'sp2', scoreboard_id: 'sb', user_id: P2, side: 'home' });
    w.t.scoreboard_players!.set('sp3', { id: 'sp3', scoreboard_id: 'sb', user_id: P3, side: 'away' });
    w.t.scoreboard_events!.set('e1', { id: 'e1', scoreboard_id: 'sb', type: 'goal', payload: { side: 'home', playerId: 'sp1', assistId: 'sp2' }, voided: false });
    w.t.scoreboard_events!.set('e2', { id: 'e2', scoreboard_id: 'sb', type: 'goal', payload: { side: 'home', playerId: 'sp1' }, voided: false });
    w.t.scoreboard_events!.set('e3', { id: 'e3', scoreboard_id: 'sb', type: 'goal', payload: { side: 'home', playerId: 'sp2' }, voided: true });
    w.t.scoreboard_events!.set('e4', { id: 'e4', scoreboard_id: 'sb', type: 'card', payload: { side: 'away', playerId: 'sp3', card: 'yellow' }, voided: false });
    await r.onGameFinished(w.client, 'match', m);
    expect(w.t.player_stats!.get(`${P1}:match:${m}`)).toMatchObject({ goals: 2, assists: 0, mvp: true, result: 'W' });
    expect(w.t.player_stats!.get(`${P2}:match:${m}`)).toMatchObject({ goals: 0, assists: 1 });
    expect(w.t.player_stats!.get(`${P3}:match:${m}`)).toMatchObject({ cards: 1, result: 'L' });
    const rec = await r.recordFor(w.client, P1, { now: NOW });
    expect(rec.record).toMatchObject({ played: 1, won: 1, goals: 2, mvps: 1 });
  });

  it('team record and head-to-head come from fixtures and challenge games', async () => {
    const w = world();
    challengeGame(w, 1, A, B, 3, 1, []);
    challengeGame(w, 3, B, A, 2, 2, []);
    w.t.competitions!.set('comp', { id: 'comp', sport_id: SPORT });
    w.t.fixtures!.set('f1', { id: 'f1', competition_id: 'comp', home_team_id: C, away_team_id: A, home_score: 0, away_score: 1, status: 'finished', starts_at: '2026-11-05T10:00:00Z' });
    const rec = await r.getTeamRecord(w.client, A);
    expect(rec.record).toMatchObject({ played: 3, won: 2, drawn: 1, lost: 0, goalsFor: 6, goalsAgainst: 3 });
    expect(rec.headToHead.find((h) => h.teamId === B)).toMatchObject({ played: 2, won: 1, drawn: 1 });
    expect(rec.band.band).toBe('new');
  });
});

describe('matchmaking', () => {
  it('suggests other teams of the sport, closest and free at the same time first', async () => {
    const w = world();
    for (const [u, team] of [[P1, A], [P2, A], [P3, B]] as const) {
      w.t.user_availability!.set(`${u}:6:morning`, { user_id: u, day: 6, time_band: 'morning' });
      void team;
    }
    w.t.team_members!.set(`${B}:${FREE1}`, { team_id: B, user_id: FREE1, role: 'player' });
    w.t.user_availability!.set(`${FREE1}:6:morning`, { user_id: FREE1, day: 6, time_band: 'morning' });
    const out = await r.suggestOpponents(w.client, P1, A, { now: NOW });
    expect(out.suggestions.map((s) => s.team.id)).not.toContain(A);
    expect(out.suggestions[0]!.team.id).toBe(B);
    expect(out.suggestions[0]!.reasons).toContain('Free Saturday mornings');
    await expect(r.suggestOpponents(w.client, ORG, A)).rejects.toThrow(/members/);
  });

  it('ranks open games for a player by sport, distance and free time', async () => {
    const w = world();
    w.t.profiles!.set(P1, { id: P1, lat: -15.42, lng: 28.3, area: 'Kabwata' });
    w.t.user_sports!.set(`${P1}`, { user_id: P1, sport_id: SPORT, level: 'intermediate' });
    w.t.matches!.set('g1', { id: 'g1', sport_id: SPORT, starts_at: '2026-11-21T16:00:00Z', lat: -15.421, lng: 28.301, area: 'Kabwata', level: 'intermediate', capacity: 10, status: 'open', visibility: 'public' });
    w.t.matches!.set('g2', { id: 'g2', sport_id: id(41), starts_at: '2026-11-22T08:00:00Z', lat: -15.2, lng: 28.6, area: 'Far', level: null, capacity: 10, status: 'open', visibility: 'public' });
    const out = await r.gamesForYou(w.client, P1, { now: NOW });
    expect(out.ranked.map((g) => g.matchId)).toEqual(['g1', 'g2']);
    expect(out.ranked[0]!.reasons).toContain('Your sport');
  });
});

describe('Free tonight', () => {
  function tonight(w: ReturnType<typeof world>) {
    w.t.matches!.set(GAME, { id: GAME, title: 'Tonight 5-a-side', organiser_id: ORG, sport_id: SPORT, starts_at: '2026-11-20T17:00:00Z', lat: -15.42, lng: 28.3, venue_id: null, status: 'open', free_notified_at: null });
  }
  it('organisers see only a count of nearby free players, and tell them once', async () => {
    const w = world();
    tonight(w);
    w.t.profiles!.set(FREE1, { id: FREE1, lat: -15.421, lng: 28.301 });
    await r.setFreeTonight(w.client, FREE1, { sports: [SPORT], radiusKm: 5 }, { now: NOW });
    await r.setFreeTonight(w.client, FREE2, { sports: [SPORT], radiusKm: 5, lat: -15.0, lng: 28.0 }, { now: NOW });
    const near = await r.freeNearby(w.client, ORG, GAME, { now: NOW });
    expect(near).toEqual({ count: 1, eligible: true, alreadyTold: false });
    await expect(r.freeNearby(w.client, P1, GAME, { now: NOW })).rejects.toThrow(/organiser/);
    const told = await r.notifyFreePlayers(w.client, ORG, { matchId: GAME }, { now: NOW });
    expect(told).toMatchObject({ count: 1 });
    expect(sent.at(-1)).toMatchObject({ ids: [FREE1], type: 'free_tonight_game' });
    await expect(r.notifyFreePlayers(w.client, ORG, { matchId: GAME }, { now: NOW })).rejects.toThrow(/already told/);
  });

  it('the create form sees a count only from three free players up, and only for tonight', async () => {
    const w = world();
    const q = { sportId: SPORT, startsAt: '2026-11-20T17:00:00Z', lat: -15.42, lng: 28.3 };
    await r.setFreeTonight(w.client, FREE1, { sports: [SPORT], radiusKm: 5, lat: -15.421, lng: 28.301 }, { now: NOW });
    await r.setFreeTonight(w.client, FREE2, { sports: [SPORT], radiusKm: 5, lat: -15.422, lng: 28.302 }, { now: NOW });
    expect(await r.freeNearbyPreview(w.client, ORG, q, { now: NOW })).toEqual({ count: 0, eligible: true });
    await r.setFreeTonight(w.client, P3, { sports: [SPORT], radiusKm: 5, lat: -15.423, lng: 28.303 }, { now: NOW });
    expect(await r.freeNearbyPreview(w.client, ORG, q, { now: NOW })).toEqual({ count: 3, eligible: true });
    // The organiser's own "free tonight" never counts.
    expect(await r.freeNearbyPreview(w.client, FREE1, q, { now: NOW })).toEqual({ count: 0, eligible: true });
    expect(await r.freeNearbyPreview(w.client, ORG, { ...q, startsAt: '2026-11-21T17:00:00Z' }, { now: NOW })).toEqual({ count: 0, eligible: false });
    expect(await r.freeNearbyPreview(w.client, ORG, { ...q, lat: null, lng: null }, { now: NOW })).toEqual({ count: 0, eligible: false });
  });

  it('switches itself off at midnight Lusaka', async () => {
    const w = world();
    const out = await r.setFreeTonight(w.client, FREE1, { sports: [SPORT], radiusKm: 5, lat: -15.4, lng: 28.3 }, { now: NOW });
    expect(out.until).toBe('2026-11-20T22:00:00.000Z');
    expect((await r.myFreeTonight(w.client, FREE1, { now: NOW })).on).toBe(true);
    expect((await r.myFreeTonight(w.client, FREE1, { now: new Date('2026-11-20T22:30:00Z') })).on).toBe(false);
  });
});
