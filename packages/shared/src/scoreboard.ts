import { z } from 'zod';

// Scoreboard engine. Everything that happens in a game is an event in an
// append-only log; the live state is computed from the log by one pure
// function, used by the API and the web app alike, so a viewer always sees
// what the official sees. Undo voids an event instead of deleting it.

export type ScoreSide = 'home' | 'away';

export const SCOREBOARD_SPORTS = ['football', 'futsal', 'basketball', 'netball', 'tennis', 'padel'] as const;
export type ScoreboardSport = (typeof SCOREBOARD_SPORTS)[number];

/** Map a sports-table name to a scoreboard sport, or null when that sport has no scoreboard. */
export function scoreboardSportFor(name: string | null | undefined): ScoreboardSport | null {
  const n = (name ?? '').trim().toLowerCase();
  return (SCOREBOARD_SPORTS as readonly string[]).includes(n) ? (n as ScoreboardSport) : null;
}

export interface PeriodsConfig {
  kind: 'periods';
  sport: ScoreboardSport;
  periods: number;
  periodMinutes: number;
  /** up: the clock counts from 0 and runs on into stoppage time. down: counts to 0. */
  direction: 'up' | 'down';
  periodNames: string[];
  /** Point values a basket or goal can be worth. */
  pointValues: number[];
  timeoutsPerSide: number;
}

export interface RacketConfig {
  kind: 'racket';
  sport: ScoreboardSport;
  bestOf: 3 | 5;
  /** Games each at which a set goes to a tie-break. */
  tiebreakAt: number;
  tiebreakPoints: number;
  /** At deuce the next point wins the game (no advantage). */
  goldenPoint: boolean;
  /** The deciding set is a single 10-point tie-break. */
  matchTiebreak: boolean;
}

export type ScoreboardConfig = PeriodsConfig | RacketConfig;

export const SCOREBOARD_PRESETS: Record<ScoreboardSport, ScoreboardConfig> = {
  football: {
    kind: 'periods', sport: 'football', periods: 2, periodMinutes: 45, direction: 'up',
    periodNames: ['1st half', '2nd half'], pointValues: [1], timeoutsPerSide: 0,
  },
  futsal: {
    kind: 'periods', sport: 'futsal', periods: 2, periodMinutes: 20, direction: 'down',
    periodNames: ['1st half', '2nd half'], pointValues: [1], timeoutsPerSide: 1,
  },
  basketball: {
    kind: 'periods', sport: 'basketball', periods: 4, periodMinutes: 10, direction: 'down',
    periodNames: ['Q1', 'Q2', 'Q3', 'Q4'], pointValues: [1, 2, 3], timeoutsPerSide: 5,
  },
  netball: {
    kind: 'periods', sport: 'netball', periods: 4, periodMinutes: 15, direction: 'down',
    periodNames: ['Q1', 'Q2', 'Q3', 'Q4'], pointValues: [1], timeoutsPerSide: 2,
  },
  tennis: {
    kind: 'racket', sport: 'tennis', bestOf: 3, tiebreakAt: 6, tiebreakPoints: 7, goldenPoint: false, matchTiebreak: false,
  },
  padel: {
    kind: 'racket', sport: 'padel', bestOf: 3, tiebreakAt: 6, tiebreakPoints: 7, goldenPoint: true, matchTiebreak: false,
  },
};

export function presetFor(sport: ScoreboardSport): ScoreboardConfig {
  return structuredCloneConfig(SCOREBOARD_PRESETS[sport]);
}

function structuredCloneConfig<T extends ScoreboardConfig>(c: T): T {
  return JSON.parse(JSON.stringify(c)) as T;
}

// --- Events ---------------------------------------------------------------

export const SCOREBOARD_EVENT_TYPES = [
  'period_start', // starts the game or the next period (racket sports: starts the match)
  'period_end', // ends the running period (the last one ends the game)
  'clock_pause',
  'clock_resume',
  'goal', // a goal or basket, with scorer and optional assist
  'point', // racket sports: a point won
  'sub',
  'card',
  'timeout',
  'game_end', // ends the game early (abandoned, walkover, retirement)
  'note',
] as const;
export type ScoreboardEventType = (typeof SCOREBOARD_EVENT_TYPES)[number];

