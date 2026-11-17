import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchMyTeams } from '../lib/teams';
import type { MyTeam } from '../lib/teams';
import { OpponentSuggestions } from './Records';
import FindOpponentForm from './FindOpponentForm';
import { Chip, Section, Sheet } from './ui';

// Explore, Teams tab: for a captain, the teams worth playing next (similar level, nearby, free at the same times, not
// played lately), one tap from a challenge. Only teams the viewer leads; players without one see nothing here.
export default function TeamSuggestions() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [challengeFor, setChallengeFor] = useState<{ teamId: string; area: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let stop = false;
    fetchMyTeams(user.id)
      .then((list) => {
        if (stop) return;
        const led = list.filter((t) => t.role === 'owner' || t.role === 'captain');
        setTeams(led);
        setTeamId(led[0]?.team.id ?? null);
      })
      .catch(() => undefined);
    return () => { stop = true; };
  }, [user]);

  if (!teams.length || !teamId) return null;
  const current = teams.find((t) => t.team.id === teamId)!;

  return (
    <Section title={`Good matches for ${current.team.name}`}>
      {teams.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <Chip key={t.team.id} on={t.team.id === teamId} onClick={() => setTeamId(t.team.id)}>
              {t.team.name}
            </Chip>
          ))}
        </div>
      ) : null}
      <OpponentSuggestions teamId={teamId} onChallenge={(s) => setChallengeFor({ teamId, area: s.team.area })} />
      {notice ? <p className="m-0 text-[13px] text-muted">{notice}</p> : null}
      <Sheet open={challengeFor !== null} onClose={() => setChallengeFor(null)} title="Post a challenge">
        {challengeFor ? (
          <FindOpponentForm
            prefill={challengeFor}
            onDone={() => {
              setChallengeFor(null);
              setNotice('Challenge posted. Teams nearby can take it.');
            }}
          />
        ) : null}
      </Sheet>
    </Section>
  );
}
