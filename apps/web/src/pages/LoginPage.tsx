import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const { loading, user, needsOnboarding, signInWithPassword, signInWithOAuth } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'meta' | 'google' | 'password' | null>(null);

  if (!loading && user) {
    if (needsOnboarding) return <Navigate to="/onboarding" replace />;
    // After Join-on-landing, land back where the visitor started.
    const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : '/home';
    return <Navigate to={safeFrom} replace />;
  }

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
    <div className="page page-narrow">
      <h1>Chabuka</h1>
      <p className="muted">Real-life sports matchmaking.</p>
      <div className="card">
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void oauth('facebook', 'meta');
          }}
        >
          {busy === 'meta' ? 'Continuing…' : 'Continue with Meta'}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void oauth('google', 'google');
          }}
        >
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
      <p className="muted">
        By continuing you agree to our <Link to="/terms">Terms</Link>. Read our{' '}
        <Link to="/privacy">Privacy</Link> and <Link to="/community">Community &amp; safety</Link>{' '}
        pages.
      </p>
    </div>
  );
}
