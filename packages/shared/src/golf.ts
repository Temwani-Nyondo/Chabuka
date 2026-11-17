import { z } from 'zod';
import { COMPETITION_CATEGORIES, competitionDetails } from './competitions.js';

// Golf (G1): course cards and the scoring maths every later part uses (tee sheet, golf days, scorecards, records).
// Pure, so the API and the app compute the same leaderboard.
//
// Handicaps: a player gives their handicap index; the playing handicap is index x allowance (e.g. 95% for stroke play),
// rounded. Strokes are handed out by stroke index: a 14 handicap gets one stroke on stroke-index holes 1-14; a 22 gets one
// everywhere plus a second on 1-4. A plus handicap (written -2) gives strokes back on the easiest holes (index 18, 17).

export const GOLF_SPORT = 'golf';

export const golfHoleSchema = z.object({
  holeNo: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  strokeIndex: z.number().int().min(1).max(18),
  yards: z.number().int().min(50).max(800).nullable().optional(),
});
export type GolfHole = z.infer<typeof golfHoleSchema>;

export const golfCourseInputSchema = z
  .object({
    courseId: z.string().uuid().optional(),
    venueId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(2).max(80),
    holes: z.union([z.literal(9), z.literal(18)]),
    teeSet: z.string().trim().max(30).nullable().optional(),
    card: z.array(golfHoleSchema),
  })
  .superRefine((c, ctx) => {
    const problem = courseCardProblem(c.holes, c.card);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['card'] });
  });
export type GolfCourseInput = z.infer<typeof golfCourseInputSchema>;

/** Pure: why a card is not a valid course (holes 1..n once each, stroke indexes 1..n once each), or null. */
export function courseCardProblem(holes: 9 | 18, card: GolfHole[]): string | null {
  if (card.length !== holes) return `Fill in all ${holes} holes.`;
  const nos = new Set(card.map((h) => h.holeNo));
  if (nos.size !== holes || [...nos].some((n) => n < 1 || n > holes)) return `Number the holes 1 to ${holes}, once each.`;
  const sis = new Set(card.map((h) => h.strokeIndex));
  if (sis.size !== holes || [...sis].some((n) => n < 1 || n > holes)) return `Use each stroke index from 1 to ${holes} once (1 is the hardest hole).`;
  return null;
}

/** A starting card: every hole a par 4 with stroke index in hole order, for the owner to edit. */
export function blankCard(holes: 9 | 18): GolfHole[] {
  return Array.from({ length: holes }, (_, i) => ({ holeNo: i + 1, par: 4, strokeIndex: i + 1, yards: null }));
}

export const coursePar = (card: GolfHole[]) => card.reduce((n, h) => n + h.par, 0);

// --- Handicaps -------------------------------------------------------------------------------------

export const handicapIndexSchema = z.number().min(-10).max(54);

/** Playing handicap: index x allowance %, rounded (a 9-hole round uses half the index). */
export function playingHandicap(index: number, allowancePct = 100, holes: 9 | 18 = 18): number {
  const base = holes === 9 ? index / 2 : index;
  return Math.round((base * allowancePct) / 100);
}

/** Strokes a player receives on a hole (negative for a plus handicap giving strokes back). */
export function strokesReceived(strokeIndex: number, playingHcp: number, holes: 9 | 18 = 18): number {
  if (playingHcp >= 0) {
    return Math.floor(playingHcp / holes) + (strokeIndex <= playingHcp % holes ? 1 : 0);
  }
  // Plus handicap: strokes go back on the easiest holes first (highest stroke index).
  const back = -playingHcp;
  const given = Math.floor(back / holes) + (strokeIndex > holes - (back % holes) ? 1 : 0);
  return given === 0 ? 0 : -given;
}

/** Stableford points on one hole: 2 for a net par, one more per stroke under, none from net double bogey. A pick-up (null) scores 0. */
export function stablefordPoints(par: number, gross: number | null, received: number): number {
  if (gross == null) return 0;
  return Math.max(0, 2 + par + received - gross);
}

// --- A round ---------------------------------------------------------------------------------------

export type GolfScoring = 'stroke' | 'stableford';

/** Strokes per hole; null = picked up (Stableford) or not played yet (missing key). */
export type HoleScores = Record<number, number | null>;

