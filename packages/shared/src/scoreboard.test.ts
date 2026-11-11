import { describe, expect, it } from 'vitest';
import {
  clockLabel,
  displayClock,
  gamePointLabel,
  leaderboard,
  presetFor,
  reduceScoreboard,
  scoreboardSportFor,
  validateScoreboardEvent,
} from './scoreboard.js';
import type {
  PeriodsConfig,
  PeriodsState,
  RacketConfig,
  RacketState,
  RosterPlayer,
  ScoreSide,
  ScoreboardEventInput,
  ScoreboardEventRecord,
} from './scoreboard.js';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function ev(seq: number, type: ScoreboardEventRecord['type'], atMin: number, extra: Partial<ScoreboardEventInput> = {}): ScoreboardEventRecord {
  return { seq, clientId: uuid(), type, at: T0 + atMin * MIN, ...extra };
}

const roster: RosterPlayer[] = [
  { id: 'H1', side: 'home', name: 'Home One', number: 1, starter: true },
  { id: 'H2', side: 'home', name: 'Home Two', number: 2, starter: true },
  { id: 'H3', side: 'home', name: 'Home Three', number: 3, starter: false },
  { id: 'A1', side: 'away', name: 'Away One', number: 1, starter: true },
  { id: 'A2', side: 'away', name: 'Away Two', number: 2, starter: true },
  { id: 'A3', side: 'away', name: 'Away Three', number: 3, starter: false },
];

const football = presetFor('football') as PeriodsConfig;
const basketball = presetFor('basketball') as PeriodsConfig;

describe('sports mapping and presets', () => {
  it('maps sport names and rejects sports without a scoreboard', () => {
    expect(scoreboardSportFor('Football')).toBe('football');
    expect(scoreboardSportFor('  PADEL ')).toBe('padel');
    expect(scoreboardSportFor('marathon')).toBeNull();
    expect(scoreboardSportFor(undefined)).toBeNull();
  });

  it('presets are independent copies', () => {
    const a = presetFor('football') as PeriodsConfig;
    a.periodMinutes = 30;
    expect((presetFor('football') as PeriodsConfig).periodMinutes).toBe(45);
  });
});

