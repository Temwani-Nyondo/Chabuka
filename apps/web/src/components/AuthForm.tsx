import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import Turnstile, { TURNSTILE_SITE_KEY } from './Turnstile';
import type { TurnstileHandle } from './Turnstile';

type Mode = 'signin' | 'signup' | 'forgot';

// Social buttons need the Google and Facebook providers enabled in Supabase
// (Auth > Providers) with their client IDs and secrets.
const SOCIAL_LOGIN_ENABLED = true;

const FROM_KEY = 'chabuka:oauth-from';
const RESEND_SECONDS = 60;

// The OAuth round trip leaves the page, so remember where to return to.
function stashFrom(from: string | undefined): void {
  try {
    if (from) window.sessionStorage.setItem(FROM_KEY, from);
  } catch {
    // Private mode: they land on the default page instead.
  }
}

function readStashedFrom(): string | null {
  try {
    return window.sessionStorage.getItem(FROM_KEY);
  } catch {
    return null;
  }
}

function clearStashedFrom(): void {
  try {
    window.sessionStorage.removeItem(FROM_KEY);
  } catch {
    // Nothing to clear.
  }
}

function friendlyError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Wrong email or password.';
  if (lower.includes('email not confirmed'))
    return 'Confirm your email first. Check your inbox for the link, or resend it below.';
  if (lower.includes('captcha')) return 'Verification failed. Please try the check again.';
  if (lower.includes('rate limit') || lower.includes('too many'))
    return 'Too many attempts. Wait a few minutes and try again.';
  return msg || fallback;
}

