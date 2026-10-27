import EmptyState from '../components/EmptyState';

export default function ExplorePage() {
  return (
    <div className="page">
      <h1>Explore</h1>
      <EmptyState
        title="Map and list"
        hint="The match list arrives Wed 28 Oct, the map view Thu 29 Oct."
      />
    </div>
  );
}
