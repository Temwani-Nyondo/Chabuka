import { z } from 'zod';

// --- Competitions v2: formats, categories, events, registration, results,
// recurring game series (Phase 3). Pure logic here; the API applies it.

export const COMPETITION_FORMATS = ['round_robin', 'double_round_robin', 'knockout', 'groups_knockout'] as const;
export type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];
export const FORMAT_LABELS: Record<CompetitionFormat, string> = {
  round_robin: 'League',
  double_round_robin: 'League, home and away',
  knockout: 'Knockout',
  groups_knockout: 'Groups, then knockout',
};
export const FORMAT_HELP: Record<CompetitionFormat, string> = {
  round_robin: 'Every team plays every other team once. Most points wins.',
  double_round_robin: 'Every team plays every other team twice, home and away.',
  knockout: 'Lose and you are out. Winners go through until the final.',
  groups_knockout: 'Teams play in small groups first; the top teams go into a knockout.',
};

/** Label for any competition format, including 'race' (a race event has no team format). */
export function formatLabel(format: string): string {
  return format === 'race' ? 'Race' : (FORMAT_LABELS[format as CompetitionFormat] ?? format);
}

export const COMPETITION_CATEGORIES = ['community', 'competitive', 'charity', 'corporate', 'school', 'social'] as const;
export type CompetitionCategory = (typeof COMPETITION_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<CompetitionCategory, string> = {
  community: 'Community',
  competitive: 'Competitive',
  charity: 'Charity',
  corporate: 'Corporate',
  school: 'School',
  social: 'Social',
};

export const ENTRY_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const FIXTURE_STAGES = ['league', 'group', 'knockout'] as const;
export type FixtureStage = (typeof FIXTURE_STAGES)[number];

export const SPONSOR_TIERS = ['title', 'gold', 'partner', 'supporter'] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];
export const SPONSOR_TIER_LABELS: Record<SponsorTier, string> = {
  title: 'Title sponsor',
  gold: 'Gold sponsors',
  partner: 'Partners',
  supporter: 'Supporters',
};

// --- Schedules ------------------------------------------------------------------

export interface Pairing {
  round: number;
  leg: number;
  home: string;
  away: string;
}

// Circle method. Every team meets every other once per leg; the second leg
// swaps home and away. Odd team counts get a bye each round (no fixture).
export function leagueRounds(teamIds: string[], legs: 1 | 2 = 1): Pairing[] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.length % 2 === 1) teams.push(null);
  const n = teams.length;
  const roundsPerLeg = n - 1;
  const out: Pairing[] = [];
  let current = [...teams];
  for (let r = 0; r < roundsPerLeg; r += 1) {
    for (let i = 0; i < n / 2; i += 1) {
      const a = current[i] ?? null;
      const b = current[n - 1 - i] ?? null;
      if (!a || !b) continue;
      // Balanced home and away: the fixed team alternates by round, the
      // rotating pairs alternate by position.
      const flip = i === 0 ? r % 2 === 1 : i % 2 === 1;
      out.push({ round: r + 1, leg: 1, home: flip ? b : a, away: flip ? a : b });
    }
    current = [current[0] ?? null, current[n - 1] ?? null, ...current.slice(1, -1)];
  }
  if (legs === 2) {
    const first = out.slice();
    for (const p of first) out.push({ round: p.round + roundsPerLeg, leg: 2, home: p.away, away: p.home });
  }
  return out;
}

// Snake draw by seed order: A B C C B A A B C …
export function groupDraw(teamIds: string[], groupCount: number): Map<string, string[]> {
  const count = Math.max(1, Math.min(groupCount, Math.floor(teamIds.length / 2) || 1));
  const labels = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  const groups = new Map<string, string[]>(labels.map((l) => [l, []]));
  teamIds.forEach((t, i) => {
    const lap = Math.floor(i / count);
    const pos = i % count;
    const label = labels[lap % 2 === 0 ? pos : count - 1 - pos] as string;
    groups.get(label)?.push(t);
  });
  return groups;
}

export interface BracketSlot {
  /** 1-based position in its round. */
  slot: number;
  round: number;
  home: string | null;
  away: string | null;
}

export function bracketSize(teams: number): number {
  let size = 2;
  while (size < teams) size *= 2;
  return size;
}

