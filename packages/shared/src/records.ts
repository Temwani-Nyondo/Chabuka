import { z } from 'zod';

// --- Phase 6: records, team ratings, matchmaking, Free tonight ---------------------------------
// Records come only from games and races that happened on Chabuka (no self-logging, no GPS). Teams get an Elo rating
// per sport, shown only as a band, never as a number. Players get records, never rankings.

export type GameResult = 'W' | 'D' | 'L';

// --- Ratings ----------------------------------------------------------------------------------

export const RATING_START = 1000;
export const PROVISIONAL_GAMES = 5;

/**
 * Elo after one game. `result` is from the home side's view. K is larger while a team is new (fewer than 5 rated
 * games) so it finds its level quickly; a bigger winning margin moves ratings a little more (log margin factor).
 */
export function eloUpdate(
  home: { rating: number; games: number },
  away: { rating: number; games: number },
  result: GameResult,
  opts: { homeAdvantage?: number; goalDiff?: number } = {},
): { home: number; away: number; delta: number } {
  const adv = opts.homeAdvantage ?? 0;
  const expectedHome = 1 / (1 + 10 ** ((away.rating - (home.rating + adv)) / 400));
  const score = result === 'W' ? 1 : result === 'D' ? 0.5 : 0;
  const margin = Math.max(1, Math.log2(Math.abs(opts.goalDiff ?? 0) + 1) * 0.75 + 0.25);
  const kHome = home.games < PROVISIONAL_GAMES ? 32 : 20;
  const kAway = away.games < PROVISIONAL_GAMES ? 32 : 20;
  const change = (score - expectedHome) * (result === 'D' ? 1 : margin);
  const dHome = Math.round(kHome * change);
  const dAway = Math.round(kAway * change);
  return { home: home.rating + dHome, away: away.rating - dAway, delta: dHome };
}

export const BANDS = ['starter', 'club', 'strong', 'elite'] as const;
export type Band = (typeof BANDS)[number] | 'new';
export const BAND_LABELS: Record<Band, string> = { new: 'New', starter: 'Starter', club: 'Club', strong: 'Strong', elite: 'Elite' };

/**
 * A team's band among teams of the same sport, by percentile: bottom 30% Starter, next 35% Club, next 25% Strong,
 * top 10% Elite. With very few rated teams the rating itself decides (around 1000 is Club). New until 5 rated games.
 */
export function ratingBand(rating: number, games: number, sportRatings: number[]): Band {
  if (games < PROVISIONAL_GAMES) return 'new';
  const others = sportRatings.filter((r) => Number.isFinite(r));
  if (others.length < 8) {
    if (rating >= 1150) return 'elite';
    if (rating >= 1060) return 'strong';
    if (rating >= 940) return 'club';
    return 'starter';
  }
  const below = others.filter((r) => r < rating).length;
  const pct = below / others.length;
  if (pct >= 0.9) return 'elite';
  if (pct >= 0.65) return 'strong';
  if (pct >= 0.3) return 'club';
  return 'starter';
}

// --- Records ----------------------------------------------------------------------------------

export interface StatLine {
  sourceId: string;
  sport: string;
  playedAt: string;
  result: GameResult | null;
  goals: number;
  assists: number;
  cards: number;
  mvp: boolean;
  opponent?: string | null;
}

export interface PlayerRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  winRate: number | null;
  goals: number;
  assists: number;
  cards: number;
  mvps: number;
  form: GameResult[];
  longestUnbeaten: number;
  bySport: { sport: string; played: number; won: number; goals: number }[];
}

