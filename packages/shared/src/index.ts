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
});
export type Profile = z.infer<typeof profileSchema>;

// Day 1 onboarding: name, photo (optional), area, sports + one level for all.
export const onboardingSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  area: z.string().trim().min(1, 'Area is required').max(80),
  photoUrl: z.string().url().optional(),
  sportIds: z.array(z.string().uuid()).min(1, 'Pick at least one sport'),
  level: levelSchema,
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
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  area: z.string().trim().min(1, 'Area is required').max(80),
  format: z.string().trim().max(40).optional(),
  capacity: z.number().int().min(2).max(100),
  level: levelSchema,
  visibility: visibilitySchema.default('public'),
  notes: z.string().trim().max(500).optional(),
});
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

export const matchIdSchema = z.object({
  matchId: z.string().uuid(),
});
export type MatchIdInput = z.infer<typeof matchIdSchema>;

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
