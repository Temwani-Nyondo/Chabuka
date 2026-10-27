import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';

export default function HomePage() {
  const { profile } = useAuth();
  const firstName = profile?.name ? profile.name.split(' ')[0] : null;
  return (
    <div className="page">
      <h1>What are you playing{firstName ? `, ${firstName}` : ''}?</h1>
      <EmptyState title="Ready to play" hint="Open matches arrive on Day 2 — Wed 28 Oct." />
      <EmptyState title="Challenges" hint="Team challenges arrive Fri 30 Oct." />
      <EmptyState title="Competitions" hint="The tournament board arrives Sat 31 Oct." />
    </div>
  );
}