export function buildRecord(lines: StatLine[]): PlayerRecord {
  const sorted = [...lines].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const decided = sorted.filter((l) => l.result);
  const won = decided.filter((l) => l.result === 'W').length;
  const drawn = decided.filter((l) => l.result === 'D').length;
  const lost = decided.filter((l) => l.result === 'L').length;
  let run = 0;
  let longest = 0;
  for (const l of decided) {
    run = l.result === 'L' ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  const bySport = new Map<string, { sport: string; played: number; won: number; goals: number }>();
  for (const l of sorted) {
    const s = bySport.get(l.sport) ?? { sport: l.sport, played: 0, won: 0, goals: 0 };
    s.played += 1;
    if (l.result === 'W') s.won += 1;
    s.goals += l.goals;
    bySport.set(l.sport, s);
  }
  return {
    played: sorted.length,
    won,
    drawn,
    lost,
    winRate: decided.length ? Math.round((won / decided.length) * 100) : null,
    goals: sorted.reduce((n, l) => n + l.goals, 0),
    assists: sorted.reduce((n, l) => n + l.assists, 0),
    cards: sorted.reduce((n, l) => n + l.cards, 0),
    mvps: sorted.filter((l) => l.mvp).length,
    form: decided.slice(-5).map((l) => l.result!) ,
    longestUnbeaten: longest,
    bySport: [...bySport.values()].sort((a, b) => b.played - a.played),
  };
}

const DAY = 86_400_000;
const mondayUtc = (t: number) => {
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY;
};

/** Activity per week for the last `weeks` weeks (oldest first), counting games and races. */
export function activityGrid(dates: string[], weeks = 52, now = new Date()): { week: string; count: number }[] {
  const thisWeek = mondayUtc(now.getTime());
  const counts = new Map<number, number>();
  for (const d of dates) {
    const w = mondayUtc(new Date(d).getTime());
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return Array.from({ length: weeks }, (_, i) => {
    const w = thisWeek - (weeks - 1 - i) * 7 * DAY;
    return { week: new Date(w).toISOString().slice(0, 10), count: counts.get(w) ?? 0 };
  });
}

/** Weeks in a row (ending this or last week) with at least one game or race. */
export function weekStreak(dates: string[], now = new Date()): number {
  const weeks = new Set(dates.map((d) => mondayUtc(new Date(d).getTime())));
  let cursor = mondayUtc(now.getTime());
  if (!weeks.has(cursor)) cursor -= 7 * DAY;
  let n = 0;
  while (weeks.has(cursor)) {
    n += 1;
    cursor -= 7 * DAY;
  }
  return n;
}

export function seasonRecap(lines: StatLine[], year: number): { games: number; opponents: number; bestMonth: string | null; goals: number } {
  const inYear = lines.filter((l) => new Date(l.playedAt).getUTCFullYear() === year);
  const months = new Map<number, number>();
  for (const l of inYear) months.set(new Date(l.playedAt).getUTCMonth(), (months.get(new Date(l.playedAt).getUTCMonth()) ?? 0) + 1);
  const best = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    games: inYear.length,
    opponents: new Set(inYear.map((l) => l.opponent).filter(Boolean)).size,
    bestMonth: best ? new Date(Date.UTC(year, best[0], 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) : null,
    goals: inYear.reduce((n, l) => n + l.goals, 0),
  };
}

export interface TeamGame {
  id: string;
  playedAt: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

export function resultFor(teamId: string, g: TeamGame): GameResult {
  const mine = g.homeId === teamId ? g.homeScore : g.awayScore;
  const theirs = g.homeId === teamId ? g.awayScore : g.homeScore;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

export function teamRecord(teamId: string, games: TeamGame[]) {
  const mine = games.filter((g) => g.homeId === teamId || g.awayId === teamId).sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const res = mine.map((g) => resultFor(teamId, g));
  const gf = mine.reduce((n, g) => n + (g.homeId === teamId ? g.homeScore : g.awayScore), 0);
  const ga = mine.reduce((n, g) => n + (g.homeId === teamId ? g.awayScore : g.homeScore), 0);
  const split = (home: boolean) => {
    const sub = mine.filter((g) => (g.homeId === teamId) === home);
    const r = sub.map((g) => resultFor(teamId, g));
    return { played: sub.length, won: r.filter((x) => x === 'W').length, drawn: r.filter((x) => x === 'D').length, lost: r.filter((x) => x === 'L').length };
  };
  let biggest: TeamGame | null = null;
  for (const g of mine) {
    const diff = (g.homeId === teamId ? g.homeScore - g.awayScore : g.awayScore - g.homeScore);
    const best = biggest ? (biggest.homeId === teamId ? biggest.homeScore - biggest.awayScore : biggest.awayScore - biggest.homeScore) : 0;
    if (diff > 0 && diff > best) biggest = g;
  }
  return {
    played: mine.length,
    won: res.filter((r) => r === 'W').length,
    drawn: res.filter((r) => r === 'D').length,
    lost: res.filter((r) => r === 'L').length,
    goalsFor: gf,
    goalsAgainst: ga,
    form: res.slice(-5),
    home: split(true),
    away: split(false),
    biggestWin: biggest,
  };
}

/** Head-to-head between two teams, from team A's view: totals and the last results. */
export function headToHead(games: TeamGame[], a: string, b: string) {
  const between = games
    .filter((g) => (g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a))
    .sort((x, y) => x.playedAt.localeCompare(y.playedAt));
  const res = between.map((g) => resultFor(a, g));
  return { played: between.length, won: res.filter((r) => r === 'W').length, drawn: res.filter((r) => r === 'D').length, lost: res.filter((r) => r === 'L').length, last: res.slice(-5) };
}

// --- Matchmaking ------------------------------------------------------------------------------

export const TIME_BAND_LABEL: Record<string, string> = { morning: 'mornings', afternoon: 'afternoons', evening: 'evenings' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekly slots ("6-morning") two sides are both free in, given each side's slots (any member free counts). */
export function sharedFreeSlots(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((s) => b.has(s)).sort();
}

export function slotLabel(slot: string): string {
  const [d, band] = slot.split('-');
  return `${DAY_NAMES[Number(d)] ?? ''} ${TIME_BAND_LABEL[band ?? ''] ?? band}`.trim();
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How good an opponent is for a team, 0 to 1, with reasons people can read. */
export function opponentScore(input: { ratingGap: number | null; km: number | null; sameArea: boolean; sharedSlots: string[]; playedRecently: boolean }): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (input.ratingGap == null) {
    score += 0.2;
  } else {
    const level = Math.max(0, 1 - Math.abs(input.ratingGap) / 300);
    score += 0.4 * level;
    if (Math.abs(input.ratingGap) <= 75) reasons.push('Similar level');
  }
  if (input.km != null) {
    score += 0.3 * Math.max(0, 1 - input.km / 30);
    if (input.km <= 15) reasons.push(`${Math.max(1, Math.round(input.km))} km away`);
  } else if (input.sameArea) {
    score += 0.2;
    reasons.push('Same area');
  }
  if (input.sharedSlots.length) {
    score += 0.3 * Math.min(1, input.sharedSlots.length / 3);
    reasons.push(`Free ${slotLabel(input.sharedSlots[0]!)}`);
  }
  if (input.playedRecently) {
    score *= 0.4;
    reasons.push('Played recently');
  }
  return { score: Math.round(score * 1000) / 1000, reasons };
}

/** How good an open game is for a player, 0 to 1, with reasons. */
export function gameScore(input: { sportMatch: boolean; levelMatch: boolean | null; km: number | null; sameArea: boolean; slotMatch: boolean; spotsLeft: number; hoursAway: number }): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;
  if (input.sportMatch) {
    s += 0.35;
    reasons.push('Your sport');
  }
  if (input.levelMatch) {
    s += 0.15;
    reasons.push('Your level');
  }
  if (input.km != null) {
    s += 0.2 * Math.max(0, 1 - input.km / 25);
    if (input.km <= 10) reasons.push(`${Math.max(1, Math.round(input.km))} km`);
  } else if (input.sameArea) {
    s += 0.15;
    reasons.push('Near you');
  }
  if (input.slotMatch) {
    s += 0.2;
    reasons.push('When you are free');
  }
  if (input.spotsLeft > 0 && input.spotsLeft <= 3) {
    s += 0.05;
    reasons.push(`${input.spotsLeft} spot${input.spotsLeft === 1 ? '' : 's'} left`);
  }
  if (input.hoursAway < 48) s += 0.05;
  return { score: Math.round(s * 1000) / 1000, reasons };
}

// --- Free tonight -----------------------------------------------------------------------------

/** Midnight at the end of today in Lusaka (UTC+2, no daylight saving). */
export function endOfTonightLusaka(now = new Date()): string {
  const local = new Date(now.getTime() + 2 * 3_600_000);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return new Date(midnightLocal - 2 * 3_600_000).toISOString();
}

export const freeTonightSchema = z.object({
  sports: z.array(z.string().uuid()).min(1, 'Pick at least one sport').max(10),
  radiusKm: z.number().min(1).max(50).default(10),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
export type FreeTonightInput = z.infer<typeof freeTonightSchema>;
export const notifyFreePlayersSchema = z.object({ matchId: z.string().uuid() });
