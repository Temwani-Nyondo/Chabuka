import { describe, expect, it } from 'vitest';
import {
  autoGroups,
  flightSizes,
  planFlights,
  blankCard,
  countback,
  courseCardProblem,
  golfCourseInputSchema,
  golfLeaderboard,
  playingHandicap,
  roundTotals,
  stablefordPoints,
  strokesReceived,
} from './golf.js';
import type { GolfHole, HoleScores } from './golf.js';

// An 18-hole card: par 72, stroke index 1..18 in hole order.
const card: GolfHole[] = blankCard(18);
const allPar = (): HoleScores => Object.fromEntries(card.map((h) => [h.holeNo, h.par]));

describe('course cards', () => {
  it('needs every hole once and every stroke index once', () => {
    expect(courseCardProblem(18, card)).toBeNull();
    expect(courseCardProblem(18, card.slice(0, 17))).toMatch(/all 18/);
    const dupSi = card.map((h) => (h.holeNo === 2 ? { ...h, strokeIndex: 1 } : h));
    expect(courseCardProblem(18, dupSi)).toMatch(/stroke index/);
    expect(courseCardProblem(9, blankCard(9))).toBeNull();
    expect(golfCourseInputSchema.safeParse({ name: 'Lusaka GC', holes: 18, card: dupSi }).success).toBe(false);
  });
});

describe('handicaps and strokes', () => {
  it('playing handicap is index x allowance, halved for nine holes', () => {
    expect(playingHandicap(14.3, 95)).toBe(14);
    expect(playingHandicap(20, 100, 9)).toBe(10);
  });

  it('hands out strokes by stroke index, two on the hardest holes above 18', () => {
    expect(strokesReceived(1, 14)).toBe(1);
    expect(strokesReceived(14, 14)).toBe(1);
    expect(strokesReceived(15, 14)).toBe(0);
    expect(strokesReceived(4, 22)).toBe(2);
    expect(strokesReceived(5, 22)).toBe(1);
    expect(card.reduce((n, h) => n + strokesReceived(h.strokeIndex, 22), 0)).toBe(22);
  });

  it('a plus handicap gives strokes back on the easiest holes', () => {
    expect(strokesReceived(18, -2)).toBe(-1);
    expect(strokesReceived(17, -2)).toBe(-1);
    expect(strokesReceived(16, -2)).toBe(0);
    expect(card.reduce((n, h) => n + strokesReceived(h.strokeIndex, -2), 0)).toBe(-2);
  });

  it('Stableford: 2 for net par, more under, none from net double bogey, none for a pick-up', () => {
    expect(stablefordPoints(4, 4, 0)).toBe(2);
    expect(stablefordPoints(4, 5, 1)).toBe(2);
    expect(stablefordPoints(5, 3, 0)).toBe(4);
    expect(stablefordPoints(4, 7, 0)).toBe(0);
    expect(stablefordPoints(4, null, 1)).toBe(0);
  });
});

describe('a round', () => {
  it('totals gross, net, points and to-par', () => {
    const t = roundTotals(card, allPar(), 18);
    expect(t).toMatchObject({ thru: 18, gross: 72, net: 54, points: 54, toPar: 0 });
  });

  it('a partial round counts only the holes played; a pick-up has no gross but still scores points', () => {
    const t = roundTotals(card, { 1: 5, 2: 4, 3: null }, 0);
    expect(t.thru).toBe(3);
    expect(t.gross).toBeNull();
    expect(t.points).toBe(1 + 2 + 0);
  });

  it('countback looks at the last nine first', () => {
    const a = roundTotals(card, { ...allPar(), 1: 5, 18: 3 }, 0); // same total, better finish
    const b = roundTotals(card, allPar(), 0);
    expect(a.gross).toBe(b.gross);
    expect(countback(a, b, 'stroke')).toBeLessThan(0);
  });
});

describe('leaderboard', () => {
  it('orders Stableford by points, splits a tie on countback, and leaves non-starters unranked', () => {
    const rows = golfLeaderboard(
      card,
      [
        { id: 'a', name: 'A', playingHcp: 0, scores: allPar() },
        { id: 'b', name: 'B', playingHcp: 0, scores: { ...allPar(), 1: 5, 18: 3 } },
        { id: 'c', name: 'C', playingHcp: 0, scores: { ...allPar(), 2: 3 } },
        { id: 'd', name: 'D', playingHcp: 0, scores: {} },
      ],
      'stableford',
    );
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(rows.map((r) => r.positionLabel)).toEqual(['1', '2', '3', '']);
  });

  it('stroke play mid-round compares to par so far, and a real tie shows T', () => {
    const rows = golfLeaderboard(
      card,
      [
        { id: 'a', name: 'A', playingHcp: 0, scores: { 1: 3, 2: 4 } }, // -1 thru 2
        { id: 'b', name: 'B', playingHcp: 0, scores: { 1: 4 } }, // E thru 1
        { id: 'c', name: 'C', playingHcp: 0, scores: { 1: 4, 2: 4 } }, // E thru 2
      ],
      'stroke',
      'gross',
    );
    expect(rows[0]!.id).toBe('a');
    expect(rows.slice(1).map((r) => r.positionLabel)).toEqual(['T2', 'T2']);
  });
});

describe('flights', () => {
  it('groups players in threes and fours, never a single when avoidable', () => {
    expect(flightSizes(4)).toEqual([4]);
    expect(flightSizes(5)).toEqual([3, 2]);
    expect(flightSizes(9)).toEqual([3, 3, 3]);
    expect(flightSizes(13)).toEqual([4, 3, 3, 3]);
    expect(flightSizes(16)).toEqual([4, 4, 4, 4]);
  });

  it('auto groups by handicap, lowest first', () => {
    const g = autoGroups([{ id: 'a', handicapIndex: 20 }, { id: 'b', handicapIndex: 2 }, { id: 'c', handicapIndex: 10 }, { id: 'd', handicapIndex: 30 }, { id: 'e', handicapIndex: 5 }]);
    expect(g).toEqual([['b', 'e', 'c'], ['a', 'd']]);
  });

  it('tee times step by the interval; a shotgun puts each group on its own hole, then a B group', () => {
    const tee = planFlights([['a'], ['b']], { startType: 'tee_times', firstTeeAt: '2026-12-05T06:00:00.000Z', intervalMin: 10 }, 18);
    expect(tee.map((f) => f.teeTime)).toEqual(['2026-12-05T06:00:00.000Z', '2026-12-05T06:10:00.000Z']);
    const gun = planFlights(Array.from({ length: 10 }, (_, i) => [String(i)]), { startType: 'shotgun', firstTeeAt: '2026-12-05T06:00:00.000Z', intervalMin: 10 }, 9);
    expect(gun.map((f) => f.label).slice(8)).toEqual(['Hole 9', 'Hole 1B']);
    expect(gun[9]!.startHole).toBe(1);
  });
});
