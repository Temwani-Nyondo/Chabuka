import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapContainer, CircleMarker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

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

function SampleMap({ games }: { games: SampleGame[] }) {
  const center: [number, number] =
    games.length > 0 ? [games[0]!.lat, games[0]!.lng] : [-15.4167, 28.2833];
  return (
    <div className="map-box map-box-tall" aria-label="Sample map of games">
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {games.map((g) => (
          <CircleMarker
            key={g.id}
            center={[g.lat, g.lng]}
            radius={8}
            pathOptions={{ color: '#0b0f14', fillColor: '#c6ff00', fillOpacity: 0.95 }}
          >
            <Popup>
              <strong>{g.title}</strong>
              <br />
              {g.area} · {g.day}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [sport, setSport] = useState('All');
  const [query, setQuery] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const stepsRef = useRef<HTMLDivElement>(null);

  // Hero search plus chips filter the same sample list: map and cards move together.
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

  const join = (id: string) => {
    // Visitors sign in first, then land back here to finish joining.
    navigate('/login', { state: { from: `/?game=${id}` } });
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <Link className="landing-logo" to="/">
          Chabuka
        </Link>
        <nav className="landing-nav" aria-label="Primary">
          <a href="#games">Find games</a>
          <a href="#venues">Venues</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="landing-auth">
          <Link className="btn btn-ghost" to="/login">
            Log in
          </Link>
          <Link className="btn btn-primary" to="/login">
            Sign up
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div>
            <h1>Find a game near you</h1>
            <p className="muted">
              Real-life sports matchmaking in Lusaka. Pick a sport and an area — the map and the
              games below move together.
            </p>
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
          <SampleMap games={visible} />
        </section>

        <section id="games" aria-label="Open games near you">
          <div className="row">
            <h2>Open games near you</h2>
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
              <button className="btn btn-primary" type="button" onClick={() => join(g.id)}>
                Join
              </button>
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

        <section className="card landing-cta" aria-label="Get started">
          <h2>Your next game is already on</h2>
          <p className="muted">Sign in to join a side, book a court, or ask the Gaffer to sort it.</p>
          <Link className="btn btn-primary" to="/login">
            Sign up free
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Chabuka · real-life sports matchmaking</span>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> ·{' '}
          <Link to="/community">Community</Link>
        </nav>
      </footer>
    </div>
  );
}
