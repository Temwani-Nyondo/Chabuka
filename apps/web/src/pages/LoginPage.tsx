import { useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthForm from '../components/AuthForm';
import { takePendingInvite } from '../lib/pendingInvite';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from;
  const goHome = useCallback(() => {
    const pending = takePendingInvite();
    if (pending) navigate(`/invite/${encodeURIComponent(pending)}`, { replace: true });
    else navigate('/home', { replace: true });
  }, [navigate]);

  return (
    <div className="auth-page">
      <img className="brand-mark brand-mark-lg" src="/brand/logo-mark.png" alt="Chabuka" width={56} height={56} />
      <h1>Chabuka</h1>
      <p className="muted">Real-life sports matchmaking.</p>
      <AuthForm initialMode="signin" from={from} onAuthenticated={goHome} />
      <p className="muted">
        By continuing you agree to our <Link to="/terms">Terms</Link>. Read our{' '}
        <Link to="/privacy">Privacy</Link> and <Link to="/community">Community &amp; safety</Link>{' '}
        pages.
      </p>
    </div>
  );
}
