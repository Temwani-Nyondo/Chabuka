import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { onboardingSchema, sportListSchema } from '@chabuka/shared';
import type { Level, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

const LEVELS: { value: Level; label: string }[] = [
  { value: 'recreational', label: 'Recreational' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'competitive', label: 'Competitive' },
];

export default function OnboardingPage() {
  const { user, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [sports, setSports] = useState<Sport[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [level, setLevel] = useState<Level>('recreational');
  const [picked, setPicked] = useState<string[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoadError('Supabase is not configured.');
      return;
    }
    supabase
      .from('sports')
      .select('id,name,formats')
      .order('name')
      .then(({ data, error: err }) => {
        if (err) {
          setLoadError(err.message);
          return;
        }
        const parsed = sportListSchema.safeParse(data);
        if (parsed.success) setSports(parsed.data);
        else setLoadError('Unexpected sports data from the server.');
      });
  }, []);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const toggleSport = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setPhotoFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarning(null);
    if (!supabase || !user) {
      setError('Not signed in.');
      return;
    }
    let photoUrl: string | undefined;
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, photoFile, { upsert: true });
      if (upErr) {
        setWarning('Photo upload failed — continuing without a photo.');
      } else {
        photoUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
    }
    const parsed = onboardingSchema.safeParse({
      name: name.trim(),
      area: area.trim(),
      photoUrl,
      sportIds: picked,
      level,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    setBusy(true);
    try {
      const { error: pErr } = await supabase.from('profiles').upsert({
        id: user.id,
        name: parsed.data.name,
        area: parsed.data.area,
        photo_url: photoUrl ?? null,
      });
      if (pErr) throw pErr;
      const { error: dErr } = await supabase.from('user_sports').delete().eq('user_id', user.id);
      if (dErr) throw dErr;
      const rows = parsed.data.sportIds.map((sport_id) => ({
        user_id: user.id,
        sport_id,
        level: parsed.data.level,
      }));
      const { error: iErr } = await supabase.from('user_sports').insert(rows);
      if (iErr) throw iErr;
      await refreshProfile();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <h1>Your player profile</h1>
      <p className="muted">Thirty seconds, then you are in.</p>
      {loadError ? <p className="error">{loadError}</p> : null}
      <form
        className="card"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <label className="field">
          Name
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={80}
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
          Photo (optional)
          <input className="input" type="file" accept="image/*" onChange={onPhoto} />
        </label>
        {preview ? (
          <img className="avatar-preview" src={preview} alt="Profile photo preview" />
        ) : null}
        <div className="field">
          <span>My sports</span>
          <div className="chips">
            {sports.map((s) => (
              <button
                key={s.id}
                type="button"
                className={picked.includes(s.id) ? 'chip chip-active' : 'chip'}
                onClick={() => toggleSport(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Level</span>
          <div className="chips">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                className={level === l.value ? 'chip chip-active' : 'chip'}
                onClick={() => setLevel(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {warning ? <p className="hint">{warning}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Start playing'}
        </button>
      </form>
      <button
        className="btn btn-ghost"
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Use a different account
      </button>
    </div>
  );
}
