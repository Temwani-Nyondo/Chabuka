import { describe, expect, it } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import {
  addScoreboardEvents,
  appointOfficial,
  createScoreboard,
  finishScoreboard,
  getControlScoreboard,
  getPublicScoreboard,
  scoreboardForTarget,
  setLineup,
  undoLastEvent,
} from './scoreboard.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORGANISER = id(1);
const CAPTAIN_H = id(2);
const CAPTAIN_A = id(3);
const OFFICIAL = id(4);
const STRANGER = id(5);
const PLAYER_H = id(6);
const PLAYER_A = id(7);
const COMP = id(20);
const FIXTURE = id(21);
const TEAM_H = id(30);
const TEAM_A = id(31);
const SPORT_FOOTBALL = id(40);
const SPORT_MARATHON = id(41);
const SPORT_TENNIS = id(42);

const MIN = 60_000;
function world() {
  const t = {
    scoreboards: new Map<string, Row>(),
    players: new Map<string, Row>(),
    events: new Map<string, Row>(),
    fixtures: new Map<string, Row>(),
    competitions: new Map<string, Row>(),
    teams: new Map<string, Row>(),
    members: new Map<string, Row>(),
    sports: new Map<string, Row>(),
    profiles: new Map<string, Row>(),
    matches: new Map<string, Row>(),
    participants: new Map<string, Row>(),
    challenges: new Map<string, Row>(),
    follows: new Map<string, Row>(),
    entries: new Map<string, Row>(),
  };
  const client = {
    from(table: string) {
      switch (table) {
        case 'scoreboards': return new FakeQuery(t.scoreboards, (r) => String(r['id']));
        case 'scoreboard_players': return new FakeQuery(t.players, (r) => String(r['id']));
        case 'scoreboard_events': return new FakeQuery(t.events, (r) => `${String(r['scoreboard_id'])}:${String(r['seq'])}`);
        case 'fixtures': return new FakeQuery(t.fixtures, (r) => String(r['id']));
        case 'competitions': return new FakeQuery(t.competitions, (r) => String(r['id']));
        case 'teams': return new FakeQuery(t.teams, (r) => String(r['id']));
        case 'team_members': return new FakeQuery(t.members, (r) => `${String(r['team_id'])}:${String(r['user_id'])}`);
        case 'sports': return new FakeQuery(t.sports, (r) => String(r['id']));
        case 'profiles': return new FakeQuery(t.profiles, (r) => String(r['id']));
        case 'matches': return new FakeQuery(t.matches, (r) => String(r['id']));
        case 'match_participants': return new FakeQuery(t.participants, (r) => `${String(r['match_id'])}:${String(r['user_id'])}`);
        case 'challenges': return new FakeQuery(t.challenges, (r) => String(r['id']));
        case 'follows': return new FakeQuery(t.follows, (r) => `${String(r['user_id'])}:${String(r['competition_id'])}`);
        case 'competition_entries': return new FakeQuery(t.entries, (r) => `${String(r['competition_id'])}:${String(r['team_id'])}`);
        default: throw new Error(`unexpected table ${table}`);
      }
    },
  };

  for (const [pid, name] of [
    [ORGANISER, 'Organiser'], [CAPTAIN_H, 'Home Captain'], [CAPTAIN_A, 'Away Captain'],
    [OFFICIAL, 'Referee Ref'], [STRANGER, 'Stranger'], [PLAYER_H, 'Home Player'], [PLAYER_A, 'Away Player'],
  ] as const) t.profiles.set(pid, { id: pid, name });
  t.sports.set(SPORT_FOOTBALL, { id: SPORT_FOOTBALL, name: 'Football' });
  t.sports.set(SPORT_MARATHON, { id: SPORT_MARATHON, name: 'marathon' });
  t.sports.set(SPORT_TENNIS, { id: SPORT_TENNIS, name: 'tennis' });
  t.teams.set(TEAM_H, { id: TEAM_H, name: 'Home FC' });
  t.teams.set(TEAM_A, { id: TEAM_A, name: 'Away FC' });
  for (const [team, user, role] of [
    [TEAM_H, CAPTAIN_H, 'owner'], [TEAM_H, PLAYER_H, 'player'],
    [TEAM_A, CAPTAIN_A, 'captain'], [TEAM_A, PLAYER_A, 'player'],
  ] as const) t.members.set(`${team}:${user}`, { team_id: team, user_id: user, role });
  t.competitions.set(COMP, {
    id: COMP, organiser_id: ORGANISER, sport_id: SPORT_FOOTBALL, name: 'Lusaka League', kind: 'tournament',
    format: 'round_robin', starts_on: '2026-11-20', max_entries: 8, status: 'live',
  });
  t.entries.set(`${COMP}:${TEAM_H}`, { competition_id: COMP, team_id: TEAM_H, status: 'registered' });
  t.entries.set(`${COMP}:${TEAM_A}`, { competition_id: COMP, team_id: TEAM_A, status: 'registered' });
  t.fixtures.set(FIXTURE, { id: FIXTURE, competition_id: COMP, home_team_id: TEAM_H, away_team_id: TEAM_A, status: 'scheduled' });
  return { client: client as never, t };
}

