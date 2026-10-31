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

export function proposeTimeAction(
  body: { challengeId: string; opponentTeamId: string; proposedStartsAt: string },
  accessToken: string,
): Promise<unknown> {
  return runAction('propose_time', body, accessToken);
}
