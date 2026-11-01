import { z } from 'zod';

// Fixed value sets (brief section 6). Defined once here, reused by the web
// app, API, helper, and MCP server.
export const LEVELS = ['recreational', 'intermediate', 'competitive'] as const;
export const levelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof levelSchema>;

export const LEVEL_LABELS: Record<Level, string> = {
  recreational: 'Recreational',
  intermediate: 'Intermediate',
  competitive: 'Competitive',
};

export const sportSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  formats: z.array(z.string()),
});
export type Sport = z.infer<typeof sportSchema>;

export const sportListSchema = z.array(sportSchema);

export const profileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80).nullable(),
  photo_url: z.string().url().nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  area: z.string().min(1).max(80).nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
  // Optional, banded in UI: exact age is never displayed anywhere.
  birth_year: z.number().int().min(1930).max(2025).nullable().optional(),
  gender: z.string().max(40).nullable().optional(),
});
export type Profile = z.infer<typeof profileSchema>;

export const AGE_BANDS = ['Under 18', '18–24', '25–34', '35–44', '45+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function ageBand(birthYear: number | null | undefined, now = new Date()): AgeBand | null {
  if (!birthYear) return null;
  const age = now.getFullYear() - birthYear;
  if (age < 18) return 'Under 18';
  if (age <= 24) return '18–24';
  if (age <= 34) return '25–34';
  if (age <= 44) return '35–44';
  return '45+';
}

// Day 1 onboarding: name, photo (optional), area, sports + one level for all.
export const onboardingSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  area: z.string().trim().min(1, 'Area is required').max(80),
  photoUrl: z.string().url().optional(),
  sportIds: z.array(z.string().uuid()).min(1, 'Pick at least one sport'),
  level: levelSchema,
  town: z.string().trim().max(80).optional(),
  birthYear: z.number().int().min(1930).max(2025).optional(),
  gender: z.string().trim().max(40).optional(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const userSportSchema = z.object({
  user_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  level: levelSchema,
});
export type UserSport = z.infer<typeof userSportSchema>;

// --- Matches (brief sections 5-7): one action layer, shared by web, API,
// helper and MCP. Status transitions live in the API action layer, never
// in the database or the UI.
export const MATCH_STATUSES = [
  'open',
  'full',
  'game_on',
  'postponed',
  'cancelled',
  'finished',
] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

export const MATCH_KINDS = ['players', 'team-vs-team'] as const;
export const matchKindSchema = z.enum(MATCH_KINDS);
export type MatchKind = z.infer<typeof matchKindSchema>;

export const VISIBILITIES = ['public', 'private'] as const;
export const visibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof visibilitySchema>;

export const matchSchema = z.object({
  id: z.string().uuid(),
  organiser_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  title: z.string().min(1).max(80),
  starts_at: z.string(),
  venue_id: z.string().uuid().nullable().optional(),
  place_id: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  area: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  capacity: z.number().int().positive(),
  level: levelSchema.nullable().optional(),
  kind: matchKindSchema,
  visibility: visibilitySchema,
  status: matchStatusSchema,
  notes: z.string().nullable().optional(),
  circle_id: z.string().uuid().nullable().optional(),
});
export type Match = z.infer<typeof matchSchema>;

export const participantSchema = z.object({
  match_id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(['joined', 'withdrawn']),
});
export type Participant = z.infer<typeof participantSchema>;

// Action inputs. The same schema validates in the web form, the API and
// the MCP tools, so each rule is written once.
export const createMatchSchema = z.object({
  sportId: z.string().uuid(),
  title: z.string().trim().min(1, 'Title is required').max(80),
  startsAt: z.iso.datetime({ offset: true }),
  venueId: z.string().uuid().optional(),
  placeId: z.string().trim().max(300).optional(),
  venueName: z.string().trim().max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  area: z.string().trim().min(1, 'Area is required').max(80),
  format: z.string().trim().max(40).optional(),
  capacity: z.number().int().min(2).max(100),
  level: levelSchema,
  visibility: visibilitySchema.default('public'),
  notes: z.string().trim().max(500).optional(),
  circleId: z.string().uuid().optional(),
});
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

export const matchIdSchema = z.object({
  matchId: z.string().uuid(),
});
export type MatchIdInput = z.infer<typeof matchIdSchema>;

// --- Venues (brief section 7): listed places to play, picked from the map
// or a listing; a dropped pin on a match is venue_id-less lat/lng. ---
export const venueSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid().nullable().optional(),
  google_place_id: z.string().nullable().optional(),
  name: z.string().min(1).max(80),
  area: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  sports: z.array(z.string()).default([]),
  facility_types: z.array(z.string()).default([]),
  price_note: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  photos: z.array(z.string()).default([]),
});
export type Venue = z.infer<typeof venueSchema>;

