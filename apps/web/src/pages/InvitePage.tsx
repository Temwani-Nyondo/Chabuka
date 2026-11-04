import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AuthForm from '../components/AuthForm';
import { useAuth } from '../auth/AuthContext';
import { claimInviteLinkAction } from '../lib/api';
import { clearPendingInvite, stashPendingInvite } from '../lib/pendingInvite';

// Public route: /invite/:code. Logged-out visitors sign in or up on this
// page (the code is stashed so email confirmation can bring them back),
// logged-in players claim with one tap and land in the team.
export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const inviteCode = (code ?? '').trim();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedTeamId, setClaimedTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (inviteCode) stashPendingInvite(inviteCode);
  }, [inviteCode]);

  if (!inviteCode) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const clean = manual.trim();
      if (clean) navigate(`/invite/${encodeURIComponent(clean)}`);
    };
    return (
      <div className="page page-narrow">
        <div className="page-head">
          <span className="eyebrow">Invite</span>
          <h1>Join with a code</h1>
          <p>Paste the invite code someone shared with you.</p>
        </div>
        <form className="card" onSubmit={submit}>
          <label className="field">
            Invite code
            <input
              className="input"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="CHB-XXXXXXXX"
              autoComplete="off"
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!manual.trim()}>
            Continue
          </button>
        </form>
        <p className="muted">
          <Link to="/">Back to Chabuka</Link>
        </p>
      </div>
    );
  }

  const claim = async () => {
    const token = session?.access_token;
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await claimInviteLinkAction(inviteCode, token);
      clearPendingInvite();
      setClaimedTeamId(out.teamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim this invite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <span className="eyebrow">Invite</span>
        <h1>You are invited</h1>
        <p>
          Code <code>{inviteCode}</code>
        </p>
      </div>
      {claimedTeamId ? (
        <div className="card">
          <h2>You are in</h2>
          <p className="muted">The invite is claimed — welcome to the side.</p>
          <div className="actions-row">
            <Link className="btn btn-primary" to={`/teams/${claimedTeamId}`}>
              Open my team
            </Link>
            <Link className="btn btn-ghost" to="/home">Home</Link>
          </div>
        </div>
      ) : !user ? (
        <div className="card">
          <h2>Sign in to claim</h2>
          <p className="muted">
            Sign in or create an account, then claim this invite on this same page.
          </p>
          <AuthForm key={inviteCode} initialMode="signup" onAuthenticated={() => {}} />
        </div>
      ) : (
        <div className="card">
          <h2>Claim this invite</h2>
          <p className="muted">
            Signed in{user.email ? ` as ${user.email}` : ''}. One tap joins you — a team
            invite also adds you to that squad.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { void claim(); }}>
            {busy ? 'Claiming…' : 'Claim invite'}
          </button>
        </div>
      )}
      <p className="muted">
        <Link to="/">Back to Chabuka</Link>
      </p>
    </div>
  );
}
