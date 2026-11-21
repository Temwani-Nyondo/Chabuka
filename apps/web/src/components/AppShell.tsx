import { useEffect, useRef, useState, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Compass,
  MessageSquareText,
  Plus,
  Radio,
  Settings,
  Shield,
  Swords,
  Trophy,
  Flag,
  Footprints,
  Users,
  Volleyball,
  LogOut,
} from 'lucide-react';
import CreateMatchForm from './CreateMatchForm';
import CreateTeamForm from './CreateTeamForm';
import FindOpponentForm from './FindOpponentForm';
import GafferPage from '../pages/GafferPage';
import { useUnreadCount } from '../lib/notifications';
import { useAuth } from '../auth/AuthContext';
import { claimTickets } from '../lib/waitapp';
import { useIsAdmin } from '../lib/admin';
import { IconButton, Sheet, Wordmark, cx } from './ui';

type CreateMode = 'menu' | 'match' | 'team' | 'opponent';

const CREATE_EVENT = 'chabuka:create';

// Any screen can open the Create sheet, optionally straight on one form.
export function requestCreate(mode: CreateMode = 'menu'): void {
  window.dispatchEvent(new CustomEvent<CreateMode>(CREATE_EVENT, { detail: mode }));
}

const TABS = [
  { to: '/today', label: 'Today', icon: CalendarDays, match: ['/today'] },
  { to: '/explore', label: 'Explore', icon: Compass, match: ['/explore', '/board', '/competitions', '/venues/', '/games/'] },
  { to: '/circles', label: 'Circles', icon: Radio, match: ['/circles'] },
  { to: '/you', label: 'You', icon: CircleUserRound, match: ['/you', '/teams', '/profile'] },
] as const;

function isOn(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname.startsWith(p));
}