let seqCounter = 0;
const ev = (type: string, atMin: number, extra: Record<string, unknown> = {}, base = Date.now()) => ({
  clientId: id(900000 + ++seqCounter), type, at: base + atMin * MIN, ...extra,
});

async function startedBoard() {
  const w = world();
  const { id: boardId } = await createScoreboard(w.client, ORGANISER, { fixtureId: FIXTURE });
  await appointOfficial(w.client, ORGANISER, boardId, OFFICIAL);
  return { ...w, boardId };
}

function playerIdOf(t: ReturnType<typeof world>['t'], userId: string): string {
  return [...t.players.values()].find((p) => p['user_id'] === userId)?.['id'] as string;
}

describe('creating a scoreboard', () => {
  it('lets the organiser or a captain set one up, with rosters from the teams', async () => {
    const w = world();
    const made = await createScoreboard(w.client, CAPTAIN_A, { fixtureId: FIXTURE });
    expect(made.shareCode.length).toBeGreaterThanOrEqual(6);
    const board = [...w.t.scoreboards.values()][0]!;
    expect(board['home_name']).toBe('Home FC');
    expect(board['away_name']).toBe('Away FC');
    expect(board['official_id']).toBeNull();
    expect([...w.t.players.values()]).toHaveLength(4);
    expect([...w.t.players.values()].every((p) => p['starter'] === true)).toBe(true); // 11 starters allowed, 2 per side
  });

  it('refuses strangers, sports without a scoreboard, and finished fixtures', async () => {
    const w = world();
    await expect(createScoreboard(w.client, STRANGER, { fixtureId: FIXTURE })).rejects.toMatchObject({ status: 403 });
    w.t.competitions.get(COMP)!['sport_id'] = SPORT_MARATHON;
    await expect(createScoreboard(w.client, ORGANISER, { fixtureId: FIXTURE })).rejects.toMatchObject({ status: 400 });
    w.t.competitions.get(COMP)!['sport_id'] = SPORT_FOOTBALL;
    w.t.fixtures.get(FIXTURE)!['status'] = 'finished';
    await expect(createScoreboard(w.client, ORGANISER, { fixtureId: FIXTURE })).rejects.toMatchObject({ status: 409 });
  });

  it('a pickup game: only its organiser, joined players split into two sides', async () => {
    const w = world();
    const MATCH = id(50);
    w.t.matches.set(MATCH, { id: MATCH, organiser_id: ORGANISER, sport_id: SPORT_FOOTBALL, title: 'Sunday kickabout', kind: 'players' });
    for (const u of [ORGANISER, PLAYER_H, PLAYER_A, STRANGER]) {
      w.t.participants.set(`${MATCH}:${u}`, { match_id: MATCH, user_id: u, status: 'joined' });
    }
    await expect(createScoreboard(w.client, STRANGER, { matchId: MATCH })).rejects.toMatchObject({ status: 403 });
    await createScoreboard(w.client, ORGANISER, { matchId: MATCH, homeName: 'Reds', awayName: 'Blues' });
    const board = [...w.t.scoreboards.values()][0]!;
    expect(board['home_name']).toBe('Reds');
    const sides = [...w.t.players.values()].map((p) => p['side']);
    expect(sides.filter((s) => s === 'home')).toHaveLength(2);
    expect(sides.filter((s) => s === 'away')).toHaveLength(2);
  });

  it('reports what the buttons need', async () => {
    const w = world();
    expect(await scoreboardForTarget(w.client, CAPTAIN_H, { fixtureId: FIXTURE })).toMatchObject({ canCreate: true, board: null });
    expect(await scoreboardForTarget(w.client, STRANGER, { fixtureId: FIXTURE })).toMatchObject({ canCreate: false, board: null });
    const made = await createScoreboard(w.client, ORGANISER, { fixtureId: FIXTURE });
    const info = await scoreboardForTarget(w.client, STRANGER, { fixtureId: FIXTURE });
    expect(info.board?.shareCode).toBe(made.shareCode);
    expect(info.board?.isOfficial).toBe(false);
    expect(info.board?.canManage).toBe(false);
    expect((await scoreboardForTarget(w.client, CAPTAIN_A, { fixtureId: FIXTURE })).board?.canManage).toBe(true);
  });
});

