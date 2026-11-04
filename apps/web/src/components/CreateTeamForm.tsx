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
  const [step, setStep] = useState(0);

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

  const next = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 0 && !name.trim()) {
      setError('Give your team a name to continue.');
      return;
    }
    if (step === 1 && !sportId) {
      setError('Pick a sport to continue.');
      return;
    }
    setStep((s) => Math.min(2, s + 1));
  };

  const sportName = sports.find((s) => s.id === sportId)?.name ?? '—';

  return (
    <form
      onSubmit={(e) => {
        if (step < 2) next(e);
        else void submit(e);
      }}
    >
      <div className="wizard-dots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? 'wizard-dot wizard-dot-done' : 'wizard-dot'} />
        ))}
      </div>
      {step === 0 ? (
        <>
          <h3>Name your squad</h3>
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
        </>
      ) : null}
      {step === 1 ? (
        <>
          <h3>What does {name.trim() || 'your team'} play?</h3>
          <div className="field">
            <span>Sport</span>
            <div className="chips">
              {sports.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={sportId === s.id ? 'chip chip-active' : 'chip'}
                  onClick={() => setSportId(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
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
        </>
      ) : null}
      {step === 2 ? (
        <>
          <h3>Where is home?</h3>
          <p className="muted">
            {name.trim()} · {sportName} · {TEAM_CATEGORY_LABELS[category]}
          </p>
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
        </>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="wizard-nav">
        {step > 0 ? (
          <button className="btn" type="button" onClick={() => { setError(null); setStep((s) => s - 1); }}>
            Back
          </button>
        ) : null}
        {step < 2 ? (
          <button className="btn btn-primary" type="submit">
            Continue
          </button>
        ) : (
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create team'}
          </button>
        )}
      </div>
    </form>
  );
}