export const venueListSchema = z.array(venueSchema);

// Lusaka centre: the map opens here until a venue or pin says otherwise.
export const DEFAULT_MAP_CENTER = { lat: -15.3875, lng: 28.3228 } as const;

// --- Venue system (Amendment 3): profiles, dashboard, free bookings ---
// Every booking and ticket is free in the MVP; there is no price or payment
// field anywhere in these schemas on purpose.
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, 'Venue name is required').max(80),
  area: z.string().trim().min(1, 'Area is required').max(80),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  googlePlaceId: z.string().trim().max(300).optional(),
  sports: z.array(z.string().trim().min(1).max(40)).default([]),
  facilityTypes: z.array(z.string().trim().min(1).max(60)).default([]),
  priceNote: z.string().trim().max(120).default('Free — MVP demo'),
  contact: z.string().trim().max(120).optional(),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

export const venueSlotSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  capacity: z.number().int().positive(),
});
export type VenueSlot = z.infer<typeof venueSlotSchema>;

export const createVenueSlotSchema = z.object({
  venueId: z.string().uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  capacity: z.number().int().min(1).max(50).default(1),
});
export type CreateVenueSlotInput = z.infer<typeof createVenueSlotSchema>;

export const BOOKING_STATUSES = ['requested', 'confirmed', 'declined', 'cancelled'] as const;
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const bookingSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  slot_id: z.string().uuid().nullable().optional(),
  match_id: z.string().uuid().nullable().optional(),
  requester_id: z.string().uuid(),
  requested_starts_at: z.string().nullable().optional(),
  status: bookingStatusSchema,
});
export type Booking = z.infer<typeof bookingSchema>;

export const requestBookingSchema = z
  .object({
    venueId: z.string().uuid(),
    slotId: z.string().uuid().optional(),
    matchId: z.string().uuid().optional(),
    requestedStartsAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => Boolean(v.slotId || v.requestedStartsAt), {
    message: 'Pick a listed slot or request a time.',
  });
export type RequestBookingInput = z.infer<typeof requestBookingSchema>;

export const respondBookingSchema = z.object({
  bookingId: z.string().uuid(),
  decision: z.enum(['confirm', 'decline']),
});
export type RespondBookingInput = z.infer<typeof respondBookingSchema>;

export const bookingIdSchema = z.object({ bookingId: z.string().uuid() });
export type BookingIdInput = z.infer<typeof bookingIdSchema>;

export const TICKET_STATUSES = ['issued', 'used', 'cancelled'] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketSchema = z.object({
  id: z.string().uuid(),
  booking_id: z.string().uuid(),
  user_id: z.string().uuid(),
  code: z.string().min(1),
  status: ticketStatusSchema,
});
export type Ticket = z.infer<typeof ticketSchema>;

export const ticketIdSchema = z.object({ ticketId: z.string().uuid() });
export type TicketIdInput = z.infer<typeof ticketIdSchema>;

// --- Teams + challenges (brief sections 6-7) ---
export const TEAM_CATEGORIES = [
  'corporate',
  'neighbourhood',
  'recreational',
  'competitive',
  'veterans',
  'alumni',
  'social',
  'club',
] as const;
export const teamCategorySchema = z.enum(TEAM_CATEGORIES);
export type TeamCategory = z.infer<typeof teamCategorySchema>;

export const TEAM_CATEGORY_LABELS: Record<TeamCategory, string> = {
  corporate: 'Corporate',
  neighbourhood: 'Neighbourhood',
  recreational: 'Recreational',
  competitive: 'Competitive',
  veterans: 'Veterans',
  alumni: 'Alumni',
  social: 'Social',
  club: 'Club',
};

export const TEAM_ROLES = ['owner', 'captain', 'player'] as const;
export const teamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const teamSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  logo_url: z.string().url().nullable().optional(),
  sport_id: z.string().uuid(),
  category: teamCategorySchema,
  city: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  verified: z.boolean().optional(),
  created_by: z.string().uuid(),
});
export type Team = z.infer<typeof teamSchema>;