export interface RoundTotals {
  /** Holes with a score entered (a pick-up counts as played). */
  thru: number;
  gross: number | null;
  net: number | null;
  points: number;
  /** Per hole, for the scorecard and countback. */
  perHole: { holeNo: number; par: number; gross: number | null; received: number; net: number | null; points: number; played: boolean }[];
  /** Relative to par over the holes played (gross), e.g. -2 or +5. */
  toPar: number | null;
}

export function roundTotals(card: GolfHole[], scores: HoleScores, playingHcp: number): RoundTotals {
  const holes = card.length === 9 ? 9 : 18;
  const perHole = [...card]
    .sort((a, b) => a.holeNo - b.holeNo)
    .map((h) => {
      const played = Object.prototype.hasOwnProperty.call(scores, h.holeNo);
      const gross = played ? (scores[h.holeNo] ?? null) : null;
      const received = strokesReceived(h.strokeIndex, playingHcp, holes);
      return { holeNo: h.holeNo, par: h.par, gross, received, net: gross == null ? null : gross - received, points: played ? stablefordPoints(h.par, gross, received) : 0, played };
    });
  const played = perHole.filter((h) => h.played);
  const pickedUp = played.some((h) => h.gross == null);
  const gross = played.length && !pickedUp ? played.reduce((n, h) => n + (h.gross ?? 0), 0) : null;
  const net = gross == null ? null : played.reduce((n, h) => n + (h.net ?? 0), 0);
  const parPlayed = played.reduce((n, h) => n + h.par, 0);
  return {
    thru: played.length,
    gross,
    net,
    points: perHole.reduce((n, h) => n + h.points, 0),
    perHole,
    toPar: gross == null ? null : gross - parPlayed,
  };
}

/**
 * Countback on a tie: the last 9, then last 6, last 3 and the last hole (net strokes for stroke play, points for
 * Stableford; on a 9-hole card the last 4.5 rounds down to 4, then 2, 1). Negative = a is better.
 */
export function countback(a: RoundTotals, b: RoundTotals, scoring: GolfScoring): number {
  const n = a.perHole.length;
  const spans = n === 9 ? [4, 2, 1] : [9, 6, 3, 1];
  for (const span of spans) {
    const pick = (r: RoundTotals) => r.perHole.slice(n - span);
    if (scoring === 'stableford') {
      const d = pick(b).reduce((s, h) => s + h.points, 0) - pick(a).reduce((s, h) => s + h.points, 0);
      if (d !== 0) return d;
    } else {
      const sum = (r: RoundTotals) => pick(r).reduce((s, h) => s + (h.net ?? 99), 0);
      const d = sum(a) - sum(b);
      if (d !== 0) return d;
    }
  }
  return 0;
}

export interface LeaderboardInput {
  id: string;
  name: string;
  playingHcp: number;
  scores: HoleScores;
}

export interface LeaderboardRow extends LeaderboardInput {
  totals: RoundTotals;
  position: number | null;
  /** "T3" when tied after countback is exhausted. */
  positionLabel: string;
}

/**
 * Order a field: Stableford by points (most first); stroke play by net, or gross when `by` is gross. Players with no
 * holes yet go last. Ties go to countback once everyone in the tie has finished.
 */
export function golfLeaderboard(card: GolfHole[], field: LeaderboardInput[], scoring: GolfScoring, by: 'net' | 'gross' = 'net'): LeaderboardRow[] {
  const rows = field.map((p) => ({ ...p, totals: roundTotals(card, p.scores, p.playingHcp), position: null as number | null, positionLabel: '' }));
  const holes = card.length;
  const key = (r: (typeof rows)[number]): number => {
    if (r.totals.thru === 0) return Number.POSITIVE_INFINITY;
    if (scoring === 'stableford') return -r.totals.points;
    const v = by === 'gross' ? r.totals.gross : r.totals.net;
    // Stroke play mid-round: compare to par so far, so someone through 9 isn't ahead of someone through 18.
    if (v == null) return Number.MAX_SAFE_INTEGER;
    const parSoFar = r.totals.perHole.filter((h) => h.played).reduce((n, h) => n + h.par, 0);
    return v - parSoFar;
  };
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.totals.thru === holes && b.totals.thru === holes) return countback(a.totals, b.totals, scoring);
    return 0;
  });
  let pos = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.totals.thru === 0) {
      r.position = null;
      r.positionLabel = '';
      continue;
    }
    const prev = rows[i - 1];
    const tied = prev && prev.totals.thru > 0 && key(prev) === key(r) && !(prev.totals.thru === holes && r.totals.thru === holes && countback(prev.totals, r.totals, scoring) !== 0);
    if (!tied) pos = i + 1;
    r.position = pos;
  }
  for (const r of rows) {
    if (r.position == null) continue;
    const same = rows.filter((x) => x.position === r.position).length;
    r.positionLabel = same > 1 ? `T${r.position}` : String(r.position);
  }
  return rows;
}

