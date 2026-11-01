import type {
  ActionName,
  ActionResult,
  CreateMatchInput,
  CreateTeamInput,
  PostChallengeInput,
} from '@chabuka/shared';

// One action layer: every write goes through POST /api/actions/:name with
// the signed-in user's token, so the API runs it as that user under RLS.
const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3001';

export async function runAction<T = ActionResult>(
  name: ActionName,
  body: unknown,
  accessToken: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/actions/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | { error?: string }
    | null;
  if (!res.ok) {
    throw new Error(data?.error ?? 'Something went wrong. Try again.');
  }
  return data as T;
}

export interface GafferTurn {
  reply: string;
  actionsTaken: { name: string; ok: boolean }[];
  provider: string;
}

export interface AgentTokenRow {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
}

async function agentTokenFetch<T>(path: string, method: string, accessToken: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(data?.error ?? 'Something went wrong. Try again.');
  }
  return data as T;
}

export async function transcribeVoiceNote(audioDataUrl: string, accessToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/helper/transcribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ audio: audioDataUrl }),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? 'Transcription failed. Try again.');
  return data?.text ?? '';
}

export function mintAgentToken(label: string, accessToken: string): Promise<{ token: string; note: string }> {
  return agentTokenFetch('/api/agent-tokens', 'POST', accessToken, { label });
}

export function fetchAgentTokens(accessToken: string): Promise<AgentTokenRow[]> {
  return agentTokenFetch('/api/agent-tokens', 'GET', accessToken);
}

export function revokeAgentToken(tokenId: string, accessToken: string): Promise<unknown> {
  return agentTokenFetch(`/api/agent-tokens/${tokenId}`, 'DELETE', accessToken);
}

export async function downloadMatchIcs(matchId: string, accessToken: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/calendar/${matchId}.ics`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  if (!res.ok) throw new Error('Could not build the calendar file. Try again.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chabuka-${matchId}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// The Gaffer chats through the internal helper endpoint (path kept);
// only the external name is the Gaffer.
export async function askGaffer(
  message: string,
  history: { role: 'user'; content: string }[],
  accessToken: string,
  images: string[] = [],
): Promise<GafferTurn> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/helper`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message, history, images }),
    });
  } catch {
    throw new Error('Could not reach the Chabuka server. Is the API running?');
  }
  const data = (await res.json().catch(() => null)) as (GafferTurn & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(data?.error ?? 'Something went wrong. Try again.');
  }
  return data as GafferTurn;
}

export function createMatchAction(
  input: CreateMatchInput,
  accessToken: string,
): Promise<ActionResult & { matchId: string }> {
  return runAction<ActionResult & { matchId: string }>('create_match', input, accessToken);
}

export function joinMatchAction(matchId: string, accessToken: string): Promise<ActionResult> {
  return runAction<ActionResult>('join_match', { matchId }, accessToken);
}

export function withdrawMatchAction(matchId: string, accessToken: string): Promise<ActionResult> {
  return runAction<ActionResult>('withdraw_match', { matchId }, accessToken);
}

export function createTeamAction(input: CreateTeamInput, accessToken: string): Promise<unknown> {
  return runAction('create_team', input, accessToken);
}

export function postChallengeAction(input: PostChallengeInput, accessToken: string): Promise<unknown> {
  return runAction('post_challenge', input, accessToken);
}

export function acceptChallengeAction(
  body: { challengeId: string; opponentTeamId: string; startsAt?: string },
  accessToken: string,
): Promise<unknown> {
  return runAction('accept_challenge', body, accessToken);
}

export function declineChallengeAction(challengeId: string, accessToken: string): Promise<unknown> {
  return runAction('decline_challenge', { challengeId }, accessToken);
}

export function createVenueAction(input: unknown, accessToken: string): Promise<unknown> {
  return runAction('create_venue', input, accessToken);
}

export function createVenueSlotAction(input: unknown, accessToken: string): Promise<unknown> {
  return runAction('create_venue_slot', input, accessToken);
}

export function requestBookingAction(input: unknown, accessToken: string): Promise<unknown> {
  return runAction('request_booking', input, accessToken);
}

export function respondBookingAction(
  body: { bookingId: string; decision: 'confirm' | 'decline' },
  accessToken: string,
): Promise<unknown> {
  return runAction('respond_booking', body, accessToken);
}

export function cancelBookingAction(bookingId: string, accessToken: string): Promise<unknown> {
  return runAction('cancel_booking', { bookingId }, accessToken);
}

export function checkInTicketAction(ticketId: string, accessToken: string): Promise<unknown> {
  return runAction('check_in_ticket', { ticketId }, accessToken);
}

export function createCompetitionAction(input: unknown, accessToken: string): Promise<unknown> {
  return runAction('create_competition', input, accessToken);
}

export function registerEntryAction(
  body: { competitionId: string; teamId: string },
  accessToken: string,
): Promise<unknown> {
  return runAction('register_entry', body, accessToken);
}

export function closeRegistrationAction(competitionId: string, accessToken: string): Promise<unknown> {
  return runAction('close_registration', { competitionId }, accessToken);
}

export function postResultAction(
  body: { fixtureId: string; homeScore: number; awayScore: number },
  accessToken: string,
): Promise<unknown> {
  return runAction('post_result', body, accessToken);
}

export function postAnnouncementAction(
  body: { competitionId: string; text: string },
  accessToken: string,
): Promise<unknown> {
  return runAction('post_announcement', body, accessToken);
}

export function followCompetitionAction(competitionId: string, accessToken: string): Promise<unknown> {
  return runAction('follow_competition', { competitionId }, accessToken);
}

export function createCircleAction(input: unknown, accessToken: string): Promise<unknown> {
  return runAction('create_circle', input, accessToken);
}

export function joinCircleAction(circleId: string, accessToken: string): Promise<unknown> {
  return runAction('join_circle', { circleId }, accessToken);
}

export function leaveCircleAction(circleId: string, accessToken: string): Promise<unknown> {
  return runAction('leave_circle', { circleId }, accessToken);
}

export function proposeTimeAction(
  body: { challengeId: string; opponentTeamId: string; proposedStartsAt: string },
  accessToken: string,
): Promise<unknown> {
  return runAction('propose_time', body, accessToken);
}
