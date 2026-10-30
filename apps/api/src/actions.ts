import { createMatchSchema, matchIdSchema, matchSchema } from '@chabuka/shared';
import type { ActionResult, CreateMatchInput, Match } from '@chabuka/shared';
import { availableActions } from '@chabuka/shared';
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
