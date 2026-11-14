import { describe, expect, it } from 'vitest';
import { formationsFor } from '@chabuka/shared';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';
import {
  getAvailability,
  getLineups,
  getRuleBook,
  getTeamAdmin,
  requestJoinTeam,
  respondAvailability,
  respondJoinRequest,
  saveLineup,
  saveRuleBook,
  setShirtNumber,
  transferOwnership,
  updateTeamSettings,
} from './teamAdmin.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORGANISER = id(1);
const OWNER_H = id(2);
const CAPTAIN_A = id(3);
const PLAYER_H = id(4);
const PLAYER_H2 = id(5);
const PLAYER_A = id(6);
const STRANGER = id(7);
const COMP = id(20);
const FIXTURE = id(21);
const PICKUP = id(22);
const TEAM_H = id(30);
const TEAM_A = id(31);
const SPORT = id(40);

function world() {
  const t: Record<string, Map<string, Row>> = {
    teams: new Map(),
    team_members: new Map(),
    team_join_requests: new Map(),
    availability_responses: new Map(),
    lineups: new Map(),
    rule_books: new Map(),
    fixtures: new Map(),
    competitions: new Map(),
    matches: new Map(),
    match_participants: new Map(),
    challenges: new Map(),
    profiles: new Map(),
    sports: new Map(),
  };
  const keys: Record<string, (r: Row) => string> = {
    team_members: (r) => `${String(r['team_id'])}:${String(r['user_id'])}`,
    availability_responses: (r) => `${String(r['subject_type'])}:${String(r['subject_id'])}:${String(r['user_id'])}`,
    match_participants: (r) => `${String(r['match_id'])}:${String(r['user_id'])}`,
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((r) => String(r['id'])));
    },
  } as never;

  for (const [pid, name] of [
    [ORGANISER, 'Organiser'], [OWNER_H, 'Home Owner'], [CAPTAIN_A, 'Away Captain'], [PLAYER_H, 'Home One'],
    [PLAYER_H2, 'Home Two'], [PLAYER_A, 'Away One'], [STRANGER, 'Stranger'],
  ] as const) t.profiles!.set(pid, { id: pid, name, photo_url: null });
  t.sports!.set(SPORT, { id: SPORT, name: 'football' });
  t.teams!.set(TEAM_H, { id: TEAM_H, name: 'Home FC', sport_id: SPORT, join_policy: 'request', kit_colour: null });
  t.teams!.set(TEAM_A, { id: TEAM_A, name: 'Away FC', sport_id: SPORT, join_policy: 'invite', kit_colour: null });
  const member = (team: string, user: string, role: string, shirt: number | null = null) =>
    t.team_members!.set(`${team}:${user}`, { team_id: team, user_id: user, role, position: null, shirt_number: shirt });
  member(TEAM_H, OWNER_H, 'owner', 10);
  member(TEAM_H, PLAYER_H, 'player', 7);
  member(TEAM_H, PLAYER_H2, 'player');
  member(TEAM_A, CAPTAIN_A, 'captain');
  member(TEAM_A, PLAYER_A, 'player');
  t.competitions!.set(COMP, { id: COMP, organiser_id: ORGANISER, sport_id: SPORT, name: 'Lusaka 5s' });
  t.fixtures!.set(FIXTURE, {
    id: FIXTURE, competition_id: COMP, home_team_id: TEAM_H, away_team_id: TEAM_A,
    starts_at: new Date(Date.now() + 86400000).toISOString(),
  });
  t.matches!.set(PICKUP, {
    id: PICKUP, organiser_id: ORGANISER, sport_id: SPORT, title: 'Saturday 5s', kind: 'players', format: '5v5',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
  });
  for (const u of [ORGANISER, PLAYER_H, PLAYER_A, STRANGER]) {
    t.match_participants!.set(`${PICKUP}:${u}`, { match_id: PICKUP, user_id: u, status: 'joined' });
  }
  return { t, client };
}

const fiveSlots = (ids: (string | null)[]) =>
  (formationsFor('football', '5v5')[0]?.slots ?? []).map((s, i) => ({ ...s, userId: ids[i] ?? null }));
const elevenSlots = (ids: (string | null)[]) =>
  (formationsFor('football', null)[0]?.slots ?? []).map((s, i) => ({ ...s, userId: ids[i] ?? null }));