// --- Golf days (G3) --------------------------------------------------------------------------------
// A golf day is a competition (kind 'golf_day'): individual entries with a handicap index, paid through a WaitApp
// ticket when there is a fee (like a race), players grouped into flights of up to four that tee off at set times or
// all at once from different holes (a shotgun start), scored hole by hole (G4).


const golfUuid = z.string().uuid();

export const SIDE_CONTESTS = ['longest_drive', 'nearest_pin'] as const;
export type SideContest = (typeof SIDE_CONTESTS)[number];
export const SIDE_CONTEST_LABELS: Record<SideContest, string> = { longest_drive: 'Longest drive', nearest_pin: 'Nearest the pin' };

export const golfDaySettingsSchema = z.object({
  courseId: golfUuid,
  scoring: z.enum(['stroke', 'stableford']).default('stableford'),
  /** Handicap allowance, % of the playing handicap (95 for individual stroke play, 100 for Stableford is common). */
  allowancePct: z.number().int().min(0).max(100).default(100),
  startType: z.enum(['tee_times', 'shotgun']).default('tee_times'),
  /** First tee time (or the shotgun start), ISO. */
  firstTeeAt: z.iso.datetime({ offset: true }),
  intervalMin: z.number().int().min(6).max(20).default(10),
  /** Entry fee per player; 0 = free. Paid entry goes through WaitApp tickets. */
  entryFee: z.number().min(0).max(1_000_000).default(0),
  currency: z.string().trim().length(3).default('ZMW'),
  fieldLimit: z.number().int().min(2).max(288).default(72),
  /** Highest handicap index accepted (54 is the maximum). */
  maxHandicap: z.number().min(0).max(54).default(54),
  sideContests: z.array(z.object({ type: z.enum(SIDE_CONTESTS), hole: z.number().int().min(1).max(18) })).max(8).default([]),
});
export type GolfDaySettings = z.infer<typeof golfDaySettingsSchema>;

export const createGolfDaySchema = z.object({
  name: z.string().trim().min(1, 'Name the golf day').max(80),
  category: z.enum(COMPETITION_CATEGORIES).default('community'),
  area: z.string().trim().min(1, 'Area is required').max(80),
  settings: golfDaySettingsSchema,
  ...competitionDetails,
});
export type CreateGolfDayInput = z.infer<typeof createGolfDaySchema>;

export const updateGolfDaySettingsSchema = z.object({ competitionId: golfUuid, settings: golfDaySettingsSchema });

export const enterGolfDaySchema = z.object({
  competitionId: golfUuid,
  playerName: z.string().trim().min(2, 'Name the player').max(80),
  handicapIndex: handicapIndexSchema,
  phone: z.string().trim().min(6, 'Add a phone number for the organiser').max(30),
});
export type EnterGolfDayInput = z.infer<typeof enterGolfDaySchema>;

export const golfEntryIdSchema = z.object({ entryId: golfUuid });

export const buildFlightsSchema = z.object({
  competitionId: golfUuid,
  /** auto: grouped by handicap; manual: exactly these groups (entry ids), in tee order. */
  mode: z.enum(['auto', 'manual']).default('auto'),
  groups: z.array(z.array(golfUuid).min(1).max(4)).max(80).optional(),
  notify: z.boolean().default(true),
});

/** Pure: split n players into groups of 3-4 (never a single or a pair when it can be avoided). */
export function flightSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 4) return [n];
  const groups = Math.ceil(n / 4);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface FlightPlan {
  label: string;
  teeTime: string | null;
  startHole: number | null;
  entryIds: string[];
}