export default function AppShell() {
  const [createOpen, setCreateOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>('menu');
  const [gafferOpen, setGafferOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const unread = useUnreadCount();
  const { session, signOut } = useAuth();
  const isAdmin = useIsAdmin();
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
    const onCreate = (e: Event) => {
      setMode((e as CustomEvent<CreateMode>).detail ?? 'menu');
      setCreateOpen(true);
    };
    window.addEventListener(CREATE_EVENT, onCreate);
    return () => window.removeEventListener(CREATE_EVENT, onCreate);
  }, []);

  useEffect(() => {
    if (!gafferOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGafferOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gafferOpen]);

  // Detail screens carry their own bottom action bar.
  const detail = /^\/(games|lineup|rules)\/[^/]+/.test(pathname) || /^\/competitions\/(new|[^/]+\/register)$/.test(pathname) || /^\/races\/(new|[^/]+\/(enter|line))$/.test(pathname);

  const openCreate = () => {
    setMode('menu');
    setCreateOpen(true);
  };
  const closeCreate = () => {
    setCreateOpen(false);
    setMode('menu');
  };
  const go = (to: string) => {
    closeCreate();
    navigate(to);
  };

  const createTitle =
    mode === 'match' ? 'Host a game' : mode === 'team' ? 'Start a team' : mode === 'opponent' ? 'Challenge a team' : 'Create';

  return (
    <div className="app min-h-dvh bg-bg text-ink">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <Link to="/today" className="mb-5 px-2 no-underline" aria-label="Chabuka home">
          <Wordmark />
        </Link>
        <button
          type="button"
          onClick={openCreate}
          className="mb-4 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-brand font-bold text-on-brand hover:brightness-[1.06]"
        >
          <Plus size={18} /> Create
        </button>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {TABS.map((t) => (
            <SideLink key={t.to} to={t.to} icon={<t.icon size={20} />} on={isOn(pathname, t.match)}>
              {t.label}
            </SideLink>
          ))}
          <SideLink to="/notifications" icon={<Bell size={20} />} on={pathname === '/notifications'} badge={unread}>
            Notifications
          </SideLink>
        </nav>
        <p className="mb-1 mt-6 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Manage</p>
        <nav aria-label="Manage" className="flex flex-col gap-0.5">
          <SideLink to="/teams" icon={<Shield size={20} />} on={pathname.startsWith('/teams')}>
            My teams
          </SideLink>
          <SideLink to="/competitions" icon={<Trophy size={20} />} on={pathname.startsWith('/board') || pathname.startsWith('/competitions')}>
            Competitions
          </SideLink>
          <SideLink to="/venues/dashboard" icon={<Building size={20} />} on={pathname === '/venues/dashboard'}>
            My venues
          </SideLink>
          {isAdmin ? (
            <SideLink to="/admin/venues" icon={<Settings size={20} />} on={pathname.startsWith('/admin')}>
              Admin
            </SideLink>
          ) : null}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setGafferOpen(true)}
            className="flex h-11 cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left font-semibold text-ink hover:bg-surface-2"
          >
            <MessageSquareText size={20} /> Ask Gaffer
          </button>
          <SideLink to="/you/settings" icon={<Settings size={20} />} on={pathname === '/you/settings'}>
            Settings
          </SideLink>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex h-11 cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          >
            <LogOut size={20} /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Phone top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/90 pl-4 pr-2 backdrop-blur lg:hidden">
          <Link to="/today" aria-label="Chabuka home" className="no-underline">
            <Wordmark size={26} />
          </Link>
          <div className="flex items-center">
            <IconButton label="Ask Gaffer" onClick={() => setGafferOpen(true)}>
              <MessageSquareText size={22} />
            </IconButton>
            <IconButton label="Notifications" badge={unread} onClick={() => navigate('/notifications')}>
              <Bell size={22} />
            </IconButton>
          </div>
        </header>

        <main className={cx(detail ? 'pb-28' : 'pb-28 lg:pb-12')}>
          {/* A screen that loads on first open shows this inside the frame; the navigation stays put. */}
          <Suspense fallback={<div className="px-4 py-6 text-[14px] text-muted">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Phone tab bar */}
      {!detail ? (
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-center border-t border-line bg-surface pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 lg:hidden"
        >
          {TABS.slice(0, 2).map((t) => (
            <TabLink key={t.to} to={t.to} label={t.label} on={isOn(pathname, t.match)} icon={<t.icon size={22} />} />
          ))}
          <span className="flex justify-center">
            <button
              type="button"
              aria-label="Create"
              onClick={openCreate}
              className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl border-0 bg-brand text-on-brand"
            >
              <Plus size={24} strokeWidth={2.4} />
            </button>
          </span>
          {TABS.slice(2).map((t) => (
            <TabLink key={t.to} to={t.to} label={t.label} on={isOn(pathname, t.match)} icon={<t.icon size={22} />} />
          ))}
        </nav>
      ) : null}

      <Sheet open={createOpen} onClose={closeCreate} title={createTitle} wide={mode !== 'menu'}>
        {mode === 'menu' ? (
          <div className="flex flex-col gap-5">
            <CreateGroup label="Play">
              <CreateItem icon={<Volleyball size={20} />} title="Host a game" sub="An open game anyone nearby can join" onClick={() => setMode('match')} />
              <CreateItem icon={<Swords size={20} />} title="Challenge a team" sub="Find an opponent for your side" onClick={() => setMode('opponent')} />
            </CreateGroup>
            <CreateGroup label="Organise">
              <CreateItem icon={<Shield size={20} />} title="Start a team" sub="Squad, captains and fixtures" onClick={() => setMode('team')} />
              <CreateItem icon={<Trophy size={20} />} title="Run a league or tournament" sub="Entries, fixtures and a live table" onClick={() => go('/competitions/new')} />
              <CreateItem icon={<Footprints size={20} />} title="Organise a race" sub="Marathons, fun runs, a mapped course and results" onClick={() => go('/races/new')} />
              <CreateItem icon={<Flag size={20} />} title="Organise a golf day" sub="Flights, tee times, live Stableford or stroke play scores" onClick={() => go('/golf/new')} />
              <CreateItem icon={<Users size={20} />} title="Start a circle" sub="A channel for a sport and a place" onClick={() => go('/circles?create=1')} />
            </CreateGroup>
            <CreateGroup label="Venue">
              <CreateItem icon={<Building size={20} />} title="List a venue" sub="Publish slots and take bookings" onClick={() => go('/venues/dashboard')} />
            </CreateGroup>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setMode('menu')}
              className="self-start cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text"
            >
              Back to options
            </button>
            {mode === 'match' ? <CreateMatchForm onDone={closeCreate} /> : null}
            {mode === 'team' ? <CreateTeamForm onDone={closeCreate} /> : null}
            {mode === 'opponent' ? <FindOpponentForm onDone={closeCreate} /> : null}
          </div>
        )}
      </Sheet>

      {gafferOpen ? (
        <div className="gaffer-overlay" role="dialog" aria-modal="true" aria-label="Ask Gaffer" onClick={() => setGafferOpen(false)}>
          <div className="gaffer-panel" onClick={(e) => e.stopPropagation()}>
            <GafferPage onClose={() => setGafferOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SideLink({ to, icon, on, badge, children }: { to: string; icon: ReactNode; on: boolean; badge?: number; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'flex h-11 items-center gap-3 rounded-xl px-3 font-semibold no-underline',
        on ? 'bg-brand-soft text-brand-text' : 'text-ink hover:bg-surface-2',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {badge ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-live px-1.5 text-[11px] font-bold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function TabLink({ to, label, icon, on }: { to: string; label: string; icon: ReactNode; on: boolean }) {
  return (
    <NavLink
      to={to}
      aria-current={on ? 'page' : undefined}
      className={cx('flex flex-col items-center gap-0.5 text-[11px] font-semibold no-underline', on ? 'text-brand-text' : 'text-muted')}
    >
      {icon}
      {label}
    </NavLink>
  );
}

function CreateGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
      <div className="overflow-hidden rounded-2xl border border-line">{children}</div>
    </div>
  );
}

function CreateItem({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 border-0 bg-surface px-3.5 py-3 text-left text-ink hover:bg-surface-2 [&+&]:border-t [&+&]:border-line"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <strong>{title}</strong>
        <span className="text-[13px] text-muted">{sub}</span>
      </span>
      <ChevronRight size={18} className="text-muted" aria-hidden="true" />
    </button>
  );
}