describe('appointing the official', () => {
  it('captains of either side and the organiser can appoint; strangers cannot', async () => {
    const w = world();
    const { id: boardId } = await createScoreboard(w.client, ORGANISER, { fixtureId: FIXTURE });
    await expect(appointOfficial(w.client, STRANGER, boardId, OFFICIAL)).rejects.toMatchObject({ status: 403 });
    await appointOfficial(w.client, CAPTAIN_H, boardId, OFFICIAL);
    expect([...w.t.scoreboards.values()][0]!['official_id']).toBe(OFFICIAL);
    // The other captain can replace them.
    await appointOfficial(w.client, CAPTAIN_A, boardId, PLAYER_A);
    expect([...w.t.scoreboards.values()][0]!['official_id']).toBe(PLAYER_A);
    await expect(appointOfficial(w.client, ORGANISER, boardId, id(999))).rejects.toMatchObject({ status: 404 });
  });

  it('only the official can record events', async () => {
    const { client, boardId } = await startedBoard();
    await expect(addScoreboardEvents(client, STRANGER, boardId, [ev('period_start', 0)])).rejects.toMatchObject({ status: 403 });
    await expect(addScoreboardEvents(client, CAPTAIN_H, boardId, [ev('period_start', 0)])).rejects.toMatchObject({ status: 403 });
    const ok = await addScoreboardEvents(client, OFFICIAL, boardId, [ev('period_start', 0)]);
    expect(ok.accepted).toHaveLength(1);
    expect(ok.status).toBe('live');
  });
});

