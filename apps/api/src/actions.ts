import {
  acceptChallengeSchema,
  bookingIdSchema,
  bookingSchema,
  challengeIdSchema,
  challengeSchema,
  createMatchSchema,
  createTeamSchema,
  createVenueSchema,
  createVenueSlotSchema,
  matchIdSchema,
  matchSchema,
  postChallengeSchema,
  proposeTimeSchema,
  requestBookingSchema,
  respondBookingSchema,
  teamSchema,
  ticketIdSchema,
  ticketSchema,
  venueSchema,
  venueSlotSchema,
} from '@chabuka/shared';
import type {
  ActionResult,
  Booking,
  Challenge,
  CreateMatchInput,
  CreateTeamInput,
  CreateVenueInput,
  CreateVenueSlotInput,
  Match,
  PostChallengeInput,
  RequestBookingInput,
  Team,
  Ticket,
  Venue,
  VenueSlot,
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
      place_id: input.placeId ?? null,
      venue_name: input.venueName ?? null,
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

// --- Venue system (Amendment 3): profiles, dashboard, free bookings ---
// All bookings and tickets are free; confirming a booking issues its ticket.

async function loadVenue(db: SupabaseClient, venueId: string): Promise<Venue> {
  const { data, error } = await db.from('venues').select('*').eq('id', venueId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Venue not found.');
  return venueSchema.parse(data);
}

async function loadSlot(db: SupabaseClient, slotId: string): Promise<VenueSlot> {
  const { data, error } = await db.from('venue_slots').select('*').eq('id', slotId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Slot not found.');
  return venueSlotSchema.parse(data);
}

async function loadBooking(db: SupabaseClient, bookingId: string): Promise<Booking> {
  const { data, error } = await db.from('bookings').select('*').eq('id', bookingId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Booking not found.');
  return bookingSchema.parse(data);
}

async function requireVenueOwner(db: SupabaseClient, venueId: string, userId: string): Promise<Venue> {
  const venue = await loadVenue(db, venueId);
  if (venue.owner_id !== userId) {
    throw new ActionError(403, 'Only the venue owner can do that.');
  }
  return venue;
}

async function confirmedForSlot(db: SupabaseClient, slotId: string): Promise<number> {
  const { count, error } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .eq('status', 'confirmed');
  if (error) throw dbError(error);
  return count ?? 0;
}

export async function createVenue(
  db: SupabaseClient,
  userId: string,
  input: CreateVenueInput,
): Promise<unknown> {
  const { data, error } = await db
    .from('venues')
    .insert({
      owner_id: userId,
      google_place_id: input.googlePlaceId ?? null,
      name: input.name,
      area: input.area,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      sports: input.sports,
      facility_types: input.facilityTypes,
      price_note: input.priceNote,
      contact: input.contact ?? null,
      photos: [],
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const venue = await loadVenue(db, (data as { id: string }).id);
  return { state: 'created', actions: ['create_venue_slot', 'request_booking'], venue };
}

export async function createVenueSlot(
  db: SupabaseClient,
  userId: string,
  input: CreateVenueSlotInput,
): Promise<unknown> {
  await requireVenueOwner(db, input.venueId, userId);
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
    throw new ActionError(400, 'The slot must end after it starts.');
  }
  const { data, error } = await db
    .from('venue_slots')
    .insert({
      venue_id: input.venueId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      capacity: input.capacity,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const slot = await loadSlot(db, (data as { id: string }).id);
  return { state: 'created', actions: ['request_booking'], slot };
}

export async function requestBooking(
  db: SupabaseClient,
  userId: string,
  input: RequestBookingInput,
): Promise<unknown> {
  const venue = await loadVenue(db, input.venueId);
  let startsAt = input.requestedStartsAt ?? null;
  if (input.slotId) {
    const slot = await loadSlot(db, input.slotId);
    if (slot.venue_id !== venue.id) throw new ActionError(400, 'That slot is for another venue.');
    startsAt = slot.starts_at;
    const { data: mine } = await db
      .from('bookings')
      .select('id')
      .eq('slot_id', slot.id)
      .eq('requester_id', userId)
      .eq('status', 'confirmed');
    const { data: requested } = await db
      .from('bookings')
      .select('id')
      .eq('slot_id', slot.id)
      .eq('requester_id', userId)
      .eq('status', 'requested');
    if (((mine as unknown[]) ?? []).length > 0 || ((requested as unknown[]) ?? []).length > 0) {
      throw new ActionError(409, 'You already have a booking for this slot.');
    }
  }
  const { data, error } = await db
    .from('bookings')
    .insert({
      venue_id: venue.id,
      slot_id: input.slotId ?? null,
      match_id: input.matchId ?? null,
      requester_id: userId,
      requested_starts_at: startsAt,
      status: 'requested',
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const booking = await loadBooking(db, (data as { id: string }).id);
  return { state: booking.status, actions: ['cancel_booking'], booking };
}

export async function respondBooking(
  db: SupabaseClient,
  userId: string,
  bookingId: string,
  decision: 'confirm' | 'decline',
): Promise<unknown> {
  const booking = await loadBooking(db, bookingId);
  await requireVenueOwner(db, booking.venue_id, userId);
  if (booking.status !== 'requested') {
    throw new ActionError(409, 'This booking has already been answered.');
  }
  if (decision === 'decline') {
    const { error } = await db.from('bookings').update({ status: 'declined' }).eq('id', booking.id);
    if (error) throw dbError(error);
    return { state: 'declined', actions: [], booking: await loadBooking(db, booking.id) };
  }
  let capacity = 1;
  if (booking.slot_id) {
    const slot = await loadSlot(db, booking.slot_id);
    capacity = slot.capacity;
    const confirmed = await confirmedForSlot(db, slot.id);
    if (confirmed >= capacity) {
      throw new ActionError(409, 'This slot is fully booked.');
    }
  }
  const { error } = await db.from('bookings').update({ status: 'confirmed' }).eq('id', booking.id);
  if (error) throw dbError(error);
  const code = `CHB-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const { data: ticketRow, error: ticketErr } = await db
    .from('tickets')
    .insert({ booking_id: booking.id, user_id: booking.requester_id, code, status: 'issued' })
    .select('id')
    .single();
  if (ticketErr) throw dbError(ticketErr);
  const { data: ticketData } = await db
    .from('tickets')
    .select('*')
    .eq('id', (ticketRow as { id: string }).id)
    .maybeSingle();
  const ticket = ticketData ? ticketSchema.parse(ticketData) : null;
  return { state: 'confirmed', actions: ['check_in_ticket'], booking: await loadBooking(db, booking.id), ticket };
}

export async function cancelBooking(
  db: SupabaseClient,
  userId: string,
  bookingId: string,
): Promise<unknown> {
  const booking = await loadBooking(db, bookingId);
  if (booking.requester_id !== userId) {
    throw new ActionError(403, 'Only the person who booked can cancel it.');
  }
  if (booking.status !== 'requested' && booking.status !== 'confirmed') {
    throw new ActionError(409, 'This booking is already closed.');
  }
  const { error } = await db.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);
  if (error) throw dbError(error);
  const { error: ticketErr } = await db
    .from('tickets')
    .update({ status: 'cancelled' })
    .eq('booking_id', booking.id)
    .eq('status', 'issued');
  if (ticketErr) throw dbError(ticketErr);
  return { state: 'cancelled', actions: [], booking: await loadBooking(db, booking.id) };
}

export async function checkInTicket(
  db: SupabaseClient,
  userId: string,
  ticketId: string,
): Promise<unknown> {
  const { data, error } = await db.from('tickets').select('*').eq('id', ticketId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Ticket not found.');
  const ticket: Ticket = ticketSchema.parse(data);
  const booking = await loadBooking(db, ticket.booking_id);
  await requireVenueOwner(db, booking.venue_id, userId);
  if (ticket.status !== 'issued') {
    throw new ActionError(409, 'This ticket has already been used or cancelled.');
  }
  const { error: updErr } = await db.from('tickets').update({ status: 'used' }).eq('id', ticket.id);
  if (updErr) throw dbError(updErr);
  const { data: updated } = await db.from('tickets').select('*').eq('id', ticket.id).maybeSingle();
  return { state: 'used', actions: [], ticket: updated ? ticketSchema.parse(updated) : null };
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
    case 'create_venue':
      return createVenue(db, userId, createVenueSchema.parse(body));
    case 'create_venue_slot':
      return createVenueSlot(db, userId, createVenueSlotSchema.parse(body));
    case 'request_booking':
      return requestBooking(db, userId, requestBookingSchema.parse(body));
    case 'respond_booking': {
      const input = respondBookingSchema.parse(body);
      return respondBooking(db, userId, input.bookingId, input.decision);
    }
    case 'cancel_booking':
      return cancelBooking(db, userId, bookingIdSchema.parse(body).bookingId);
    case 'check_in_ticket':
      return checkInTicket(db, userId, ticketIdSchema.parse(body).ticketId);
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
