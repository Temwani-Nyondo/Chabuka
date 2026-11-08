import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

// Landing page for the password-reset email. Supabase turns the link into a
// recovery session; the user then picks a new password here.
export default function ResetPasswordPage() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    window.setTimeout(() => navigate('/home', { replace: true }), 1200);
  };

  return (
    <div className="auth-page">
      <img className="brand-mark brand-mark-lg" src="/brand/logo-mark.png" alt="Chabuka" width={56} height={56} />
      <h1>Choose a new password</h1>
      <div className="card">
        {loading ? (
          <p className="loading">Loading…</p>
        ) : !session ? (
          <div>
            <p>This reset link has expired or was already used.</p>
            <Link className="btn btn-primary" to="/login">
              Back to sign in
            </Link>
          </div>
        ) : done ? (
          <p>
            <strong>Password updated.</strong> Taking you in…
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            <label className="field">
              New password
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
            <label className="field">
              Confirm password
              <input
                className="input"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