describe('running a game', () => {
  it('records a goal with an assist and keeps the score on the board', async () => {
    const { client, t, boardId } = await startedBoard();
    const h = playerIdOf(t, CAPTAIN_H);
    const h2 = playerIdOf(t, PLAYER_H);
    const r = await addScoreboardEvents(client, OFFICIAL, boardId, [
      ev('period_start', 0),
      ev('goal', 10, { side: 'home', playerId: h, assistId: h2 }),
      ev('goal', 20, { side: 'away', playerId: playerIdOf(t, PLAYER_A) }),
    ]);
    expect(r.error).toBeNull();
    expect(r.score).toEqual({ home: 1, away: 1 });
    const board = [...t.scoreboards.values()][0]!;
    expect(board['home_score']).toBe(1);
    expect(board['last_seq']).toBe(3);
    expect(board['started_at']).toBeTruthy();
  });

  it('stops at the first event that breaks a rule and keeps the ones before it', async () => {
    const { client, t, boardId } = await startedBoard();
    const a = playerIdOf(t, PLAYER_A);
    const r = await addScoreboardEvents(client, OFFICIAL, boardId, [
      ev('period_start', 0),
      ev('goal', 5, { side: 'home', playerId: a }), // scorer is on the away side
      ev('goal', 6, { side: 'home' }),
    ]);
    expect(r.accepted).toHaveLength(1);
    expect(r.error).toMatchObject({ index: 1 });
    expect(r.error?.message).toMatch(/other side/);
    expect([...t.events.values()]).toHaveLength(1);
  });

  it('ignores a tap that arrives twice', async () => {
    const { client, t, boardId } = await startedBoard();
    const start = ev('period_start', 0);
    await addScoreboardEvents(client, OFFICIAL, boardId, [start]);
    const again = await addScoreboardEvents(client, OFFICIAL, boardId, [start, ev('goal', 3, { side: 'home' })]);
    expect(again.duplicates).toBe(1);
    expect(again.accepted).toHaveLength(1);
    expect([...t.events.values()]).toHaveLength(2);
  });

  it('keeps event times sane: not in the future, not before the last event', async () => {
    const { client, t, boardId } = await startedBoard();
    const now = 2_000_000_000_000;
    await addScoreboardEvents(client, OFFICIAL, boardId, [ev('period_start', 0, {}, now), ev('goal', -30, { side: 'home' }, now), ev('goal', 500, { side: 'home' }, now)], now);
    const ats = [...t.events.values()].sort((x, y) => Number(x['seq']) - Number(y['seq'])).map((e) => Number(e['at']));
    expect(ats[1]).toBeGreaterThanOrEqual(ats[0]!); // the back-dated goal is pulled up to the kickoff
    expect(ats[2]).toBeLessThanOrEqual(now + 30_000); // the future goal is pulled back
  });

  it('undo voids the last event and puts the score back', async () => {
    const { client, t, boardId } = await startedBoard();
    await addScoreboardEvents(client, OFFICIAL, boardId, [ev('period_start', 0), ev('goal', 5, { side: 'home' })]);
    await expect(undoLastEvent(client, STRANGER, boardId)).rejects.toMatchObject({ status: 403 });
    const u = await undoLastEvent(client, OFFICIAL, boardId);
    expect(u.voidedSeq).toBe(2);
    expect([...t.scoreboards.values()][0]!['home_score']).toBe(0);
    const control = await getControlScoreboard(client, OFFICIAL, boardId);
    expect(control.events.find((e) => e.seq === 2)?.voided).toBe(true);
  });

  it('sets the line-up before kickoff only', async () => {
    const { client, t, boardId } = await startedBoard();
    const h = playerIdOf(t, CAPTAIN_H);
    await setLineup(client, CAPTAIN_H, boardId, [h]);
    expect([...t.players.values()].find((p) => p['id'] === h)!['starter']).toBe(true);
    expect([...t.players.values()].find((p) => p['id'] === playerIdOf(t, PLAYER_H))!['starter']).toBe(false);
    await addScoreboardEvents(client, OFFICIAL, boardId, [ev('period_start', 0)]);
    await expect(setLineup(client, CAPTAIN_H, boardId, [h])).rejects.toMatchObject({ status: 409 });
    await expect(setLineup(client, STRANGER, boardId, [h])).rejects.toMatchObject({ status: 403 });
  });
});

