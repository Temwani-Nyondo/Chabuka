import type { ActionName, ActionResult, CreateMatchInput } from '@chabuka/shared';

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
