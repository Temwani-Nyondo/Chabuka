import type { Band, PlayerRecord, StatLine, TeamGame } from '@chabuka/shared';
import { API_BASE } from './api';

// Phase 6 reads: records (games and races), team bands, suggested opponents, games for you, Free tonight.

export interface MyRecordView {
  record: PlayerRecord;
  grid: { week: string; count: number }[];
  streak: number;
  season: { games: number; opponents: number; bestMonth: string | null; goals: number };
  recent: StatLine[];
}

export interface BandView {
  band: Band;
  label: string;
  trend: number;
}

export interface TeamRecordView {
  team: { id: string; name: string };
  band: BandView;
  record: {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    form: ('W' | 'D' | 'L')[];
    home: { played: number; won: number; drawn: number; lost: number };
    away: { played: number; won: number; drawn: number; lost: number };
    biggestWin: (TeamGame & { opponent: string }) | null;
  };
  headToHead: { teamId: string; name: string; played: number; won: number; drawn: number; lost: number; last: ('W' | 'D' | 'L')[] }[];
}

export interface OpponentSuggestion {
  team: { id: string; name: string; logo_url: string | null; area: string | null };
  score: number;
  reasons: string[];
  band: BandView;
  sharedSlots: string[];
}

async function get<T>(path: string, token: string, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach the Chabuka server.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? fallback);
  return data as T;
}

export const fetchMyRecord = (token: string) => get<MyRecordView>('/api/records/me', token, 'Could not load your record.');
export const fetchTeamRecord = (token: string, teamId: string) => get<TeamRecordView>(`/api/teams/${teamId}/record`, token, 'Could not load the team record.');
export const fetchOpponents = (token: string, teamId: string) =>
  get<{ suggestions: OpponentSuggestion[] }>(`/api/teams/${teamId}/opponents`, token, 'Could not load suggestions.').then((r) => r.suggestions);
export const fetchVersus = (token: string, home: string, away: string) =>
  get<{ home?: BandView; away?: BandView; headToHead: { played: number; won: number; drawn: number; lost: number; last: ('W' | 'D' | 'L')[] } }>(`/api/versus/${home}/${away}`, token, 'Could not load.');
export const fetchGamesForYou = (token: string) =>
  get<{ ranked: { matchId: string; score: number; reasons: string[] }[] }>('/api/games/for-you', token, 'Could not rank games.').then((r) => r.ranked);
/** While creating a game: how many players are free tonight near the place (0 below three, so no one can be located). */
export function fetchFreePreview(token: string, q: { sportId: string; startsAt: string; lat?: number | null; lng?: number | null; venueId?: string | null }) {
  const p = new URLSearchParams({ sportId: q.sportId, startsAt: q.startsAt });
  if (q.lat != null && q.lng != null) { p.set('lat', String(q.lat)); p.set('lng', String(q.lng)); }
  if (q.venueId) p.set('venueId', q.venueId);
  return get<{ count: number; eligible: boolean }>(`/api/free-nearby?${p.toString()}`, token, 'Could not load.');
}

export const fetchFreeNearby = (token: string, matchId: string) =>
  get<{ count: number; eligible: boolean; alreadyTold?: boolean; reason?: string }>(`/api/games/${matchId}/free-nearby`, token, 'Could not load.');
export const fetchMyFreeTonight = (token: string) => get<{ on: boolean; sports?: string[]; radius_km?: number; until?: string }>('/api/me/free-tonight', token, 'Could not load.');