describe('period sports', () => {
  it('scores goals with scorer and assist and keeps stats', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'goal', 10, { side: 'home', playerId: 'H1', assistId: 'H2' }),
      ev(3, 'goal', 20, { side: 'away', playerId: 'A1' }),
      ev(4, 'goal', 30, { side: 'home', playerId: 'H1' }),
    ]) as PeriodsState;
    expect(state.score).toEqual({ home: 2, away: 1 });
    expect(state.status).toBe('live');
    expect(state.stats['H1']?.goals).toBe(2);
    expect(state.stats['H2']?.assists).toBe(1);
    expect(leaderboard(state)[0]?.playerId).toBe('H1');
    expect(state.timeline.at(-1)?.score).toEqual({ home: 2, away: 1 });
    expect(state.timeline.find((t) => t.seq === 2)?.label).toBe("11'");
  });

  it('counts clock time across pause and resume', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'clock_pause', 10),
      ev(3, 'clock_resume', 15),
    ]) as PeriodsState;
    expect(state.status).toBe('live');
    expect(state.elapsedMs).toBe(10 * MIN);
    // 5 minutes after resuming, 15 minutes of play have gone by, not 20.
    expect(displayClock(football, state, T0 + 20 * MIN)).toBe('15:00');
  });

  it('runs half time and the second half from 45:00 with stoppage labels', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'goal', 47, { side: 'home', playerId: 'H1' }),
      ev(3, 'period_end', 48),
    ]) as PeriodsState;
    expect(state.status).toBe('break');
    expect(state.timeline.find((t) => t.seq === 2)?.label).toBe("45+3'");

    const second = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'period_end', 45),
      ev(3, 'period_start', 60),
      ev(4, 'goal', 62, { side: 'away', playerId: 'A2' }),
    ]) as PeriodsState;
    expect(second.period).toBe(2);
    expect(second.periodScores).toEqual([{ home: 0, away: 0 }, { home: 0, away: 1 }]);
    expect(second.timeline.find((t) => t.seq === 4)?.label).toBe("48'");
    expect(displayClock(football, second, T0 + 62 * MIN)).toBe('47:00');
  });

  it('ends after the last period and names the winner', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'goal', 5, { side: 'away', playerId: 'A1' }),
      ev(3, 'period_end', 45),
      ev(4, 'period_start', 60),
      ev(5, 'period_end', 105),
    ]) as PeriodsState;
    expect(state.status).toBe('ended');
    expect(state.winner).toBe('away');
    const draw = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'game_end', 10),
    ]) as PeriodsState;
    expect(draw.winner).toBe('draw');
  });

  it('ignores events that make no sense and events that were voided', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'goal', 1, { side: 'home', playerId: 'H1' }), // before kickoff
      ev(2, 'period_start', 2),
      { ...ev(3, 'goal', 3, { side: 'home', playerId: 'H1' }), voided: true },
      ev(4, 'goal', 4, { side: 'away', playerId: 'A1' }),
    ]) as PeriodsState;
    expect(state.score).toEqual({ home: 0, away: 1 });
  });

  it('handles substitutions, and a sent-off player cannot return', () => {
    const base = [
      ev(1, 'period_start', 0),
      ev(2, 'sub', 20, { side: 'home', outId: 'H2', inId: 'H3' }),
    ];
    const state = reduceScoreboard(football, roster, base) as PeriodsState;
    expect(state.onCourt.home.sort()).toEqual(['H1', 'H3']);
    expect(state.stats['H3']?.subsOn).toBe(1);

    const probe = (e: ScoreboardEventInput) => validateScoreboardEvent(football, roster, state, e);
    expect(probe(ev(3, 'sub', 21, { side: 'home', outId: 'H2', inId: 'H3' }))).toMatch(/not on the court/);
    expect(probe(ev(3, 'sub', 21, { side: 'home', outId: 'H1', inId: 'H3' }))).toMatch(/already on/);
    expect(probe(ev(3, 'sub', 21, { side: 'home', outId: 'H1', inId: 'A3' }))).toMatch(/same side/);
    expect(probe(ev(3, 'sub', 21, { side: 'home', outId: 'H1', inId: 'H2' }))).toBeNull();

    const sent = reduceScoreboard(football, roster, [...base, ev(3, 'card', 30, { playerId: 'H2', card: 'red' })]) as PeriodsState;
    expect(sent.sentOff).toContain('H2');
    expect(validateScoreboardEvent(football, roster, sent, ev(4, 'sub', 31, { side: 'home', outId: 'H1', inId: 'H2' }))).toMatch(/sent-off/);
  });

  it('a second yellow is a red: off the court', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'card', 10, { playerId: 'A1', card: 'yellow' }),
      ev(3, 'card', 30, { playerId: 'A1', card: 'yellow' }),
    ]) as PeriodsState;
    expect(state.stats['A1']?.yellow).toBe(2);
    expect(state.sentOff).toContain('A1');
    expect(state.onCourt.away).not.toContain('A1');
  });

  it('an own goal counts for the other side and gives nobody a goal', () => {
    const state = reduceScoreboard(football, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'goal', 10, { side: 'home', playerId: 'A1', ownGoal: true }),
    ]) as PeriodsState;
    expect(state.score).toEqual({ home: 1, away: 0 });
    expect(state.stats['A1']?.goals).toBe(0);
    expect(validateScoreboardEvent(football, roster, state, ev(3, 'goal', 11, { side: 'home', playerId: 'A1', ownGoal: true, assistId: 'H1' }))).toMatch(/own goal/);
  });

  it('validates scorers: wrong side, benched, unknown', () => {
    const state = reduceScoreboard(football, roster, [ev(1, 'period_start', 0)]) as PeriodsState;
    const v = (e: Partial<ScoreboardEventInput>) => validateScoreboardEvent(football, roster, state, ev(2, 'goal', 5, e));
    expect(v({ side: 'home', playerId: 'A1' })).toMatch(/other side/);
    expect(v({ side: 'home', playerId: 'H3' })).toMatch(/not on the court/);
    expect(v({ side: 'home', playerId: 'ZZ' })).toMatch(/Unknown/);
    expect(v({ side: 'home', playerId: 'H1', assistId: 'H1' })).toMatch(/cannot assist/);
    expect(v({ side: 'home', playerId: 'H1', assistId: 'H2' })).toBeNull();
    expect(v({ playerId: 'H1' })).toMatch(/which side/);
    const setup = reduceScoreboard(football, roster, []) as PeriodsState;
    expect(validateScoreboardEvent(football, roster, setup, ev(1, 'goal', 1, { side: 'home' }))).toMatch(/Start a period/);
  });

  it('basketball: 1, 2 and 3 point scores, countdown labels, timeouts limit', () => {
    const state = reduceScoreboard(basketball, roster, [
      ev(1, 'period_start', 0),
      ev(2, 'goal', 2.5, { side: 'home', playerId: 'H1', points: 3 }),
      ev(3, 'goal', 3, { side: 'away', playerId: 'A1', points: 2 }),
      ev(4, 'goal', 3.5, { side: 'away', playerId: 'A1', points: 1 }),
    ]) as PeriodsState;
    expect(state.score).toEqual({ home: 3, away: 3 });
    expect(state.stats['A1']?.points).toBe(3);
    expect(state.timeline.find((t) => t.seq === 2)?.label).toBe('Q1 7:30');
    expect(clockLabel(basketball, 2, 4 * MIN + 28_000)).toBe('Q2 5:32');
    expect(displayClock(basketball, state, T0 + 4 * MIN)).toBe('06:00');
    expect(validateScoreboardEvent(basketball, roster, state, ev(5, 'goal', 4, { side: 'home', points: 3 }))).toBeNull();
    expect(validateScoreboardEvent(football, roster, reduceScoreboard(football, roster, [ev(1, 'period_start', 0)]), ev(2, 'goal', 4, { side: 'home', points: 3 }))).toMatch(/worth/);
    let t = state;
    for (let i = 0; i < 5; i++) {
      t = reduceScoreboard(basketball, roster, [...[ev(1, 'period_start', 0)], ...Array.from({ length: i + 1 }, (_, k) => ev(2 + k, 'timeout', 1 + k, { side: 'home' }))]) as PeriodsState;
    }
    expect(validateScoreboardEvent(basketball, roster, t, ev(9, 'timeout', 7, { side: 'home' }))).toMatch(/No timeouts/);
    expect(validateScoreboardEvent(football, roster, reduceScoreboard(football, roster, [ev(1, 'period_start', 0)]), ev(2, 'timeout', 1, { side: 'home' }))).toMatch(/no timeouts/);
  });

  it('refuses period and clock changes at the wrong time', () => {
    const setup = reduceScoreboard(football, roster, []);
    const v = (state: typeof setup, type: ScoreboardEventInput['type']) => validateScoreboardEvent(football, roster, state, ev(1, type, 1));
    expect(v(setup, 'clock_pause')).toMatch(/not running/);
    expect(v(setup, 'period_end')).toMatch(/No period/);
    expect(v(setup, 'period_start')).toBeNull();
    const live = reduceScoreboard(football, roster, [ev(1, 'period_start', 0)]);
    expect(v(live, 'period_start')).toMatch(/already running/);
    expect(v(live, 'clock_resume')).toMatch(/not paused/);
    const ended = reduceScoreboard(football, roster, [ev(1, 'period_start', 0), ev(2, 'game_end', 5)]);
    expect(v(ended, 'goal')).toMatch(/ended/);
  });
});

