import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMatchSchema, LEVEL_LABELS, LEVELS } from '@chabuka/shared';
import type { Level, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { createMatchAction } from '../lib/api';
import { fetchSports } from '../lib/matches';
import VenuePicker from './VenuePicker';
import type { VenuePick } from './VenuePicker';

export default function CreateMatchForm({ onDone }: { onDone: () => void }) {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const [sports, setSports] = useState<Sport[]>([]);
  const [sportId, setSportId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [area, setArea] = useState(profile?.area ?? '');
  const [format, setFormat] = useState('');
  const [capacity, setCapacity] = useState(10);
  const [level, setLevel] = useState<Level>('recreational');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [notes, setNotes] = useState('');
  const [venuePick, setVenuePick] = useState<VenuePick>({});
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

  const sport = sports.find((s) => s.id === sportId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    const parsed = createMatchSchema.safeParse({
      sportId,
      title: title.trim(),
      startsAt: startsAt ? new Date(startsAt).toISOString() : '',
      area: area.trim(),
      venueId: venuePick.venueId,
      placeId: venuePick.placeId,
      venueName: venuePick.venueName,
      lat: venuePick.lat,
      lng: venuePick.lng,
      format: format || undefined,
      capacity,
      level,
      visibility,
      notes: notes.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    if (new Date(parsed.data.startsAt).getTime() <= Date.now()) {
      setError('Pick a start time in the future.');
      return;
    }
    setBusy(true);
    try {
      await createMatchAction(parsed.data, token);
      onDone();
      navigate('/explore');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the match.');
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
        Title
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Saturday football"
          maxLength={80}
        />
      </label>
      <label className="field">
        Sport
        <select
          className="input"
          value={sportId}
          onChange={(e) => {
            setSportId(e.target.value);
            setFormat('');
          }}
        >
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {sport && sport.formats.length > 0 ? (
        <label className="field">
          Format
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Any</option>
            {sport.formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        Starts
        <input
          className="input"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </label>
      <VenuePicker
        sportName={sport?.name}
        area={area}
        onAreaChange={setArea}
        onPick={setVenuePick}
      />
      <label className="field">
        Players needed (including you)
        <input
          className="input"
          type="number"
          min={2}
          max={100}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
        />
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
        Who can see it
        <select
          className="input"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
        >
          <option value="public">Public — anyone can join</option>
          <option value="private">Private — not listed on Explore</option>
        </select>
      </label>
      <label className="field">
        Notes (optional)
        <input
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Bring a dark and a light shirt"
          maxLength={500}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create match'}
      </button>
    </form>
  );
}