export const scoreboardEventInputSchema = z.object({
  /** Client-made id, so a retried tap is never counted twice. */
  clientId: z.string().uuid(),
  type: z.enum(SCOREBOARD_EVENT_TYPES),
  /** When it happened, ms since epoch. The server clamps it near its own clock. */
  at: z.number().int().positive(),
  side: z.enum(['home', 'away']).optional(),
  playerId: z.string().max(64).optional(),
  assistId: z.string().max(64).optional(),
  inId: z.string().max(64).optional(),
  outId: z.string().max(64).optional(),
  card: z.enum(['yellow', 'red']).optional(),
  points: z.number().int().min(1).max(3).optional(),
  ownGoal: z.boolean().optional(),
  note: z.string().trim().max(200).optional(),
});
export type ScoreboardEventInput = z.infer<typeof scoreboardEventInputSchema>;

export interface ScoreboardEventRecord extends ScoreboardEventInput {
  seq: number;
  voided?: boolean;
}

export interface RosterPlayer {
  id: string;
  side: ScoreSide;
  name: string;
  number?: number | null;
  starter: boolean;
}

export interface PlayerStats {
  goals: number;
  assists: number;
  points: number;
  yellow: number;
  red: number;
  subsOn: number;
  subsOff: number;
}

export interface TimelineItem {
  seq: number;
  type: ScoreboardEventType;
  side?: ScoreSide;
  playerId?: string;
  assistId?: string;
  inId?: string;
  outId?: string;
  card?: 'yellow' | 'red';
  points?: number;
  ownGoal?: boolean;
  note?: string;
  /** 1-based period (set number for racket sports). */
  period: number;
  /** Elapsed within the period at that moment. */
  clockMs: number;
  /** Human label such as "37'", "45+2'" or "Q2 4:32"; empty for racket sports. */
  label: string;
  /** Score straight after this event. */
  score: { home: number; away: number };
}

export type Winner = ScoreSide | 'draw' | null;

export interface PeriodsState {
  kind: 'periods';
  sport: ScoreboardSport;
  status: 'setup' | 'live' | 'paused' | 'break' | 'ended';
  period: number;
  score: { home: number; away: number };
  periodScores: { home: number; away: number }[];
  /** Elapsed in the current period as of anchorAt. */
  elapsedMs: number;
  /** When the clock last started running; null while stopped. */
  anchorAt: number | null;
  onCourt: { home: string[]; away: string[] };
  sentOff: string[];
  yellows: Record<string, number>;
  timeouts: { home: number; away: number };
  stats: Record<string, PlayerStats>;
  timeline: TimelineItem[];
  winner: Winner;
  lastSeq: number;
}

export interface RacketState {
  kind: 'racket';
  sport: ScoreboardSport;
  status: 'setup' | 'live' | 'ended';
  /** Completed sets, in order. */
  sets: { home: number; away: number }[];
  /** Games in the current set. */
  games: { home: number; away: number };
  /** Raw points in the current game (or tie-break). */
  points: { home: number; away: number };
  inTiebreak: boolean;
  tiebreakTarget: number;
  setNumber: number;
  /** Sets won: the headline score. */
  score: { home: number; away: number };
  timeline: TimelineItem[];
  winner: Winner;
  lastSeq: number;
}

export type ScoreboardState = PeriodsState | RacketState;

const emptyStats = (): PlayerStats => ({ goals: 0, assists: 0, points: 0, yellow: 0, red: 0, subsOn: 0, subsOff: 0 });
const other = (s: ScoreSide): ScoreSide => (s === 'home' ? 'away' : 'home');