// Shared sign-in / sign-up form: the /login page and the landing-page modal
// render the same form so visitors never leave the page to authenticate.
export default function AuthForm({
  initialMode = 'signin',
  from,
  onAuthenticated,
}: {
  initialMode?: Mode;
  from?: string;
  onAuthenticated?: () => void;
}) {
  const { loading, user, needsOnboarding, signInWithPassword, signInWithOAuth } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<'meta' | 'google' | 'password' | null>(null);
  const captchaRef = useRef<TurnstileHandle | null>(null);
  const [params] = useSearchParams();
  const justConfirmed = params.get('confirmed') === '1';

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (loading || !user) return;
    if (needsOnboarding) {
      navigate('/onboarding', { replace: true });
      return;
    }
    const target = from ?? readStashedFrom();
    const safeFrom = target && target.startsWith('/') && !target.startsWith('//') ? target : null;
    clearStashedFrom();
    if (safeFrom) {
      navigate(safeFrom, { replace: true });
      return;
    }
    onAuthenticated?.();
  }, [loading, user, needsOnboarding, from, navigate, onAuthenticated]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setSent(false);
    setResetSent(false);
    setNeedsConfirm(false);
    captchaRef.current?.reset();
  };

  // Captcha is required whenever a site key is configured; the token is
  // single use, so every attempt resets the widget.
  const captchaMissing = TURNSTILE_SITE_KEY !== '' && !captcha;
  const finishAttempt = () => {
    captchaRef.current?.reset();
    setBusy(null);
  };

  const oauth = async (provider: 'facebook' | 'google', label: 'meta' | 'google') => {
    setBusy(label);
    setError(null);
    stashFrom(from);
    try {
      await signInWithOAuth(provider);
    } catch (err) {
      setError(friendlyError(err, 'Sign-in failed.'));
      setBusy(null);
    }
  };

  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (captchaMissing) {
      setError('Please complete the verification check.');
      return;
    }
    setBusy('password');
    setError(null);
    setNeedsConfirm(false);
    try {
      await signInWithPassword(email.trim(), password, captcha ?? undefined);
    } catch (err) {
      const msg = friendlyError(err, 'Sign-in failed.');
      setError(msg);
      setNeedsConfirm(err instanceof Error && err.message.toLowerCase().includes('email not confirmed'));
      finishAttempt();
    }
  };

  const submitSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !isSupabaseConfigured) {
      setError('Sign-up is not available right now. Try again later.');
      return;
    }
    if (captchaMissing) {
      setError('Please complete the verification check.');
      return;
    }
    setBusy('password');
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
          captchaToken: captcha ?? undefined,
          // The confirmation email bounces back to OUR url; Supabase
          // verifies the link and hands the session to the app there.
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
        },
      });
      if (error) throw error;
      // Supabase answers "success" with no identities for an email that is
      // already registered, to avoid leaking which emails have accounts.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        setError('That email already has an account. Sign in instead, or reset your password.');
        return;
      }
      setSent(true);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(friendlyError(err, 'Sign-up failed.'));
    } finally {
      finishAttempt();
    }
  };

  const resendConfirmation = async () => {
    if (!supabase || cooldown > 0) return;
    if (captchaMissing) {
      setError('Please complete the verification check.');
      return;
    }
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        captchaToken: captcha ?? undefined,
        emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
      },
    });
    captchaRef.current?.reset();
    if (error) {
      setError(friendlyError(error, 'Could not resend the email.'));
      return;
    }
    setInfo(`Sent again to ${email.trim()}.`);
    setCooldown(RESEND_SECONDS);
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (captchaMissing) {
      setError('Please complete the verification check.');
      return;
    }
    setBusy('password');
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        captchaToken: captcha ?? undefined,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      // Same answer whether or not the email has an account.
      setResetSent(true);
    } catch (err) {
      setError(friendlyError(err, 'Could not send the reset email.'));
    } finally {
      finishAttempt();
    }
  };

  const captchaWidget = <Turnstile ref={captchaRef} onToken={setCaptcha} />;

  const heading =
    mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Welcome back';
  const subheading =
    mode === 'signup'
      ? 'Find a game, a team and a place to play.'
      : mode === 'forgot'
        ? 'We will email you a link to choose a new one.'
        : 'Log in to see your games and teams.';

  return (
    <div className="card auth-card">
      <div className="auth-head">
        <h2 className="auth-title">{heading}</h2>
        <p className="muted">{subheading}</p>
      </div>
      {SOCIAL_LOGIN_ENABLED && mode !== 'forgot' ? (
      <div className="social-row">
      <button
        className="btn btn-social"
        type="button"
        aria-label="Continue with Google"
        disabled={busy !== null}
        onClick={() => {
          void oauth('google', 'google');
        }}
      >
        <span className="brand-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        </span>
        {busy === 'google' ? 'Opening…' : 'Google'}
      </button>
      <button
        className="btn btn-social"
        type="button"
        aria-label="Continue with Facebook"
        disabled={busy !== null}
        onClick={() => {
          void oauth('facebook', 'meta');
        }}
      >
        <span className="brand-icon brand-icon-meta" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.3 0-1.1-.1-2.1-.1-2.1 0-3.6 1.3-3.6 3.7V11H8.2v3h2.5v7h2.8z"
            />
          </svg>
        </span>
        {busy === 'meta' ? 'Opening…' : 'Facebook'}
      </button>
      </div>
      ) : null}
      {SOCIAL_LOGIN_ENABLED && mode !== 'forgot' ? (
        <div className="divider" role="separator">
          <span>or use email</span>
        </div>
      ) : null}
      {mode !== 'forgot' ? (
        <div className="seg" role="tablist" aria-label="Log in or create account">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={mode === 'signin' ? 'seg-btn seg-btn-active' : 'seg-btn'}
            onClick={() => switchMode('signin')}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'seg-btn seg-btn-active' : 'seg-btn'}
            onClick={() => switchMode('signup')}
          >
            Create account
          </button>
        </div>
      ) : null}
      {justConfirmed && mode === 'signin' && !user ? (
        <p className="muted">Email confirmed. Log in to continue.</p>
      ) : null}
      {mode === 'forgot' ? (
        resetSent ? (
          <div>
            <p>
              <strong>Check your inbox.</strong> If {email.trim()} has an account, a reset link is on
              its way.
            </p>
            <button className="btn btn-ghost" type="button" onClick={() => switchMode('signin')}>
              Back to log in
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void submitForgot(e);
            }}
          >
            <label className="field">
              Email
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            {captchaWidget}
            {error ? <p className="error">{error}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy !== null || captchaMissing}>
              {busy === 'password' ? 'Sending…' : 'Send reset link'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => switchMode('signin')}>
              Back to log in
            </button>
          </form>
        )
      ) : mode === 'signin' ? (
        <form
          onSubmit={(e) => {
            void submitSignIn(e);
          }}
        >
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <div className="field">
            <div className="field-row">
              <label htmlFor="auth-password">Password</label>
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            </div>
            <input
              id="auth-password"
              className="input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>
          {captchaWidget}
          {error ? <p className="error">{error}</p> : null}
          {info ? <p className="muted">{info}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy !== null || captchaMissing}>
            {busy === 'password' ? 'Logging in…' : 'Log in'}
          </button>
          {needsConfirm ? (
            <button
              className="btn"
              type="button"
              disabled={cooldown > 0 || captchaMissing}
              onClick={() => {
                void resendConfirmation();
              }}
            >
              {cooldown > 0 ? `Resend confirmation (${cooldown}s)` : 'Resend confirmation email'}
            </button>
          ) : null}

        </form>
      ) : sent ? (
        <div>
          <p>
            <strong>Check your inbox.</strong> We sent a confirmation email to {email.trim()}.
            Click the link in it and you will be signed straight in.
          </p>
          <p className="muted">No email yet? Check spam, then resend it.</p>
          {captchaWidget}
          {error ? <p className="error">{error}</p> : null}
          {info ? <p className="muted">{info}</p> : null}
          <button
            className="btn"
            type="button"
            disabled={cooldown > 0 || captchaMissing}
            onClick={() => {
              void resendConfirmation();
            }}
          >
            {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            void submitSignUp(e);
          }}
        >
          <label className="field">
            Username
            <input
              className="input"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should players call you?"
              autoComplete="nickname"
              maxLength={80}
            />
          </label>
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>
          <label className="field field-check">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              required
            />{' '}
            I agree to the <Link to="/terms">Terms of Use</Link>.
          </label>
          {captchaWidget}
          {error ? <p className="error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy !== null || captchaMissing}>
            {busy === 'password' ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}
    </div>
  );
}
