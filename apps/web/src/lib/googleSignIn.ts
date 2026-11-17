// Google sign-in on Chabuka's own page (Google Identity Services), so Google's chooser says "Sign in to
// chabuka.waitapp.online" instead of naming Supabase's address (what the redirect flow shows). Google hands back an ID
// token, and Supabase checks it (signInWithIdToken), so no Supabase address is ever shown.
//
// Switched on by VITE_GOOGLE_CLIENT_ID at build time (the same Google client Supabase's Google provider uses). That
// client must list this site under "Authorized JavaScript origins" in Google Cloud, or the chooser cannot open; when it
// can't (not set up, blocked, dismissed), the caller falls back to the old redirect, so sign-in never breaks.

interface GoogleId {
  initialize(opts: Record<string, unknown>): void;
  prompt(cb?: (n: Record<string, (() => unknown) | undefined>) => void): void;
  cancel(): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const CLIENT_ID = (import.meta.env['VITE_GOOGLE_CLIENT_ID'] as string | undefined)?.trim() || '';

export const googleDirectEnabled = (): boolean => CLIENT_ID.length > 0;

let loading: Promise<GoogleId | null> | null = null;
function loadGis(): Promise<GoogleId | null> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google?.accounts?.id ?? null);
    s.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loading;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Opens Google's account chooser on this page. Resolves the ID token and the raw nonce for Supabase, or null when the
 * chooser could not show or the person closed it (the caller then uses the redirect).
 */
export async function googleIdToken(): Promise<{ token: string; nonce: string } | null> {
  if (!CLIENT_ID) return null;
  const gis = await loadGis();
  if (!gis) return null;
  const raw = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await sha256Hex(raw);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { token: string; nonce: string } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    gis.initialize({
      client_id: CLIENT_ID,
      // Google puts the hashed nonce in the token; Supabase hashes the raw one and compares.
      nonce: hashed,
      context: 'signin',
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      callback: (r: { credential?: string }) => finish(r.credential ? { token: r.credential, nonce: raw } : null),
    });
    gis.prompt((n) => {
      const call = (k: string) => (typeof n[k] === 'function' ? (n[k] as () => unknown)() : undefined);
      if (call('isNotDisplayed') === true || call('isSkippedMoment') === true) finish(null);
      if (call('isDismissedMoment') === true && call('getDismissedReason') !== 'credential_returned') finish(null);
    });
    // Nothing happened (a blocked prompt can stay silent): fall back rather than leave the button spinning.
    window.setTimeout(() => finish(null), 90_000);
  });
}
