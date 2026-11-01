import {
  acceptChallengeSchema,
  announcementSchema,
  answerPollSchema,
  circleEligibility,
  circleIdSchema,
  circleSchema,
  createCircleSchema,
  createPollSchema,
  bookingIdSchema,
  bookingSchema,
  challengeIdSchema,
  challengeSchema,
  competitionEntrySchema,
  competitionIdSchema,
  competitionSchema,
  computeStandings,
  createCompetitionSchema,
  createMatchSchema,
  createTeamSchema,
  createVenueSchema,
  createVenueSlotSchema,
  fixtureSchema,
  matchIdSchema,
  matchSchema,
  pollSchema,
  postAnnouncementSchema,
  postChallengeSchema,
  postResultSchema,
  proposeTimeSchema,
  registerEntrySchema,
  reportScoreSchema,
  requestBookingSchema,
  respondBookingSchema,
  roundRobinPairings,
  teamSchema,
  ticketIdSchema,
  ticketSchema,
  venueSchema,
  venueSupportsSport,
  venueSlotSchema,
} from '@chabuka/shared';
import type {
  ActionResult,
  Announcement,
  AnswerPollInput,
  Booking,
  Challenge,
  Circle,
  Competition,
  CreateCircleInput,
  CreateCompetitionInput,
  CreateMatchInput,
  CreatePollInput,
  CreateTeamInput,
  CreateVenueInput,
  CreateVenueSlotInput,
  Fixture,
  Match,
  Poll,
  PostAnnouncementInput,
  PostChallengeInput,
  PostResultInput,
  RegisterEntryInput,
  ReportScoreInput,
  RequestBookingInput,
  Team,
  Ticket,
  Venue,
  VenueSlot,
} from '@chabuka/shared';
import { availableActions, availableChallengeActions } from '@chabuka/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase.js';
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
  if (input.venueId) {
    const venue = await loadVenue(db, input.venueId);
    const { data: sportRow } = await db.from('sports').select('name').eq('id', input.sportId).maybeSingle();
    const sportName = (sportRow as { name?: string } | null)?.name ?? '';
    if (!venueSupportsSport(venue.sports, sportName)) {
      throw new ActionError(
        400,
        `${venue.name} doesn't host ${sportName || 'that sport'} — pick a venue with the right courts, or drop a pin.`,
      );
    }
  }
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
      circle_id: input.circleId ?? null,
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
  if (input.circleId) {
    const { data: memberRows } = await db
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', input.circleId);
    const memberIds = ((memberRows ?? []) as { user_id: string }[])
      .map((r) => r.user_id)
      .filter((id) => id !== userId);
    await notifyUsers(memberIds, 'circle_event', { matchId, title: input.title });
  }
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
  if (match.organiser_id !== userId) {
    await notifyUsers([match.organiser_id], 'player_joined', { matchId, title: match.title });
  }
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

