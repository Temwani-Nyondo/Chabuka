import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery } from './testing.js';
import type { Row } from './testing.js';

const sent: { ids: string[]; type: string; payload: Record<string, unknown> }[] = [];
vi.mock('./actions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./actions.js')>();
  return {
    ...real,
    notifyUsers: async (ids: string[], type: string, payload: Record<string, unknown>) => {
      sent.push({ ids, type, payload });
    },
  };
});

const s = await import('./social.js');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1);
const ADMIN = id(2);
const MEMBER = id(3);
const MUTED = id(4);
const STRANGER = id(5);
const PLATFORM = id(6);
const CIRCLE = id(10);
const TEAM = id(20);
const NOW = new Date('2026-11-20T10:00:00Z');

function world() {
  const tables = [
    'circles', 'circle_members', 'circle_admins', 'circle_posts', 'circle_poll_votes', 'post_reactions', 'creator_profiles', 'creator_posts',
    'user_follows', 'follows', 'profiles', 'blocks', 'team_members', 'match_participants', 'race_entries', 'user_sports', 'sports', 'teams',
    'matches', 'race_results', 'race_distances', 'competitions', 'announcements', 'fixtures', 'platform_admins', 'player_stats',
  ];
  const t: Record<string, Map<string, Row>> = Object.fromEntries(tables.map((n) => [n, new Map<string, Row>()]));
  const keys: Record<string, (r: Row) => string> = {
    circle_members: (r) => `${String(r['circle_id'])}:${String(r['user_id'])}`,
    circle_admins: (r) => `${String(r['circle_id'])}:${String(r['user_id'])}`,
    circle_poll_votes: (r) => `${String(r['post_id'])}:${String(r['user_id'])}`,
    post_reactions: (r) => `${String(r['post_type'])}:${String(r['post_id'])}:${String(r['user_id'])}:${String(r['reaction'])}`,
    creator_profiles: (r) => String(r['user_id']),
    user_follows: (r) => `${String(r['user_id'])}:${String(r['subject_type'])}:${String(r['subject_id'])}`,
    team_members: (r) => `${String(r['team_id'])}:${String(r['user_id'])}`,
    blocks: (r) => `${String(r['blocker_id'])}:${String(r['blocked_user_id'])}`,
    platform_admins: (r) => String(r['user_id']),
  };
  const client = {
    from(table: string) {
      const map = t[table];
      if (!map) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(map, keys[table] ?? ((r) => String(r['id'])));
    },
  } as never;
  t.circles!.set(CIRCLE, { id: CIRCLE, name: 'Lusaka Runners', created_by: OWNER, sport_id: null, area: 'Lusaka', age_bands: [], genders: [], levels: [] });
  t.circle_admins!.set(`${CIRCLE}:${OWNER}`, { circle_id: CIRCLE, user_id: OWNER, role: 'owner' });
  t.circle_admins!.set(`${CIRCLE}:${ADMIN}`, { circle_id: CIRCLE, user_id: ADMIN, role: 'admin' });
  for (const [u, notify] of [[OWNER, 'all'], [ADMIN, 'all'], [MEMBER, 'all'], [MUTED, 'none']] as const) {
    t.circle_members!.set(`${CIRCLE}:${u}`, { circle_id: CIRCLE, user_id: u, notify, last_read_at: null, removed_at: null, created_at: '2026-11-01T00:00:00Z' });
  }
  for (const [u, name] of [[OWNER, 'Owner'], [ADMIN, 'Admin'], [MEMBER, 'Member'], [MUTED, 'Muted'], [STRANGER, 'Stranger']] as const) {
    t.profiles!.set(u, { id: u, name, photo_url: null, visibility: 'connections' });
  }
  t.platform_admins!.set(PLATFORM, { user_id: PLATFORM });
  return { t, client };
}

beforeEach(() => {
  sent.length = 0;
});

