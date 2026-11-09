import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import CreateMatchForm from './CreateMatchForm';
import CreateTeamForm from './CreateTeamForm';
import FindOpponentForm from './FindOpponentForm';
import GafferPage from '../pages/GafferPage';
import { useTheme } from '../lib/theme';
import { useUnreadCount } from '../lib/notifications';
import { useAuth } from '../auth/AuthContext';
import { claimTickets } from '../lib/waitapp';

type SheetMode = 'menu' | 'match' | 'team' | 'opponent';

export default function AppShell() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<SheetMode>('menu');
  const [gafferOpen, setGafferOpen] = useState(false);
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const unread = useUnreadCount();
  const { session } = useAuth();
  const claimedFor = useRef<string | null>(null);

  // Tickets bought before this account existed are attached once per sign-in.
  useEffect(() => {
    const token = session?.access_token;
    const uid = session?.user.id ?? null;
    if (!token || !uid || claimedFor.current === uid) return;
    claimedFor.current = uid;
    void claimTickets(token).catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (!gafferOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGafferOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gafferOpen]);

  const closeSheet = () => {
    setSheetOpen(false);
    setMode('menu');
  };
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'topbar-link topbar-link-active' : 'topbar-link';

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="topbar-brand"
          type="button"
          aria-label="Chabuka home"
          onClick={() => navigate('/home')}
        >
          <img className="brand-mark" src="/brand/logo-mark.png" alt="" width={26} height={26} />
          <span>Chabuka</span>
        </button>
        <nav className="topbar-nav" aria-label="Primary">
          <NavLink to="/home" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/explore" className={navClass}>
            Explore
          </NavLink>
          <NavLink to="/teams" className={navClass}>
            Teams
          </NavLink>
          <NavLink to="/notifications" className={navClass} aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}>
            Alerts
            {unread > 0 ? <span className="nav-badge">{unread > 9 ? '9+' : unread}</span> : null}
          </NavLink>
          <NavLink to="/profile" className={navClass}>
            Profile
          </NavLink>
        </nav>
        <div className="topbar-actions">
          <button
            className="btn btn-primary topbar-create"
            type="button"
            onClick={() => {
              setMode('menu');
              setSheetOpen(true);
            }}
          >
            Create
          </button>
          <button className="btn btn-ghost topbar-theme" type="button" onClick={toggle}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      {sheetOpen ? (
        <div className="sheet-backdrop" role="presentation" onClick={closeSheet}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Set something up"
            onClick={(e) => e.stopPropagation()}
          >
            {mode === 'match' ? (
              <>
                <h2>Create match</h2>
                <CreateMatchForm onDone={closeSheet} />
                <button className="btn btn-ghost" type="button" onClick={() => setMode('menu')}>
                  Back
                </button>
              </>
            ) : mode === 'team' ? (
              <>
                <h2>Create team</h2>
                <CreateTeamForm onDone={closeSheet} />
                <button className="btn btn-ghost" type="button" onClick={() => setMode('menu')}>
                  Back
                </button>
              </>
            ) : mode === 'opponent' ? (
              <>
                <h2>Find opponent</h2>
                <FindOpponentForm onDone={closeSheet} />
                <button className="btn btn-ghost" type="button" onClick={() => setMode('menu')}>
                  Back
                </button>
              </>
            ) : (
              <>
                <h2>What do you want to do?</h2>
                <p className="muted">Play</p>
                <button className="sheet-item" type="button" onClick={() => setMode('match')}>
                  <span>Create a match</span>
                  <span className="tag">Open game</span>
                </button>
                <button className="sheet-item" type="button" onClick={() => setMode('opponent')}>
                  <span>Challenge a team</span>
                  <span className="tag">Team vs team</span>
                </button>
                <p className="muted">Organize</p>
                <button className="sheet-item" type="button" onClick={() => setMode('team')}>
                  <span>Start a team</span>
                  <span className="tag">Squad</span>
                </button>
                <button
                  className="sheet-item"
                  type="button"
                  onClick={() => {
                    closeSheet();
                    navigate('/circles');
                  }}
                >
                  <span>Join a circle</span>
                  <span className="tag">Sport groups</span>
                </button>
                <button
                  className="sheet-item"
                  type="button"
                  onClick={() => {
                    closeSheet();
                    navigate('/venues/dashboard');
                  }}
                >
                  <span>Register a venue</span>
                  <span className="tag">Courts & pitches</span>
                </button>
                <button
                  className="sheet-item"
                  type="button"
                  onClick={() => {
                    closeSheet();
                    navigate('/board');
                  }}
                >
                  <span>Run a tournament</span>
                  <span className="tag">Season board</span>
                </button>
                <p className="muted">Elsewhere</p>
                <button
                  className="sheet-item"
                  type="button"
                  onClick={() => {
                    closeSheet();
                    setGafferOpen(true);
                  }}
                >
                  <span>Ask Gaffer</span>
                  <span className="tag">AI helper</span>
                </button>
                <button
                  className="sheet-item"
                  type="button"
                  onClick={() => {
                    closeSheet();
                    navigate('/notifications');
                  }}
                >
                  <span>Notifications</span>
                  <span className="tag">Updates</span>
                </button>
                <button className="btn btn-ghost" type="button" onClick={closeSheet}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {!gafferOpen ? (
        <button
          className="fab-gaffer"
          type="button"
          aria-label="Ask Gaffer"
          onClick={() => setGafferOpen(true)}
        >
          <span className="fab-gaffer-ball" aria-hidden="true">G</span>
          Gaffer
        </button>
      ) : null}
      {gafferOpen ? (
        <div
          className="gaffer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Ask Gaffer"
          onClick={() => setGafferOpen(false)}
        >
          <div className="gaffer-panel" onClick={(e) => e.stopPropagation()}>
            <GafferPage onClose={() => setGafferOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