// Standard seeding order for a bracket of `size`: 1 v size, then the halves
// keep the top seeds apart until the final.
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

// First-round slots from a seed list (best first). Missing opponents are byes:
// a team facing a bye goes straight through.
export function knockoutBracket(seeds: string[]): { rounds: number; first: BracketSlot[] } {
  const size = bracketSize(Math.max(2, seeds.length));
  const order = seedOrder(size);
  const first: BracketSlot[] = [];
  for (let i = 0; i < size; i += 2) {
    first.push({
      slot: i / 2 + 1,
      round: 1,
      home: seeds[(order[i] as number) - 1] ?? null,
      away: seeds[(order[i + 1] as number) - 1] ?? null,
    });
  }
  return { rounds: Math.log2(size), first };
}

// Where a slot's winner goes next: slot 1 and 2 feed slot 1 of the next round
// (home and away), 3 and 4 feed slot 2, and so on.
export function nextSlot(slot: number): { slot: number; side: 'home' | 'away' } {
  return { slot: Math.ceil(slot / 2), side: slot % 2 === 1 ? 'home' : 'away' };
}

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

// Group winners meet other groups' runners-up: A1 v B2, B1 v A2, C1 v D2 …
// Returned as a seed list for knockoutBracket.
export function qualifiersToSeeds(groups: Map<string, string[]>, advance: number): string[] {
  const labels = [...groups.keys()].sort();
  const seeds: string[] = [];
  // Seeds run A1 B1 C1 … then A2 B2 C2 …; standard seeding then pairs each
  // group winner with a runner-up from another group.
  for (let place = 0; place < advance; place += 1) {
    for (const label of labels) {
      const team = groups.get(label)?.[place];
      if (team) seeds.push(team);
    }
  }
  return seeds;
}

// --- Standings --------------------------------------------------------------------

export interface ScoredFixture {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score?: number | null;
  away_score?: number | null;
  status: string;
}

export interface TableRow {
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

export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

const played = (f: ScoredFixture): f is ScoredFixture & { home_team_id: string; away_team_id: string; home_score: number; away_score: number } =>
  f.status === 'finished' && !!f.home_team_id && !!f.away_team_id && f.home_score != null && f.away_score != null;

// Points, then goal difference, then goals scored, then head to head between
// the tied teams, then name order so the table never jumps about.
export function leagueTable(teamIds: string[], fixtures: ScoredFixture[], points: PointsRule = { win: 3, draw: 1, loss: 0 }): TableRow[] {
  const rows = new Map<string, TableRow>(
    teamIds.map((teamId) => [teamId, { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 }]),
  );
  for (const f of fixtures) {
    if (!played(f)) continue;
    const h = rows.get(f.home_team_id);
    const a = rows.get(f.away_team_id);
    if (!h || !a) continue;
    h.played += 1;
    a.played += 1;
    h.goalsFor += f.home_score;
    h.goalsAgainst += f.away_score;
    a.goalsFor += f.away_score;
    a.goalsAgainst += f.home_score;
    if (f.home_score > f.away_score) {
      h.won += 1;
      a.lost += 1;
      h.points += points.win;
      a.points += points.loss;
    } else if (f.home_score < f.away_score) {
      a.won += 1;
      h.lost += 1;
      a.points += points.win;
      h.points += points.loss;
    } else {
      h.drawn += 1;
      a.drawn += 1;
      h.points += points.draw;
      a.points += points.draw;
    }
  }
  for (const r of rows.values()) r.goalDifference = r.goalsFor - r.goalsAgainst;
  const headToHead = (x: string, y: string): number => {
    let px = 0;
    let py = 0;
    for (const f of fixtures) {
      if (!played(f)) continue;
      const pair = new Set([f.home_team_id, f.away_team_id]);
      if (!pair.has(x) || !pair.has(y)) continue;
      const xs = f.home_team_id === x ? f.home_score : f.away_score;
      const ys = f.home_team_id === y ? f.home_score : f.away_score;
      if (xs > ys) px += points.win;
      else if (xs < ys) py += points.win;
      else {
        px += points.draw;
        py += points.draw;
      }
    }
    return py - px;
  };
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      headToHead(a.teamId, b.teamId) ||
      a.teamId.localeCompare(b.teamId),
  );
}