describe('circles as channels', () => {
  it('only admins post; members are told by their notification level', async () => {
    const w = world();
    await expect(s.postToCircle(w.client, MEMBER, { circleId: CIRCLE, body: 'Hello' })).rejects.toThrow(/admins/);
    await s.postToCircle(w.client, ADMIN, { circleId: CIRCLE, body: 'Saturday long run, 6am' });
    expect(sent.at(-1)!.ids.sort()).toEqual([OWNER, MEMBER].sort());
    w.t.circle_members!.get(`${CIRCLE}:${MEMBER}`)!['notify'] = 'important';
    await s.postToCircle(w.client, ADMIN, { circleId: CIRCLE, body: 'Kit colours' });
    expect(sent.at(-1)!.ids).toEqual([OWNER]);
    await s.postToCircle(w.client, OWNER, { circleId: CIRCLE, body: 'Race cancelled', important: true });
    expect(sent.at(-1)!.ids.sort()).toEqual([ADMIN, MEMBER].sort());
  });

  it('reactions toggle; polls take one vote from members and close on time', async () => {
    const w = world();
    const { postId } = await s.postToCircle(w.client, ADMIN, { circleId: CIRCLE, poll: { options: ['5K', '10K'], closesAt: '2026-11-21T00:00:00Z' } });
    const on = await s.react(w.client, MEMBER, { postType: 'circle', postId, reaction: 'fire' });
    expect(on).toMatchObject({ state: 'added', counts: { fire: 1 }, mine: ['fire'] });
    const off = await s.react(w.client, MEMBER, { postType: 'circle', postId, reaction: 'fire' });
    expect(off).toMatchObject({ state: 'removed', counts: { fire: 0 } });
    await expect(s.react(w.client, STRANGER, { postType: 'circle', postId, reaction: 'like' })).rejects.toThrow(/Join/);
    await s.votePoll(w.client, MEMBER, { postId, option: 1 }, { now: NOW });
    await expect(s.votePoll(w.client, MEMBER, { postId, option: 0 }, { now: NOW })).rejects.toThrow(/already voted/);
    await expect(s.votePoll(w.client, OWNER, { postId, option: 0 }, { now: new Date('2026-11-22T00:00:00Z') })).rejects.toThrow(/closed/);
    const page = await s.getCirclePosts(w.client, MEMBER, CIRCLE);
    expect(page.posts[0]!.poll).toMatchObject({ tally: [0, 1], myVote: 1 });
  });

  it('counts unread posts and clears them when read', async () => {
    const w = world();
    await s.postToCircle(w.client, ADMIN, { circleId: CIRCLE, body: 'One' });
    await new Promise((r) => setTimeout(r, 5));
    await s.postToCircle(w.client, ADMIN, { circleId: CIRCLE, body: 'Two' });
    expect((await s.listCircles(w.client, MEMBER)).yours[0]).toMatchObject({ unread: 2, last: { body: 'Two' } });
    expect((await s.listCircles(w.client, ADMIN)).yours[0]!.unread).toBe(0);
    await s.markCircleRead(w.client, MEMBER, { circleId: CIRCLE }, { now: new Date(Date.now() + 60_000) });
    expect((await s.listCircles(w.client, MEMBER)).yours[0]!.unread).toBe(0);
    expect((await s.listCircles(w.client, STRANGER)).discover).toHaveLength(1);
  });

  it('owner manages admins, removes members and hands over; removed members cannot react', async () => {
    const w = world();
    await expect(s.addCircleAdmin(w.client, ADMIN, { circleId: CIRCLE, userId: MEMBER })).rejects.toThrow(/owner/);
    await s.addCircleAdmin(w.client, OWNER, { circleId: CIRCLE, userId: MEMBER });
    expect(await s.circleRole(w.client, CIRCLE, MEMBER)).toBe('admin');
    await expect(s.removeCircleMember(w.client, ADMIN, { circleId: CIRCLE, userId: MEMBER })).rejects.toThrow(/Only the owner/);
    await s.removeCircleMember(w.client, ADMIN, { circleId: CIRCLE, userId: MUTED });
    const { postId } = await s.postToCircle(w.client, OWNER, { circleId: CIRCLE, body: 'Hi' });
    await expect(s.react(w.client, MUTED, { postType: 'circle', postId, reaction: 'like' })).rejects.toThrow(/Join/);
    await s.transferCircleOwnership(w.client, OWNER, { circleId: CIRCLE, userId: MEMBER });
    expect(await s.circleRole(w.client, CIRCLE, MEMBER)).toBe('owner');
    expect(await s.circleRole(w.client, CIRCLE, OWNER)).toBe('admin');
  });

  it('pins one post at a time; authors edit, admins delete', async () => {
    const w = world();
    const a = await s.postToCircle(w.client, ADMIN, { circleId: CIRCLE, body: 'A' });
    const b = await s.postToCircle(w.client, OWNER, { circleId: CIRCLE, body: 'B' });
    await s.pinCirclePost(w.client, OWNER, { postId: a.postId, pinned: true });
    await s.pinCirclePost(w.client, OWNER, { postId: b.postId, pinned: true });
    expect([...w.t.circle_posts!.values()].filter((p) => p['pinned']).map((p) => p['id'])).toEqual([b.postId]);
    await expect(s.editCirclePost(w.client, OWNER, { postId: a.postId, body: 'x' })).rejects.toThrow(/wrote it/);
    await s.deleteCirclePost(w.client, OWNER, { postId: a.postId });
    expect((await s.getCirclePosts(w.client, MEMBER, CIRCLE)).posts.map((p) => p.body)).toEqual(['B']);
  });

  it('automatic posts link to the game and notify members', async () => {
    const w = world();
    const game = id(30);
    await s.autoPost(w.client, CIRCLE, 'game', { type: 'match', id: game }, 'New game: Sunday 5-a-side', OWNER);
    const post = [...w.t.circle_posts!.values()][0]!;
    expect(post).toMatchObject({ kind: 'game', link_type: 'match', link_id: game, author_id: null });
    expect(sent.at(-1)!.ids).not.toContain(OWNER);
  });
});

