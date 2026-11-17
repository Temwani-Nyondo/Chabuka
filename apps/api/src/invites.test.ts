import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';

const sent: { ids: string[]; type: string; payload: Record<string, unknown> }[] = [];
const joins: { userId: string; matchId: string }[] = [];
let joinFails: string | null = null;
vi.mock('./actions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./actions.js')>();
  return {
    ...real,
    notifyUsers: async (ids: string[], type: string, payload: Record<string, unknown>) => void sent.push({ ids, type, payload }),
    joinMatch: async (_db: unknown, userId: string, matchId: string) => {
      if (joinFails) throw new real.ActionError(409, joinFails);
      joins.push({ userId, matchId });
      return { state: 'joined' };
    },
  };
});

const inv = await import('./invites.js');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1);
const P1 = id(2);
const P2 = id(3);
const NEWBIE = id(4);
const STRANGER = id(5);
const GAME = id(20);
const PRIVATE_GAME = id(21);
const OLD_GAME = id(22);
const CIRCLE = id(30);
const TEAM = id(31);
const SPORT = id(40);
const NOW = new Date('2026-12-01T08:00:00Z');

let t: Record<string, Map<string, Row>>;

function client() {
  const keys: Record<string, (r: Row) => string> = {
    invite_links: (r) => String(r['code']),
    invite_link_uses: (r) => `${String(r['code'])}:${String(r['user_id'])}`,
    match_invites_sent: (r) => `${String(r['match_id'])}:${String(r['sender_id'])}:${String(r['audience'])}`,
    match_participants: (r) => `${String(r['match_id'])}:${String(r['user_id'])}`,
    circle_members: (r) => `${String(r['circle_id'])}:${String(r['user_id'])}`,
    team_members: (r) => `${String(r['team_id'])}:${String(r['user_id'])}`,
  };
  return {
    from: (name: string) => {
      if (!t[name]) t[name] = new Map();
      return new FakeQuery(t[name]!, keys[name] ?? ((r) => String(r['id'])));
    },
  } as never;
}

function put(table: string, row: Row, key?: string) {
  if (!t[table]) t[table] = new Map();
  t[table]!.set(key ?? String(row['id']), row);
}

const game = (over: Row = {}): Row => ({
  id: GAME, organiser_id: ORG, sport_id: SPORT, title: 'Friday 5-a-side', starts_at: '2026-12-05T16:00:00Z',
  area: 'Kabulonga', venue_name: 'Arena', format: '5v5', level: 'recreational', capacity: 10, status: 'open', kind: 'players',
  visibility: 'public', ...over,
});

beforeEach(() => {
  t = {};
  sent.length = 0;
  joins.length = 0;
  joinFails = null;
  for (const [uid, name] of [[ORG, 'Mwila Banda'], [P1, 'Chanda Phiri'], [P2, 'Bwalya Zulu'], [NEWBIE, 'Natasha Mulenga'], [STRANGER, 'Sam Tembo']] as const) {
    put('profiles', { id: uid, name, photo_url: null, invited_by: null });
  }
  put('sports', { id: SPORT, name: 'football' });
  put('matches', game());
  put('matches', game({ id: PRIVATE_GAME, title: 'Private kickabout', visibility: 'private' }));
  put('matches', game({ id: OLD_GAME, title: 'Last week', starts_at: '2026-11-20T16:00:00Z', status: 'finished' }));
  put('match_participants', { match_id: GAME, user_id: ORG, status: 'joined' }, `${GAME}:${ORG}`);
  put('match_participants', { match_id: GAME, user_id: P1, status: 'joined' }, `${GAME}:${P1}`);
  put('circles', { id: CIRCLE, name: 'Sunday Ballers' });
  for (const uid of [ORG, P1, P2, NEWBIE]) put('circle_members', { circle_id: CIRCLE, user_id: uid, removed_at: null }, `${CIRCLE}:${uid}`);
  put('teams', { id: TEAM, name: 'Kabulonga FC' });
  for (const uid of [ORG, P2]) put('team_members', { team_id: TEAM, user_id: uid, role: 'player' }, `${TEAM}:${uid}`);
});

