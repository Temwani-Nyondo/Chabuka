import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REACTIONS,
  applyCreatorSchema,
  canSeeProfile,
  circleIdOnlySchema,
  circleMemberSchema,
  circleNotifySchema,
  circlePostIdSchema,
  circlePostSchema,
  creatorPostIdSchema,
  creatorPostSchema,
  editCirclePostSchema,
  excerpt,
  followSchema,
  notifiesFor,
  pinCirclePostSchema,
  publishToCircleSchema,
  reactSchema,
  reviewCreatorSchema,
  updateCreatorProfileSchema,
  profileVisibilitySchema,
  votePollSchema,
  type FollowSubject,
  type NotifyLevel,
  type ProfileVisibility,
  type Reaction,
  type Relation,
} from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';
import { requireAdmin } from './venues.js';
import { recordFor } from './records.js';

// Phase 5: circles as channels (admins post, members react, vote and mute), approved creators (posts and articles),
// one follow system, and player profiles shown by relationship. No comments, no direct messages.
// Everything runs on the service client after the checks here.

type Deps = { now?: Date };

interface CircleRow {
  id: string;
  name: string;
  created_by: string;
  sport_id: string | null;
  area: string | null;
  description: string | null;
  photo_url: string | null;
  cover_url: string | null;
  age_bands: string[];
  genders: string[];
  levels: string[];
}

interface MemberRow {
  circle_id: string;
  user_id: string;
  notify: NotifyLevel | null;
  last_read_at: string | null;
  removed_at: string | null;
  created_at: string;
}