describe('creators', () => {
  const app = { handle: 'coach_k', displayName: 'Coach K', pitch: 'I coach Lusaka juniors and write weekly training notes.' };
  it('apply, get approved by a platform admin, publish once to followers', async () => {
    const w = world();
    await s.applyCreator(w.client, MEMBER, app);
    expect(sent.at(-1)).toMatchObject({ ids: [PLATFORM], type: 'creator_pending' });
    await expect(s.saveCreatorPost(w.client, MEMBER, { kind: 'post', body: 'Hi', publish: true })).rejects.toThrow(/approved/);
    await expect(s.reviewCreator(w.client, OWNER, { userId: MEMBER, decision: 'approve' })).rejects.toThrow(/Admins/);
    await s.reviewCreator(w.client, PLATFORM, { userId: MEMBER, decision: 'approve' });
    await s.follow(w.client, OWNER, { subjectType: 'creator', subjectId: MEMBER });
    const draft = await s.saveCreatorPost(w.client, MEMBER, { kind: 'article', title: 'Hill sessions', body: '## Why hills\nThey build strength.' });
    expect(sent.filter((x) => x.type === 'creator_post')).toHaveLength(0);
    expect((await s.getCreator(w.client, OWNER, 'coach_k')).posts).toHaveLength(0);
    await s.saveCreatorPost(w.client, MEMBER, { postId: draft.postId, kind: 'article', title: 'Hill sessions', body: '## Why hills\nThey build strength.', publish: true });
    await s.saveCreatorPost(w.client, MEMBER, { postId: draft.postId, kind: 'article', title: 'Hill sessions!', body: '## Why hills\nThey build strength.', publish: true });
    expect(sent.filter((x) => x.type === 'creator_post')).toHaveLength(1);
    const page = await s.getCreator(w.client, OWNER, 'COACH_K');
    expect(page).toMatchObject({ followers: 1, following: true });
    expect(page.posts[0]!.body).toBe('');
    expect((await s.getCreatorPost(w.client, OWNER, draft.postId)).post.body).toContain('Why hills');
  });

  it('handles are unique; suspended creators disappear', async () => {
    const w = world();
    await s.applyCreator(w.client, MEMBER, app);
    await expect(s.applyCreator(w.client, ADMIN, app)).rejects.toThrow(/taken/);
    await s.reviewCreator(w.client, PLATFORM, { userId: MEMBER, decision: 'approve' });
    await expect(s.reviewCreator(w.client, PLATFORM, { userId: MEMBER, decision: 'suspend' })).rejects.toThrow(/Say why/);
    await s.reviewCreator(w.client, PLATFORM, { userId: MEMBER, decision: 'suspend', note: 'Spam' });
    await expect(s.getCreator(w.client, OWNER, 'coach_k')).rejects.toThrow(/not found/);
  });
});

