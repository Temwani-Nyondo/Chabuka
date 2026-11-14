import type { Availability, Formation, JoinPolicy, LineupSlot, LineupSubject, RuleItem, SaveLineupInput, SaveRuleBookInput } from '@chabuka/shared';
import { API_BASE } from './api';

// Client for the Phase 2 API: availability, lineups, team admin, rule books.
// The tables behind these have no client policies, so every read goes through
// the API, which checks who may see what.

async function call<T>(path: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? 'Something went wrong. Try again.');
  return data as T;
}

export type Role = 'owner' | 'captain' | 'player';
export type Side = 'home' | 'away';

export interface SquadPlayer {
  userId: string;
  name: string;
  photoUrl: string | null;
  shirt: number | null;
  position: string | null;
  role: Role | null;
  status: Availability | null;
  note: string | null;
}

export interface SideSquad {
  side: Side;
  teamId: string | null;
  name: string;
  kitColour: string | null;
  canManage: boolean;
  players: SquadPlayer[];
  counts: Record<Availability | 'none', number>;
}

export interface SubjectInfo {
  type: LineupSubject;
  id: string;
  title: string;
  startsAt: string | null;
  sport: string | null;
  format: string | null;
  pickup: boolean;
}

export interface AvailabilityView {
  subject: SubjectInfo;
  sides: SideSquad[];
  me: { status: Availability | null; side: Side | null };
}

export interface LineupSideView {
  side: Side;
  teamId: string | null;
  name: string;
  kitColour: string | null;
  canEdit: boolean;
  lineup: {
    formation: string;
    slots: (LineupSlot & { name: string | null; shirt: number | null })[];
    bench: { userId: string; name: string; shirt: number | null }[];
    published: boolean;
    updatedAt: string;
  } | null;
  pool: SquadPlayer[];
}

export interface LineupsView {
  subject: SubjectInfo;
  formations: Formation[];
  sides: LineupSideView[];
}

export interface TeamAdminView {
  joinPolicy: JoinPolicy;
  kitColour: string | null;
  myRole: Role | null;
  myRequest: { id: string; createdAt: string } | null;
  requests: { id: string; userId: string; name: string; photoUrl: string | null; message: string | null; createdAt: string }[];
}

export interface RuleBookView {
  title: string;
  rules: RuleItem[];
  version: number;
  source: 'own' | 'competition' | 'template';
  canEdit: boolean;
  target: { type: 'match' | 'competition' | 'team'; id: string };
}

export const fetchAvailability = (token: string, type: LineupSubject, id: string) => call<AvailabilityView>(`/api/availability/${type}/${id}`, token);
export const answerAvailability = (token: string, body: { subjectType: LineupSubject; subjectId: string; status: Availability; note?: string }) =>
  call<{ status: Availability }>('/api/availability', token, body);
export const remindAvailability = (token: string, type: LineupSubject, id: string) => call<{ reminded: number }>(`/api/availability/${type}/${id}/remind`, token, {});

export const fetchLineups = (token: string, type: LineupSubject, id: string) => call<LineupsView>(`/api/lineups/${type}/${id}`, token);
export const saveLineup = (token: string, body: SaveLineupInput) => call<{ published: boolean; notified: number }>('/api/lineups', token, body);

export const fetchTeamAdmin = (token: string, teamId: string) => call<TeamAdminView>(`/api/teams/${teamId}/admin`, token);
export const askToJoinTeam = (token: string, teamId: string, message?: string) => call<{ state: 'joined' | 'requested' }>('/api/teams/join', token, { teamId, message });
export const answerJoinRequest = (token: string, requestId: string, decision: 'accept' | 'decline') =>
  call<{ state: string }>('/api/teams/requests/respond', token, { requestId, decision });
export const setShirt = (token: string, teamId: string, userId: string, number: number | null) => call('/api/teams/shirt', token, { teamId, userId, number });
export const handOverTeam = (token: string, teamId: string, userId: string) => call('/api/teams/transfer', token, { teamId, userId });
export const saveTeamSettings = (token: string, body: { teamId: string; joinPolicy?: JoinPolicy; kitColour?: string | null }) => call('/api/teams/settings', token, body);

export const fetchRuleBook = (token: string, type: 'match' | 'fixture' | 'competition' | 'team', id: string) => call<RuleBookView>(`/api/rulebooks/${type}/${id}`, token);
export const saveRuleBook = (token: string, body: SaveRuleBookInput) => call<{ version: number }>('/api/rulebooks', token, body);
