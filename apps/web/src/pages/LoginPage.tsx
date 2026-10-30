import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { loading, user, needsOnboarding, signInWithOtp, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'meta' | 'google' | 'email' | null>(null);

  if (!loading && user)
    return <Navigate to={needsOnboarding ? '/onboarding' : '/'} replace />;

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

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('email');
    setError(null);
    try {
      await signInWithOtp(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page-narrow">
      <h1>Chabuka</h1>
      <p className="muted">Real-life sports matchmaking.</p>
      {sent ? (
        <div className="card">
          <p>Check your inbox for the sign-in link.</p>
        </div>
      ) : (
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
          {/*
            Phone number (OTP) slots in beside the email form when it lands
            post-hackathon. Email doubles as the backup if a provider fails
            during judging.
          */}
          <form
            onSubmit={(e) => {
              void submitEmail(e);
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
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              {busy === 'email' ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