// Who goes through from a knockout tie: the score, or the shoot-out winner
// recorded when it ends level.
export function knockoutWinner(fixture: ScoredFixture & { winner_team_id?: string | null }): string | null {
  const w = fixture.winner_team_id ?? null;
  const f = fixture;
  if (!played(f)) return null;
  if (f.home_score > f.away_score) return f.home_team_id;
  if (f.away_score > f.home_score) return f.away_team_id;
  return w && (w === f.home_team_id || w === f.away_team_id) ? w : null;
}

// --- Recurring game series -----------------------------------------------------------
// Lusaka is UTC+2 all year (no daylight saving), so local wall time maps to a
// fixed UTC offset.
export const SERIES_TZ_OFFSET_MINUTES = 120;

export interface SeriesRule {
  weekday: number; // 0 Sunday … 6 Saturday, local
  time: string; // "HH:MM" local
  intervalWeeks: 1 | 2;
  /** First game (local date, YYYY-MM-DD). Fortnightly series count from it. */
  startsOn: string;
  until?: string | null;
}

// The next `count` game times (ISO, UTC) strictly after `from`.
export function nextSeriesDates(rule: SeriesRule, from: Date, count: number): string[] {
  const [hh, mm] = rule.time.split(':').map(Number) as [number, number];
  const offset = SERIES_TZ_OFFSET_MINUTES * 60_000;
  const start = new Date(`${rule.startsOn}T00:00:00Z`);
  // First occurrence on/after startsOn with the right weekday.
  const first = new Date(start);
  while (first.getUTCDay() !== rule.weekday) first.setUTCDate(first.getUTCDate() + 1);
  const until = rule.until ? new Date(`${rule.until}T23:59:59Z`).getTime() - offset : Infinity;
  const out: string[] = [];
  const cursor = new Date(first);
  for (let guard = 0; guard < 520 && out.length < count; guard += 1) {
    const at = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hh, mm) - offset;
    if (at > until) break;
    if (at > from.getTime()) out.push(new Date(at).toISOString());
    cursor.setUTCDate(cursor.getUTCDate() + 7 * rule.intervalWeeks);
  }
  return out;
}

// --- Inputs ------------------------------------------------------------------------

const uuid = z.string().uuid();
const url = z.string().trim().url().max(2000);
const optText = (max: number) => z.string().trim().max(max).optional();

export const registrationQuestionSchema = z.object({
  label: z.string().trim().min(1, 'Each question needs a label').max(120),
  required: z.boolean().default(false),
});
export type RegistrationQuestion = z.infer<typeof registrationQuestionSchema>;

export const competitionDetails = {
  description: optText(4000),
  bannerUrl: url.nullable().optional(),
  location: optText(160),
  venueId: uuid.nullable().optional(),
  hostName: optText(120),
  hostLogoUrl: url.nullable().optional(),
  hostContact: optText(160),
  hostWebsite: url.nullable().optional(),
  causeName: optText(120),
  causeDescription: optText(2000),
  causeUrl: url.nullable().optional(),
  fundraisingNote: optText(300),
  entryFeeNote: optText(160),
  registrationClosesAt: z.iso.datetime({ offset: true }).nullable().optional(),
  requiresApproval: z.boolean().optional(),
  teamSizeMin: z.number().int().min(1).max(60).nullable().optional(),
  teamSizeMax: z.number().int().min(1).max(60).nullable().optional(),
  registrationQuestions: z.array(registrationQuestionSchema).max(12).optional(),
};

