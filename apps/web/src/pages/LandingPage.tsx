import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, CircleMarker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import AuthForm from '../components/AuthForm';
import { useTheme } from '../lib/theme';

// Static first cut: every game and venue below is SAMPLE content, clearly
// labelled, until the public-read RLS change is approved and real data is
// wired in. No network calls here on purpose.

interface SampleGame {
  id: string;
  sport: string;
  title: string;
  area: string;
  day: string;
  spots: string;
  lat: number;
  lng: number;
}

interface SampleVenue {
  id: string;
  name: string;
  area: string;
  sports: string;
  note: string;
}

const SAMPLE_GAMES: SampleGame[] = [
  {
    id: 'sample-1',
    sport: 'Basketball',
    title: 'Tuesday evening 5v5 run',
    area: 'Avondale',
    day: 'Tue 6:00 PM',
    spots: '7/10 in',
    lat: -15.405,
    lng: 28.355,
  },
  {
    id: 'sample-2',
    sport: 'Football',
    title: 'Saturday morning 7-a-side',
    area: 'Woodlands',
    day: 'Sat 9:00 AM',
    spots: '9/14 in',
    lat: -15.4395,
    lng: 28.3512,
  },
  {
    id: 'sample-3',
    sport: 'Netball',
    title: 'Sunday social netball',
    area: 'Kabulonga',
    day: 'Sun 3:00 PM',
    spots: '5/12 in',
    lat: -15.4189,
    lng: 28.3489,
  },
];

const SAMPLE_VENUES: SampleVenue[] = [
  {
    id: 'sample-v1',
    name: 'Avondale Community Court',
    area: 'Avondale',
    sports: 'Basketball · Netball',
    note: 'Evenings · Free',
  },
  {
    id: 'sample-v2',
    name: 'Woodlands Sports Field',
    area: 'Woodlands',
    sports: 'Football · Rugby',
    note: 'Weekends · Free',
  },
];

const SPORTS = ['All', 'Basketball', 'Football', 'Netball'];

const STEPS = [
  {
    title: 'Find a game',
    body: 'Search by sport and area, or browse open games near you.',
  },
  {
    title: 'Join your side',
    body: 'Tap Join and the organiser sees you are in. No calls, no group chats.',
  },
  {
    title: 'Show up and play',
    body: 'Get the venue pin and tip-off time. Scores and recaps live on the board.',
  },
];

