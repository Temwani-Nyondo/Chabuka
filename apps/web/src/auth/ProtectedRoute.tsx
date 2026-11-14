import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SIGNED_OUT_KEY, useAuth } from './AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';

function SetupNotice() {
  return (
    <div className="page page-narrow">
      <h1>Chabuka</h1>
      <div className="card">
        <p>
          Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> to <code>apps/web/.env</code> and reload.
        </p>
      </div>
    </div>
  );
}

export default function ProtectedRoute() {
  const { loading, user, needsOnboarding } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading)
    return (
      <div className="page">
        <p className="loading">Loading…</p>
      </div>
    );
  if (!user) {
    // Signed out inside the app (or the session expired, or a shared link was
    // opened while signed out): the login page, not the marketing landing.
    // After a deliberate sign-out there is no page to return to.
    let signedOut = false;
    try {
      signedOut = sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
    } catch {
      signedOut = false;
    }
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={signedOut ? null : { from }} />;
  }
  if (needsOnboarding && location.pathname !== '/onboarding')
    return <Navigate to="/onboarding" replace />;
  if (!needsOnboarding && location.pathname === '/onboarding')
    return <Navigate to="/today" replace />;
  return <Outlet />;
}