describe('shareLink', () => {
  it('gives one personal link and reuses it', async () => {
    const a = await inv.shareLink(client(), P1, {}, { now: NOW });
    const b = await inv.shareLink(client(), P1, {}, { now: NOW });
    expect(a.code).toBe(b.code);
    expect(a.url).toMatch(/\/i\/CHB-[0-9A-F]{8}$/);
    expect(a.matchId).toBeNull();
    expect(a.text).toContain(a.url);
  });

  it('gives a game link that expires two hours after kick-off, separate from the personal one', async () => {
    const personal = await inv.shareLink(client(), ORG, {}, { now: NOW });
    const g = await inv.shareLink(client(), ORG, { matchId: GAME }, { now: NOW });
    expect(g.code).not.toBe(personal.code);
    expect(g.text).toContain('Friday 5-a-side');
    expect(t['invite_links']!.get(g.code)!['expires_at']).toBe('2026-12-05T18:00:00.000Z');
  });

  it('refuses finished games and private games shared by outsiders', async () => {
    await expect(inv.shareLink(client(), ORG, { matchId: OLD_GAME }, { now: NOW })).rejects.toMatchObject({ status: 409 });
    await expect(inv.shareLink(client(), STRANGER, { matchId: PRIVATE_GAME }, { now: NOW })).rejects.toMatchObject({ status: 403 });
    await expect(inv.shareLink(client(), ORG, { matchId: PRIVATE_GAME }, { now: NOW })).resolves.toMatchObject({ matchId: PRIVATE_GAME });
  });
});

describe('invitePreview', () => {
  it('shows the game and only the inviter first name', async () => {
    const { code } = await inv.shareLink(client(), ORG, { matchId: GAME }, { now: NOW });
    const p = await inv.invitePreview(client(), code, { now: NOW });
    expect(p).toMatchObject({ valid: true, kind: 'match', inviter: { firstName: 'Mwila' } });
    expect(p.game).toMatchObject({ id: GAME, title: 'Friday 5-a-side', sport: 'football', joined: 2, capacity: 10 });
    expect(JSON.stringify(p)).not.toContain('Banda');
  });

  it('says why a link cannot be used', async () => {
    expect(await inv.invitePreview(client(), 'CHB-NOPE0000', { now: NOW })).toMatchObject({ valid: false, reason: 'not_found' });
    const { code } = await inv.shareLink(client(), ORG, { matchId: GAME }, { now: NOW });
    const later = new Date('2026-12-06T00:00:00Z');
    expect(await inv.invitePreview(client(), code, { now: later })).toMatchObject({ valid: false, reason: 'expired' });
  });
});

