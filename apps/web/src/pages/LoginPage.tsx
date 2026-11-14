import { useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthForm from '../components/AuthForm';
import { LogoMark } from '../components/ui';
import { takePendingInvite } from '../lib/pendingInvite';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from;
  const goHome = useCallback(() => {
    const pending = takePendingInvite();
    if (pending) navigate(`/invite/${encodeURIComponent(pending)}`, { replace: true });
    else navigate('/today', { replace: true });
  }, [navigate]);

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
          <div>
            <h1 className="m-0">Welcome back</h1>
            <p className="m-0 text-[14px] text-muted">Log in or create your free account.</p>
          </div>
          <AuthForm initialMode="signin" from={from} onAuthenticated={goHome} />
          <p className="m-0 text-center text-[12px] text-muted">
            By continuing you agree to our <Link to="/terms">Terms</Link>. Read our <Link to="/privacy">Privacy</Link> and{' '}
            <Link to="/community">Community and safety</Link> pages.
          </p>
        </div>
      </div>
    </div>
  );
}
