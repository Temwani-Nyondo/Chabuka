import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../lib/theme';

export default function ProfilePage() {
  const { profile, sportsCount, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="page">
      <h1>Profile</h1>
      <div className="card player-card">
        <span className="muted">Player card</span>
        <span className="player-name">{profile?.name ?? 'New player'}</span>
        <span className="muted">{profile?.area ?? 'Area not set'}</span>
        <div className="player-stats">
          <div className="player-stat">
            <strong>{sportsCount}</strong>
            <span>Sports</span>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="row">
          <span className="muted">Theme</span>
          <button className="btn btn-ghost" type="button" onClick={toggle}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
      <button
        className="btn btn-ghost"
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