export const CHALLENGE_STATUSES = [
  'open',
  'accepted',
  'reschedule_proposed',
  'declined',
  'expired',
] as const;
export const challengeStatusSchema = z.enum(CHALLENGE_STATUSES);
export type ChallengeStatus = z.infer<typeof challengeStatusSchema>;

export const challengeSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  format: z.string().nullable().optional(),
  level: levelSchema.nullable().optional(),
  window_start: z.string(),
  window_end: z.string(),
  area: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  radius_km: z.number().nullable().optional(),
  status: challengeStatusSchema,
  opponent_team_id: z.string().uuid().nullable().optional(),
  proposed_starts_at: z.string().nullable().optional(),
  match_id: z.string().uuid().nullable().optional(),
  created_by: z.string().uuid(),
});
export type Challenge = z.infer<typeof challengeSchema>;

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, 'Team name is required').max(80),
  sportId: z.string().uuid(),
  category: teamCategorySchema.default('recreational'),
  city: z.string().trim().max(80).optional(),
  area: z.string().trim().min(1, 'Area is required').max(80),
  logoUrl: z.string().url().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const postChallengeSchema = z.object({
  teamId: z.string().uuid(),
  format: z.string().trim().max(40).optional(),
  level: levelSchema,
  windowStart: z.iso.datetime({ offset: true }),
  windowEnd: z.iso.datetime({ offset: true }),
  area: z.string().trim().min(1, 'Area is required').max(80),
  radiusKm: z.number().min(1).max(100).default(10),
});
export type PostChallengeInput = z.infer<typeof postChallengeSchema>;

export const challengeIdSchema = z.object({
  challengeId: z.string().uuid(),
});
export type ChallengeIdInput = z.infer<typeof challengeIdSchema>;

export const acceptChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  opponentTeamId: z.string().uuid(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
});
export type AcceptChallengeInput = z.infer<typeof acceptChallengeSchema>;

export const proposeTimeSchema = z.object({
  challengeId: z.string().uuid(),
  opponentTeamId: z.string().uuid(),
  proposedStartsAt: z.iso.datetime({ offset: true }),
});
export type ProposeTimeInput = z.infer<typeof proposeTimeSchema>;

// --- Team availability polls: captains ask "who's in?", members answer. ---
export const pollResponseSchema = z.enum(['in', 'out', 'maybe']);
export type PollResponse = z.infer<typeof pollResponseSchema>;

export const pollSchema = z.object({
  id: z.string().uuid(),
  team_id: z.string().uuid(),
  created_by: z.string().uuid(),
  question: z.string(),
  closes_at: z.string().nullable().optional(),
  status: z.enum(['open', 'closed']),
});
export type Poll = z.infer<typeof pollSchema>;

export const createPollSchema = z.object({
  teamId: z.string().uuid(),
  question: z.string().trim().min(1, 'Question is required').max(200),
  closesAt: z.iso.datetime({ offset: true }).optional(),
});
export type CreatePollInput = z.infer<typeof createPollSchema>;

export const answerPollSchema = z.object({
  pollId: z.string().uuid(),
  response: pollResponseSchema,
});
export type AnswerPollInput = z.infer<typeof answerPollSchema>;