describe('claimInvite', () => {
  it('joins the game, counts the use once and records who invited them', async () => {
    const { code } = await inv.shareLink(client(), P1, { matchId: GAME }, { now: NOW });
    const out = await inv.claimInvite(client(), NEWBIE, { code }, { now: NOW });
    expect(out).toMatchObject({ state: 'claimed', matchId: GAME, joined: 'joined', joinError: null });
    expect(joins).toEqual([{ userId: NEWBIE, matchId: GAME }]);
    await inv.claimInvite(client(), NEWBIE, { code }, { now: NOW });
    expect(t['invite_links']!.get(code)!['use_count']).toBe(1);
    expect(t['profiles']!.get(NEWBIE)!['invited_by']).toBe(P1);
  });

  it('keeps the first inviter when a second link is used', async () => {
    const first = await inv.shareLink(client(), P1, {}, { now: NOW });
    const second = await inv.shareLink(client(), P2, {}, { now: NOW });
    await inv.claimInvite(client(), NEWBIE, { code: first.code }, { now: NOW });
    await inv.claimInvite(client(), NEWBIE, { code: second.code }, { now: NOW });
    expect(t['profiles']!.get(NEWBIE)!['invited_by']).toBe(P1);
    // The personal-link owner hears about their first recruit only.
    expect(sent.filter((s) => s.type === 'invite_joined')).toEqual([{ ids: [P1], type: 'invite_joined', payload: { name: 'Natasha' } }]);
  });

  it('a full game still claims the link and says why they were not added', async () => {
    const { code } = await inv.shareLink(client(), ORG, { matchId: GAME }, { now: NOW });
    joinFails = 'This match is full.';
    const out = await inv.claimInvite(client(), NEWBIE, { code }, { now: NOW });
    expect(out).toMatchObject({ joined: null, joinError: 'This match is full.' });
    expect(t['profiles']!.get(NEWBIE)!['invited_by']).toBe(ORG);
  });

  it('a long-time player opening a link is not counted as brought in', async () => {
    t['profiles']!.set(STRANGER, { ...t['profiles']!.get(STRANGER)!, created_at: '2026-01-01T00:00:00Z' });
    const { code } = await inv.shareLink(client(), P1, {}, { now: NOW });
    await inv.claimInvite(client(), STRANGER, { code }, { now: NOW });
    expect(t['profiles']!.get(STRANGER)!['invited_by']).toBeNull();
    expect(sent.filter((s) => s.type === 'invite_joined')).toEqual([]);
  });

  it('your own link records nothing', async () => {
    const { code } = await inv.shareLink(client(), P1, {}, { now: NOW });
    await inv.claimInvite(client(), P1, { code }, { now: NOW });
    expect(t['invite_links']!.get(code)!['use_count'] ?? 0).toBe(0);
    expect(t['profiles']!.get(P1)!['invited_by']).toBeNull();
  });

  it('single-use team links are marked used and refuse a second player', async () => {
    put('invite_links', { code: 'CHB-TEAM0001', created_by: ORG, team_id: TEAM, match_id: null, multi_use: false, use_count: 0, expires_at: null, revoked_at: null, claimed_by: null }, 'CHB-TEAM0001');
    const out = await inv.claimInvite(client(), NEWBIE, { code: 'CHB-TEAM0001' }, { now: NOW });
    expect(out).toMatchObject({ teamId: TEAM });
    expect(t['invite_links']!.get('CHB-TEAM0001')!['claimed_by']).toBe(NEWBIE);
    expect(t['team_members']!.has(`${TEAM}:${NEWBIE}`)).toBe(true);
    await expect(inv.claimInvite(client(), STRANGER, { code: 'CHB-TEAM0001' }, { now: NOW })).rejects.toMatchObject({ status: 409 });
    // The same player opening it again is fine.
    await expect(inv.claimInvite(client(), NEWBIE, { code: 'CHB-TEAM0001' }, { now: NOW })).resolves.toMatchObject({ teamId: TEAM });
  });
});

describe('inviteToMatch', () => {
  it('only players in the game can invite', async () => {
    await expect(inv.inviteToMatch(client(), P2, { matchId: GAME, circleId: CIRCLE }, { now: NOW })).rejects.toMatchObject({ status: 403 });
  });

  it('tells the circle (minus people already playing) once, with a link', async () => {
    const out = await inv.inviteToMatch(client(), P1, { matchId: GAME, circleId: CIRCLE }, { now: NOW });
    expect(out).toMatchObject({ state: 'sent', audience: 'Sunday Ballers', recipients: 2 });
    expect(out.url).toMatch(/\/i\/CHB-/);
    const note = sent.find((s) => s.type === 'game_invite')!;
    expect(note.ids.sort()).toEqual([P2, NEWBIE].sort());
    expect(note.payload).toMatchObject({ matchId: GAME, from: 'Chanda', via: 'Sunday Ballers' });
    await expect(inv.inviteToMatch(client(), P1, { matchId: GAME, circleId: CIRCLE }, { now: NOW })).rejects.toMatchObject({ status: 409 });
  });

  it('can tell a team the player is in, but not one they are not', async () => {
    const out = await inv.inviteToMatch(client(), ORG, { matchId: GAME, teamId: TEAM }, { now: NOW });
    expect(out).toMatchObject({ audience: 'Kabulonga FC', recipients: 1 });
    await expect(inv.inviteToMatch(client(), P1, { matchId: GAME, teamId: TEAM }, { now: NOW })).rejects.toMatchObject({ status: 403 });
  });

  it('needs exactly one circle or team', async () => {
    await expect(inv.inviteToMatch(client(), P1, { matchId: GAME }, { now: NOW })).rejects.toThrow();
    await expect(inv.inviteToMatch(client(), P1, { matchId: GAME, circleId: CIRCLE, teamId: TEAM }, { now: NOW })).rejects.toThrow();
  });
});