export function initialState(config: ScoreboardConfig, roster: RosterPlayer[] = []): ScoreboardState {
  if (config.kind === 'racket') {
    return {
      kind: 'racket', sport: config.sport, status: 'setup', sets: [], games: { home: 0, away: 0 },
      points: { home: 0, away: 0 }, inTiebreak: false, tiebreakTarget: config.tiebreakPoints, setNumber: 1,
      score: { home: 0, away: 0 }, timeline: [], winner: null, lastSeq: 0,
    };
  }
  const stats: Record<string, PlayerStats> = {};
  for (const p of roster) stats[p.id] = emptyStats();
  return {
    kind: 'periods', sport: config.sport, status: 'setup', period: 0, score: { home: 0, away: 0 }, periodScores: [],
    elapsedMs: 0, anchorAt: null,
    onCourt: {
      home: roster.filter((p) => p.side === 'home' && p.starter).map((p) => p.id),
      away: roster.filter((p) => p.side === 'away' && p.starter).map((p) => p.id),
    },
    sentOff: [], yellows: {}, timeouts: { home: 0, away: 0 }, stats, timeline: [], winner: null, lastSeq: 0,
  };
}

/** Elapsed ms in the current period at `now`. */
export function periodElapsedMs(state: PeriodsState, now: number): number {
  return state.elapsedMs + (state.anchorAt != null ? Math.max(0, now - state.anchorAt) : 0);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "37'", "45+2'" for count-up sports; "Q2 4:32" for count-down sports. */
export function clockLabel(config: PeriodsConfig, period: number, elapsedMs: number): string {
  const periodMs = config.periodMinutes * 60_000;
  if (config.direction === 'up') {
    if (elapsedMs > periodMs) {
      return `${period * config.periodMinutes}+${Math.floor((elapsedMs - periodMs) / 60_000) + 1}'`;
    }
    return `${(period - 1) * config.periodMinutes + Math.floor(elapsedMs / 60_000) + 1}'`;
  }
  const remaining = Math.max(0, periodMs - elapsedMs);
  const secs = Math.ceil(remaining / 1000);
  const name = config.periodNames[period - 1] ?? `P${period}`;
  return `${name} ${Math.floor(secs / 60)}:${pad2(secs % 60)}`;
}

/** What a scoreboard clock shows right now: "37:12" counting up, or "04:32" counting down. */
export function displayClock(config: PeriodsConfig, state: PeriodsState, now: number): string {
  const elapsed = periodElapsedMs(state, now);
  const periodMs = config.periodMinutes * 60_000;
  if (config.direction === 'up') {
    const total = (Math.max(1, state.period) - 1) * periodMs + elapsed;
    const secs = Math.floor(total / 1000);
    return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
  }
  const secs = Math.ceil(Math.max(0, periodMs - elapsed) / 1000);
  return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
}

// --- Reducer --------------------------------------------------------------

export function reduceScoreboard(
  config: ScoreboardConfig,
  roster: RosterPlayer[],
  events: ScoreboardEventRecord[],
): ScoreboardState {
  const ordered = [...events].filter((e) => !e.voided).sort((a, b) => a.seq - b.seq);
  return config.kind === 'racket' ? reduceRacket(config, ordered) : reducePeriods(config, roster, ordered);
}

function reducePeriods(config: PeriodsConfig, roster: RosterPlayer[], events: ScoreboardEventRecord[]): PeriodsState {
  const s = initialState(config, roster) as PeriodsState;
  const statsFor = (id: string): PlayerStats => (s.stats[id] ??= emptyStats());
  const stop = (at: number) => {
    if (s.anchorAt != null) s.elapsedMs += Math.max(0, at - s.anchorAt);
    s.anchorAt = null;
  };

  for (const e of events) {
    s.lastSeq = e.seq;
    const elapsedAt = s.elapsedMs + (s.anchorAt != null ? Math.max(0, e.at - s.anchorAt) : 0);
    const push = (extra: Partial<TimelineItem> = {}) => {
      const item: TimelineItem = {
        seq: e.seq, type: e.type, period: Math.max(1, s.period), clockMs: elapsedAt,
        label: clockLabel(config, Math.max(1, s.period), elapsedAt), score: { ...s.score },
        ...(e.side ? { side: e.side } : {}), ...(e.playerId ? { playerId: e.playerId } : {}),
        ...(e.assistId ? { assistId: e.assistId } : {}), ...(e.inId ? { inId: e.inId } : {}),
        ...(e.outId ? { outId: e.outId } : {}), ...(e.card ? { card: e.card } : {}),
        ...(e.note ? { note: e.note } : {}), ...extra,
      };
      s.timeline.push(item);
    };

    switch (e.type) {
      case 'period_start': {
        if (s.status !== 'setup' && s.status !== 'break') break;
        if (s.period >= config.periods) break;
        s.period += 1;
        s.periodScores[s.period - 1] = { home: 0, away: 0 };
        s.elapsedMs = 0;
        s.anchorAt = e.at;
        s.status = 'live';
        push();
        break;
      }
      case 'clock_pause': {
        if (s.status !== 'live') break;
        stop(e.at);
        s.status = 'paused';
        push();
        break;
      }
      case 'clock_resume': {
        if (s.status !== 'paused') break;
        s.anchorAt = e.at;
        s.status = 'live';
        push();
        break;
      }
      case 'period_end': {
        if (s.status !== 'live' && s.status !== 'paused') break;
        stop(e.at);
        push();
        if (s.period >= config.periods) {
          s.status = 'ended';
          s.winner = s.score.home === s.score.away ? 'draw' : s.score.home > s.score.away ? 'home' : 'away';
        } else {
          s.status = 'break';
        }
        break;
      }
      case 'game_end': {
        if (s.status === 'setup' || s.status === 'ended') break;
        stop(e.at);
        s.status = 'ended';
        s.winner = s.score.home === s.score.away ? 'draw' : s.score.home > s.score.away ? 'home' : 'away';
        push();
        break;
      }
      case 'goal': {
        if ((s.status !== 'live' && s.status !== 'paused') || !e.side) break;
        const pts = e.points ?? 1;
        s.score[e.side] += pts;
        const ps = s.periodScores[s.period - 1];
        if (ps) ps[e.side] += pts;
        if (e.playerId && !e.ownGoal) {
          const st = statsFor(e.playerId);
          st.goals += 1;
          st.points += pts;
        }
        if (e.assistId && !e.ownGoal) statsFor(e.assistId).assists += 1;
        push({ points: pts, ...(e.ownGoal ? { ownGoal: true } : {}) });
        break;
      }
      case 'sub': {
        if ((s.status === 'setup' || s.status === 'ended') || !e.side || !e.inId || !e.outId) break;
        const court = s.onCourt[e.side];
        const idx = court.indexOf(e.outId);
        if (idx === -1 || court.includes(e.inId)) break;
        court[idx] = e.inId;
        statsFor(e.outId).subsOff += 1;
        statsFor(e.inId).subsOn += 1;
        push();
        break;
      }
      case 'card': {
        if (s.status === 'setup' || !e.playerId || !e.card) break;
        const st = statsFor(e.playerId);
        let sentOff = false;
        if (e.card === 'yellow') {
          st.yellow += 1;
          s.yellows[e.playerId] = (s.yellows[e.playerId] ?? 0) + 1;
          if (s.yellows[e.playerId] === 2) sentOff = true; // second yellow is a red
        } else {
          st.red += 1;
          sentOff = true;
        }
        if (sentOff && !s.sentOff.includes(e.playerId)) {
          s.sentOff.push(e.playerId);
          for (const side of ['home', 'away'] as const) {
            s.onCourt[side] = s.onCourt[side].filter((id) => id !== e.playerId);
          }
        }
        push();
        break;
      }
      case 'timeout': {
        if ((s.status !== 'live' && s.status !== 'paused') || !e.side) break;
        s.timeouts[e.side] += 1;
        push();
        break;
      }
      case 'note':
        push();
        break;
      default:
        break;
    }
  }
  return s;
}

// --- Racket sports ----------------------------------------------------------

export function gamePointLabel(state: RacketState, goldenPoint: boolean): { home: string; away: string } {
  if (state.inTiebreak) return { home: String(state.points.home), away: String(state.points.away) };
  const ladder = ['0', '15', '30', '40'];
  const { home: h, away: a } = state.points;
  if (h >= 3 && a >= 3) {
    if (goldenPoint) return { home: '40', away: '40' };
    if (h === a) return { home: '40', away: '40' };
    return h > a ? { home: 'Ad', away: '40' } : { home: '40', away: 'Ad' };
  }
  return { home: ladder[Math.min(h, 3)] ?? '40', away: ladder[Math.min(a, 3)] ?? '40' };
}

function reduceRacket(config: RacketConfig, events: ScoreboardEventRecord[]): RacketState {
  const s = initialState(config) as RacketState;
  const setsToWin = Math.ceil(config.bestOf / 2);

  const startSet = () => {
    s.games = { home: 0, away: 0 };
    s.points = { home: 0, away: 0 };
    const deciding = s.setNumber === config.bestOf;
    if (config.matchTiebreak && deciding) {
      s.inTiebreak = true;
      s.tiebreakTarget = 10;
    } else {
      s.inTiebreak = false;
      s.tiebreakTarget = config.tiebreakPoints;
    }
  };

  const winSet = (side: ScoreSide, games: { home: number; away: number }) => {
    s.sets.push({ ...games });
    s.score[side] += 1;
    if (s.score[side] >= setsToWin) {
      s.status = 'ended';
      s.winner = side;
      return;
    }
    s.setNumber += 1;
    startSet();
  };

  const winGame = (side: ScoreSide) => {
    const wasTiebreak = s.inTiebreak;
    s.games[side] += 1;
    s.points = { home: 0, away: 0 };
    if (wasTiebreak) {
      // A tie-break always decides the set (a match tie-break counts as 1-0).
      winSet(side, { ...s.games });
      return;
    }
    const g = s.games[side];
    const o = s.games[other(side)];
    if (g >= config.tiebreakAt && g - o >= 2) {
      winSet(side, { ...s.games });
    } else if (g === config.tiebreakAt && o === config.tiebreakAt) {
      s.inTiebreak = true;
      s.tiebreakTarget = config.tiebreakPoints;
    }
  };

  const addPoint = (side: ScoreSide) => {
    s.points[side] += 1;
    const p = s.points[side];
    const o = s.points[other(side)];
    if (s.inTiebreak) {
      if (p >= s.tiebreakTarget && p - o >= 2) winGame(side);
      return;
    }
    const won = config.goldenPoint ? p >= 4 : p >= 4 && p - o >= 2;
    if (won) winGame(side);
  };

  startSet();

  for (const e of events) {
    s.lastSeq = e.seq;
    const push = () => {
      s.timeline.push({
        seq: e.seq, type: e.type, period: s.setNumber, clockMs: 0, label: '', score: { ...s.score },
        ...(e.side ? { side: e.side } : {}), ...(e.playerId ? { playerId: e.playerId } : {}),
        ...(e.note ? { note: e.note } : {}),
      });
    };
    if (e.type === 'period_start') {
      if (s.status === 'setup') {
        s.status = 'live';
        push();
      }
    } else if (e.type === 'point') {
      if (s.status !== 'live' || !e.side) continue;
      addPoint(e.side);
      push();
    } else if (e.type === 'game_end') {
      if (s.status === 'live') {
        s.status = 'ended';
        s.winner = e.side ?? (s.score.home === s.score.away ? 'draw' : s.score.home > s.score.away ? 'home' : 'away');
        push();
      }
    } else if (e.type === 'note') {
      push();
    }
  }
  return s;
}

// --- Validation (used by the API before accepting an event, and by the control panel) ---

export function validateScoreboardEvent(
  config: ScoreboardConfig,
  roster: RosterPlayer[],
  state: ScoreboardState,
  event: ScoreboardEventInput,
): string | null {
  const byId = new Map(roster.map((p) => [p.id, p]));
  if (state.status === 'ended' && event.type !== 'note') return 'This game has ended.';

  if (config.kind === 'racket') {
    const st = state as RacketState;
    switch (event.type) {
      case 'period_start':
        return st.status === 'setup' ? null : 'The match has already started.';
      case 'point':
        if (st.status !== 'live') return 'Start the match first.';
        return event.side ? null : 'Say who won the point.';
      case 'game_end':
        return st.status === 'live' ? null : 'The match has not started.';
      case 'note':
        return null;
      default:
        return 'That does not apply to this sport.';
    }
  }

  const st = state as PeriodsState;
  switch (event.type) {
    case 'period_start':
      if (st.status !== 'setup' && st.status !== 'break') return 'A period is already running.';
      return st.period >= config.periods ? 'All periods have been played.' : null;
    case 'clock_pause':
      return st.status === 'live' ? null : 'The clock is not running.';
    case 'clock_resume':
      return st.status === 'paused' ? null : 'The clock is not paused.';
    case 'period_end':
      return st.status === 'live' || st.status === 'paused' ? null : 'No period is running.';
    case 'game_end':
      return st.status === 'setup' ? 'The game has not started.' : null;
    case 'goal': {
      if (st.status !== 'live' && st.status !== 'paused') return 'Start a period before scoring.';
      if (!event.side) return 'Say which side scored.';
      const pts = event.points ?? 1;
      if (!config.pointValues.includes(pts)) return `A ${config.sport} score is worth ${config.pointValues.join(', ')}.`;
      if (event.ownGoal && event.assistId) return 'An own goal has no assist.';
      if (event.playerId && !event.ownGoal) {
        const p = byId.get(event.playerId);
        if (!p) return 'Unknown scorer.';
        if (p.side !== event.side) return 'The scorer is on the other side.';
        if (!st.onCourt[event.side].includes(p.id)) return 'The scorer is not on the court.';
      }
      if (event.assistId) {
        const a = byId.get(event.assistId);
        if (!a) return 'Unknown assist.';
        if (a.side !== event.side) return 'The assist is on the other side.';
        if (event.assistId === event.playerId) return 'The scorer cannot assist their own goal.';
        if (!st.onCourt[event.side].includes(a.id)) return 'The assist is not on the court.';
      }
      return null;
    }
    case 'sub': {
      if (st.status === 'setup') return 'Start the game before substitutions.';
      if (!event.side || !event.inId || !event.outId) return 'Pick who comes on and who goes off.';
      const out = byId.get(event.outId);
      const inn = byId.get(event.inId);
      if (!out || !inn) return 'Unknown player.';
      if (out.side !== event.side || inn.side !== event.side) return 'Both players must be on the same side.';
      if (!st.onCourt[event.side].includes(event.outId)) return 'That player is not on the court.';
      if (st.onCourt[event.side].includes(event.inId)) return 'That player is already on.';
      if (st.sentOff.includes(event.inId)) return 'A sent-off player cannot come back on.';
      return null;
    }
    case 'card': {
      if (st.status === 'setup') return 'Start the game first.';
      if (!event.playerId || !event.card) return 'Pick the player and the card.';
      return byId.has(event.playerId) ? null : 'Unknown player.';
    }
    case 'timeout': {
      if (st.status !== 'live' && st.status !== 'paused') return 'Timeouts are taken during a period.';
      if (!event.side) return 'Say which side.';
      if (config.timeoutsPerSide === 0) return 'This sport has no timeouts.';
      return st.timeouts[event.side] >= config.timeoutsPerSide ? 'No timeouts left.' : null;
    }
    case 'point':
      return 'That does not apply to this sport.';
    case 'note':
      return null;
    default:
      return 'Unknown event.';
  }
}

/** Goals, assists and cards per player, for result screens and later stats. */
export function leaderboard(state: ScoreboardState): { playerId: string; stats: PlayerStats }[] {
  if (state.kind !== 'periods') return [];
  return Object.entries(state.stats)
    .map(([playerId, stats]) => ({ playerId, stats }))
    .filter((x) => x.stats.goals + x.stats.assists + x.stats.yellow + x.stats.red > 0)
    .sort((a, b) => b.stats.points - a.stats.points || b.stats.assists - a.stats.assists);
}

/** Final score for the result tables: goals or points for period sports, sets won for racket sports. */
export function finalScore(state: ScoreboardState): { home: number; away: number } {
  return { ...state.score };
}
