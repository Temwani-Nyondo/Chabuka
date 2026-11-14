import { Link } from 'react-router-dom';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page page-narrow">
      <h1>{title}</h1>
      {children}
      <p className="muted">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> ·{' '}
        <Link to="/community">Community &amp; safety</Link> ·{' '}
        <Link to="/data-deletion">Delete my data</Link>
      </p>
    </div>
  );
}

const DELETION_EMAIL = 'ahead.cglm@gmail.com';

export function DataDeletionPage() {
  return (
    <Shell title="Delete your data">
      <div className="card">
        <p>You can ask us to delete your Chabuka account and the data attached to it at any time.</p>
        <p className="muted">
          How to ask: email{' '}
          <a href={`mailto:${DELETION_EMAIL}?subject=Delete%20my%20Chabuka%20data`}>{DELETION_EMAIL}</a>{' '}
          from the email address you signed up with (or the one on your Google or Facebook account if
          you signed in that way), with the subject &ldquo;Delete my Chabuka data&rdquo;. We use that
          to check the request is really from you.
        </p>
        <p className="muted">
          What we delete: your profile and photo, your sports, availability and settings, your
          team memberships, game sign-ups, venue booking requests, notifications and agent access
          tokens. Games or results you organised for other people may stay without your name.
        </p>
        <p className="muted">
          Ticket payments are handled by WaitApp, not by Chabuka. Payment and ticket records held
          there may be kept as the law requires, under WaitApp&rsquo;s own policy.
        </p>
        <p className="muted">
          We aim to finish within 30 days and will email you when it is done. If you signed in with
          Facebook, you can also remove Chabuka from your Facebook settings under Apps and Websites.
        </p>
      </div>
    </Shell>
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
