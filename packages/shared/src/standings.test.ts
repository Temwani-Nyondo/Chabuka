import { describe, expect, it } from 'vitest';
import { computeStandings, roundRobinPairings } from './index.js';

describe('computeStandings', () => {
  it('ignores scheduled fixtures and points only finished results', () => {
    const standings = computeStandings(
      ['A', 'B'],
      [
        { home_team_id: 'A', away_team_id: 'B', home_score: 2, away_score: 1, status: 'finished' },
        { home_team_id: 'B', away_team_id: 'A', home_score: 3, away_score: 0, status: 'scheduled' },
      ],
    );
    expect(standings[0]).toMatchObject({ teamId: 'A', points: 3, won: 1, played: 1 });
    expect(standings[1]).toMatchObject({ teamId: 'B', points: 0, lost: 1, played: 1 });
  });

  it('orders level points by goal difference', () => {
    const standings = computeStandings(
      ['A', 'B', 'C'],
      [
        { home_team_id: 'A', away_team_id: 'B', home_score: 3, away_score: 0, status: 'finished' },
        { home_team_id: 'C', away_team_id: 'B', home_score: 1, away_score: 0, status: 'finished' },
      ],
    );
    expect(standings.map((row) => row.teamId)).toEqual(['A', 'C', 'B']);
  });
});

describe('roundRobinPairings', () => {
  it('makes every pair meet once for even fields', () => {
    const pairs = roundRobinPairings(['A', 'B', 'C', 'D']).map((pair) => pair.sort().join('-')).sort();
    expect(pairs).toEqual(['A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D']);
  });

  it('handles byes for odd fields', () => {
    expect(roundRobinPairings(['A', 'B', 'C'])).toHaveLength(3);
  });
});
