import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthForm, { clearStashedFrom, readStashedFrom } from '../components/AuthForm';
import { LogoMark } from '../components/ui';
import { SIGNED_OUT_KEY, useAuth } from '../auth/AuthContext';
import { takePendingInvite } from '../lib/pendingInvite';

// Coming back from Google: Supabase puts the session in the address
// (#access_token=… or ?code=…). Read once, before the client clears it.
function returningFromProvider(): boolean {
  if (typeof window === 'undefined') return false;
  const { hash, search } = window.location;
  if (/error=/.test(hash) || /error=/.test(search)) return false;
  return /access_token=/.test(hash) || /[?&]code=/.test(search);
}

// The sign-back-in screen for people who already have an account. New
// visitors meet the landing page instead.
export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loading, user, needsOnboarding } = useAuth();
  const [fromProvider] = useState(returningFromProvider);
  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    try {
      sessionStorage.removeItem(SIGNED_OUT_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);

  const goHome = useCallback(() => {
    const pending = takePendingInvite();
    if (pending) navigate(`/invite/${encodeURIComponent(pending)}`, { replace: true });
    else navigate('/today', { replace: true });
  }, [navigate]);

  // While a sign-in is finishing, show that instead of a form that would
  // appear for a moment and vanish.
  const finishing = !!user || (fromProvider && loading);

  // Once the session is ready: onboarding, the page they came from, or Today.
  useEffect(() => {
    if (loading || !user) return;
    if (needsOnboarding) {
      navigate('/onboarding', { replace: true });
      return;
    }
    const target = from ?? readStashedFrom();
    clearStashedFrom();
    if (target && target.startsWith('/') && !target.startsWith('//') && target !== '/login') {
      navigate(target, { replace: true });
      return;
    }
    goHome();
  }, [loading, user, needsOnboarding, from, navigate, goHome]);

  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[1.1fr_1fr]">
      <div className="relative flex h-56 items-end bg-[url('/sports/football.jpg')] bg-cover bg-center lg:h-auto">
        <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
        <div className="relative p-6 text-white lg:p-12">
          <Link to="/" className="mb-3 inline-flex items-center gap-2 text-[18px] font-extrabold tracking-[-0.02em] text-white no-underline">
            <LogoMark size={28} /> Chabuka
          </Link>
          <p className="m-0 max-w-[30ch] text-[22px] font-extrabold leading-tight tracking-[-0.02em] lg:text-[34px]">
            Find your game. Book the court. Just show up.
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center px-4 py-8">
        <div className="flex w-full max-w-[420px] flex-col gap-4">
          {finishing ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" aria-live="polite">
              <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-surface-3 border-t-brand" aria-hidden="true" />
              <h1 className="m-0 text-[22px]">Signing you in…</h1>
              <p className="m-0 text-[14px] text-muted">Getting your games and teams ready.</p>
            </div>
          ) : (
            <>
              <AuthForm initialMode="signin" from={from} onAuthenticated={goHome} />
              <p className="m-0 text-center text-[14px] text-muted">
                New to Chabuka?{' '}
                <Link to="/" className="font-semibold text-brand-text">
                  See what’s on near you
                </Link>
              </p>
              <p className="m-0 text-center text-[12px] text-muted">
                By continuing you agree to our <Link to="/terms">Terms</Link>. Read our <Link to="/privacy">Privacy</Link> and{' '}
                <Link to="/community">Community and safety</Link> pages.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
