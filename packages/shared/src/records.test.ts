import { describe, expect, it } from 'vitest';
import {
  activityGrid,
  buildRecord,
  eloUpdate,
  endOfTonightLusaka,
  gameScore,
  headToHead,
  opponentScore,
  ratingBand,
  sharedFreeSlots,
  slotLabel,
  teamRecord,
  weekStreak,
} from './records';
import type { StatLine, TeamGame } from './records';

describe('Elo', () => {
  it('is symmetric for equal teams, and draws between equals change nothing', () => {
    const a = { rating: 1000, games: 10 };
    const r = eloUpdate(a, a, 'W');
    expect(r.home - 1000).toBe(1000 - r.away);
    expect(r.delta).toBe(10);
    expect(eloUpdate(a, a, 'D')).toMatchObject({ home: 1000, away: 1000 });
  });
  it('moves new teams faster and big wins a little more', () => {
    const newT = eloUpdate({ rating: 1000, games: 0 }, { rating: 1000, games: 0 }, 'W');
    expect(newT.delta).toBe(16);
    const big = eloUpdate({ rating: 1000, games: 10 }, { rating: 1000, games: 10 }, 'W', { goalDiff: 5 });
    expect(big.delta).toBeGreaterThan(10);
  });
  it('an upset moves more than an expected win', () => {
    const upset = eloUpdate({ rating: 900, games: 10 }, { rating: 1200, games: 10 }, 'W');
    const expected = eloUpdate({ rating: 1200, games: 10 }, { rating: 900, games: 10 }, 'W');
    expect(upset.delta).toBeGreaterThan(expected.delta);
  });
});

describe('bands', () => {
  it('is New until 5 games, then by rating with few teams', () => {
    expect(ratingBand(1300, 2, [])).toBe('new');
    expect(ratingBand(1000, 5, [1000])).toBe('club');
    expect(ratingBand(1200, 9, [1000])).toBe('elite');
    expect(ratingBand(900, 9, [1000])).toBe('starter');
  });
  it('uses percentiles once there are enough teams', () => {
    const field = [800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250];
    expect(ratingBand(1260, 6, field)).toBe('elite');
    expect(ratingBand(820, 6, field)).toBe('starter');
    expect(ratingBand(1010, 6, field)).toBe('club');
  });
});

describe('records', () => {
  const line = (d: string, result: StatLine['result'], goals = 0, sport = 'Football'): StatLine => ({ sourceId: d, sport, playedAt: `${d}T10:00:00Z`, result, goals, assists: 0, cards: 0, mvp: false });
  it('adds up results, form and the longest unbeaten run', () => {
    const r = buildRecord([line('2026-01-01', 'W', 2), line('2026-01-08', 'D'), line('2026-01-15', 'L'), line('2026-01-22', 'W', 1), line('2026-01-29', 'W'), line('2026-02-05', null, 0, 'Padel')]);
    expect(r).toMatchObject({ played: 6, won: 3, drawn: 1, lost: 1, winRate: 60, goals: 3, longestUnbeaten: 2 });
    expect(r.form).toEqual(['W', 'D', 'L', 'W', 'W']);
    expect(r.bySport[0]).toMatchObject({ sport: 'Football', played: 5 });
  });
  it('counts weeks across a year boundary', () => {
    const now = new Date('2026-01-07T12:00:00Z');
    const grid = activityGrid(['2025-12-30T10:00:00Z', '2026-01-06T10:00:00Z', '2026-01-06T18:00:00Z'], 3, now);
    expect(grid.map((g) => g.count)).toEqual([0, 1, 2]);
    expect(weekStreak(['2025-12-30T10:00:00Z', '2026-01-06T10:00:00Z'], now)).toBe(2);
  });
  it('team record and head-to-head', () => {
    const g = (id: string, h: string, a: string, hs: number, as: number): TeamGame => ({ id, playedAt: `2026-0${id}-01T00:00:00Z`, homeId: h, awayId: a, homeScore: hs, awayScore: as });
    const games = [g('1', 'A', 'B', 3, 0), g('2', 'B', 'A', 1, 1), g('3', 'A', 'C', 0, 2), g('4', 'C', 'A', 1, 4)];
    const rec = teamRecord('A', games);
    expect(rec).toMatchObject({ played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 8, goalsAgainst: 4 });
    expect(rec.biggestWin?.id).toBe('1');
    expect(rec.home).toMatchObject({ played: 2, won: 1, lost: 1 });
    expect(headToHead(games, 'A', 'B')).toMatchObject({ played: 2, won: 1, drawn: 1, last: ['W', 'D'] });
  });
});

describe('matchmaking', () => {
  it('prefers close, similar, free-at-the-same-time teams not played recently', () => {
    const good = opponentScore({ ratingGap: 20, km: 3, sameArea: true, sharedSlots: ['6-morning'], playedRecently: false });
    const far = opponentScore({ ratingGap: 20, km: 28, sameArea: false, sharedSlots: [], playedRecently: false });
    const recent = opponentScore({ ratingGap: 20, km: 3, sameArea: true, sharedSlots: ['6-morning'], playedRecently: true });
    expect(good.score).toBeGreaterThan(far.score);
    expect(good.score).toBeGreaterThan(recent.score);
    expect(good.reasons).toEqual(['Similar level', '3 km away', 'Free Saturday mornings']);
  });
  it('ranks games by sport, level, distance and free time', () => {
    const a = gameScore({ sportMatch: true, levelMatch: true, km: 2, sameArea: false, slotMatch: true, spotsLeft: 2, hoursAway: 20 });
    const b = gameScore({ sportMatch: false, levelMatch: null, km: 20, sameArea: false, slotMatch: false, spotsLeft: 8, hoursAway: 100 });
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons).toContain('2 spots left');
  });
  it('finds shared free slots and labels them', () => {
    expect(sharedFreeSlots(new Set(['1-evening', '6-morning']), new Set(['6-morning', '3-evening']))).toEqual(['6-morning']);
    expect(slotLabel('3-evening')).toBe('Wednesday evenings');
  });
  it('Free tonight ends at midnight in Lusaka', () => {
    expect(endOfTonightLusaka(new Date('2026-11-20T15:00:00Z'))).toBe('2026-11-20T22:00:00.000Z');
    expect(endOfTonightLusaka(new Date('2026-11-20T22:30:00Z'))).toBe('2026-11-21T22:00:00.000Z');
  });
});
