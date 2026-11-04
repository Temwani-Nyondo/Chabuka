import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'meta' | 'google' | 'password' | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    if (needsOnboarding) {
      navigate('/onboarding', { replace: true });
      return;
    }
    const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : null;
    if (safeFrom) {
      navigate(safeFrom, { replace: true });
      return;
    }
    onAuthenticated?.();
  }, [loading, user, needsOnboarding, from, navigate, onAuthenticated]);

  const oauth = async (provider: 'facebook' | 'google', label: 'meta' | 'google') => {
    setBusy(label);
    setError(null);
    try {
      await signInWithOAuth(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(null);
    }
  };

  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(null);
    }
  };

  const submitSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !isSupabaseConfigured) {
      setError('Sign-up is not available right now. Try again later.');
      return;
    }
    setBusy('password');
    setError(null);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
          // The confirmation email bounces back to OUR url; Supabase
          // verifies the link and hands the session to the app there.
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <button
        className="btn btn-brand"
        type="button"
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
        {busy === 'meta' ? 'Continuing…' : 'Continue with Meta'}
      </button>
      <button
        className="btn btn-brand"
        type="button"
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
        {busy === 'google' ? 'Continuing…' : 'Continue with Google'}
      </button>
      <div className="divider" role="separator">
        or
      </div>
      <div className="chips" role="tablist" aria-label="Sign in or create account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={mode === 'signin' ? 'chip chip-active' : 'chip'}
          onClick={() => {
            setMode('signin');
            setError(null);
            setSent(false);
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={mode === 'signup' ? 'chip chip-active' : 'chip'}
          onClick={() => {
            setMode('signup');
            setError(null);
            setSent(false);
          }}
        >
          Create account
        </button>
      </div>
      {mode === 'signin' ? (
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
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            {busy === 'password' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : sent ? (
        <div>
          <p>
            <strong>Check your inbox.</strong> We sent a confirmation email to {email.trim()}.
            Click the link in it and you will be signed straight in.
          </p>
          <p className="muted">No email yet? Check spam, then try again in a few minutes.</p>
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
          {error ? <p className="error">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            {busy === 'password' ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}
    </div>
  );
}