// --- Team availability polls: captains ask "who's in?", members answer. ---
async function loadPoll(db: SupabaseClient, pollId: string): Promise<Poll> {
  const { data, error } = await db.from('polls').select('*').eq('id', pollId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Poll not found.');
  return pollSchema.parse(data);
}

async function requireTeamMember(db: SupabaseClient, teamId: string, userId: string): Promise<void> {
  const { data, error } = await db
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(403, 'Only team members can do that.');
}

export async function createPoll(
  db: SupabaseClient,
  userId: string,
  input: CreatePollInput,
): Promise<unknown> {
  await requireTeamMember(db, input.teamId, userId);
  const { data, error } = await db
    .from('polls')
    .insert({
      team_id: input.teamId,
      created_by: userId,
      question: input.question,
      closes_at: input.closesAt ?? null,
      status: 'open',
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const poll = await loadPoll(db, (data as { id: string }).id);
  const { data: members } = await db.from('team_members').select('user_id').eq('team_id', input.teamId);
  const others = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== userId);
  await notifyUsers(others, 'poll_created', { pollId: poll.id, teamId: input.teamId, question: input.question });
  return { state: 'open', actions: ['answer_poll'], poll };
}

export async function answerPoll(
  db: SupabaseClient,
  userId: string,
  input: AnswerPollInput,
): Promise<unknown> {
  const poll = await loadPoll(db, input.pollId);
  if (poll.status !== 'open') {
    throw new ActionError(409, 'This poll is closed.');
  }
  await requireTeamMember(db, poll.team_id, userId);
  const { error } = await db
    .from('poll_responses')
    .upsert({ poll_id: poll.id, user_id: userId, response: input.response }, { onConflict: 'poll_id,user_id' });
  if (error) throw dbError(error);
  return { state: 'answered', actions: ['answer_poll'], pollId: poll.id, response: input.response };
}

// --- Post-game scores on casual matches (tournaments use post_result). ---
export async function reportScore(
  db: SupabaseClient,
  userId: string,
  input: ReportScoreInput,
): Promise<unknown> {
  const match = await loadMatch(db, input.matchId);
  if (match.organiser_id !== userId) {
    throw new ActionError(403, 'Only the organiser can report the score.');
  }
  const { error } = await db
    .from('matches')
    .update({ home_score: input.homeScore, away_score: input.awayScore })
    .eq('id', match.id);
  if (error) throw dbError(error);
  return { state: 'reported', actions: [], match: { ...match, home_score: input.homeScore, away_score: input.awayScore } };
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
    await notifyUsers([booking.requester_id], 'booking_answered', { bookingId: booking.id, decision });
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
  await notifyUsers([booking.requester_id], 'booking_answered', { bookingId: booking.id, decision });
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

// --- Tournaments (Day 5 board, brief sections 6-7) ---

async function loadCompetition(db: SupabaseClient, competitionId: string): Promise<Competition> {
  const { data, error } = await db
    .from('competitions')
    .select('*')
    .eq('id', competitionId)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Tournament not found.');
  return competitionSchema.parse(data);
}

async function loadFixture(db: SupabaseClient, fixtureId: string): Promise<Fixture> {
  const { data, error } = await db.from('fixtures').select('*').eq('id', fixtureId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Fixture not found.');
  return fixtureSchema.parse(data);
}

async function loadEntries(db: SupabaseClient, competitionId: string): Promise<string[]> {
  const { data, error } = await db
    .from('competition_entries')
    .select('team_id')
    .eq('competition_id', competitionId);
  if (error) throw dbError(error);
  const rows = (data as { team_id: string }[] | null) ?? [];
  return rows.map((r) => competitionEntrySchema.parse({ competition_id: competitionId, team_id: r.team_id, status: 'registered' }).team_id);
}

async function loadFixtures(db: SupabaseClient, competitionId: string): Promise<Fixture[]> {
  const { data, error } = await db
    .from('fixtures')
    .select('*')
    .eq('competition_id', competitionId)
    .order('created_at');
  if (error) throw dbError(error);
  return ((data as unknown[] | null) ?? []).map((row) => fixtureSchema.parse(row));
}

export async function createCompetition(
  db: SupabaseClient,
  userId: string,
  input: CreateCompetitionInput,
): Promise<unknown> {
  const { data, error } = await db
    .from('competitions')
    .insert({
      organiser_id: userId,
      sport_id: input.sportId,
      name: input.name,
      kind: 'tournament',
      format: 'round_robin',
      area: input.area,
      starts_on: input.startsOn,
      ends_on: input.endsOn ?? null,
      max_entries: input.maxEntries,
      status: 'registration',
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const competition = await loadCompetition(db, (data as { id: string }).id);
  return { state: competition.status, actions: ['register_entry'], competition };
}

export async function registerEntry(
  db: SupabaseClient,
  userId: string,
  input: RegisterEntryInput,
): Promise<unknown> {
  const competition = await loadCompetition(db, input.competitionId);
  if (competition.status !== 'registration') {
    throw new ActionError(409, 'Entries are closed for this tournament.');
  }
  await requireCaptain(db, input.teamId, userId);
  const team = await loadTeam(db, input.teamId);
  if (team.sport_id !== competition.sport_id) {
    throw new ActionError(409, 'That team plays a different sport.');
  }
  const entries = await loadEntries(db, competition.id);
  if (entries.includes(team.id)) {
    return { state: competition.status, actions: [], competition, entries };
  }
  if (entries.length >= competition.max_entries) {
    throw new ActionError(409, 'This tournament is full.');
  }
  const { error } = await db
    .from('competition_entries')
    .insert({ competition_id: competition.id, team_id: team.id, status: 'registered' });
  if (error) throw dbError(error);
  return { state: competition.status, actions: [], competition, entries: [...entries, team.id] };
}

export async function closeRegistration(
  db: SupabaseClient,
  userId: string,
  competitionId: string,
): Promise<unknown> {
  const competition = await loadCompetition(db, competitionId);
  if (competition.organiser_id !== userId) {
    throw new ActionError(403, 'Only the tournament organiser can start it.');
  }
  if (competition.status !== 'registration') {
    throw new ActionError(409, 'This tournament has already started.');
  }
  const entries = await loadEntries(db, competition.id);
  if (entries.length < 2) {
    throw new ActionError(409, 'At least 2 teams must enter before fixtures can be made.');
  }
  const pairings = roundRobinPairings(entries);
  for (const [homeTeamId, awayTeamId] of pairings) {
    const { error } = await db.from('fixtures').insert({
      competition_id: competition.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      status: 'scheduled',
    });
    if (error) throw dbError(error);
  }
  const { error: updErr } = await db
    .from('competitions')
    .update({ status: 'live' })
    .eq('id', competition.id);
  if (updErr) throw dbError(updErr);
  const fixtures = await loadFixtures(db, competition.id);
  return { state: 'live', actions: ['post_result'], competition: { ...competition, status: 'live' as const }, fixtures };
}

export async function postResult(
  db: SupabaseClient,
  userId: string,
  input: PostResultInput,
): Promise<unknown> {
  const fixture = await loadFixture(db, input.fixtureId);
  const competition = await loadCompetition(db, fixture.competition_id);
  if (competition.organiser_id !== userId) {
    throw new ActionError(403, 'Only the tournament organiser can post results.');
  }
  if (competition.status !== 'live') {
    throw new ActionError(409, 'This tournament is not live.');
  }
  if (fixture.status !== 'scheduled') {
    throw new ActionError(409, 'This result is already in.');
  }
  const { error } = await db
    .from('fixtures')
    .update({ status: 'finished', home_score: input.homeScore, away_score: input.awayScore })
    .eq('id', fixture.id);
  if (error) throw dbError(error);
  const entries = await loadEntries(db, competition.id);
  const fixtures = await loadFixtures(db, competition.id);
  const standings = computeStandings(entries, fixtures);
  const { data: followerRows } = await db.from('follows').select('user_id').eq('competition_id', competition.id);
  await notifyUsers(
    ((followerRows ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== userId),
    'result_posted',
    { competitionId: competition.id, fixtureId: fixture.id },
  );
  const allFinished = fixtures.every((f) => f.status === 'finished');
  if (allFinished) {
    const { error: finishErr } = await db
      .from('competitions')
      .update({ status: 'finished' })
      .eq('id', competition.id);
    if (finishErr) throw dbError(finishErr);
    return { state: 'finished', actions: [], competition: { ...competition, status: 'finished' as const }, fixtures, standings };
  }
  return { state: competition.status, actions: ['post_result'], competition, fixtures, standings };
}

export async function postAnnouncement(
  db: SupabaseClient,
  userId: string,
  input: PostAnnouncementInput,
): Promise<unknown> {
  const competition = await loadCompetition(db, input.competitionId);
  if (competition.organiser_id !== userId) {
    throw new ActionError(403, 'Only the tournament organiser can announce.');
  }
  const { data, error } = await db
    .from('announcements')
    .insert({
      competition_id: competition.id,
      author_id: userId,
      type: input.type,
      text: input.text,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const { data: row } = await db
    .from('announcements')
    .select('*')
    .eq('id', (data as { id: string }).id)
    .maybeSingle();
  const announcement: Announcement | null = row ? announcementSchema.parse(row) : null;
  return { state: competition.status, actions: [], announcement };
}

export async function followCompetition(
  db: SupabaseClient,
  userId: string,
  competitionId: string,
): Promise<unknown> {
  await loadCompetition(db, competitionId);
  const { data: existing } = await db
    .from('follows')
    .select('user_id')
    .eq('user_id', userId)
    .eq('competition_id', competitionId)
    .maybeSingle();
  if (existing) return { state: 'following', actions: [] };
  const { error } = await db
    .from('follows')
    .insert({ user_id: userId, competition_id: competitionId });
  if (error) throw dbError(error);
  return { state: 'following', actions: [] };
}

// --- Circles ---

async function loadCircle(db: SupabaseClient, circleId: string): Promise<Circle> {
  const { data, error } = await db.from('circles').select('*').eq('id', circleId).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new ActionError(404, 'Circle not found.');
  return circleSchema.parse(data);
}

async function notifyUsers(
  userIds: string[],
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Best-effort: a failed notification must never fail the game action.
  // Written with the service client because recipients are other users —
  // the actor's own JWT cannot insert their rows under RLS.
  if (userIds.length === 0) return;
  const rows = userIds.map((user_id) => ({ user_id, type, payload }));
  try {
    const { error } = await createServiceClient().from('notifications').insert(rows);
    if (error) console.error('notification failed', type, error.message);
  } catch (err) {
    console.error('notification failed', type, err instanceof Error ? err.message : 'unknown');
  }
}

export async function createCircle(
  db: SupabaseClient,
  userId: string,
  input: CreateCircleInput,
): Promise<unknown> {
  const { data, error } = await db
    .from('circles')
    .insert({
      name: input.name,
      sport_id: input.sportId ?? null,
      area: input.area,
      description: input.description ?? null,
      age_bands: input.ageBands,
      genders: input.genders,
      levels: input.levels,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw dbError(error);
  const circle = await loadCircle(db, (data as { id: string }).id);
  const { error: memberErr } = await db
    .from('circle_members')
    .insert({ circle_id: circle.id, user_id: userId });
  if (memberErr) throw dbError(memberErr);
  return { state: 'created', actions: ['join_circle'], circle };
}

export async function joinCircle(
  db: SupabaseClient,
  userId: string,
  circleId: string,
): Promise<unknown> {
  const circle = await loadCircle(db, circleId);
  const { data: profileRow } = await db
    .from('profiles')
    .select('birth_year,gender')
    .eq('id', userId)
    .maybeSingle();
  const profile = (profileRow ?? {}) as { birth_year: number | null; gender: string | null };
  const reason = circleEligibility({
    birthYear: profile.birth_year,
    gender: profile.gender,
    ageBands: circle.age_bands,
    genders: circle.genders,
  });
  if (reason) throw new ActionError(403, reason);
  if (circle.sport_id && circle.levels.length > 0) {
    const { data: sportRow } = await db
      .from('user_sports')
      .select('level')
      .eq('user_id', userId)
      .eq('sport_id', circle.sport_id)
      .maybeSingle();
    const level = (sportRow as { level?: string } | null)?.level;
    if (!level || !(circle.levels as string[]).includes(level)) {
      throw new ActionError(403, `This circle is for ${circle.levels.join(', ')} players.`);
    }
  }
  const { data: existing } = await db
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', circle.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return { state: 'joined', actions: ['leave_circle'], circle };
  const { error } = await db.from('circle_members').insert({ circle_id: circle.id, user_id: userId });
  if (error) throw dbError(error);
  return { state: 'joined', actions: ['leave_circle'], circle };
}

export async function leaveCircle(
  db: SupabaseClient,
  userId: string,
  circleId: string,
): Promise<unknown> {
  const circle = await loadCircle(db, circleId);
  const { error } = await db
    .from('circle_members')
    .delete()
    .eq('circle_id', circle.id)
    .eq('user_id', userId);
  if (error) throw dbError(error);
  return { state: 'left', actions: ['join_circle'], circle };
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
    case 'create_competition':
      return createCompetition(db, userId, createCompetitionSchema.parse(body));
    case 'register_entry':
      return registerEntry(db, userId, registerEntrySchema.parse(body));
    case 'close_registration':
      return closeRegistration(db, userId, competitionIdSchema.parse(body).competitionId);
    case 'post_result':
      return postResult(db, userId, postResultSchema.parse(body));
    case 'report_score':
      return reportScore(db, userId, reportScoreSchema.parse(body));
    case 'create_poll':
      return createPoll(db, userId, createPollSchema.parse(body));
    case 'answer_poll':
      return answerPoll(db, userId, answerPollSchema.parse(body));
    case 'post_announcement':
      return postAnnouncement(db, userId, postAnnouncementSchema.parse(body));
    case 'follow_competition':
      return followCompetition(db, userId, competitionIdSchema.parse(body).competitionId);
    case 'create_circle':
      return createCircle(db, userId, createCircleSchema.parse(body));
    case 'join_circle':
      return joinCircle(db, userId, circleIdSchema.parse(body).circleId);
    case 'leave_circle':
      return leaveCircle(db, userId, circleIdSchema.parse(body).circleId);
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