// --- Post-game scores on casual matches (tournaments use post_result). ---
export const reportScoreSchema = z.object({
  matchId: z.string().uuid(),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
});
export type ReportScoreInput = z.infer<typeof reportScoreSchema>;

// Actions a viewer gets on a challenge. Captains/owners act for their team.
export function availableChallengeActions(input: {
  status: ChallengeStatus;
  isPosterTeamMember: boolean;
  isCaptainOrOwner: boolean;
}): string[] {
  if (!input.isCaptainOrOwner) return [];
  if (input.status === 'open') {
    return input.isPosterTeamMember ? [] : ['accept_challenge', 'propose_time', 'decline_challenge'];
  }
  if (input.status === 'reschedule_proposed') {
    return input.isPosterTeamMember ? ['accept_challenge', 'decline_challenge'] : [];
  }
  return [];
}

// --- Tournaments (Day 5 board, brief sections 6-7) ---
// Round robin only. Standings are calculated from finished fixtures, never
// stored by hand: played, won, drawn, lost, GF, GA, GD, points (3 W / 1 D).
export const COMPETITION_STATUSES = ['registration', 'live', 'finished', 'cancelled'] as const;
export const competitionStatusSchema = z.enum(COMPETITION_STATUSES);
export type CompetitionStatus = z.infer<typeof competitionStatusSchema>;

export const COMPETITION_STATUS_LABELS: Record<CompetitionStatus, string> = {
  registration: 'Open for teams',
  live: 'Live',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

export const FIXTURE_STATUSES = ['scheduled', 'finished'] as const;
export const fixtureStatusSchema = z.enum(FIXTURE_STATUSES);
export type FixtureStatus = z.infer<typeof fixtureStatusSchema>;

export const competitionSchema = z.object({
  id: z.string().uuid(),
  organiser_id: z.string().uuid(),
  sport_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  kind: z.literal('tournament'),
  format: z.literal('round_robin'),
  area: z.string().nullable().optional(),
  starts_on: z.string(),
  ends_on: z.string().nullable().optional(),
  max_entries: z.number().int().positive(),
  status: competitionStatusSchema,
  rules: z.string().nullable().optional(),
});
export type Competition = z.infer<typeof competitionSchema>;

export const competitionEntrySchema = z.object({
  competition_id: z.string().uuid(),
  team_id: z.string().uuid(),
  status: z.literal('registered'),
});
export type CompetitionEntry = z.infer<typeof competitionEntrySchema>;

export const fixtureSchema = z.object({
  id: z.string().uuid(),
  competition_id: z.string().uuid(),
  home_team_id: z.string().uuid(),
  away_team_id: z.string().uuid(),
  starts_at: z.string().nullable().optional(),
  venue_id: z.string().uuid().nullable().optional(),
  home_score: z.number().int().nonnegative().nullable().optional(),
  away_score: z.number().int().nonnegative().nullable().optional(),
  status: fixtureStatusSchema,
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const announcementSchema = z.object({
  id: z.string().uuid(),
  competition_id: z.string().uuid(),
  match_id: z.string().uuid().nullable().optional(),
  author_id: z.string().uuid(),
  type: z.string().min(1).max(40),
  text: z.string().min(1).max(500),
});
export type Announcement = z.infer<typeof announcementSchema>;

export const createCompetitionSchema = z.object({
  name: z.string().trim().min(1, 'Tournament name is required').max(80),
  sportId: z.string().uuid(),
  area: z.string().trim().min(1, 'Area is required').max(80),
  startsOn: z.string().min(4, 'Start date is required').max(20),
  endsOn: z.string().max(20).optional(),
  maxEntries: z.number().int().min(2, 'Needs at least 2 teams').max(16),
});
export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;

export const competitionIdSchema = z.object({ competitionId: z.string().uuid() });
export type CompetitionIdInput = z.infer<typeof competitionIdSchema>;

export const registerEntrySchema = z.object({
  competitionId: z.string().uuid(),
  teamId: z.string().uuid(),
});
export type RegisterEntryInput = z.infer<typeof registerEntrySchema>;

export const fixtureIdSchema = z.object({ fixtureId: z.string().uuid() });
export type FixtureIdInput = z.infer<typeof fixtureIdSchema>;

export const postResultSchema = z.object({
  fixtureId: z.string().uuid(),
  homeScore: z.number().int().min(0).max(999),
  awayScore: z.number().int().min(0).max(999),
});
export type PostResultInput = z.infer<typeof postResultSchema>;

export const postAnnouncementSchema = z.object({
  competitionId: z.string().uuid(),
  text: z.string().trim().min(1, 'Announcement text is required').max(500),
  type: z.string().trim().min(1).max(40).default('update'),
});
export type PostAnnouncementInput = z.infer<typeof postAnnouncementSchema>;

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

// Sorted by points, then GD, then GF, then teamId so order is stable.
export function computeStandings(
  teamIds: string[],
  fixtures: Pick<Fixture, 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score' | 'status'>[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const teamId of teamIds) {
    rows.set(teamId, {
      teamId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }
  for (const f of fixtures) {
    if (f.status !== 'finished' || f.home_score == null || f.away_score == null) continue;
    const home = rows.get(f.home_team_id);
    const away = rows.get(f.away_team_id);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.goalsFor += f.home_score;
    home.goalsAgainst += f.away_score;
    away.goalsFor += f.away_score;
    away.goalsAgainst += f.home_score;
    if (f.home_score > f.away_score) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (f.home_score < f.away_score) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.teamId.localeCompare(b.teamId),
  );
}

// Unordered unique pairings for a single round robin; a null is the bye
// slot for odd-sized entry lists.
export function roundRobinPairings(teamIds: string[]): [string, string][] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 === 1) teams.push(null);
  const rounds = teams.length - 1;
  const pairings: [string, string][] = [];
  let current = [...teams];
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < current.length / 2; i += 1) {
      const home = current[i] ?? null;
      const away = current[current.length - 1 - i] ?? null;
      if (home && away) pairings.push([home, away]);
    }
    current = [current[0] as string, current[current.length - 1] as string, ...current.slice(1, -1)];
  }
  return pairings;
}