describe('following and privacy', () => {
  it('follows teams and shows their fixtures in the feed; unfollow clears it', async () => {
    const w = world();
    w.t.teams!.set(TEAM, { id: TEAM, name: 'Kabwata FC' });
    w.t.fixtures!.set('f1', { id: 'f1', competition_id: 'c1', home_team_id: TEAM, away_team_id: null, starts_at: new Date(Date.now() + 86_400_000).toISOString(), status: 'scheduled' });
    await s.follow(w.client, STRANGER, { subjectType: 'team', subjectId: TEAM });
    expect((await s.getFollowingFeed(w.client, STRANGER)).items[0]).toMatchObject({ type: 'team_fixture', home: 'Kabwata FC' });
    await s.unfollow(w.client, STRANGER, { subjectType: 'team', subjectId: TEAM });
    expect((await s.getFollowingFeed(w.client, STRANGER)).items).toHaveLength(0);
    await expect(s.follow(w.client, STRANGER, { subjectType: 'team', subjectId: id(99) })).rejects.toThrow(/Not found/);
  });

  it('competition followers come from both the old and new tables', async () => {
    const w = world();
    w.t.follows!.set('x', { user_id: OWNER, competition_id: id(50) });
    w.t.user_follows!.set('y', { user_id: MEMBER, subject_type: 'competition', subject_id: id(50) });
    expect((await s.competitionFollowers(w.client, id(50))).sort()).toEqual([OWNER, MEMBER].sort());
  });

  it('shows a player record to connections only, never when blocked', async () => {
    const w = world();
    w.t.team_members!.set(`${TEAM}:${OWNER}`, { team_id: TEAM, user_id: OWNER, role: 'captain' });
    w.t.team_members!.set(`${TEAM}:${ADMIN}`, { team_id: TEAM, user_id: ADMIN, role: 'player' });
    w.t.teams!.set(TEAM, { id: TEAM, name: 'Kabwata FC' });
    // ADMIN and STRANGER share nothing (STRANGER is not in the circle).
    const asTeammate = await s.getPlayer(w.client, ADMIN, OWNER);
    expect(asTeammate).toMatchObject({ relation: 'connection', visible: true });
    expect((asTeammate as { teams: unknown[] }).teams).toHaveLength(1);
    const asStranger = await s.getPlayer(w.client, STRANGER, OWNER);
    expect(asStranger).toMatchObject({ relation: 'other', visible: false, name: 'Owner' });
    expect('teams' in asStranger).toBe(false);
    await s.setVisibility(w.client, OWNER, { visibility: 'everyone' });
    expect((await s.getPlayer(w.client, STRANGER, OWNER)).visible).toBe(true);
    w.t.blocks!.set('b', { blocker_id: OWNER, blocked_user_id: STRANGER });
    expect((await s.getPlayer(w.client, STRANGER, OWNER)).visible).toBe(false);
    expect((await s.getPlayer(w.client, MEMBER, OWNER)).relation).toBe('connection'); // shared circle
  });
});
