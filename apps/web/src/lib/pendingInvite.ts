// A shared invite link survives sign-up: the code someone opened is stashed
// here so post-auth screens can send them back to claim it.
const KEY = 'chabuka:pending-invite';

export function stashPendingInvite(code: string): void {
  try {
    const clean = code.trim();
    if (clean) window.localStorage.setItem(KEY, clean);
  } catch {
    // Private mode etc: the invite page itself still works.
  }
}

export function takePendingInvite(): string | null {
  try {
    const code = window.localStorage.getItem(KEY);
    window.localStorage.removeItem(KEY);
    return code && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

export function peekPendingInvite(): string | null {
  try {
    const code = window.localStorage.getItem(KEY);
    return code && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