// --- Circles: interest groups with prerequisites. Events can sit in a
// circle so subscribers hear about them. Empty prerequisite lists = open. ---
export const circleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  sport_id: z.string().uuid().nullable().optional(),
  area: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  age_bands: z.array(z.string()).default([]),
  genders: z.array(z.string()).default([]),
  levels: z.array(levelSchema).default([]),
  created_by: z.string().uuid(),
});
export type Circle = z.infer<typeof circleSchema>;

export const createCircleSchema = z.object({
  name: z.string().trim().min(1, 'Circle name is required').max(80),
  sportId: z.string().uuid().optional(),
  area: z.string().trim().min(1, 'Area is required').max(80),
  description: z.string().trim().max(500).optional(),
  ageBands: z.array(z.string().trim().min(1).max(20)).max(5).default([]),
  genders: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  levels: z.array(levelSchema).max(3).default([]),
});
export type CreateCircleInput = z.infer<typeof createCircleSchema>;

export const circleIdSchema = z.object({ circleId: z.string().uuid() });
export type CircleIdInput = z.infer<typeof circleIdSchema>;

// Returns null when eligible, else the plain reason for the join refusal.
export function circleEligibility(input: {
  birthYear: number | null | undefined;
  gender: string | null | undefined;
  ageBands: string[];
  genders: string[];
}): string | null {
  if (input.ageBands.length > 0) {
    const band = ageBand(input.birthYear);
    if (!band) return 'Add your year of birth to join this circle.';
    if (!input.ageBands.includes(band)) return `This circle is for ${input.ageBands.join(', ')}.`;
  }
  if (input.genders.length > 0) {
    if (!input.gender) return 'Add your gender to join this circle.';
    // Self-described free text vs circle wording: treat common variants as
    // the same group (woman/women/female, man/men/male).
    const norm = (g: string) => {
      const v = g.trim().toLowerCase();
      if (v === 'woman' || v === 'women' || v === 'female') return 'women';
      if (v === 'man' || v === 'men' || v === 'male') return 'men';
      return v;
    };
    const wanted = input.genders.map(norm);
    if (!wanted.includes(norm(input.gender))) {
      return `This circle is for ${input.genders.join(', ')}.`;
    }
  }
  return null;
}

