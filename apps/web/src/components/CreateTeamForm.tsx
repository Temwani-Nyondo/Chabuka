import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTeamSchema, TEAM_CATEGORIES, TEAM_CATEGORY_LABELS } from '@chabuka/shared';
import type { Sport, TeamCategory } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { createTeamAction } from '../lib/api';
import { fetchSports } from '../lib/matches';

export default function CreateTeamForm({ onDone }: { onDone: () => void }) {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const [sports, setSports] = useState<Sport[]>([]);
  const [name, setName] = useState('');
  const [sportId, setSportId] = useState('');
  const [category, setCategory] = useState<TeamCategory>('recreational');
  const [area, setArea] = useState(profile?.area ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSports()
      .then((list) => {
        setSports(list);
        if (list[0]) setSportId(list[0].id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load sports.'),
      );
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    const parsed = createTeamSchema.safeParse({
      name: name.trim(),
      sportId,
      category,
      area: area.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    setBusy(true);
    try {
      await createTeamAction(parsed.data, token);
      onDone();
      navigate('/teams');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the team.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <label className="field">
        Team name
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Finance FC"
          maxLength={80}
        />
      </label>
      <label className="field">
        Sport
        <select className="input" value={sportId} onChange={(e) => setSportId(e.target.value)}>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Category
        <select
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value as TeamCategory)}
        >
          {TEAM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {TEAM_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
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
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create team'}
      </button>
    </form>
  );
}
