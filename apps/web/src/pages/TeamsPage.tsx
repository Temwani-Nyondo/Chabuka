import { useCallback, useEffect, useState } from 'react';
import { Plus, Shield, Swords } from 'lucide-react';
import { TEAM_CATEGORY_LABELS } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchMyTeams } from '../lib/teams';
import type { MyTeam } from '../lib/teams';
import { requestCreate } from '../components/AppShell';
import { Badge, Button, Card, Crest, EmptyState, ErrorNote, ListRow, PageHeader, Skeleton } from '../components/ui';

export default function TeamsPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setTeams(await fetchMyTeams(user.id));
  }, [user]);

  useEffect(() => {
    reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load your teams.'))
      .finally(() => setLoading(false));
  }, [reload]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-4 pt-4">
      <PageHeader
        title="My teams"
        sub="Squads you play for and run."
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => requestCreate('team')}>
            New team
          </Button>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <Skeleton className="h-32" />
      ) : teams.length === 0 ? (
        <EmptyState
          icon={<Shield size={22} />}
          title="No teams yet"
          body="Start one for your regular side, or open an invite link from your captain to join theirs."
          action={
            <Button variant="primary" size="sm" onClick={() => requestCreate('team')}>
              Start a team
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          {teams.map(({ team, role }) => (
            <ListRow
              key={team.id}
              to={`/teams/${team.id}`}
              leading={<Crest id={team.id} name={team.name} src={team.logo_url} size={44} />}
              title={team.name}
              sub={[TEAM_CATEGORY_LABELS[team.category], team.area].filter(Boolean).join(' · ')}
              trailing={role !== 'player' ? <Badge tone="brand">{role === 'owner' ? 'Owner' : 'Captain'}</Badge> : undefined}
            />
          ))}
        </Card>
      )}
      <Card className="flex items-center gap-3 p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
          <Swords size={20} />
        </span>
        <span className="flex-1 text-[14px] text-muted">Looking for a game? Post a challenge and nearby sides can take you on.</span>
        <Button size="sm" onClick={() => requestCreate('opponent')}>
          Challenge
        </Button>
      </Card>
    </div>
  );
}
