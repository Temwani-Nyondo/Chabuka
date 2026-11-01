import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { loading, user, needsOnboarding, signInWithPassword, signInWithOAuth } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const submit = async (e: FormEvent) => {
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
        <form
          onSubmit={(e) => {
            void submit(e);
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
      </div>
      <p className="muted">
        By continuing you agree to our <Link to="/terms">Terms</Link>. Read our{' '}
        <Link to="/privacy">Privacy</Link> and <Link to="/community">Community &amp; safety</Link>{' '}
        pages.
      </p>
    </div>
  );
}