/**
 * Pure: flights from groups of entry ids. Tee times: the first group at `firstTeeAt`, then every interval. Shotgun:
 * group 1 starts on hole 1, group 2 on hole 2..., and once every hole has a group, a second group per hole ("1B").
 */
export function planFlights(groups: string[][], s: Pick<GolfDaySettings, 'startType' | 'firstTeeAt' | 'intervalMin'>, holes: 9 | 18): FlightPlan[] {
  return groups.map((entryIds, i) => {
    if (s.startType === 'shotgun') {
      const hole = (i % holes) + 1;
      const wave = Math.floor(i / holes);
      return { label: `Hole ${hole}${wave ? String.fromCharCode(65 + wave) : ''}`, teeTime: s.firstTeeAt, startHole: hole, entryIds };
    }
    const at = new Date(new Date(s.firstTeeAt).getTime() + i * s.intervalMin * 60_000).toISOString();
    return { label: `Group ${i + 1}`, teeTime: at, startHole: 1, entryIds };
  });
}

/** Pure: groups by handicap (lowest first), sized by flightSizes. */
export function autoGroups(entries: { id: string; handicapIndex: number }[]): string[][] {
  const sorted = [...entries].sort((a, b) => a.handicapIndex - b.handicapIndex || a.id.localeCompare(b.id));
  const out: string[][] = [];
  let i = 0;
  for (const size of flightSizes(sorted.length)) {
    out.push(sorted.slice(i, i + size).map((e) => e.id));
    i += size;
  }
  return out;
}

// --- Scoring (G4) ----------------------------------------------------------------------------------

export const saveGolfScoresSchema = z.object({
  competitionId: golfUuid,
  /** Scores for one or more players of a flight on one or more holes. strokes null = picked up. */
  scores: z
    .array(z.object({ entryId: golfUuid, holeNo: z.number().int().min(1).max(18), strokes: z.number().int().min(1).max(20).nullable() }))
    .min(1)
    .max(80),
});
export type SaveGolfScoresInput = z.infer<typeof saveGolfScoresSchema>;

export const claimScorerSchema = z.object({ competitionId: golfUuid, flightId: golfUuid });

export const setSideResultSchema = z.object({
  competitionId: golfUuid,
  type: z.enum(SIDE_CONTESTS),
  hole: z.number().int().min(1).max(18),
  entryId: golfUuid.nullable(),
  note: z.string().trim().max(60).optional(),
});

export const publishGolfResultsSchema = z.object({ competitionId: golfUuid });

// --- Rounds and records (G5) ---------------------------------------------------------------------------

export const logRoundSchema = z
  .object({
    courseId: golfUuid,
    playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date'),
    handicapIndex: handicapIndexSchema.nullable().optional(),
    /** Hole-by-hole strokes ("1": 4...); or leave empty and give a total. */
    scores: z.record(z.string().regex(/^\d{1,2}$/), z.number().int().min(1).max(20).nullable()).default({}),
    total: z.number().int().min(18).max(200).nullable().optional(),
  })
  .refine((r) => Object.keys(r.scores).length > 0 || r.total != null, { message: 'Enter the hole scores or the total.' });
export type LogRoundInput = z.infer<typeof logRoundSchema>;

export interface GolfRoundLine {
  id: string;
  courseName: string;
  playedOn: string;
  holes: 9 | 18;
  gross: number | null;
  net: number | null;
  points: number | null;
  source: 'casual' | 'golf_day';
}

/** Pure: a golfer's record from their rounds (best scores compare like for like: 18-hole rounds only). */
export function golfRecord(rounds: GolfRoundLine[]) {
  const full = rounds.filter((r) => r.holes === 18);
  const gross = full.map((r) => r.gross).filter((n): n is number => n != null);
  const net = full.map((r) => r.net).filter((n): n is number => n != null);
  const pts = full.map((r) => r.points).filter((n): n is number => n != null);
  return {
    rounds: rounds.length,
    bestGross: gross.length ? Math.min(...gross) : null,
    bestNet: net.length ? Math.min(...net) : null,
    bestPoints: pts.length ? Math.max(...pts) : null,
    averageGross: gross.length ? Math.round((gross.reduce((a, b) => a + b, 0) / gross.length) * 10) / 10 : null,
  };
}