// A venue hosts only what its courts support: its declared sports list is
// the capability, matched loosely (case-insensitive) everywhere.
export function venueSupportsSport(venueSports: string[], sportName: string): boolean {
  const wanted = sportName.trim().toLowerCase();
  return venueSports.some((s) => s.trim().toLowerCase() === wanted);
}

// Calendar export (user decision: ICS + Google link first, no OAuth sync).
// Pure helpers so web, API and MCP produce identical output.
export function buildIcs(input: {
  id: string;
  title: string;
  startsAt: string;
  location?: string | null;
  description?: string | null;
}): string {
  const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(new Date(input.startsAt).getTime() + 2 * 3600 * 1000);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chabuka//Game//EN',
    'BEGIN:VEVENT',
    `UID:${input.id}@chabuka`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(input.startsAt)}`,
    `DTEND:${dt(end.toISOString())}`,
    `SUMMARY:${esc(input.title)}`,
    input.location ? `LOCATION:${esc(input.location)}` : '',
    input.description ? `DESCRIPTION:${esc(input.description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

export function googleCalendarUrl(input: {
  title: string;
  startsAt: string;
  location?: string | null;
  details?: string | null;
}): string {
  const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(new Date(input.startsAt).getTime() + 2 * 3600 * 1000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${dt(input.startsAt)}/${dt(end.toISOString())}`,
    ...(input.location ? { location: input.location } : {}),
    ...(input.details ? { details: input.details } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Action names. The API contract returns the new state plus the
// actions now available, e.g. { state: 'joined', actions: ['withdraw'] },
// and the web renders its buttons straight from that list.
export const ACTION_NAMES = [
  'create_match',
  'join_match',
  'withdraw_match',
  'create_team',
  'post_challenge',
  'accept_challenge',
  'decline_challenge',
  'propose_time',
  'create_venue',
  'create_venue_slot',
  'request_booking',
  'respond_booking',
  'cancel_booking',
  'check_in_ticket',
  'create_competition',
  'register_entry',
  'close_registration',
  'post_result',
  'report_score',
  'create_poll',
  'answer_poll',
  'post_announcement',
  'follow_competition',
  'create_circle',
  'join_circle',
  'leave_circle',
] as const;
export const actionNameSchema = z.enum(ACTION_NAMES);
export type ActionName = z.infer<typeof actionNameSchema>;

export const CTA_LABELS: Record<string, string> = {
  join: 'Join',
  withdraw: 'Withdraw',
  directions: 'Directions',
  accept_challenge: 'Accept',
  decline_challenge: 'Decline',
  propose_time: 'Propose another time',
  request_booking: 'Book free',
  confirm_booking: 'Confirm',
  decline_booking: 'Decline',
  cancel_booking: 'Cancel booking',
  check_in_ticket: 'Check in',
  create_competition: 'Create tournament',
  register_entry: 'Enter team',
  close_registration: 'Start tournament',
  post_result: 'Post result',
  post_announcement: 'Announce',
  follow_competition: 'Follow',
};

export const actionResultSchema = z.object({
  state: z.string(),
  actions: z.array(z.string()),
  joinedCount: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

// Available actions for a match, given the viewer's relationship to it.
// The API returns this on every action; Day 2 covers join/withdraw only.
export function availableActions(input: {
  status: MatchStatus;
  isOrganiser: boolean;
  isParticipant: boolean;
  joinedCount: number;
  capacity: number;
}): string[] {
  if (input.status !== 'open' && input.status !== 'full') return [];
  const isFull = input.joinedCount >= input.capacity;
  if (input.isParticipant) return ['withdraw', 'directions'];
  if (input.isOrganiser) return ['directions'];
  if (!isFull) return ['join'];
  return [];
}
