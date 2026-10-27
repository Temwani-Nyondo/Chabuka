import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../lib/theme';

export default function ProfilePage() {
  const { profile, sportsCount, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="page">
      <h1>Profile</h1>
      <div className="card">
        <div className="row">
          <span className="muted">Name</span>
          <strong>{profile?.name ?? '—'}</strong>
        </div>
        <div className="row">
          <span className="muted">Area</span>
          <strong>{profile?.area ?? '—'}</strong>
        </div>
        <div className="row">
          <span className="muted">Sports</span>
          <strong>{sportsCount}</strong>
        </div>
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