describe('finishing', () => {
  it('writes the score into the fixture and standings, and undo takes it back out', async () => {
    const { client, t, boardId } = await startedBoard();
    const h = playerIdOf(t, CAPTAIN_H);
    await addScoreboardEvents(client, OFFICIAL, boardId, [
      ev('period_start', 0),
      ev('goal', 10, { side: 'home', playerId: h }),
      ev('period_end', 45),
      ev('period_start', 60),
    ]);
    await expect(finishScoreboard(client, OFFICIAL, boardId)).rejects.toMatchObject({ status: 409 }); // not over
    await addScoreboardEvents(client, OFFICIAL, boardId, [ev('period_end', 105)]);
    await expect(finishScoreboard(client, STRANGER, boardId)).rejects.toMatchObject({ status: 403 });
    await expect(finishScoreboard(client, OFFICIAL, boardId, { mvpPlayerId: id(777) })).rejects.toMatchObject({ status: 400 });
    const done = await finishScoreboard(client, OFFICIAL, boardId, { mvpPlayerId: h });
    expect(done).toEqual({ homeScore: 1, awayScore: 0 });
    const fixture = t.fixtures.get(FIXTURE)!;
    expect(fixture['status']).toBe('finished');
    expect(fixture['home_score']).toBe(1);
    expect(t.competitions.get(COMP)!['status']).toBe('finished'); // it was the only fixture
    expect([...t.scoreboards.values()][0]!['result_posted']).toBe(true);
    await expect(finishScoreboard(client, OFFICIAL, boardId)).rejects.toMatchObject({ status: 409 });

    await undoLastEvent(client, OFFICIAL, boardId);
    const reopened = t.fixtures.get(FIXTURE)!;
    expect(reopened['status']).toBe('scheduled');
    expect(reopened['home_score']).toBeNull();
    expect(t.competitions.get(COMP)!['status']).toBe('live');
    expect([...t.scoreboards.values()][0]!['result_posted']).toBe(false);
  });

  it('a pickup game stores its score on the game', async () => {
    const w = world();
    const MATCH = id(50);
    w.t.matches.set(MATCH, { id: MATCH, organiser_id: ORGANISER, sport_id: SPORT_FOOTBALL, title: 'Sunday kickabout', kind: 'players' });
    w.t.participants.set(`${MATCH}:${ORGANISER}`, { match_id: MATCH, user_id: ORGANISER, status: 'joined' });
    const { id: boardId } = await createScoreboard(w.client, ORGANISER, { matchId: MATCH });
    await appointOfficial(w.client, ORGANISER, boardId, OFFICIAL);
    await addScoreboardEvents(w.client, OFFICIAL, boardId, [
      ev('period_start', 0), ev('goal', 5, { side: 'away' }), ev('goal', 6, { side: 'away' }), ev('game_end', 40),
    ]);
    await finishScoreboard(w.client, ORGANISER, boardId);
    expect(w.t.matches.get(MATCH)!['home_score']).toBe(0);
    expect(w.t.matches.get(MATCH)!['away_score']).toBe(2);
  });

  it('a tennis match records sets won', async () => {
    const w = world();
    w.t.competitions.get(COMP)!['sport_id'] = SPORT_TENNIS;
    const { id: boardId } = await createScoreboard(w.client, ORGANISER, { fixtureId: FIXTURE });
    await appointOfficial(w.client, ORGANISER, boardId, OFFICIAL);
    const points = [ev('period_start', 0)];
    for (let set = 0; set < 2; set++) for (let i = 0; i < 24; i++) points.push(ev('point', 1 + set * 30 + i, { side: 'home' }));
    const r = await addScoreboardEvents(w.client, OFFICIAL, boardId, points);
    expect(r.error).toBeNull();
    expect(r.status).toBe('ended');
    expect(r.score).toEqual({ home: 2, away: 0 });
    const done = await finishScoreboard(w.client, OFFICIAL, boardId);
    expect(done).toEqual({ homeScore: 2, awayScore: 0 });
  });
});

describe('what the public sees', () => {
  it('shows names, numbers and events but no account ids', async () => {
    const { client, t, boardId } = await startedBoard();
    await addScoreboardEvents(client, OFFICIAL, boardId, [ev('period_start', 0), ev('goal', 5, { side: 'home', playerId: playerIdOf(t, CAPTAIN_H) })]);
    const code = String([...t.scoreboards.values()][0]!['share_code']);
    const pub = await getPublicScoreboard(client, code);
    expect(pub.board.homeName).toBe('Home FC');
    expect(pub.board.officialName).toBe('Referee Ref');
    expect(pub.board.homeScore).toBe(1);
    expect(pub.roster).toHaveLength(4);
    const json = JSON.stringify(pub);
    for (const secret of [ORGANISER, CAPTAIN_H, CAPTAIN_A, OFFICIAL, PLAYER_H, PLAYER_A, 'user_id', 'created_by', 'official_id']) {
      expect(json).not.toContain(secret);
    }
    await expect(getPublicScoreboard(client, 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(getPublicScoreboard(client, 'does-not-exist-123')).rejects.toMatchObject({ status: 404 });
  });
});
