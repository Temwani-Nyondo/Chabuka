import EmptyState from '../components/EmptyState';

export default function TeamsPage() {
  return (
    <div className="page">
      <h1>Teams</h1>
      <EmptyState title="My teams" hint="Teams arrive Fri 30 Oct." />
    </div>
  );
}