interface PostRow {
  id: string;
  circle_id: string;
  author_id: string | null;
  kind: string;
  body: string;
  images: string[] | null;
  link_type: string | null;
  link_id: string | null;
  poll: { options: string[]; closesAt?: string | null } | null;
  important: boolean;
  pinned: boolean;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

async function loadCircle(svc: SupabaseClient, id: string): Promise<CircleRow> {
  const { data } = await svc.from('circles').select('*').eq('id', id).maybeSingle();
  if (!data) throw new ActionError(404, 'Circle not found.');
  return data as CircleRow;
}

export async function circleRole(svc: SupabaseClient, circleId: string, userId: string): Promise<'owner' | 'admin' | null> {
  const { data } = await svc.from('circle_admins').select('role').eq('circle_id', circleId).eq('user_id', userId).maybeSingle();
  return ((data as { role?: 'owner' | 'admin' } | null)?.role ?? null) as 'owner' | 'admin' | null;
}

async function requireCircleAdmin(svc: SupabaseClient, circleId: string, userId: string) {
  const role = await circleRole(svc, circleId, userId);
  if (!role) throw new ActionError(403, 'Only the circle admins can do that.');
  return role;
}

async function membership(svc: SupabaseClient, circleId: string, userId: string): Promise<MemberRow | null> {
  const { data } = await svc.from('circle_members').select('*').eq('circle_id', circleId).eq('user_id', userId).maybeSingle();
  const m = data as MemberRow | null;
  return m && !m.removed_at ? m : null;
}

async function activeMembers(svc: SupabaseClient, circleId: string): Promise<MemberRow[]> {
  const { data } = await svc.from('circle_members').select('*').eq('circle_id', circleId);
  return ((data ?? []) as MemberRow[]).filter((m) => !m.removed_at);
}

async function namesOf(svc: SupabaseClient, ids: string[]): Promise<Map<string, { name: string; photo: string | null }>> {
  const map = new Map<string, { name: string; photo: string | null }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await svc.from('profiles').select('id,name,photo_url').in('id', unique);
  for (const p of (data ?? []) as { id: string; name: string | null; photo_url: string | null }[]) map.set(p.id, { name: p.name ?? 'Player', photo: p.photo_url });
  return map;
}

async function notifyMembers(svc: SupabaseClient, circle: CircleRow, post: { id: string; body: string; important: boolean; kind: string }, exceptUserId: string | null) {
  const members = await activeMembers(svc, circle.id);
  const ids = members.filter((m) => m.user_id !== exceptUserId && notifiesFor(m.notify, post.important)).map((m) => m.user_id);
  await notifyUsers(ids, 'circle_post', {
    circleId: circle.id,
    postId: post.id,
    title: circle.name,
    excerpt: excerpt(post.body, 90),
    important: post.important,
    kind: post.kind,
  });
}

// --- Circle posts -----------------------------------------------------------------------------

export async function postToCircle(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = circlePostSchema.parse(raw);
  const circle = await loadCircle(svc, input.circleId);
  await requireCircleAdmin(svc, circle.id, userId);
  const kind = input.poll ? 'poll' : input.images.length && !input.body ? 'photo' : 'update';
  const { data, error } = await svc
    .from('circle_posts')
    .insert({
      circle_id: circle.id,
      author_id: userId,
      kind,
      body: input.body,
      images: input.images,
      poll: input.poll ? { options: input.poll.options, closesAt: input.poll.closesAt ?? null } : null,
      important: input.important,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not post.');
  const id = (data as { id: string }).id;
  await notifyMembers(svc, circle, { id, body: input.poll && !input.body ? `Poll: ${input.poll.options.join(' / ')}` : input.body, important: input.important, kind }, userId);
  return { state: 'posted', postId: id };
}

/** A post the app makes itself: a game in the circle, its result, an event published to it. */
export async function autoPost(
  svc: SupabaseClient,
  circleId: string,
  kind: 'game' | 'result' | 'event',
  link: { type: 'match' | 'competition' | 'race'; id: string },
  body: string,
  exceptUserId: string | null = null,
) {
  try {
    const circle = await loadCircle(svc, circleId);
    const { data } = await svc
      .from('circle_posts')
      .insert({ circle_id: circleId, author_id: null, kind, body, images: [], link_type: link.type, link_id: link.id, important: false, created_at: new Date().toISOString() })
      .select('id')
      .single();
    const id = (data as { id: string } | null)?.id;
    if (id) await notifyMembers(svc, circle, { id, body, important: false, kind }, exceptUserId);
  } catch {
    // An automatic post never blocks the action that triggered it.
  }
}

async function loadPost(svc: SupabaseClient, postId: string): Promise<PostRow> {
  const { data } = await svc.from('circle_posts').select('*').eq('id', postId).maybeSingle();
  const post = data as PostRow | null;
  if (!post || post.deleted_at) throw new ActionError(404, 'Post not found.');
  return post;
}

export async function editCirclePost(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = editCirclePostSchema.parse(raw);
  const post = await loadPost(svc, input.postId);
  if (post.author_id !== userId) throw new ActionError(403, 'Only the person who wrote it can edit it.');
  await svc.from('circle_posts').update({ body: input.body, edited_at: new Date().toISOString() }).eq('id', post.id);
  return { state: 'edited' };
}

export async function deleteCirclePost(svc: SupabaseClient, userId: string, raw: unknown) {
  const { postId } = circlePostIdSchema.parse(raw);
  const post = await loadPost(svc, postId);
  if (post.author_id !== userId && !(await circleRole(svc, post.circle_id, userId))) throw new ActionError(403, 'Only the author or a circle admin can delete it.');
  await svc.from('circle_posts').update({ deleted_at: new Date().toISOString(), pinned: false }).eq('id', post.id);
  return { state: 'deleted' };
}

export async function pinCirclePost(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = pinCirclePostSchema.parse(raw);
  const post = await loadPost(svc, input.postId);
  await requireCircleAdmin(svc, post.circle_id, userId);
  if (input.pinned) await svc.from('circle_posts').update({ pinned: false }).eq('circle_id', post.circle_id).eq('pinned', true);
  await svc.from('circle_posts').update({ pinned: input.pinned }).eq('id', post.id);
  return { state: input.pinned ? 'pinned' : 'unpinned' };
}

async function reactionSummary(svc: SupabaseClient, postType: 'circle' | 'creator', postIds: string[], userId: string) {
  const counts = new Map<string, Record<Reaction, number>>();
  const mine = new Map<string, Reaction[]>();
  if (!postIds.length) return { counts, mine };
  const { data } = await svc.from('post_reactions').select('post_id,user_id,reaction').eq('post_type', postType).in('post_id', postIds);
  for (const r of (data ?? []) as { post_id: string; user_id: string; reaction: Reaction }[]) {
    const c = counts.get(r.post_id) ?? { like: 0, fire: 0, clap: 0, strong: 0 };
    c[r.reaction] += 1;
    counts.set(r.post_id, c);
    if (r.user_id === userId) mine.set(r.post_id, [...(mine.get(r.post_id) ?? []), r.reaction]);
  }
  return { counts, mine };
}

/** Toggle a reaction. Circle posts: members of the circle; creator posts: anyone who can see the post. */
export async function react(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = reactSchema.parse(raw);
  if (input.postType === 'circle') {
    const post = await loadPost(svc, input.postId);
    if (!(await membership(svc, post.circle_id, userId)) && !(await circleRole(svc, post.circle_id, userId))) {
      throw new ActionError(403, 'Join the circle to react.');
    }
  } else {
    const { data } = await svc.from('creator_posts').select('status,deleted_at').eq('id', input.postId).maybeSingle();
    const p = data as { status: string; deleted_at: string | null } | null;
    if (!p || p.status !== 'published' || p.deleted_at) throw new ActionError(404, 'Post not found.');
  }
  const { data: existing } = await svc
    .from('post_reactions')
    .select('reaction')
    .eq('post_type', input.postType)
    .eq('post_id', input.postId)
    .eq('user_id', userId)
    .eq('reaction', input.reaction)
    .maybeSingle();
  if (existing) {
    await svc.from('post_reactions').delete().eq('post_type', input.postType).eq('post_id', input.postId).eq('user_id', userId).eq('reaction', input.reaction);
  } else {
    await svc.from('post_reactions').insert({ post_type: input.postType, post_id: input.postId, user_id: userId, reaction: input.reaction });
  }
  const { counts, mine } = await reactionSummary(svc, input.postType, [input.postId], userId);
  return { state: existing ? 'removed' : 'added', counts: counts.get(input.postId) ?? { like: 0, fire: 0, clap: 0, strong: 0 }, mine: mine.get(input.postId) ?? [] };
}

export async function votePoll(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = votePollSchema.parse(raw);
  const post = await loadPost(svc, input.postId);
  if (post.kind !== 'poll' || !post.poll) throw new ActionError(400, 'That post is not a poll.');
  if (!(await membership(svc, post.circle_id, userId))) throw new ActionError(403, 'Join the circle to vote.');
  if (post.poll.closesAt && new Date(post.poll.closesAt) < (deps.now ?? new Date())) throw new ActionError(409, 'This poll has closed.');
  if (input.option >= post.poll.options.length) throw new ActionError(400, 'Pick one of the options.');
  const { data: existing } = await svc.from('circle_poll_votes').select('option').eq('post_id', post.id).eq('user_id', userId).maybeSingle();
  if (existing) throw new ActionError(409, 'You have already voted.');
  await svc.from('circle_poll_votes').insert({ post_id: post.id, user_id: userId, option: input.option });
  return { state: 'voted' };
}

export async function setCircleNotify(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = circleNotifySchema.parse(raw);
  if (!(await membership(svc, input.circleId, userId))) throw new ActionError(403, 'Join the circle first.');
  await svc.from('circle_members').update({ notify: input.notify }).eq('circle_id', input.circleId).eq('user_id', userId);
  return { state: 'saved', notify: input.notify };
}

export async function markCircleRead(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = circleIdOnlySchema.parse(raw);
  if (!(await membership(svc, input.circleId, userId))) return { state: 'not_member' };
  await svc.from('circle_members').update({ last_read_at: (deps.now ?? new Date()).toISOString() }).eq('circle_id', input.circleId).eq('user_id', userId);
  return { state: 'read' };
}

// --- Circle admin -----------------------------------------------------------------------------

export async function addCircleAdmin(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = circleMemberSchema.parse(raw);
  const circle = await loadCircle(svc, input.circleId);
  if ((await circleRole(svc, circle.id, userId)) !== 'owner') throw new ActionError(403, 'Only the circle owner can add admins.');
  if (!(await membership(svc, circle.id, input.userId))) throw new ActionError(409, 'They need to be a member first.');
  if (await circleRole(svc, circle.id, input.userId)) return { state: 'already_admin' };
  await svc.from('circle_admins').insert({ circle_id: circle.id, user_id: input.userId, role: 'admin' });
  await notifyUsers([input.userId], 'circle_admin_added', { circleId: circle.id, title: circle.name });
  return { state: 'added' };
}

export async function removeCircleAdmin(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = circleMemberSchema.parse(raw);
  if ((await circleRole(svc, input.circleId, userId)) !== 'owner') throw new ActionError(403, 'Only the circle owner can remove admins.');
  if ((await circleRole(svc, input.circleId, input.userId)) === 'owner') throw new ActionError(409, 'Hand over ownership first.');
  await svc.from('circle_admins').delete().eq('circle_id', input.circleId).eq('user_id', input.userId);
  return { state: 'removed' };
}

export async function removeCircleMember(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = circleMemberSchema.parse(raw);
  const mine = await requireCircleAdmin(svc, input.circleId, userId);
  const theirs = await circleRole(svc, input.circleId, input.userId);
  if (theirs === 'owner') throw new ActionError(409, 'The owner cannot be removed.');
  if (theirs === 'admin' && mine !== 'owner') throw new ActionError(403, 'Only the owner can remove an admin.');
  await svc.from('circle_admins').delete().eq('circle_id', input.circleId).eq('user_id', input.userId);
  await svc.from('circle_members').update({ removed_at: new Date().toISOString(), removed_by: userId }).eq('circle_id', input.circleId).eq('user_id', input.userId);
  return { state: 'removed' };
}

export async function transferCircleOwnership(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = circleMemberSchema.parse(raw);
  if ((await circleRole(svc, input.circleId, userId)) !== 'owner') throw new ActionError(403, 'Only the owner can hand over the circle.');
  if (!(await membership(svc, input.circleId, input.userId))) throw new ActionError(409, 'The new owner must be a member.');
  await svc.from('circle_admins').upsert({ circle_id: input.circleId, user_id: input.userId, role: 'owner' });
  await svc.from('circle_admins').update({ role: 'admin' }).eq('circle_id', input.circleId).eq('user_id', userId);
  await svc.from('circles').update({ created_by: input.userId }).eq('id', input.circleId);
  return { state: 'transferred' };
}

/** Publish a league, cup or race to a circle (organiser who is also a circle admin). */
export async function publishToCircle(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = publishToCircleSchema.parse(raw);
  const { data } = await svc.from('competitions').select('id,name,kind,organiser_id,circle_id').eq('id', input.competitionId).maybeSingle();
  const c = data as { id: string; name: string; kind: string; organiser_id: string; circle_id: string | null } | null;
  if (!c) throw new ActionError(404, 'Event not found.');
  if (c.organiser_id !== userId) throw new ActionError(403, 'Only the organiser can do that.');
  if (input.circleId) await requireCircleAdmin(svc, input.circleId, userId);
  await svc.from('competitions').update({ circle_id: input.circleId }).eq('id', c.id);
  if (input.circleId && input.circleId !== c.circle_id) {
    await autoPost(svc, input.circleId, 'event', { type: c.kind === 'race' ? 'race' : 'competition', id: c.id }, `${c.name}: entries are open.`, userId);
  }
  return { state: input.circleId ? 'published' : 'removed' };
}

/** Called by results publishing: tells the event's circle, if it has one. */
export async function eventNewsToCircle(svc: SupabaseClient, competitionId: string, body: string) {
  const { data } = await svc.from('competitions').select('id,kind,circle_id').eq('id', competitionId).maybeSingle();
  const c = data as { id: string; kind: string; circle_id: string | null } | null;
  if (c?.circle_id) await autoPost(svc, c.circle_id, 'event', { type: c.kind === 'race' ? 'race' : 'competition', id: c.id }, body);
}

// --- Circle reads -----------------------------------------------------------------------------

export async function listCircles(svc: SupabaseClient, userId: string) {
  const { data: circles } = await svc.from('circles').select('*').order('created_at', { ascending: false }).limit(200);
  const list = (circles ?? []) as CircleRow[];
  const ids = list.map((c) => c.id);
  const { data: members } = ids.length ? await svc.from('circle_members').select('*').in('circle_id', ids) : { data: [] };
  const { data: posts } = ids.length ? await svc.from('circle_posts').select('id,circle_id,author_id,kind,body,created_at,deleted_at').in('circle_id', ids).order('created_at', { ascending: false }) : { data: [] };
  const allMembers = ((members ?? []) as MemberRow[]).filter((m) => !m.removed_at);
  const livePosts = ((posts ?? []) as PostRow[]).filter((p) => !p.deleted_at);
  const removedFrom = new Set(((members ?? []) as MemberRow[]).filter((m) => m.removed_at && m.user_id === userId).map((m) => m.circle_id));
  const { data: adminRows } = await svc.from('circle_admins').select('circle_id,role').eq('user_id', userId);
  const myRole = new Map(((adminRows ?? []) as { circle_id: string; role: 'owner' | 'admin' }[]).map((a) => [a.circle_id, a.role]));
  const out = list.map((c) => {
    const mine = allMembers.find((m) => m.circle_id === c.id && m.user_id === userId) ?? null;
    const cp = livePosts.filter((p) => p.circle_id === c.id);
    const last = cp[0] ?? null;
    const unread = mine ? cp.filter((p) => p.author_id !== userId && (!mine.last_read_at || p.created_at > mine.last_read_at)).length : 0;
    return {
      circle: c,
      memberCount: allMembers.filter((m) => m.circle_id === c.id).length,
      isMember: !!mine,
      role: myRole.get(c.id) ?? null,
      removed: removedFrom.has(c.id),
      notify: mine?.notify ?? null,
      unread,
      last: last ? { body: last.kind === 'poll' ? 'Poll' : excerpt(last.body, 80) || (last.kind === 'photo' ? 'Photo' : ''), at: last.created_at, kind: last.kind } : null,
    };
  });
  const yours = out.filter((c) => c.isMember).sort((a, b) => (b.last?.at ?? b.circle.id).localeCompare(a.last?.at ?? a.circle.id));
  return { yours, discover: out.filter((c) => !c.isMember && !c.removed) };
}

export async function getCircle(svc: SupabaseClient, userId: string, circleId: string) {
  const circle = await loadCircle(svc, circleId);
  const [role, mine, members, adminsRes, gamesRes, eventsRes] = await Promise.all([
    circleRole(svc, circle.id, userId),
    membership(svc, circle.id, userId),
    activeMembers(svc, circle.id),
    svc.from('circle_admins').select('user_id,role').eq('circle_id', circle.id),
    svc.from('matches').select('id,title,starts_at,status,venue_name,area').eq('circle_id', circle.id).gt('starts_at', new Date().toISOString()).order('starts_at').limit(10),
    svc.from('competitions').select('id,name,kind,starts_on,status,banner_url').eq('circle_id', circle.id).limit(10),
  ]);
  const admins = (adminsRes.data ?? []) as { user_id: string; role: string }[];
  const canSeeMembers = !!role;
  const names = await namesOf(svc, [...admins.map((a) => a.user_id), ...(canSeeMembers ? members.map((m) => m.user_id) : [])]);
  const { data: pinned } = await svc.from('circle_posts').select('*').eq('circle_id', circle.id).eq('pinned', true).maybeSingle();
  const { data: removed } = await svc.from('circle_members').select('removed_at').eq('circle_id', circle.id).eq('user_id', userId).maybeSingle();
  return {
    circle,
    role,
    isMember: !!mine,
    removed: !!(removed as { removed_at: string | null } | null)?.removed_at,
    notify: mine?.notify ?? 'all',
    memberCount: members.length,
    admins: admins.map((a) => ({ userId: a.user_id, role: a.role, name: names.get(a.user_id)?.name ?? 'Admin', photo: names.get(a.user_id)?.photo ?? null })),
    // Only admins see the member list (to manage it); members see the count.
    members: canSeeMembers ? members.map((m) => ({ userId: m.user_id, name: names.get(m.user_id)?.name ?? 'Member', photo: names.get(m.user_id)?.photo ?? null, since: m.created_at })) : [],
    pinnedPostId: (pinned as PostRow | null)?.deleted_at ? null : ((pinned as PostRow | null)?.id ?? null),
    games: gamesRes.data ?? [],
    events: eventsRes.data ?? [],
  };
}

export async function getCirclePosts(svc: SupabaseClient, userId: string, circleId: string, before?: string) {
  await loadCircle(svc, circleId);
  let q = svc.from('circle_posts').select('*').eq('circle_id', circleId);
  if (before) q = q.lt('created_at', before);
  const { data } = await q.order('created_at', { ascending: false }).limit(31);
  const rows = ((data ?? []) as PostRow[]).filter((p) => !p.deleted_at);
  const page = rows.slice(0, 30);
  const ids = page.map((p) => p.id);
  const [{ counts, mine }, names, votesRes] = await Promise.all([
    reactionSummary(svc, 'circle', ids, userId),
    namesOf(svc, page.map((p) => p.author_id ?? '')),
    ids.length ? svc.from('circle_poll_votes').select('post_id,user_id,option').in('post_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const votes = (votesRes.data ?? []) as { post_id: string; user_id: string; option: number }[];
  const matchIds = page.filter((p) => p.link_type === 'match' && p.link_id).map((p) => p.link_id!);
  const compIds = page.filter((p) => (p.link_type === 'competition' || p.link_type === 'race') && p.link_id).map((p) => p.link_id!);
  const { data: matches } = matchIds.length ? await svc.from('matches').select('id,title,starts_at,status,home_score,away_score,venue_name').in('id', matchIds) : { data: [] };
  const { data: comps } = compIds.length ? await svc.from('competitions').select('id,name,kind,starts_on,status,banner_url').in('id', compIds) : { data: [] };
  const mMap = new Map(((matches ?? []) as { id: string }[]).map((m) => [m.id, m]));
  const cMap = new Map(((comps ?? []) as { id: string }[]).map((c) => [c.id, c]));
  return {
    posts: page.map((p) => {
      const pv = votes.filter((v) => v.post_id === p.id);
      return {
        id: p.id,
        kind: p.kind,
        body: p.body,
        images: p.images ?? [],
        important: p.important,
        pinned: p.pinned,
        createdAt: p.created_at,
        editedAt: p.edited_at,
        author: p.author_id ? { id: p.author_id, name: names.get(p.author_id)?.name ?? 'Admin', photo: names.get(p.author_id)?.photo ?? null } : null,
        mine: p.author_id === userId,
        reactions: counts.get(p.id) ?? { like: 0, fire: 0, clap: 0, strong: 0 },
        myReactions: mine.get(p.id) ?? [],
        poll: p.poll
          ? {
              options: p.poll.options,
              closesAt: p.poll.closesAt ?? null,
              tally: p.poll.options.map((_, i) => pv.filter((v) => v.option === i).length),
              myVote: pv.find((v) => v.user_id === userId)?.option ?? null,
            }
          : null,
        link: p.link_type && p.link_id ? { type: p.link_type, id: p.link_id, data: (p.link_type === 'match' ? mMap.get(p.link_id) : cMap.get(p.link_id)) ?? null } : null,
      };
    }),
    hasMore: rows.length > 30,
  };
}

// --- Creators ---------------------------------------------------------------------------------

interface CreatorRow {
  user_id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
  sports: string[];
  links: string[];
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  pitch: string | null;
  review_note: string | null;
  created_at: string;
}

async function myCreator(svc: SupabaseClient, userId: string): Promise<CreatorRow | null> {
  const { data } = await svc.from('creator_profiles').select('*').eq('user_id', userId).maybeSingle();
  return data as CreatorRow | null;
}

export async function applyCreator(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = applyCreatorSchema.parse(raw);
  const current = await myCreator(svc, userId);
  if (current?.status === 'approved') throw new ActionError(409, 'You are already a creator.');
  if (current?.status === 'suspended') throw new ActionError(409, 'Your creator page is suspended. Contact support.');
  const { data: taken } = await svc.from('creator_profiles').select('user_id').eq('handle', input.handle).maybeSingle();
  if (taken && (taken as { user_id: string }).user_id !== userId) throw new ActionError(409, 'That handle is taken.');
  const row = {
    user_id: userId,
    handle: input.handle,
    display_name: input.displayName,
    bio: input.bio,
    sports: input.sports,
    links: input.links,
    pitch: input.pitch,
    status: 'pending',
    review_note: null,
  };
  const { error } = await svc.from('creator_profiles').upsert(row);
  if (error) throw new ActionError(500, 'Could not send the application.');
  const { data: admins } = await svc.from('platform_admins').select('user_id');
  await notifyUsers(((admins ?? []) as { user_id: string }[]).map((a) => a.user_id), 'creator_pending', { userId, title: input.displayName, handle: input.handle });
  return { state: 'pending' };
}

export async function reviewCreator(svc: SupabaseClient, adminId: string, raw: unknown) {
  const input = reviewCreatorSchema.parse(raw);
  await requireAdmin(svc, adminId);
  const current = await myCreator(svc, input.userId);
  if (!current) throw new ActionError(404, 'Application not found.');
  if ((input.decision === 'reject' || input.decision === 'suspend') && !input.note) throw new ActionError(400, 'Say why, so they know what to fix.');
  const status = input.decision === 'approve' || input.decision === 'reinstate' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'suspended';
  await svc
    .from('creator_profiles')
    .update({ status, review_note: input.note ?? null, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq('user_id', input.userId);
  await notifyUsers([input.userId], 'creator_application_reviewed', { status, note: input.note ?? null, handle: current.handle });
  return { state: status };
}

export async function updateCreatorProfile(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = updateCreatorProfileSchema.parse(raw);
  const current = await myCreator(svc, userId);
  if (!current || current.status !== 'approved') throw new ActionError(403, 'Only approved creators have a page to edit.');
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch['display_name'] = input.displayName;
  if (input.bio !== undefined) patch['bio'] = input.bio;
  if (input.avatarUrl !== undefined) patch['avatar_url'] = input.avatarUrl;
  if (input.bannerUrl !== undefined) patch['banner_url'] = input.bannerUrl;
  if (input.sports !== undefined) patch['sports'] = input.sports;
  if (input.links !== undefined) patch['links'] = input.links;
  if (Object.keys(patch).length === 0) return { state: 'unchanged' };
  await svc.from('creator_profiles').update(patch).eq('user_id', userId);
  return { state: 'saved' };
}

export async function saveCreatorPost(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = creatorPostSchema.parse(raw);
  const creator = await myCreator(svc, userId);
  if (!creator || creator.status !== 'approved') throw new ActionError(403, 'Only approved creators can publish.');
  const now = (deps.now ?? new Date()).toISOString();
  const fields = {
    kind: input.kind,
    title: input.title,
    body: input.body,
    cover_url: input.coverUrl ?? null,
    images: input.images,
    sport_id: input.sportId ?? null,
  };
  let id = input.postId;
  let firstPublish = false;
  if (id) {
    const { data } = await svc.from('creator_posts').select('*').eq('id', id).maybeSingle();
    const p = data as { creator_id: string; status: string; deleted_at: string | null } | null;
    if (!p || p.creator_id !== userId || p.deleted_at) throw new ActionError(404, 'Post not found.');
    firstPublish = input.publish && p.status !== 'published';
    await svc
      .from('creator_posts')
      .update({ ...fields, edited_at: p.status === 'published' ? now : null, ...(firstPublish ? { status: 'published', published_at: now } : {}) })
      .eq('id', id);
  } else {
    firstPublish = input.publish;
    const { data, error } = await svc
      .from('creator_posts')
      .insert({ ...fields, creator_id: userId, status: input.publish ? 'published' : 'draft', published_at: input.publish ? now : null })
      .select('id')
      .single();
    if (error) throw new ActionError(500, 'Could not save.');
    id = (data as { id: string }).id;
  }
  if (firstPublish) {
    const { data: followers } = await svc.from('user_follows').select('user_id').eq('subject_type', 'creator').eq('subject_id', userId);
    await notifyUsers(((followers ?? []) as { user_id: string }[]).map((f) => f.user_id), 'creator_post', {
      handle: creator.handle,
      postId: id,
      title: creator.display_name,
      excerpt: input.kind === 'article' ? input.title : excerpt(input.body, 90),
      kind: input.kind,
    });
  }
  return { state: input.publish ? 'published' : 'draft', postId: id };
}

export async function deleteCreatorPost(svc: SupabaseClient, userId: string, raw: unknown) {
  const { postId } = creatorPostIdSchema.parse(raw);
  const { data } = await svc.from('creator_posts').select('creator_id').eq('id', postId).maybeSingle();
  if (!data || (data as { creator_id: string }).creator_id !== userId) throw new ActionError(404, 'Post not found.');
  await svc.from('creator_posts').update({ deleted_at: new Date().toISOString() }).eq('id', postId);
  return { state: 'deleted' };
}

interface CreatorPostRow {
  id: string;
  creator_id: string;
  kind: 'post' | 'article';
  title: string;
  body: string;
  cover_url: string | null;
  images: string[] | null;
  sport_id: string | null;
  status: string;
  published_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

function postView(p: CreatorPostRow, counts: Map<string, Record<Reaction, number>>, mine: Map<string, Reaction[]>, full: boolean) {
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    body: full || p.kind === 'post' ? p.body : '',
    excerpt: excerpt(p.body, 200),
    coverUrl: p.cover_url,
    images: p.images ?? [],
    status: p.status,
    publishedAt: p.published_at,
    editedAt: p.edited_at,
    reactions: counts.get(p.id) ?? { like: 0, fire: 0, clap: 0, strong: 0 },
    myReactions: mine.get(p.id) ?? [],
    words: p.body.split(/\s+/).filter(Boolean).length,
  };
}

async function followerCount(svc: SupabaseClient, type: FollowSubject, id: string): Promise<number> {
  const { data } = await svc.from('user_follows').select('user_id').eq('subject_type', type).eq('subject_id', id);
  return ((data ?? []) as unknown[]).length;
}

async function isFollowing(svc: SupabaseClient, userId: string, type: FollowSubject, id: string): Promise<boolean> {
  const { data } = await svc.from('user_follows').select('user_id').eq('user_id', userId).eq('subject_type', type).eq('subject_id', id).maybeSingle();
  return !!data;
}

export async function getCreator(svc: SupabaseClient, userId: string, handle: string) {
  const { data } = await svc.from('creator_profiles').select('*').eq('handle', handle.toLowerCase()).maybeSingle();
  const c = data as CreatorRow | null;
  const self = c?.user_id === userId;
  if (!c || (c.status !== 'approved' && !self)) throw new ActionError(404, 'Creator not found.');
  const { data: postsRaw } = await svc.from('creator_posts').select('*').eq('creator_id', c.user_id).order('created_at', { ascending: false }).limit(100);
  const posts = ((postsRaw ?? []) as CreatorPostRow[]).filter((p) => !p.deleted_at && (self || p.status === 'published'));
  const { counts, mine } = await reactionSummary(svc, 'creator', posts.map((p) => p.id), userId);
  return {
    creator: { userId: c.user_id, handle: c.handle, displayName: c.display_name, bio: c.bio, avatarUrl: c.avatar_url, bannerUrl: c.banner_url, sports: c.sports, links: c.links, status: c.status },
    self,
    followers: await followerCount(svc, 'creator', c.user_id),
    following: await isFollowing(svc, userId, 'creator', c.user_id),
    posts: posts.sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at)).map((p) => postView(p, counts, mine, false)),
  };
}

export async function getCreatorPost(svc: SupabaseClient, userId: string, postId: string) {
  const { data } = await svc.from('creator_posts').select('*').eq('id', postId).maybeSingle();
  const p = data as CreatorPostRow | null;
  if (!p || p.deleted_at) throw new ActionError(404, 'Post not found.');
  const { data: cRaw } = await svc.from('creator_profiles').select('*').eq('user_id', p.creator_id).maybeSingle();
  const c = cRaw as CreatorRow | null;
  const self = p.creator_id === userId;
  if (!c || (!self && (p.status !== 'published' || c.status !== 'approved'))) throw new ActionError(404, 'Post not found.');
  const { counts, mine } = await reactionSummary(svc, 'creator', [p.id], userId);
  return {
    creator: { userId: c.user_id, handle: c.handle, displayName: c.display_name, avatarUrl: c.avatar_url },
    following: await isFollowing(svc, userId, 'creator', c.user_id),
    self,
    post: postView(p, counts, mine, true),
  };
}

export async function myCreatorStatus(svc: SupabaseClient, userId: string) {
  const c = await myCreator(svc, userId);
  return c ? { handle: c.handle, displayName: c.display_name, status: c.status, reviewNote: c.review_note } : null;
}

export async function listCreatorApplications(svc: SupabaseClient, adminId: string, status: string) {
  await requireAdmin(svc, adminId);
  const { data } = await svc.from('creator_profiles').select('*').eq('status', status).order('created_at');
  const rows = (data ?? []) as CreatorRow[];
  const names = await namesOf(svc, rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, account_name: names.get(r.user_id)?.name ?? null }));
}

// --- Following --------------------------------------------------------------------------------

async function subjectExists(svc: SupabaseClient, type: FollowSubject, id: string): Promise<boolean> {
  if (type === 'creator') {
    const { data } = await svc.from('creator_profiles').select('status').eq('user_id', id).maybeSingle();
    return (data as { status?: string } | null)?.status === 'approved';
  }
  const table = type === 'team' ? 'teams' : type === 'competition' ? 'competitions' : 'venues';
  const { data } = await svc.from(table).select('id').eq('id', id).maybeSingle();
  return !!data;
}

export async function follow(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = followSchema.parse(raw);
  if (input.subjectType === 'creator' && input.subjectId === userId) throw new ActionError(400, 'That is you.');
  if (!(await subjectExists(svc, input.subjectType, input.subjectId))) throw new ActionError(404, 'Not found.');
  await svc.from('user_follows').upsert({ user_id: userId, subject_type: input.subjectType, subject_id: input.subjectId });
  return { state: 'following', followers: await followerCount(svc, input.subjectType, input.subjectId) };
}

export async function unfollow(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = followSchema.parse(raw);
  await svc.from('user_follows').delete().eq('user_id', userId).eq('subject_type', input.subjectType).eq('subject_id', input.subjectId);
  if (input.subjectType === 'competition') await svc.from('follows').delete().eq('user_id', userId).eq('competition_id', input.subjectId);
  return { state: 'not_following', followers: await followerCount(svc, input.subjectType, input.subjectId) };
}

/** Followers of a competition, from both the old and the new follow tables. */
/** Everyone following one subject (a venue, team, competition or creator). */
export async function followersOf(svc: SupabaseClient, subjectType: FollowSubject, subjectId: string): Promise<string[]> {
  const { data } = await svc.from('user_follows').select('user_id').eq('subject_type', subjectType).eq('subject_id', subjectId);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

export async function competitionFollowers(svc: SupabaseClient, competitionId: string): Promise<string[]> {
  const [a, b] = await Promise.all([
    svc.from('user_follows').select('user_id').eq('subject_type', 'competition').eq('subject_id', competitionId),
    svc.from('follows').select('user_id').eq('competition_id', competitionId),
  ]);
  return [...new Set([...((a.data ?? []) as { user_id: string }[]), ...((b.data ?? []) as { user_id: string }[])].map((r) => r.user_id))];
}

export async function getMyFollows(svc: SupabaseClient, userId: string) {
  const { data } = await svc.from('user_follows').select('*').eq('user_id', userId);
  const rows = (data ?? []) as { subject_type: FollowSubject; subject_id: string; created_at: string }[];
  const ids = (t: FollowSubject) => rows.filter((r) => r.subject_type === t).map((r) => r.subject_id);
  const [creators, teams, comps, venues] = await Promise.all([
    ids('creator').length ? svc.from('creator_profiles').select('user_id,handle,display_name,avatar_url').in('user_id', ids('creator')) : Promise.resolve({ data: [] }),
    ids('team').length ? svc.from('teams').select('id,name,logo_url').in('id', ids('team')) : Promise.resolve({ data: [] }),
    ids('competition').length ? svc.from('competitions').select('id,name,kind,banner_url').in('id', ids('competition')) : Promise.resolve({ data: [] }),
    ids('venue').length ? svc.from('venues').select('id,name,photos').in('id', ids('venue')) : Promise.resolve({ data: [] }),
  ]);
  return { creators: creators.data ?? [], teams: teams.data ?? [], competitions: comps.data ?? [], venues: venues.data ?? [] };
}

/** The Following feed: creator posts, followed teams' fixtures and results, followed events' news. Newest first. */
export async function getFollowingFeed(svc: SupabaseClient, userId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const { data } = await svc.from('user_follows').select('*').eq('user_id', userId);
  const rows = (data ?? []) as { subject_type: FollowSubject; subject_id: string }[];
  const ids = (t: FollowSubject) => rows.filter((r) => r.subject_type === t).map((r) => r.subject_id);
  const items: { type: string; at: string; [k: string]: unknown }[] = [];

  const creatorIds = ids('creator');
  if (creatorIds.length) {
    const { data: posts } = await svc.from('creator_posts').select('*').in('creator_id', creatorIds).eq('status', 'published').order('published_at', { ascending: false }).limit(40);
    const live = ((posts ?? []) as CreatorPostRow[]).filter((p) => !p.deleted_at);
    const { data: cs } = await svc.from('creator_profiles').select('user_id,handle,display_name,avatar_url,status').in('user_id', creatorIds);
    const cMap = new Map(((cs ?? []) as { user_id: string; handle: string; display_name: string; avatar_url: string | null; status: string }[]).map((c) => [c.user_id, c]));
    const { counts, mine } = await reactionSummary(svc, 'creator', live.map((p) => p.id), userId);
    for (const p of live) {
      const c = cMap.get(p.creator_id);
      if (!c || c.status !== 'approved') continue;
      items.push({ type: 'creator_post', at: p.published_at ?? p.created_at, creator: { handle: c.handle, displayName: c.display_name, avatarUrl: c.avatar_url }, post: postView(p, counts, mine, false) });
    }
  }

  const teamIds = ids('team');
  if (teamIds.length) {
    const [home, away] = await Promise.all([
      svc.from('fixtures').select('*').in('home_team_id', teamIds),
      svc.from('fixtures').select('*').in('away_team_id', teamIds),
    ]);
    const fx = new Map<string, Record<string, unknown>>();
    for (const f of [...((home.data ?? []) as Record<string, unknown>[]), ...((away.data ?? []) as Record<string, unknown>[])]) fx.set(String(f['id']), f);
    const allTeamIds = [...new Set([...fx.values()].flatMap((f) => [String(f['home_team_id'] ?? ''), String(f['away_team_id'] ?? '')]).filter(Boolean))];
    const { data: tRows } = allTeamIds.length ? await svc.from('teams').select('id,name').in('id', allTeamIds) : { data: [] };
    const tName = new Map(((tRows ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    const horizon = now.getTime() + 14 * 86_400_000;
    const back = now.getTime() - 30 * 86_400_000;
    for (const f of fx.values()) {
      const at = String(f['starts_at'] ?? '');
      if (!at) continue;
      const t = new Date(at).getTime();
      const finished = f['status'] === 'completed' || f['status'] === 'finished' || f['home_score'] != null;
      if ((finished && t >= back) || (!finished && t <= horizon && t >= now.getTime())) {
        items.push({
          type: finished ? 'team_result' : 'team_fixture',
          at,
          competitionId: f['competition_id'],
          home: tName.get(String(f['home_team_id'])) ?? 'TBC',
          away: tName.get(String(f['away_team_id'])) ?? 'TBC',
          homeScore: f['home_score'] ?? null,
          awayScore: f['away_score'] ?? null,
        });
      }
    }
  }

  const compIds = ids('competition');
  if (compIds.length) {
    const { data: news } = await svc.from('announcements').select('*').in('competition_id', compIds).order('created_at', { ascending: false }).limit(30);
    const { data: comps } = await svc.from('competitions').select('id,name,kind').in('id', compIds);
    const cName = new Map(((comps ?? []) as { id: string; name: string; kind: string }[]).map((c) => [c.id, c]));
    for (const n of (news ?? []) as { competition_id: string; text: string; created_at: string }[]) {
      const c = cName.get(n.competition_id);
      items.push({ type: 'event_news', at: n.created_at, competitionId: n.competition_id, kind: c?.kind ?? 'tournament', name: c?.name ?? 'Event', text: n.text });
    }
    const { data: dists } = await svc.from('race_distances').select('competition_id,name,results_published,starts_at').in('competition_id', compIds);
    for (const d of (dists ?? []) as { competition_id: string; name: string; results_published: boolean; starts_at: string }[]) {
      if (d.results_published) items.push({ type: 'race_results', at: d.starts_at, competitionId: d.competition_id, name: cName.get(d.competition_id)?.name ?? 'Race', distance: d.name });
    }
  }

  return { items: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60), follows: rows.length };
}

// --- Privacy and player profiles ----------------------------------------------------------------

export async function setVisibility(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = profileVisibilitySchema.parse(raw);
  await svc.from('profiles').update({ visibility: input.visibility }).eq('id', userId);
  return { state: 'saved', visibility: input.visibility };
}

async function shares(svc: SupabaseClient, table: string, key: string, a: string, b: string, extra?: (row: Record<string, unknown>) => boolean): Promise<boolean> {
  const { data: mine } = await svc.from(table).select('*').eq('user_id', a);
  const keys = new Set(((mine ?? []) as Record<string, unknown>[]).filter((r) => !extra || extra(r)).map((r) => String(r[key])));
  if (!keys.size) return false;
  const { data: theirs } = await svc.from(table).select('*').eq('user_id', b).in(key, [...keys]);
  return ((theirs ?? []) as Record<string, unknown>[]).some((r) => !extra || extra(r));
}

export async function relationBetween(svc: SupabaseClient, viewer: string, player: string): Promise<Relation> {
  if (viewer === player) return 'self';
  if (await shares(svc, 'team_members', 'team_id', viewer, player)) return 'connection';
  if (await shares(svc, 'match_participants', 'match_id', viewer, player, (r) => r['status'] === 'joined')) return 'connection';
  if (await shares(svc, 'circle_members', 'circle_id', viewer, player, (r) => !r['removed_at'])) return 'connection';
  if (await shares(svc, 'race_entries', 'competition_id', viewer, player, (r) => r['status'] === 'confirmed')) return 'connection';
  return 'other';
}

export async function getPlayer(svc: SupabaseClient, viewer: string, playerId: string) {
  const { data } = await svc.from('profiles').select('id,name,photo_url,cover_url,visibility').eq('id', playerId).maybeSingle();
  const p = data as { id: string; name: string | null; photo_url: string | null; cover_url: string | null; visibility: ProfileVisibility | null } | null;
  if (!p) throw new ActionError(404, 'Player not found.');
  const [b1, b2] = await Promise.all([
    svc.from('blocks').select('blocker_id').eq('blocker_id', viewer).eq('blocked_user_id', playerId).maybeSingle(),
    svc.from('blocks').select('blocker_id').eq('blocker_id', playerId).eq('blocked_user_id', viewer).maybeSingle(),
  ]);
  const blockedByMe = !!b1.data;
  const blocked = blockedByMe || !!b2.data;
  const relation = await relationBetween(svc, viewer, playerId);
  const visible = canSeeProfile(p.visibility, relation, blocked);
  const base = { id: p.id, name: p.name ?? 'Player', photoUrl: p.photo_url, coverUrl: p.cover_url, relation, visible, blockedByMe, visibility: relation === 'self' ? p.visibility : null };
  if (!visible) return base;

  const [{ data: sportRows }, { data: memberRows }, { data: partRows }, { data: raceRows }] = await Promise.all([
    svc.from('user_sports').select('sport_id,level').eq('user_id', playerId),
    svc.from('team_members').select('team_id,role').eq('user_id', playerId),
    svc.from('match_participants').select('match_id,status').eq('user_id', playerId),
    svc.from('race_entries').select('id,competition_id,distance_id,runner_name,status').eq('user_id', playerId),
  ]);
  const sportIds = ((sportRows ?? []) as { sport_id: string }[]).map((s) => s.sport_id);
  const { data: sports } = sportIds.length ? await svc.from('sports').select('id,name').in('id', sportIds) : { data: [] };
  const teamIds = ((memberRows ?? []) as { team_id: string }[]).map((m) => m.team_id);
  const { data: teams } = teamIds.length ? await svc.from('teams').select('id,name,logo_url,sport_id').in('id', teamIds) : { data: [] };
  const matchIds = ((partRows ?? []) as { match_id: string; status: string }[]).filter((r) => r.status === 'joined').map((r) => r.match_id);
  const { data: matches } = matchIds.length ? await svc.from('matches').select('id,title,starts_at,status,home_score,away_score').in('id', matchIds) : { data: [] };
  const played = ((matches ?? []) as { id: string; title: string; starts_at: string; status: string; home_score: number | null; away_score: number | null }[])
    .filter((m) => m.status === 'finished' || new Date(m.starts_at) < new Date())
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  // Race results: only the runner's own name entries (not people they entered for others), and only once published.
  const myName = (p.name ?? '').toLowerCase();
  const entries = ((raceRows ?? []) as { id: string; competition_id: string; distance_id: string; runner_name: string; status: string }[]).filter(
    (e) => e.status === 'confirmed' && e.runner_name.toLowerCase() === myName,
  );
  const eIds = entries.map((e) => e.id);
  const { data: results } = eIds.length ? await svc.from('race_results').select('*').in('entry_id', eIds) : { data: [] };
  const dIds = [...new Set(entries.map((e) => e.distance_id))];
  const { data: dists } = dIds.length ? await svc.from('race_distances').select('id,name,distance_km,results_published,starts_at,competition_id').in('id', dIds) : { data: [] };
  const cIds = [...new Set(entries.map((e) => e.competition_id))];
  const { data: comps } = cIds.length ? await svc.from('competitions').select('id,name').in('id', cIds) : { data: [] };
  const dMap = new Map(((dists ?? []) as { id: string; name: string; distance_km: number; results_published: boolean; starts_at: string }[]).map((d) => [d.id, d]));
  const cMap = new Map(((comps ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const races = ((results ?? []) as { entry_id: string; gun_seconds: number | null; chip_seconds: number | null; status: string; overall_pos: number | null }[])
    .map((r) => {
      const e = entries.find((x) => x.id === r.entry_id)!;
      const d = dMap.get(e.distance_id);
      if (!d?.results_published) return null;
      return { raceId: e.competition_id, race: cMap.get(e.competition_id) ?? 'Race', distance: d.name, km: Number(d.distance_km), date: d.starts_at, seconds: r.chip_seconds != null ? Number(r.chip_seconds) : r.gun_seconds != null ? Number(r.gun_seconds) : null, status: r.status, position: r.overall_pos };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.date.localeCompare(a.date));
  const levelOf = new Map(((sportRows ?? []) as { sport_id: string; level: string }[]).map((s) => [s.sport_id, s.level]));
  return {
    ...base,
    sports: ((sports ?? []) as { id: string; name: string }[]).map((s) => ({ name: s.name, level: levelOf.get(s.id) ?? null })),
    teams: teams ?? [],
    record: { played: played.length, recent: played.slice(0, 8) },
    stats: await recordFor(svc, playerId),
    races,
  };
}

export { REACTIONS };
