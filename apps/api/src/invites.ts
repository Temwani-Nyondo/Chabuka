// Share links and game invites.
//
// - shareLink: one reusable link per player per game (anyone with it sees the game and can join), or the player's
//   personal "join Chabuka" link. Sharing again returns the same live link.
// - invitePreview: what a link shows before sign-in (public, trimmed: the inviter's first name and photo only).
// - claimInvite: claiming as a signed-in player. Game links join the game, team links join the team, and the first
//   link a player ever uses records who brought them (profiles.invited_by). Old single-use team links still work.
// - inviteToMatch: nudge one of your circles or teams about a game you're in (once per game per audience).
//
// Writes use the service client: invite rows belong to their creator under RLS, so a claimer can't update them.
import type { SupabaseClient } from '@supabase/supabase-js';
import { inviteCodeSchema, inviteToMatchSchema, shareLinkSchema, type InvitePreview } from '@chabuka/shared';
import { ActionError, joinMatch, notifyUsers } from './actions.js';

type Deps = { now?: Date };

interface LinkRow {
  code: string;
  created_by: string;
  team_id: string | null;
  match_id: string | null;
  multi_use: boolean | null;
  use_count: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  claimed_by: string | null;
}

interface MatchRow {
  id: string;
  organiser_id: string;
  sport_id: string;
  title: string;
  starts_at: string;
  area: string | null;
  venue_name: string | null;
  format: string | null;
  level: string | null;
  capacity: number;
  status: string;
  kind: string;
}

/** A game link stays usable until two hours after kick-off. */
const MATCH_LINK_GRACE_MS = 2 * 3600_000;
/** An account younger than this, claiming a link, counts as brought in by whoever sent it. */
const NEW_ACCOUNT_MS = 7 * 86_400_000;
/** Most players one nudge goes to. */
const MAX_RECIPIENTS = 200;

export function appUrl(): string {
  return (process.env.APP_URL ?? 'https://chabuka.waitapp.online').replace(/\/+$/, '');
}

export const inviteUrl = (code: string) => `${appUrl()}/i/${encodeURIComponent(code)}`;