// --- Racket sports -------------------------------------------------------------

const tennis = presetFor('tennis') as RacketConfig;
const padel = presetFor('padel') as RacketConfig;

function points(sides: ScoreSide[], startSeq = 2): ScoreboardEventRecord[] {
  return sides.map((side, i) => ev(startSeq + i, 'point', 1 + i, { side }));
}
const love = (side: ScoreSide): ScoreSide[] => [side, side, side, side];
const games = (side: ScoreSide, n: number): ScoreSide[] => Array.from({ length: n }, () => love(side)).flat();
const run = (config: RacketConfig, sides: ScoreSide[]) =>
  reduceScoreboard(config, [], [ev(1, 'period_start', 0), ...points(sides)]) as RacketState;

describe('tennis and padel', () => {
  it('scores a love game and shows 15/30/40', () => {
    const mid = run(tennis, ['home', 'home', 'away']);
    expect(gamePointLabel(mid, false)).toEqual({ home: '30', away: '15' });
    const won = run(tennis, love('home'));
    expect(won.games).toEqual({ home: 1, away: 0 });
    expect(won.points).toEqual({ home: 0, away: 0 });
  });

  it('needs two clear points from deuce in tennis (advantage)', () => {
    const deuce = run(tennis, ['home', 'home', 'home', 'away', 'away', 'away']);
    expect(gamePointLabel(deuce, false)).toEqual({ home: '40', away: '40' });
    const adHome = run(tennis, ['home', 'home', 'home', 'away', 'away', 'away', 'home']);
    expect(gamePointLabel(adHome, false)).toEqual({ home: 'Ad', away: '40' });
    const back = run(tennis, ['home', 'home', 'home', 'away', 'away', 'away', 'home', 'away']);
    expect(gamePointLabel(back, false)).toEqual({ home: '40', away: '40' });
    const won = run(tennis, ['home', 'home', 'home', 'away', 'away', 'away', 'home', 'home']);
    expect(won.games).toEqual({ home: 1, away: 0 });
  });

  it('padel golden point: the next point at deuce wins the game', () => {
    const won = run(padel, ['home', 'home', 'home', 'away', 'away', 'away', 'away']);
    expect(won.games).toEqual({ home: 0, away: 1 });
  });

  it('wins a set 6-4, then the match in two sets', () => {
    const set1 = [...games('home', 4), ...games('away', 4), ...games('home', 2)];
    const s1 = run(tennis, set1);
    expect(s1.sets).toEqual([{ home: 6, away: 4 }]);
    expect(s1.score).toEqual({ home: 1, away: 0 });
    expect(s1.setNumber).toBe(2);
    expect(s1.games).toEqual({ home: 0, away: 0 });
    const done = run(tennis, [...set1, ...games('home', 6)]);
    expect(done.status).toBe('ended');
    expect(done.winner).toBe('home');
    expect(done.score).toEqual({ home: 2, away: 0 });
    // Points after the match ends change nothing.
    const after = reduceScoreboard(tennis, [], [ev(1, 'period_start', 0), ...points([...set1, ...games('home', 6), 'away'])]) as RacketState;
    expect(after.score).toEqual({ home: 2, away: 0 });
  });

  it('plays a tie-break at 6-6 to 7, win by two, and records the set 7-6', () => {
    const toSixAll: ScoreSide[] = [];
    for (let i = 0; i < 5; i++) toSixAll.push(...games('home', 1), ...games('away', 1));
    toSixAll.push(...games('home', 1), ...games('away', 1));
    const atTb = run(tennis, toSixAll);
    expect(atTb.games).toEqual({ home: 6, away: 6 });
    expect(atTb.inTiebreak).toBe(true);
    // 6-6 in the tie-break is not over; 7-6 is not enough; 8-6 wins.
    const tbPoints: ScoreSide[] = ['home', 'away', 'home', 'away', 'home', 'away', 'home', 'away', 'home', 'away', 'home', 'away'];
    const sixSix = run(tennis, [...toSixAll, ...tbPoints]);
    expect(sixSix.points).toEqual({ home: 6, away: 6 });
    const sevenSix = run(tennis, [...toSixAll, ...tbPoints, 'home']);
    expect(sevenSix.inTiebreak).toBe(true);
    const wonSet = run(tennis, [...toSixAll, ...tbPoints, 'home', 'home']);
    expect(wonSet.sets).toEqual([{ home: 7, away: 6 }]);
    expect(wonSet.score).toEqual({ home: 1, away: 0 });
    expect(wonSet.inTiebreak).toBe(false);
  });

  it('a match tie-break replaces the deciding set', () => {
    const cfg: RacketConfig = { ...tennis, matchTiebreak: true };
    const oneAll = [...games('home', 6), ...games('away', 6)];
    const deciding = reduceScoreboard(cfg, [], [ev(1, 'period_start', 0), ...points(oneAll)]) as RacketState;
    expect(deciding.setNumber).toBe(3);
    expect(deciding.inTiebreak).toBe(true);
    expect(deciding.tiebreakTarget).toBe(10);
    const tb: ScoreSide[] = Array.from({ length: 10 }, () => 'home' as ScoreSide);
    const done = reduceScoreboard(cfg, [], [ev(1, 'period_start', 0), ...points([...oneAll, ...tb])]) as RacketState;
    expect(done.status).toBe('ended');
    expect(done.winner).toBe('home');
  });

  it('validates racket events', () => {
    const setup = reduceScoreboard(tennis, [], []);
    expect(validateScoreboardEvent(tennis, [], setup, ev(1, 'point', 1, { side: 'home' }))).toMatch(/Start the match/);
    expect(validateScoreboardEvent(tennis, [], setup, ev(1, 'period_start', 0))).toBeNull();
    const live = reduceScoreboard(tennis, [], [ev(1, 'period_start', 0)]);
    expect(validateScoreboardEvent(tennis, [], live, ev(2, 'point', 1))).toMatch(/who won/);
    expect(validateScoreboardEvent(tennis, [], live, ev(2, 'goal', 1, { side: 'home' }))).toMatch(/does not apply/);
    expect(validateScoreboardEvent(tennis, [], live, ev(2, 'point', 1, { side: 'away' }))).toBeNull();
  });
});
