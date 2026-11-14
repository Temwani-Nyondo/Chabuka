import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building, CalendarCheck, MapPin, Moon, Navigation, Search, Shield, Sun, Timer, Trophy, UserPlus } from 'lucide-react';
import AuthForm from '../components/AuthForm';
import { Badge, Button, Meter, Sheet, Wordmark, cx } from '../components/ui';
import { sportBackdrop, sportLabel } from '../components/GameCard';
import { useTheme } from '../lib/theme';
import { API_BASE } from '../lib/api';

// Live data: upcoming open games and approved venues from the public landing
// endpoint. A signed-out visitor sees no personal data, only game and venue
// details. Joining needs an account, so Join opens sign-up.

interface LiveGame {
  id: string;
  sport: string;
  title: string;
  area: string | null;
  venueName: string | null;
  startsAt: string;
  spotsTaken: number;
  capacity: number;
  lat: number | null;
  lng: number | null;
}

interface LiveVenue {
  id: string;
  name: string;
  area: string | null;
  sports: string[];
  priceNote: string | null;
}

const SPORT_TILES = ['Football', 'Futsal', 'Basketball', 'Netball', 'Tennis', 'Padel'];

const STEPS = [
  { icon: Search, title: 'Find a game', body: 'Search by sport and area, or browse open games near you.' },
  { icon: UserPlus, title: 'Join your side', body: 'Tap Join and the host sees you are in. No calls, no group chats.' },
  { icon: Navigation, title: 'Show up and play', body: 'Directions, kick-off time and the live score in one place.' },
];

