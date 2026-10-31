import { Link } from 'react-router-dom';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page page-narrow">
      <h1>{title}</h1>
      {children}
      <p className="muted">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> ·{' '}
        <Link to="/community">Community &amp; safety</Link>
      </p>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy">
      <div className="card">
        <p>Chabuka stores what it needs to arrange games, and nothing else:</p>
        <p className="muted">
          Your profile (name, photo, town and locality, sports and level), optional year of birth
          shown only as an age band, optional gender, your matches, teams, bookings and tickets.
        </p>
        <p className="muted">
          There is no chat in Chabuka, so there are no messages to store. Agent access tokens are
          stored only as a hash; every AI call runs as you, under the same rules as the app.
        </p>
        <p className="muted">
          We never sell personal data. Deleting your account deletes your profile and tokens.
          Questions: ask through your team organiser or venue contact.
        </p>
      </div>
    </Shell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Terms">
      <div className="card">
        <p>Chabuka arranges real-life grassroots sport. By using it you agree to:</p>
        <p className="muted">
          Show up for games you join, or withdraw in time. Organisers keep fixture details
          (time, place, capacity) accurate. All bookings and tickets are free during the demo;
          there are no payments in Chabuka.
        </p>
        <p className="muted">
          Standings are calculated from results organisers post. Chabuka is provided as-is for
          the hackathon demo; schedules can change, so confirm with your organiser on the day.
        </p>
      </div>
    </Shell>
  );
}

export function CommunityPage() {
  return (
    <Shell title="Community & safety">
      <div className="card">
        <p>Sport first, everyone welcome:</p>
        <p className="muted">
          Meet at public venues, ideally listed ones. Beginners are never shamed — tiers reward
          showing up, not skill, and Chabuka has no individual skill rankings.
        </p>
        <p className="muted">
          Captains and organisers set the tone: start on time, respect officials and opponents,
          and look after new players. If something feels wrong at a game, tell the organiser or
          venue contact first, and stop joining that group.
        </p>
        <p className="muted">
          Report a problem through the organiser of the match or tournament involved. Accounts
          that repeatedly no-show, harass, or endanger others lose access.
        </p>
      </div>
    </Shell>
  );
}
