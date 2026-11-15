import { describe, expect, it } from 'vitest';
import {
  bracketSize,
  createCompetitionV2Schema,
  groupDraw,
  knockoutBracket,
  knockoutWinner,
  leagueRounds,
  leagueTable,
  nextSeriesDates,
  nextSlot,
  qualifiersToSeeds,
  registerTeamSchema,
  roundName,
  seedOrder,
} from './competitions.js';

const T = (n: number) => `team-${n}`;

describe('leagueRounds', () => {
  it('pairs every team with every other once, one game per team per round', () => {
    const teams = [T(1), T(2), T(3), T(4)];
    const p = leagueRounds(teams);
    expect(p).toHaveLength(6);
    const pairs = new Set(p.map((x) => [x.home, x.away].sort().join('|')));
    expect(pairs.size).toBe(6);
    for (const round of [1, 2, 3]) {
      const inRound = p.filter((x) => x.round === round).flatMap((x) => [x.home, x.away]);
      expect(new Set(inRound).size).toBe(4);
    }
  });

  it('gives each team a bye in odd leagues and swaps venues for the second leg', () => {
    const p = leagueRounds([T(1), T(2), T(3)], 2);
    expect(p).toHaveLength(6);
    const first = p.filter((x) => x.leg === 1);
    const second = p.filter((x) => x.leg === 2);
    for (const f of first) expect(second.some((s) => s.home === f.away && s.away === f.home)).toBe(true);
    expect(Math.max(...p.map((x) => x.round))).toBe(6);
  });

  it('spreads home games fairly', () => {
    const p = leagueRounds([T(1), T(2), T(3), T(4), T(5), T(6)]);
    for (const t of [1, 2, 3, 4, 5, 6].map(T)) {
      const home = p.filter((x) => x.home === t).length;
      expect(home).toBeGreaterThanOrEqual(1);
      expect(home).toBeLessThanOrEqual(4);
    }
  });
});

describe('groups and brackets', () => {
  it('snake-draws seeds so each group gets a top seed', () => {
    const g = groupDraw([1, 2, 3, 4, 5, 6, 7, 8].map(T), 2);
    expect(g.get('A')).toEqual([T(1), T(4), T(5), T(8)]);
    expect(g.get('B')).toEqual([T(2), T(3), T(6), T(7)]);
  });

  it('keeps top seeds apart until the final and gives byes to the best seeds', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketSize(5)).toBe(8);
    const b = knockoutBracket([1, 2, 3, 4, 5, 6].map(T));
    expect(b.rounds).toBe(3);
    expect(b.first[0]).toMatchObject({ home: T(1), away: null });
    expect(b.first.filter((s) => s.away === null || s.home === null)).toHaveLength(2);
  });

  it('feeds winners into the right next slot and names rounds', () => {
    expect(nextSlot(1)).toEqual({ slot: 1, side: 'home' });
    expect(nextSlot(2)).toEqual({ slot: 1, side: 'away' });
    expect(nextSlot(3)).toEqual({ slot: 2, side: 'home' });
    expect(roundName(3, 3)).toBe('Final');
    expect(roundName(2, 3)).toBe('Semi-finals');
    expect(roundName(1, 4)).toBe('Round of 16');
  });

  it('crosses group winners with other groups’ runners-up', () => {
    const two = knockoutBracket(qualifiersToSeeds(new Map([['A', [T(1), T(2)]], ['B', [T(3), T(4)]]]), 2));
    expect(two.first.map((s) => [s.home, s.away])).toEqual([[T(1), T(4)], [T(3), T(2)]]);
    const four = knockoutBracket(
      qualifiersToSeeds(new Map([['A', ['A1', 'A2']], ['B', ['B1', 'B2']], ['C', ['C1', 'C2']], ['D', ['D1', 'D2']]]), 2),
    );
    for (const s of four.first) expect(s.home?.[0]).not.toBe(s.away?.[0]);
  });
});