const ORGANISERS = [
  { icon: Shield, title: 'Run your team', body: 'Squad, captains, availability for every fixture and your lineup on the pitch.' },
  { icon: Trophy, title: 'Run a league', body: 'Entries, fixtures, results both captains confirm, and a live table.' },
  { icon: Timer, title: 'Officiate', body: 'A shared match clock, score and cards that everyone can follow live.' },
  { icon: Building, title: 'List a venue', body: 'Publish slots, take booking requests and check players in.' },
];

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export default function LandingPage() {
  const [sport, setSport] = useState('All');
  const [games, setGames] = useState<LiveGame[]>([]);
  const [venues, setVenues] = useState<LiveVenue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/landing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('landing'))))
      .then((d: { games: LiveGame[]; venues: LiveVenue[] }) => {
        if (cancelled) return;
        setGames(d.games);
        setVenues(d.venues);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sportChips = useMemo(() => ['All', ...new Set(games.map((g) => g.sport))], [games]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games.filter((g) => {
      if (sport !== 'All' && g.sport.toLowerCase() !== sport.toLowerCase()) return false;
      if (!q) return true;
      return g.title.toLowerCase().includes(q) || (g.area ?? '').toLowerCase().includes(q) || g.sport.toLowerCase().includes(q);
    });
  }, [games, sport, query]);

  const pickSport = (name: string) => {
    setSport(name);
    document.getElementById('games')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-4">
          <Link to="/" className="no-underline" aria-label="Chabuka home">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden gap-5 text-[14px] font-semibold md:flex">
            <a href="#games" className="text-muted no-underline hover:text-ink">Games</a>
            <a href="#organisers" className="text-muted no-underline hover:text-ink">For organisers</a>
            <a href="#venues" className="text-muted no-underline hover:text-ink">Venues</a>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink hover:bg-surface-2"
            >
              {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <Button variant="ghost" size="sm" onClick={() => setAuthMode('signin')}>
              Log in
            </Button>
            <Button variant="primary" size="sm" onClick={() => setAuthMode('signup')}>
              Sign up
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative bg-[url('/brand/hero-pitch.jpg')] bg-cover bg-center">
          <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
          <div className="relative mx-auto flex max-w-[1120px] flex-col gap-5 px-4 py-16 text-white sm:py-24">
            <h1 className="m-0 max-w-[16ch] text-[38px] leading-[1.05] tracking-[-0.035em] text-white sm:text-[56px]">
              Find your game. Book the court. Just show up.
            </h1>
            <p className="m-0 max-w-[52ch] text-[16px] text-white/85">
              Open grassroots games, teams, leagues and bookable venues in Lusaka. Football, basketball, netball and more.
            </p>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                document.getElementById('games')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex max-w-[640px] flex-col gap-2 rounded-2xl bg-surface p-2 text-ink sm:flex-row"
            >
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                aria-label="Sport"
                className="h-12 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink sm:w-44"
              >
                {sportChips.map((s) => (
                  <option key={s} value={s}>
                    {s === 'All' ? 'Any sport' : sportLabel(s)}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Area or game, e.g. Avondale"
                aria-label="Area or game"
                className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink"
              />
              <Button type="submit" variant="primary" size="lg" icon={<Search size={18} />}>
                Find games
              </Button>
            </form>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-4 pt-10" aria-label="Sports">
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {SPORT_TILES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => pickSport(name)}
                className="relative h-28 w-40 shrink-0 cursor-pointer overflow-hidden rounded-2xl border-0 bg-cover bg-center p-0 text-left"
                style={{ backgroundImage: `url(${sportBackdrop(name)})` }}
              >
                <span className="absolute inset-0 bg-black/40" aria-hidden="true" />
                <span className="absolute bottom-2.5 left-3 text-[15px] font-extrabold text-white">{name}</span>
              </button>
            ))}
          </div>
        </section>

        <section id="games" className="mx-auto flex max-w-[1120px] scroll-mt-20 flex-col gap-4 px-4 pt-10" aria-label="Upcoming games">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Upcoming games</h2>
            {sport !== 'All' ? (
              <button type="button" onClick={() => setSport('All')} className="cursor-pointer border-0 bg-transparent text-[14px] font-semibold text-brand-text">
                Showing {sportLabel(sport)} · show all
              </button>
            ) : null}
          </div>
          {visible.length === 0 ? (
            <p className="m-0 rounded-2xl border border-dashed border-line-strong p-6 text-center text-[15px] text-muted">
              {!loaded
                ? 'Loading games…'
                : games.length === 0
                  ? 'No games are on yet. Sign up and host the first one in your area.'
                  : 'No games match that search. Try another sport or area.'}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((g) => {
                const left = Math.max(0, g.capacity - g.spotsTaken);
                return (
                  <article key={g.id} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4">
                    <div className="flex items-center justify-between">
                      <Badge tone="brand">{sportLabel(g.sport)}</Badge>
                      <span className="text-[12px] font-bold text-muted">{dayFmt.format(new Date(g.startsAt))}</span>
                    </div>
                    <span className="tnum text-[24px] font-extrabold leading-none tracking-[-0.03em]">{timeFmt.format(new Date(g.startsAt))}</span>
                    <strong>{g.title}</strong>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <MapPin size={14} /> {g.venueName ?? g.area ?? 'Lusaka'}
                    </span>
                    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
                      <span className="text-[13px] text-muted">
                        <strong className="tnum text-ink">
                          {g.spotsTaken}/{g.capacity}
                        </strong>{' '}
                        in · {left} spot{left === 1 ? '' : 's'} left
                      </span>
                      <Meter value={g.spotsTaken} max={g.capacity} />
                    </div>
                    <div className="mt-auto flex gap-2 pt-1">
                      <Button variant="primary" size="sm" onClick={() => setAuthMode('signup')}>
                        Join
                      </Button>
                      {g.lat != null && g.lng != null ? (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-bold text-ink no-underline hover:bg-surface-2"
                        >
                          <Navigation size={14} /> Directions
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mx-auto max-w-[1120px] px-4 pt-14" aria-label="How it works">
          <h2 className="m-0 mb-4 text-[24px] font-extrabold tracking-[-0.02em]">How it works</h2>
          <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                  <s.icon size={20} />
                </span>
                <strong className="text-[16px]">
                  {i + 1}. {s.title}
                </strong>
                <span className="text-[14px] text-muted">{s.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <section id="organisers" className="mx-auto max-w-[1120px] scroll-mt-20 px-4 pt-14" aria-label="For organisers">
          <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">For captains, organisers and venues</h2>
          <p className="m-0 mb-4 mt-1 text-[15px] text-muted">The admin side of grassroots sport, without the spreadsheets and group chats.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ORGANISERS.map((o) => (
              <div key={o.title} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
                <o.icon size={22} className="text-brand-text" />
                <strong className="text-[16px]">{o.title}</strong>
                <span className="text-[14px] text-muted">{o.body}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="venues" className="mx-auto max-w-[1120px] scroll-mt-20 px-4 pt-14" aria-label="Venues you can book">
          <h2 className="m-0 mb-4 text-[24px] font-extrabold tracking-[-0.02em]">Venues you can book</h2>
          {venues.length === 0 ? (
            <p className="m-0 text-[15px] text-muted">{loaded ? 'No venues listed yet. Own a pitch or court? Sign up and list it.' : 'Loading venues…'}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {venues.map((v) => (
                <div key={v.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                    <CalendarCheck size={20} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <strong>{v.name}</strong>
                    <span className="text-[13px] text-muted">{[v.area, v.sports.map(sportLabel).join(', ')].filter(Boolean).join(' · ')}</span>
                    {v.priceNote ? <span className="text-[13px] font-semibold">{v.priceNote}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mx-auto max-w-[1120px] px-4 py-14" aria-label="Get started">
          <div className="relative overflow-hidden rounded-3xl bg-[url('/brand/celebration.jpg')] bg-cover bg-center">
            <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
            <div className="relative flex flex-col items-start gap-3 p-8 text-white sm:p-12">
              <h2 className="m-0 max-w-[20ch] text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-white">Your next game is already on</h2>
              <p className="m-0 text-white/85">Join a side, book a court, or ask Gaffer to sort it.</p>
              <Button variant="primary" size="lg" onClick={() => setAuthMode('signup')}>
                Sign up free
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-muted">
          <span>Chabuka · grassroots sport, organised</span>
          <nav aria-label="Legal" className={cx('flex flex-wrap gap-4')}>
            <Link to="/privacy" className="text-muted">Privacy</Link>
            <Link to="/terms" className="text-muted">Terms</Link>
            <Link to="/community" className="text-muted">Community</Link>
            <Link to="/data-deletion" className="text-muted">Data deletion</Link>
          </nav>
        </div>
      </footer>

      <Sheet open={authMode !== null} onClose={() => setAuthMode(null)} title={authMode === 'signin' ? 'Log in' : 'Create your account'}>
        {authMode ? <AuthForm key={authMode} initialMode={authMode} onAuthenticated={() => setAuthMode(null)} /> : null}
      </Sheet>
    </div>
  );
}
