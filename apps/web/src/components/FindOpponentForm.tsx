import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LEVEL_LABELS, LEVELS, postChallengeSchema } from '@chabuka/shared';
import type { Level } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { postChallengeAction } from '../lib/api';
import { fetchMyTeams, isCaptainRole } from '../lib/teams';
import type { MyTeam } from '../lib/teams';

export default function FindOpponentForm({ onDone }: { onDone: () => void }) {
  const { session, user, profile } = useAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [level, setLevel] = useState<Level>('recreational');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [area, setArea] = useState(profile?.area ?? '');
  const [radiusKm, setRadiusKm] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchMyTeams(user.id)
      .then((list) => {
        const mine = list.filter((t) => isCaptainRole(t.role));
        setTeams(mine);
        if (mine[0]) setTeamId(mine[0].team.id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load your teams.'),
      );
  }, [user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    const parsed = postChallengeSchema.safeParse({
      teamId,
      level,
      windowStart: windowStart ? new Date(windowStart).toISOString() : '',
      windowEnd: windowEnd ? new Date(windowEnd).toISOString() : '',
      area: area.trim(),
      radiusKm,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    setBusy(true);
    try {
      await postChallengeAction(parsed.data, token);
      onDone();
      navigate('/explore');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the challenge.');
    } finally {
      setBusy(false);
    }
  };

  if (teams.length === 0) {
    return <p className="muted">Create a team first — challenges are posted by a team captain.</p>;
  }

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <label className="field">
        Your team
        <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.team.id} value={t.team.id}>
              {t.team.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Level</span>
        <div className="chips">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className={level === l ? 'chip chip-active' : 'chip'}
              onClick={() => setLevel(l)}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Available from
        <input
          className="input"
          type="datetime-local"
          value={windowStart}
          onChange={(e) => setWindowStart(e.target.value)}
        />
      </label>
      <label className="field">
        Until
        <input
          className="input"
          type="datetime-local"
          value={windowEnd}
          onChange={(e) => setWindowEnd(e.target.value)}
        />
      </label>
      <label className="field">
        Area
        <input
          className="input"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="e.g. Woodlands"
          maxLength={80}
        />
      </label>
      <label className="field">
        Within (km)
        <input
          className="input"
          type="number"
          min={1}
          max={100}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Posting…' : 'Find opponent'}
      </button>
    </form>
  );
}