describe('leagueTable', () => {
  const f = (h: string, a: string, hs: number, as: number) => ({ home_team_id: h, away_team_id: a, home_score: hs, away_score: as, status: 'finished' });

  it('uses the organiser’s points and ignores unplayed games', () => {
    const table = leagueTable([T(1), T(2)], [f(T(1), T(2), 2, 0), { home_team_id: T(2), away_team_id: T(1), status: 'scheduled' }], { win: 2, draw: 1, loss: 0 });
    expect(table[0]).toMatchObject({ teamId: T(1), points: 2, played: 1 });
  });

  it('breaks a tie on points, GD and GF with head to head', () => {
    // T1 and T2 level on everything except their meeting, which T2 won.
    const table = leagueTable([T(1), T(2), T(3)], [f(T(1), T(3), 3, 0), f(T(2), T(3), 3, 0), f(T(2), T(1), 1, 0), f(T(3), T(1), 0, 1), f(T(3), T(2), 1, 0)]);
    const top = table.slice(0, 2).map((r) => r.teamId);
    expect(table[0]?.points).toBe(table[1]?.points);
    expect(top[0]).toBe(T(2));
  });
});

describe('knockoutWinner', () => {
  it('uses the score, then the shoot-out winner', () => {
    expect(knockoutWinner({ home_team_id: T(1), away_team_id: T(2), home_score: 2, away_score: 1, status: 'finished' })).toBe(T(1));
    expect(knockoutWinner({ home_team_id: T(1), away_team_id: T(2), home_score: 1, away_score: 1, status: 'finished', winner_team_id: T(2) })).toBe(T(2));
    expect(knockoutWinner({ home_team_id: T(1), away_team_id: T(2), home_score: 1, away_score: 1, status: 'finished' })).toBeNull();
    expect(knockoutWinner({ home_team_id: T(1), away_team_id: T(2), home_score: 1, away_score: 1, status: 'finished', winner_team_id: T(9) })).toBeNull();
  });
});

describe('nextSeriesDates', () => {
  const rule = { weekday: 2, time: '18:00', intervalWeeks: 1 as const, startsOn: '2026-11-17' };

  it('lists the next Tuesdays at 18:00 Lusaka time (16:00 UTC)', () => {
    const dates = nextSeriesDates(rule, new Date('2026-11-15T00:00:00Z'), 3);
    expect(dates).toEqual(['2026-11-17T16:00:00.000Z', '2026-11-24T16:00:00.000Z', '2026-12-01T16:00:00.000Z']);
  });

  it('skips past games, honours fortnightly series and the end date', () => {
    expect(nextSeriesDates({ ...rule, intervalWeeks: 2 }, new Date('2026-11-18T00:00:00Z'), 2)).toEqual(['2026-12-01T16:00:00.000Z', '2026-12-15T16:00:00.000Z']);
    expect(nextSeriesDates({ ...rule, until: '2026-11-24' }, new Date('2026-11-15T00:00:00Z'), 5)).toHaveLength(2);
  });
});

describe('inputs', () => {
  const base = { name: 'Corporate 5s', sportId: '00000000-0000-4000-8000-000000000001', area: 'Lusaka', startsOn: '2026-12-01', maxEntries: 8 };

  it('needs a group count for groups-then-knockout and sane squad sizes', () => {
    expect(createCompetitionV2Schema.safeParse({ ...base, format: 'groups_knockout' }).success).toBe(false);
    expect(createCompetitionV2Schema.safeParse({ ...base, format: 'groups_knockout', groupCount: 2 }).success).toBe(true);
    expect(createCompetitionV2Schema.safeParse({ ...base, teamSizeMin: 9, teamSizeMax: 5 }).success).toBe(false);
  });

  it('will not register a team without accepting the rules', () => {
    const entry = { competitionId: base.sportId, teamId: base.sportId, contactName: 'Mwila', contactPhone: '0977000000' };
    expect(registerTeamSchema.safeParse(entry).success).toBe(false);
    expect(registerTeamSchema.safeParse({ ...entry, acceptRules: true }).success).toBe(true);
  });
});