describe('availability', () => {
  it('lets squad members answer and shows captains the whole squad', async () => {
    const { client } = world();
    await respondAvailability(client, PLAYER_H, { subjectType: 'fixture', subjectId: FIXTURE, status: 'in' });
    await respondAvailability(client, PLAYER_H2, { subjectType: 'fixture', subjectId: FIXTURE, status: 'maybe' });
    const view = await getAvailability(client, OWNER_H, 'fixture', FIXTURE);
    expect(view.sides).toHaveLength(1);
    expect(view.sides[0]?.name).toBe('Home FC');
    expect(view.sides[0]?.canManage).toBe(true);
    expect(view.sides[0]?.counts).toEqual({ in: 1, maybe: 1, out: 0, none: 1 });
    const mine = await getAvailability(client, PLAYER_H, 'fixture', FIXTURE);
    expect(mine.me.status).toBe('in');
    expect(mine.sides[0]?.canManage).toBe(false);
  });

  it('lets the organiser see both sides and keeps strangers out', async () => {
    const { client } = world();
    expect((await getAvailability(client, ORGANISER, 'fixture', FIXTURE)).sides).toHaveLength(2);
    await expect(getAvailability(client, STRANGER, 'fixture', FIXTURE)).rejects.toMatchObject({ status: 403 });
    await expect(
      respondAvailability(client, STRANGER, { subjectType: 'fixture', subjectId: FIXTURE, status: 'in' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('treats joined pickup players as in, and points answers to join/leave', async () => {
    const { client } = world();
    const view = await getAvailability(client, ORGANISER, 'match', PICKUP);
    expect(view.sides[0]?.counts.in).toBe(4);
    await expect(
      respondAvailability(client, PLAYER_H, { subjectType: 'match', subjectId: PICKUP, status: 'out' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('lineups', () => {
  it('lets a captain save a draft only their own side sees, then publish it', async () => {
    const { client } = world();
    await saveLineup(client, OWNER_H, {
      subjectType: 'fixture', subjectId: FIXTURE, side: 'home', formation: '4-4-2',
      slots: elevenSlots([PLAYER_H, OWNER_H]), bench: [PLAYER_H2], publish: false,
    });
    const own = await getLineups(client, OWNER_H, 'fixture', FIXTURE);
    expect(own.sides[0]?.lineup?.slots[0]?.name).toBe('Home One');
    expect(own.sides[0]?.lineup?.slots[0]?.shirt).toBe(7);
    expect(own.sides[0]?.pool.length).toBe(3);
    const rival = await getLineups(client, CAPTAIN_A, 'fixture', FIXTURE);
    expect(rival.sides[0]?.lineup).toBeNull();
    expect(rival.sides[0]?.pool).toEqual([]);
    const result = await saveLineup(client, OWNER_H, {
      subjectType: 'fixture', subjectId: FIXTURE, side: 'home', formation: '4-4-2',
      slots: elevenSlots([PLAYER_H, OWNER_H]), bench: [], publish: true,
    });
    expect(result.published).toBe(true);
    expect((await getLineups(client, CAPTAIN_A, 'fixture', FIXTURE)).sides[0]?.lineup?.published).toBe(true);
  });

  it('refuses players, other captains and outsiders in the lineup', async () => {
    const { client } = world();
    const base = { subjectType: 'fixture' as const, subjectId: FIXTURE, side: 'home' as const, formation: '4-4-2', bench: [], publish: false };
    await expect(saveLineup(client, PLAYER_H, { ...base, slots: elevenSlots([PLAYER_H]) })).rejects.toMatchObject({ status: 403 });
    await expect(saveLineup(client, CAPTAIN_A, { ...base, slots: elevenSlots([PLAYER_H]) })).rejects.toMatchObject({ status: 403 });
    await expect(saveLineup(client, OWNER_H, { ...base, slots: elevenSlots([PLAYER_A]) })).rejects.toMatchObject({ status: 400 });
  });

  it('lets the pickup host split players into two sides, each player once', async () => {
    const { client } = world();
    await saveLineup(client, ORGANISER, {
      subjectType: 'match', subjectId: PICKUP, side: 'home', formation: '2-1-1',
      slots: fiveSlots([PLAYER_H, ORGANISER]), bench: [], publish: false,
    });
    await expect(
      saveLineup(client, ORGANISER, {
        subjectType: 'match', subjectId: PICKUP, side: 'away', formation: '2-1-1',
        slots: fiveSlots([PLAYER_H]), bench: [], publish: false,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await saveLineup(client, ORGANISER, {
      subjectType: 'match', subjectId: PICKUP, side: 'away', formation: '2-1-1',
      slots: fiveSlots([PLAYER_A, STRANGER]), bench: [], publish: true,
    });
    await expect(
      saveLineup(client, PLAYER_A, {
        subjectType: 'match', subjectId: PICKUP, side: 'away', formation: '2-1-1',
        slots: fiveSlots([PLAYER_A]), bench: [], publish: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('team admin', () => {
  it('follows the join policy: invite refuses, request waits for a captain, open joins', async () => {
    const { client, t } = world();
    await expect(requestJoinTeam(client, STRANGER, { teamId: TEAM_A })).rejects.toMatchObject({ status: 403 });
    expect((await requestJoinTeam(client, STRANGER, { teamId: TEAM_H, message: 'I play in goal' })).state).toBe('requested');
    expect((await requestJoinTeam(client, STRANGER, { teamId: TEAM_H })).state).toBe('requested');
    const admin = await getTeamAdmin(client, OWNER_H, TEAM_H);
    expect(admin.requests).toHaveLength(1);
    expect(admin.requests[0]?.message).toBe('I play in goal');
    expect((await getTeamAdmin(client, STRANGER, TEAM_H)).myRequest).not.toBeNull();
    expect((await getTeamAdmin(client, PLAYER_H, TEAM_H)).requests).toEqual([]);
    await expect(respondJoinRequest(client, PLAYER_H, { requestId: admin.requests[0]!.id, decision: 'accept' })).rejects.toMatchObject({ status: 403 });
    await respondJoinRequest(client, OWNER_H, { requestId: admin.requests[0]!.id, decision: 'accept' });
    expect(t.team_members!.get(`${TEAM_H}:${STRANGER}`)?.['role']).toBe('player');
    await expect(respondJoinRequest(client, OWNER_H, { requestId: admin.requests[0]!.id, decision: 'decline' })).rejects.toMatchObject({ status: 409 });

    await updateTeamSettings(client, CAPTAIN_A, { teamId: TEAM_A, joinPolicy: 'open', kitColour: '#b42318' });
    expect((await requestJoinTeam(client, ORGANISER, { teamId: TEAM_A })).state).toBe('joined');
    expect(t.teams!.get(TEAM_A)?.['kit_colour']).toBe('#b42318');
    await expect(updateTeamSettings(client, PLAYER_A, { teamId: TEAM_A, joinPolicy: 'invite' })).rejects.toMatchObject({ status: 403 });
  });

  it('keeps shirt numbers unique and lets players pick their own', async () => {
    const { client, t } = world();
    await expect(setShirtNumber(client, OWNER_H, { teamId: TEAM_H, userId: PLAYER_H2, number: 7 })).rejects.toThrow(/Home One/);
    await setShirtNumber(client, PLAYER_H2, { teamId: TEAM_H, userId: PLAYER_H2, number: 9 });
    expect(t.team_members!.get(`${TEAM_H}:${PLAYER_H2}`)?.['shirt_number']).toBe(9);
    await expect(setShirtNumber(client, PLAYER_H2, { teamId: TEAM_H, userId: PLAYER_H, number: 11 })).rejects.toMatchObject({ status: 403 });
  });

  it('hands ownership over and keeps the old owner as captain', async () => {
    const { client, t } = world();
    await expect(transferOwnership(client, PLAYER_H, { teamId: TEAM_H, userId: PLAYER_H2 })).rejects.toMatchObject({ status: 403 });
    await transferOwnership(client, OWNER_H, { teamId: TEAM_H, userId: PLAYER_H });
    expect(t.team_members!.get(`${TEAM_H}:${PLAYER_H}`)?.['role']).toBe('owner');
    expect(t.team_members!.get(`${TEAM_H}:${OWNER_H}`)?.['role']).toBe('captain');
  });
});

describe('rule books', () => {
  it('starts from the sport template, lets the host save versions, and refuses others', async () => {
    const { client } = world();
    const start = await getRuleBook(client, ORGANISER, { type: 'match', id: PICKUP });
    expect(start.source).toBe('template');
    expect(start.title).toMatch(/Futsal/);
    expect(start.canEdit).toBe(true);
    expect((await getRuleBook(client, PLAYER_H, { type: 'match', id: PICKUP })).canEdit).toBe(false);
    const target = { type: 'match' as const, id: PICKUP };
    expect((await saveRuleBook(client, ORGANISER, { target, title: 'Saturday rules', rules: [{ title: 'Kick-off', body: '09:00 sharp' }] })).version).toBe(1);
    expect((await saveRuleBook(client, ORGANISER, { target, title: 'Saturday rules', rules: [{ title: 'Kick-off', body: '09:30' }] })).version).toBe(2);
    const after = await getRuleBook(client, PLAYER_H, target);
    expect(after.source).toBe('own');
    expect(after.rules[0]?.body).toBe('09:30');
    await expect(saveRuleBook(client, PLAYER_H, { target, title: 'Mine', rules: [{ title: 'x', body: '' }] })).rejects.toMatchObject({ status: 403 });
  });

  it('gives fixtures their competition’s rules', async () => {
    const { client } = world();
    await saveRuleBook(client, ORGANISER, { target: { type: 'competition', id: COMP }, title: 'Lusaka 5s rules', rules: [{ title: 'Points', body: 'Win 3, draw 1' }] });
    const book = await getRuleBook(client, OWNER_H, { type: 'fixture', id: FIXTURE });
    expect(book.source).toBe('competition');
    expect(book.title).toBe('Lusaka 5s rules');
    expect(book.canEdit).toBe(false);
  });
});