function mintCode(): string {
  return `CHB-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

async function loadMatch(svc: SupabaseClient, matchId: string): Promise<MatchRow> {
  const { data } = await svc.from('matches').select('*').eq('id', matchId).maybeSingle();
  if (!data) throw new ActionError(404, 'Game not found.');
  return data as MatchRow;
}

async function isInGame(svc: SupabaseClient, match: MatchRow, userId: string): Promise<boolean> {
  if (match.organiser_id === userId) return true;
  const { data } = await svc.from('match_participants').select('status').eq('match_id', match.id).eq('user_id', userId).maybeSingle();
  return (data as { status?: string } | null)?.status === 'joined';
}

async function joinedCount(svc: SupabaseClient, matchId: string): Promise<number> {
  const { data } = await svc.from('match_participants').select('user_id,status').eq('match_id', matchId);
  return ((data ?? []) as { status: string }[]).filter((r) => r.status === 'joined').length;
}

function linkState(row: LinkRow | null, now: Date): InvitePreview['reason'] | null {
  if (!row) return 'not_found';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() < now.getTime()) return 'expired';
  if (!row.multi_use && row.claimed_by) return 'used';
  return null;
}

async function loadLink(svc: SupabaseClient, code: string): Promise<LinkRow | null> {
  const { data } = await svc.from('invite_links').select('*').eq('code', code).maybeSingle();
  return (data as LinkRow | null) ?? null;
}

/** The player's live link for a game (they must be in it, or it must be public), or their personal link. */
export async function shareLink(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = shareLinkSchema.parse(raw ?? {});
  const now = deps.now ?? new Date();
  let expiresAt: string | null = null;
  let title: string | null = null;
  if (input.matchId) {
    const match = await loadMatch(svc, input.matchId);
    if (match.status === 'cancelled' || match.status === 'finished') throw new ActionError(409, 'This game is over, so there is nothing to invite to.');
    if (match.kind !== 'players') throw new ActionError(409, 'Team matches are set up through challenges, not invite links.');
    const kickOff = new Date(match.starts_at).getTime();
    if (kickOff + MATCH_LINK_GRACE_MS < now.getTime()) throw new ActionError(409, 'This game has already been played.');
    // A private game can only be shared by the people in it.
    const vis = (match as unknown as { visibility?: string }).visibility;
    if (vis === 'private' && !(await isInGame(svc, match, userId))) throw new ActionError(403, 'Only players in this game can share it.');
    expiresAt = new Date(kickOff + MATCH_LINK_GRACE_MS).toISOString();
    title = match.title;
  }
  const live = async () => {
    const base = svc.from('invite_links').select('*').eq('created_by', userId).eq('multi_use', true).is('revoked_at', null);
    const { data } = await (input.matchId ? base.eq('match_id', input.matchId) : base.is('match_id', null).is('team_id', null)).maybeSingle();
    return data as LinkRow | null;
  };
  const existing = await live();
  let row = existing;
  if (!row) {
    const { data, error } = await svc
      .from('invite_links')
      .insert({ code: mintCode(), created_by: userId, match_id: input.matchId ?? null, multi_use: true, expires_at: expiresAt })
      .select('*')
      .single();
    if (error) {
      // Two taps at once: the unique index let one through, so read that one.
      const again = await live();
      if (!again) throw new ActionError(500, 'Could not make the link. Try again.');
      row = again;
    } else {
      row = data as LinkRow;
    }
  }
  const url = inviteUrl(row.code);
  const text = title
    ? `Join my game on Chabuka: ${title}. ${url}`
    : `Join me on Chabuka, for finding games and people to play with near you. ${url}`;
  return { code: row.code, url, text, matchId: row.match_id, uses: row.use_count ?? 0 };
}

/** What a link shows before anyone signs in. Never more than the inviter's first name and photo. */
export async function invitePreview(svc: SupabaseClient, code: string, deps: Deps = {}): Promise<InvitePreview> {
  const clean = inviteCodeSchema.parse({ code }).code;
  const now = deps.now ?? new Date();
  const row = await loadLink(svc, clean);
  const reason = linkState(row, now);
  const base: InvitePreview = { code: clean, valid: reason === null, kind: 'platform', inviter: null };
  if (reason) base.reason = reason;
  if (!row) return base;
  const { data: who } = await svc.from('profiles').select('name,photo_url').eq('id', row.created_by).maybeSingle();
  const p = who as { name?: string | null; photo_url?: string | null } | null;
  base.inviter = { firstName: (p?.name ?? '').trim().split(/\s+/)[0] || 'A player', avatarUrl: p?.photo_url ?? null };
  if (row.team_id) {
    const { data: t } = await svc.from('teams').select('id,name').eq('id', row.team_id).maybeSingle();
    base.kind = 'team';
    base.team = (t as { id: string; name: string } | null) ?? null;
  }
  if (row.match_id) {
    const { data: m } = await svc.from('matches').select('*').eq('id', row.match_id).maybeSingle();
    base.kind = 'match';
    const match = m as MatchRow | null;
    if (match) {
      const { data: s } = await svc.from('sports').select('name').eq('id', match.sport_id).maybeSingle();
      base.game = {
        id: match.id,
        title: match.title,
        sport: (s as { name?: string } | null)?.name ?? null,
        startsAt: match.starts_at,
        area: match.area,
        venueName: match.venue_name,
        format: match.format,
        level: match.level,
        joined: await joinedCount(svc, match.id),
        capacity: match.capacity,
        status: match.status,
      };
    } else {
      base.game = null;
    }
  }
  return base;
}

/**
 * Claim a link as the signed-in player. Joins the game or team it is for; a full or started game still counts the
 * player as invited (they just aren't added), and says why.
 */
export async function claimInvite(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const { code } = inviteCodeSchema.parse(raw ?? {});
  const now = deps.now ?? new Date();
  const row = await loadLink(svc, code);
  const reason = linkState(row, now);
  if (reason === 'not_found' || !row) throw new ActionError(404, 'Invite link not found.');
  if (reason === 'revoked') throw new ActionError(410, 'This invite link was revoked.');
  if (reason === 'expired') throw new ActionError(410, 'This invite link expired.');
  if (reason === 'used' && row.claimed_by !== userId) throw new ActionError(409, 'This invite link was already used.');
  const own = row.created_by === userId;

  if (!own) {
    if (row.multi_use) {
      // A repeat claim by the same player is fine; only first uses count.
      const { data: used } = await svc.from('invite_link_uses').select('user_id').eq('code', row.code).eq('user_id', userId).maybeSingle();
      if (!used) {
        const { error } = await svc.from('invite_link_uses').insert({ code: row.code, user_id: userId, used_at: now.toISOString() });
        if (!error) await svc.from('invite_links').update({ use_count: (row.use_count ?? 0) + 1 }).eq('code', row.code);
      }
    } else if (!row.claimed_by) {
      await svc.from('invite_links').update({ claimed_by: userId, claimed_at: now.toISOString() }).eq('code', row.code).is('claimed_by', null);
    }
    // First link wins: who brought this player to Chabuka never changes after that. Only a new account (under a week
    // old) counts as brought in: a long-time player opening a friend's link wasn't recruited by it.
    const { data: me } = await svc.from('profiles').select('invited_by,created_at').eq('id', userId).maybeSingle();
    const mine = me as { invited_by?: string | null; created_at?: string | null } | null;
    const isNew = !mine?.created_at || now.getTime() - new Date(mine.created_at).getTime() < NEW_ACCOUNT_MS;
    const firstTime = isNew && !mine?.invited_by;
    if (firstTime) await svc.from('profiles').update({ invited_by: row.created_by }).eq('id', userId).is('invited_by', null);
    const { data: meName } = await svc.from('profiles').select('name').eq('id', userId).maybeSingle();
    const name = ((meName as { name?: string | null } | null)?.name ?? '').trim().split(/\s+/)[0] || 'Someone';
    if (!row.match_id && !row.team_id && firstTime) {
      await notifyUsers([row.created_by], 'invite_joined', { name });
    }
  }

  if (row.team_id && !own) {
    const { error } = await svc
      .from('team_members')
      .upsert({ team_id: row.team_id, user_id: userId, role: 'player' }, { onConflict: 'team_id,user_id', ignoreDuplicates: true });
    if (error) throw new ActionError(500, 'Could not add you to the team.');
  }

  let joined: string | null = null;
  let joinError: string | null = null;
  if (row.match_id) {
    try {
      const out = (await joinMatch(svc, userId, row.match_id)) as { state?: string };
      joined = out?.state ?? 'joined';
    } catch (err) {
      joinError = err instanceof ActionError ? err.message : 'Could not add you to the game.';
    }
  }
  return { state: 'claimed', teamId: row.team_id, matchId: row.match_id, joined, joinError };
}

/** Tell one of your circles or teams about a game you're in. Once per game per circle/team. */
export async function inviteToMatch(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = inviteToMatchSchema.parse(raw ?? {});
  const now = deps.now ?? new Date();
  const match = await loadMatch(svc, input.matchId);
  if (!(await isInGame(svc, match, userId))) throw new ActionError(403, 'Join the game first, then invite people to it.');
  if (match.status !== 'open') throw new ActionError(409, match.status === 'full' ? 'This game is already full.' : 'This game is not open.');
  if (new Date(match.starts_at).getTime() < now.getTime()) throw new ActionError(409, 'This game has already started.');

  let audience: string;
  let audienceName: string;
  let members: string[];
  if (input.circleId) {
    const { data: me } = await svc.from('circle_members').select('removed_at').eq('circle_id', input.circleId).eq('user_id', userId).maybeSingle();
    if (!me || (me as { removed_at?: string | null }).removed_at) throw new ActionError(403, 'You can only invite circles you are in.');
    const { data: c } = await svc.from('circles').select('name').eq('id', input.circleId).maybeSingle();
    const { data: rows } = await svc.from('circle_members').select('user_id,removed_at').eq('circle_id', input.circleId);
    members = ((rows ?? []) as { user_id: string; removed_at: string | null }[]).filter((r) => !r.removed_at).map((r) => r.user_id);
    audience = `circle:${input.circleId}`;
    audienceName = (c as { name?: string } | null)?.name ?? 'your circle';
  } else {
    const teamId = input.teamId!;
    const { data: me } = await svc.from('team_members').select('user_id').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
    if (!me) throw new ActionError(403, 'You can only invite teams you are in.');
    const { data: t } = await svc.from('teams').select('name').eq('id', teamId).maybeSingle();
    const { data: rows } = await svc.from('team_members').select('user_id').eq('team_id', teamId);
    members = ((rows ?? []) as { user_id: string }[]).map((r) => r.user_id);
    audience = `team:${teamId}`;
    audienceName = (t as { name?: string } | null)?.name ?? 'your team';
  }

  const { data: sent } = await svc.from('match_invites_sent').select('sent_at').eq('match_id', match.id).eq('sender_id', userId).eq('audience', audience).maybeSingle();
  if (sent) throw new ActionError(409, `You already invited ${audienceName} to this game.`);

  const { data: inGame } = await svc.from('match_participants').select('user_id,status').eq('match_id', match.id);
  const already = new Set(((inGame ?? []) as { user_id: string; status: string }[]).filter((r) => r.status === 'joined').map((r) => r.user_id));
  already.add(match.organiser_id);
  already.add(userId);
  const recipients = [...new Set(members)].filter((id) => !already.has(id)).slice(0, MAX_RECIPIENTS);

  await svc.from('match_invites_sent').insert({ match_id: match.id, sender_id: userId, audience, recipients: recipients.length, sent_at: now.toISOString() });
  if (recipients.length) {
    const { data: meName } = await svc.from('profiles').select('name').eq('id', userId).maybeSingle();
    const from = ((meName as { name?: string | null } | null)?.name ?? '').trim().split(/\s+/)[0] || 'A player';
    await notifyUsers(recipients, 'game_invite', { matchId: match.id, title: match.title, startsAt: match.starts_at, from, via: audienceName });
  }
  const link = await shareLink(svc, userId, { matchId: match.id }, { now });
  return { state: 'sent', matchId: match.id, audience: audienceName, recipients: recipients.length, url: link.url };
}
