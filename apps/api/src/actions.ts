import {
  acceptChallengeSchema,
  challengeIdSchema,
  challengeSchema,
  createMatchSchema,
  createTeamSchema,
  matchIdSchema,
  matchSchema,
  postChallengeSchema,
  proposeTimeSchema,
  teamSchema,
} from '@chabuka/shared';
import type {
  ActionResult,
  Challenge,
  CreateMatchInput,
  CreateTeamInput,
  Match,
  PostChallengeInput,
  Team,
} from '@chabuka/shared';
import { availableActions, availableChallengeActions } from '@chabuka/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export class ActionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function dbError(error: { message: string }): ActionError {
  return new ActionError(500, error.message);
}

async function loadMatch(db: SupabaseClient, matchId: string): Promise<Match> {
  const { data, error } = await db.from('matches').select('*').eq('id', matchId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Match not found.');
  return matchSchema.parse(data);
}

async function joinedCount(db: SupabaseClient, matchId: string): Promise<number> {
  const { count, error } = await db
    .from('match_participants')
    .select('user_id', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('status', 'joined');
  if (error) throw dbError(error);
  return count ?? 0;
}

async function participantStatus(
  db: SupabaseClient,
  matchId: string,
  userId: string,
): Promise<'joined' | 'withdrawn' | null> {
  const { data, error } = await db
    .from('match_participants')
    .select('status')
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw dbError(error);
  const status = (data as { status?: unknown } | null)?.status;
  return status === 'joined' || status === 'withdrawn' ? status : null;
}

function resultFor(
  match: Match,
  userId: string,
  isParticipant: boolean,
  count: number,
  state: string,
): ActionResult {
  return {
    state,
    actions: availableActions({
      status: match.status,
      isOrganiser: match.organiser_id === userId,
      isParticipant,
      joinedCount: count,
      capacity: match.capacity,
    }),
    joinedCount: count,
    capacity: match.capacity,
  };
}

// The organiser counts as the first player, so fill counts are real from
// the start and one person can host and play at once.
export async function createMatch(
  db: SupabaseClient,
  userId: string,
  input: CreateMatchInput,
): Promise<ActionResult & { matchId: string }> {
  const { data, error } = await db
    .from('matches')
    .insert({
      organiser_id: userId,
      sport_id: input.sportId,
      title: input.title,
      starts_at: input.startsAt,
      venue_id: input.venueId ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      area: input.area,
      format: input.format ?? null,
      capacity: input.capacity,
      level: input.level,
      kind: 'players',
      visibility: input.visibility,
      status: 'open',
      notes: input.notes ?? null,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const matchId = (data as { id: string }).id;

  const { error: joinErr } = await db
    .from('match_participants')
    .insert({ match_id: matchId, user_id: userId, status: 'joined' });
  if (joinErr) throw dbError(joinErr);

  const match = await loadMatch(db, matchId);
  const count = await joinedCount(db, matchId);
  return { matchId, ...resultFor(match, userId, true, count, 'organiser') };
}

export async function joinMatch(
  db: SupabaseClient,
  userId: string,
  matchId: string,
): Promise<ActionResult> {
  const match = await loadMatch(db, matchId);
  if (match.kind !== 'players') {
    throw new ActionError(409, 'Team matches are set up through challenges.');
  }
  if (match.status !== 'open' && match.status !== 'full') {
    throw new ActionError(409, 'This match is not open.');
  }
  const existing = await participantStatus(db, matchId, userId);
  const before = await joinedCount(db, matchId);
  if (existing === 'joined') {
    return resultFor(match, userId, true, before, 'joined');
  }
  if (before >= match.capacity) {
    throw new ActionError(409, 'This match is full.');
  }
  const { error } = await db
    .from('match_participants')
    .upsert({ match_id: matchId, user_id: userId, status: 'joined' }, { onConflict: 'match_id,user_id' });
  if (error) throw dbError(error);
  const after = await joinedCount(db, matchId);
  return resultFor(match, userId, true, after, 'joined');
}

export async function withdrawMatch(
  db: SupabaseClient,
  userId: string,
  matchId: string,
): Promise<ActionResult> {
  const match = await loadMatch(db, matchId);
  const existing = await participantStatus(db, matchId, userId);
  if (existing !== 'joined') {
    const count = await joinedCount(db, matchId);
    const state = match.organiser_id === userId ? 'organiser' : 'not_joined';
    return resultFor(match, userId, false, count, state);
  }
  const { error } = await db
    .from('match_participants')
    .update({ status: 'withdrawn' })
    .eq('match_id', matchId)
    .eq('user_id', userId);
  if (error) throw dbError(error);
  const count = await joinedCount(db, matchId);
  const state = match.organiser_id === userId ? 'organiser' : 'not_joined';
  return resultFor(match, userId, false, count, state);
}

// --- Teams + challenges ---

async function loadTeam(db: SupabaseClient, teamId: string): Promise<Team> {
  const { data, error } = await db.from('teams').select('*').eq('id', teamId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Team not found.');
  return teamSchema.parse(data);
}

async function loadChallenge(db: SupabaseClient, challengeId: string): Promise<Challenge> {
  const { data, error } = await db.from('challenges').select('*').eq('id', challengeId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Challenge not found.');
  return challengeSchema.parse(data);
}

async function myTeamRole(
  db: SupabaseClient,
  teamId: string,
  userId: string,
): Promise<'owner' | 'captain' | 'player' | null> {
  const { data, error } = await db
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw dbError(error);
  const role = (data as { role?: unknown } | null)?.role;
  return role === 'owner' || role === 'captain' || role === 'player' ? role : null;
}

async function requireCaptain(db: SupabaseClient, teamId: string, userId: string): Promise<void> {
  const role = await myTeamRole(db, teamId, userId);
  if (role !== 'owner' && role !== 'captain') {
    throw new ActionError(403, 'Only a team captain or owner can do that.');
  }
}

function challengeResult(challenge: Challenge, actions: string[]): unknown {
  return { state: challenge.status, actions, challenge };
}

export async function createTeam(
  db: SupabaseClient,
  userId: string,
  input: CreateTeamInput,
): Promise<unknown> {
  const { data, error } = await db
    .from('teams')
    .insert({
      name: input.name,
      sport_id: input.sportId,
      category: input.category,
      city: input.city ?? null,
      area: input.area,
      logo_url: input.logoUrl ?? null,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const teamId = (data as { id: string }).id;
  const { error: memberErr } = await db
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId, role: 'owner' });
  if (memberErr) throw dbError(memberErr);
  const team = await loadTeam(db, teamId);
  return { state: 'created', actions: ['post_challenge'], team };
}

export async function postChallenge(
  db: SupabaseClient,
  userId: string,
  input: PostChallengeInput,
): Promise<unknown> {
  const team = await loadTeam(db, input.teamId);
  await requireCaptain(db, team.id, userId);
  if (new Date(input.windowEnd).getTime() <= new Date(input.windowStart).getTime()) {
    throw new ActionError(400, 'The window must end after it starts.');
  }
  const { data, error } = await db
    .from('challenges')
    .insert({
      team_id: team.id,
      sport_id: team.sport_id,
      format: input.format ?? null,
      level: input.level,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      area: input.area,
      radius_km: input.radiusKm,
      status: 'open',
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const challenge = await loadChallenge(db, (data as { id: string }).id);
  return challengeResult(challenge, []);
}

export async function acceptChallenge(
  db: SupabaseClient,
  userId: string,
  challengeId: string,
  opponentTeamId: string,
  startsAt?: string,
): Promise<unknown> {
  const challenge = await loadChallenge(db, challengeId);
  const acceptingOwnProposal = challenge.status === 'reschedule_proposed';
  if (challenge.status !== 'open' && !acceptingOwnProposal) {
    throw new ActionError(409, 'This challenge is no longer open.');
  }
  // Open: the opponent captain accepts. Reschedule proposed: the posting
  // captain accepts the proposed time.
  const actingTeamId = acceptingOwnProposal ? challenge.team_id : opponentTeamId;
  const opponentId = acceptingOwnProposal ? challenge.opponent_team_id : opponentTeamId;
  if (!opponentId) throw new ActionError(409, 'No opponent team on this challenge.');
  if (!acceptingOwnProposal && opponentId === challenge.team_id) {
    throw new ActionError(409, 'A team cannot accept its own challenge.');
  }
  await requireCaptain(db, actingTeamId, userId);
  const home = await loadTeam(db, challenge.team_id);
  const away = await loadTeam(db, opponentId);
  const starts = challenge.proposed_starts_at ?? startsAt ?? challenge.window_start;
  const { data: matchRow, error: matchErr } = await db
    .from('matches')
    .insert({
      organiser_id: challenge.created_by,
      sport_id: challenge.sport_id,
      title: `${home.name} vs ${away.name}`,
      starts_at: starts,
      area: challenge.area,
      format: challenge.format,
      capacity: 22,
      level: challenge.level,
      kind: 'team-vs-team',
      visibility: 'public',
      status: 'open',
    })
    .select('id')
    .single();
  if (matchErr) throw dbError(matchErr);
  const matchId = (matchRow as { id: string }).id;
  const { error: updErr } = await db
    .from('challenges')
    .update({ status: 'accepted', opponent_team_id: opponentId, match_id: matchId })
    .eq('id', challenge.id);
  if (updErr) throw dbError(updErr);
  const updated = await loadChallenge(db, challenge.id);
  return { state: 'accepted', actions: ['directions'], challenge: updated, matchId };
}

export async function declineChallenge(
  db: SupabaseClient,
  userId: string,
  challengeId: string,
  opponentTeamId?: string,
): Promise<unknown> {
  const challenge = await loadChallenge(db, challengeId);
  if (challenge.status !== 'open' && challenge.status !== 'reschedule_proposed') {
    throw new ActionError(409, 'This challenge is no longer open.');
  }
  // Either side can end it: posting captain withdraws, opponent declines.
  const asPoster = await myTeamRole(db, challenge.team_id, userId);
  if (asPoster !== 'owner' && asPoster !== 'captain') {
    if (!opponentTeamId) throw new ActionError(403, 'Only a team captain or owner can do that.');
    await requireCaptain(db, opponentTeamId, userId);
  }
  const { error } = await db.from('challenges').update({ status: 'declined' }).eq('id', challenge.id);
  if (error) throw dbError(error);
  const updated = await loadChallenge(db, challenge.id);
  return challengeResult(updated, []);
}

export async function proposeTime(
  db: SupabaseClient,
  userId: string,
  challengeId: string,
  opponentTeamId: string,
  proposedStartsAt: string,
): Promise<unknown> {
  const challenge = await loadChallenge(db, challengeId);
  if (challenge.status !== 'open') {
    throw new ActionError(409, 'This challenge is no longer open.');
  }
  if (opponentTeamId === challenge.team_id) {
    throw new ActionError(409, 'A team cannot propose a time on its own challenge.');
  }
  await requireCaptain(db, opponentTeamId, userId);
  const { error } = await db
    .from('challenges')
    .update({
      status: 'reschedule_proposed',
      opponent_team_id: opponentTeamId,
      proposed_starts_at: proposedStartsAt,
    })
    .eq('id', challenge.id);
  if (error) throw dbError(error);
  const updated = await loadChallenge(db, challenge.id);
  return challengeResult(updated, availableChallengeActions({
    status: updated.status,
    isPosterTeamMember: false,
    isCaptainOrOwner: true,
  }));
}

// HTTP entry points: parse once with the shared schema, then dispatch.
// Notifications land with the Day 5 board; the matches migrations have
// no notifications table yet, so no notification rows are written here.
export async function runAction(
  db: SupabaseClient,
  userId: string,
  name: string,
  body: unknown,
): Promise<unknown> {
  switch (name) {
    case 'create_match':
      return createMatch(db, userId, createMatchSchema.parse(body));
    case 'join_match':
      return joinMatch(db, userId, matchIdSchema.parse(body).matchId);
    case 'withdraw_match':
      return withdrawMatch(db, userId, matchIdSchema.parse(body).matchId);
    case 'create_team':
      return createTeam(db, userId, createTeamSchema.parse(body));
    case 'post_challenge': {
      const input = postChallengeSchema.parse(body);
      return postChallenge(db, userId, input);
    }
    case 'accept_challenge': {
      const input = acceptChallengeSchema.parse(body);
      return acceptChallenge(db, userId, input.challengeId, input.opponentTeamId, input.startsAt);
    }
    case 'decline_challenge':
      return declineChallenge(db, userId, challengeIdSchema.parse(body).challengeId);
    case 'propose_time': {
      const input = proposeTimeSchema.parse(body);
      return proposeTime(db, userId, input.challengeId, input.opponentTeamId, input.proposedStartsAt);
    }
    default:
      throw new ActionError(404, 'Unknown action.');
  }
}

export function toHttpError(err: unknown): { status: number; message: string } {
  if (err instanceof ActionError) return { status: err.status, message: err.message };
  if (err instanceof z.ZodError) {
    return { status: 400, message: err.issues[0]?.message ?? 'Check the input and try again.' };
  }
  return { status: 500, message: 'Something went wrong.' };
}