function GameMiniMap({ game }: { game: SampleGame }) {
  return (
    <div className="map-box game-map" aria-label={`Map for ${game.title}`}>
      <MapContainer
        key={game.id}
        center={[game.lat, game.lng]}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={[game.lat, game.lng]}
          radius={8}
          pathOptions={{ color: '#181206', fillColor: '#ffb300', fillOpacity: 0.95 }}
        >
          <Popup>
            <strong>{game.title}</strong>
            <br />
            {game.area} · {game.day}
          </Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}

export default function LandingPage() {
  const [sport, setSport] = useState('All');
  const [query, setQuery] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [mapId, setMapId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const { theme, toggle } = useTheme();

  // Floating auth modal: visitors sign in or up without leaving the page.
  // After auth the landing gate sends them home on its own.
  useEffect(() => {
    if (!authMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authMode]);

  // Hero search plus chips filter the same sample list of games.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_GAMES.filter((g) => {
      if (sport !== 'All' && g.sport !== sport) return false;
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.area.toLowerCase().includes(q) ||
        g.sport.toLowerCase().includes(q)
      );
    });
  }, [sport, query]);

  // Highlight the how-it-works step currently in view.
  useEffect(() => {
    const root = stepsRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const cards = [...root.querySelectorAll<HTMLElement>('[data-step]')];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.step ?? 0);
            setActiveStep(index);
          }
        }
      },
      { rootMargin: '-40% 0px -40% 0px' },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  const join = (_id: string) => {
    // Sample games are not joinable yet: signing up is the next step.
    setAuthMode('signup');
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <Link className="landing-logo" to="/">
          <img className="brand-mark" src="/brand/logo-mark.png" alt="" width={30} height={30} />
          Chabuka
        </Link>
        <nav className="landing-nav" aria-label="Primary">
          <a href="#games">Find games</a>
          <a href="#venues">Venues</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="landing-auth">
          <button className="btn btn-ghost" type="button" onClick={toggle} aria-label="Switch theme">
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setAuthMode('signin')}>
            Log in
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setAuthMode('signup')}>
            Sign up
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-band" style={{ backgroundImage: "url('/brand/hero-pitch.jpg')" }}>
          <div className="hero-band-inner">
            <h1 className="landing-title">Find your game. Book the court. Just show up.</h1>
            <p className="hero-sub">
              Chabuka matches you with open grassroots games and bookable venues near you —
              football, basketball, netball and more. Pick a sport and an area, then open a
              game below for its map and directions.
            </p>
            <div className="actions-row landing-ctas">
              <a className="btn btn-primary" href="#games">
                Find a game
              </a>
              <button className="btn btn-hero-ghost" type="button" onClick={() => setAuthMode('signup')}>
                Sign up free
              </button>
            </div>
            <div className="landing-search" role="search">
              <label className="field">
                Sport
                <select
                  className="input"
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  aria-label="Filter by sport"
                >
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Area or game
                <input
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Avondale, basketball…"
                  aria-label="Search games"
                />
              </label>
            </div>
          </div>
          </div>
        </section>

        <section id="games" aria-label="Open games near you">
          <div className="row">
            <h2>Upcoming games</h2>
            <span className="tag">Sample data</span>
          </div>
          <div className="chips" role="group" aria-label="Filter by sport">
            {SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                className={sport === s ? 'chip chip-active' : 'chip'}
                aria-pressed={sport === s}
                onClick={() => setSport(s)}
              >
                {s}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="muted">No sample games match that search. Try another sport or area.</p>
          ) : null}
          {visible.map((g) => (
            <div className="card" key={g.id}>
              <div className="row">
                <strong>
                  {g.sport} · {g.day}
                </strong>
                <span className="tag">{g.spots}</span>
              </div>
              <p className="muted">
                {g.title} · {g.area}
              </p>
              <div className="actions-row">
                <button className="btn btn-primary" type="button" onClick={() => join(g.id)}>
                  Join
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  aria-expanded={mapId === g.id}
                  onClick={() => setMapId(mapId === g.id ? null : g.id)}
                >
                  {mapId === g.id ? 'Hide map' : 'View on map'}
                </button>
                <a
                  className="btn btn-ghost"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Directions
                </a>
              </div>
              {mapId === g.id ? <GameMiniMap game={g} /> : null}
            </div>
          ))}
        </section>

        <section id="how" aria-label="How it works">
          <h2>How it works</h2>
          <div className="landing-steps" ref={stepsRef}>
            {STEPS.map((step, i) => (
              <div
                key={step.title}
                data-step={i}
                className={activeStep === i ? 'card landing-step landing-step-active' : 'card landing-step'}
                tabIndex={0}
                aria-current={activeStep === i ? 'step' : undefined}
              >
                <strong>
                  {i + 1}. {step.title}
                </strong>
                <p className="muted">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="venues" aria-label="Venues you can book">
          <h2>Venues you can book</h2>
          {SAMPLE_VENUES.map((v) => (
            <div className="card" key={v.id}>
              <div className="row">
                <strong>{v.name}</strong>
                <span className="tag">{v.area}</span>
              </div>
              <p className="muted">
                {v.sports} · {v.note}
              </p>
            </div>
          ))}
        </section>

        <section className="card landing-cta landing-cta-photo" aria-label="Get started">
          <img className="brand-mark brand-mark-lg" src="/brand/logo-mark.png" alt="" width={56} height={56} />
          <h2>Your next game is already on</h2>
          <p className="muted">Sign in to join a side, book a court, or ask Gaffer to sort it.</p>
          <button className="btn btn-primary" type="button" onClick={() => setAuthMode('signup')}>
            Sign up free
          </button>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Chabuka · real-life sports matchmaking</span>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> ·{' '}
          <Link to="/community">Community</Link>
        </nav>
      </footer>
      {authMode ? (
        <div
          className="modal-overlay modal-overlay-sports"
          role="dialog"
          aria-modal="true"
          aria-label={authMode === 'signin' ? 'Log in' : 'Sign up'}
          onClick={() => setAuthMode(null)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              type="button"
              onClick={() => setAuthMode(null)}
              aria-label="Close"
            >
              &times;
            </button>
            <AuthForm
              key={authMode}
              initialMode={authMode}
              onAuthenticated={() => setAuthMode(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
