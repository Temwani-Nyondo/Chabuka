import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { finishWaitAppLink, takeTicketingReturn } from '../lib/waitapp';

// Where WaitApp sends the organiser back after they approve the link. The
// one-time code is traded for the link on Chabuka's server; the browser never
// holds a long-lived token.
export default function WaitAppConnectPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const code = params.get('code');
  const state = params.get('state');

  useEffect(() => {
    const token = session?.access_token;
    if (!code || !state || !token || started.current) return;
    started.current = true;
    finishWaitAppLink(token, code, state)
      .then(() => {
        const matchId = takeTicketingReturn();
        navigate(matchId ? `/explore?highlight=${encodeURIComponent(matchId)}` : '/home', { replace: true });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not finish linking WaitApp.'));
  }, [code, state, session, navigate]);

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Ticket sales</span>
        <h1>Linking WaitApp</h1>
      </div>
      {!code || !state ? (
        <p className="error">This link is incomplete. Go back and press Connect again.</p>
      ) : error ? (
        <>
          <p className="error">{error}</p>
          <Link className="btn" to="/home">
            Back to Home
          </Link>
        </>
      ) : (
        <p className="loading">Finishing the link...</p>
      )}
    </div>
  );
}