export const createCompetitionV2Schema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    sportId: uuid,
    kind: z.enum(['tournament', 'league']).default('tournament'),
    format: z.enum(COMPETITION_FORMATS).default('round_robin'),
    category: z.enum(COMPETITION_CATEGORIES).default('community'),
    area: z.string().trim().min(1, 'Area is required').max(80),
    startsOn: z.string().min(4, 'Start date is required').max(20),
    endsOn: z.string().max(20).optional(),
    maxEntries: z.number().int().min(2, 'Needs at least 2 teams').max(64),
    groupCount: z.number().int().min(2).max(8).optional(),
    advancePerGroup: z.number().int().min(1).max(4).optional(),
    pointsWin: z.number().int().min(0).max(10).optional(),
    pointsDraw: z.number().int().min(0).max(10).optional(),
    pointsLoss: z.number().int().min(0).max(10).optional(),
    ...competitionDetails,
  })
  .refine((v) => v.format !== 'groups_knockout' || (v.groupCount ?? 0) >= 2, { message: 'Pick how many groups', path: ['groupCount'] })
  .refine((v) => !v.teamSizeMin || !v.teamSizeMax || v.teamSizeMin <= v.teamSizeMax, { message: 'Smallest squad is bigger than the largest', path: ['teamSizeMin'] });
export type CreateCompetitionV2Input = z.infer<typeof createCompetitionV2Schema>;

export const updateCompetitionSchema = z.object({
  competitionId: uuid,
  name: z.string().trim().min(1).max(80).optional(),
  area: z.string().trim().min(1).max(80).optional(),
  startsOn: z.string().min(4).max(20).optional(),
  endsOn: z.string().max(20).nullable().optional(),
  category: z.enum(COMPETITION_CATEGORIES).optional(),
  maxEntries: z.number().int().min(2).max(64).optional(),
  ...competitionDetails,
});
export type UpdateCompetitionInput = z.infer<typeof updateCompetitionSchema>;

export const sponsorInputSchema = z.object({
  competitionId: uuid,
  sponsorId: uuid.optional(),
  name: z.string().trim().min(1, 'Sponsor name is required').max(120),
  logoUrl: url.nullable().optional(),
  url: url.nullable().optional(),
  tier: z.enum(SPONSOR_TIERS).default('partner'),
});
export type SponsorInput = z.infer<typeof sponsorInputSchema>;
export const removeSponsorSchema = z.object({ competitionId: uuid, sponsorId: uuid });

export const registerTeamSchema = z.object({
  competitionId: uuid,
  teamId: uuid,
  contactName: z.string().trim().min(1, 'Who should the organiser contact?').max(120),
  contactPhone: z.string().trim().min(6, 'Add a phone number the organiser can reach').max(30),
  squadSize: z.number().int().min(1).max(60).optional(),
  answers: z.array(z.object({ label: z.string().max(120), answer: z.string().trim().max(1000) })).max(12).default([]),
  note: optText(500),
  acceptRules: z.literal(true, { message: 'Accept the rules to enter' }),
});
export type RegisterTeamInput = z.infer<typeof registerTeamSchema>;

export const reviewEntrySchema = z.object({ competitionId: uuid, teamId: uuid, decision: z.enum(['approve', 'reject']), note: optText(300) });
export const withdrawEntrySchema = z.object({ competitionId: uuid, teamId: uuid });

export const scheduleFixtureSchema = z.object({
  fixtureId: uuid,
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  venueId: uuid.nullable().optional(),
  venueName: optText(160),
  status: z.enum(['scheduled', 'postponed', 'cancelled']).optional(),
});
export type ScheduleFixtureInput = z.infer<typeof scheduleFixtureSchema>;

export const reportResultSchema = z.object({
  fixtureId: uuid,
  homeScore: z.number().int().min(0).max(999),
  awayScore: z.number().int().min(0).max(999),
  /** Knockout tie that ends level: who won the shoot-out. */
  winnerTeamId: uuid.optional(),
});
export type ReportResultInput = z.infer<typeof reportResultSchema>;

export const createSeriesSchema = z.object({
  sportId: uuid,
  title: z.string().trim().min(1, 'Title is required').max(80),
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time'),
  intervalWeeks: z.union([z.literal(1), z.literal(2)]).default(1),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  area: z.string().trim().min(1, 'Area is required').max(80),
  venueId: uuid.optional(),
  venueName: optText(120),
  placeId: optText(300),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  format: optText(40),
  capacity: z.number().int().min(2).max(100),
  level: z.enum(['recreational', 'intermediate', 'competitive']),
  notes: optText(500),
  visibility: z.enum(['public', 'private']).default('public'),
  circleId: uuid.optional(),
});
export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;
export const seriesIdSchema = z.object({ seriesId: uuid });
export const skipOccurrenceSchema = z.object({ matchId: uuid, reason: optText(200) });
