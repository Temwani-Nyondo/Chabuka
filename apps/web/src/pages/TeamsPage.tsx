import { useCallback, useEffect, useState } from 'react';
import CreateTeamForm from '../components/CreateTeamForm';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { TEAM_CATEGORY_LABELS } from '@chabuka/shared';
import { fetchMyTeams } from '../lib/teams';
import type { MyTeam } from '../lib/teams';

export default function TeamsPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setTeams(await fetchMyTeams(user.id));
  }, [user]);

  useEffect(() => {
    reload()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load your teams.'),
      )
      .finally(() => setLoading(false));
  }, [reload]);

  return (
    <div className="page">
      <h1>Teams</h1>
      {loading ? <p className="loading">Loading your teams…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && teams.length === 0 && !showForm ? (
        <EmptyState
          title="No teams yet"
          hint="Create a team to post challenges and enter tournaments."
        />
      ) : null}
      {teams.map(({ team, role }) => (
        <div className="card" key={team.id}>
          <div className="row">
            <strong>{team.name}</strong>
            <span className="tag">{role}</span>
          </div>
          <p className="muted">
            {TEAM_CATEGORY_LABELS[team.category]}
            {team.area ? ` · ${team.area}` : ''}
          </p>
        </div>
      ))}
      {showForm ? (
        <div className="card">
          <h2>Create team</h2>
          <CreateTeamForm
            onDone={() => {
              setShowForm(false);
              void reload();
            }}
          />
          <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>
          Create team
        </button>
      )}
    </div>
  );
}
