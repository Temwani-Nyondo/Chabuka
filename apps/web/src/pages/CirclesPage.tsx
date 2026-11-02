import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { createCircleAction, joinCircleAction, leaveCircleAction, updateCircleAction } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { fetchCircleEvents, fetchCircles } from '../lib/circles';
import type { CircleListing } from '../lib/circles';
import { fetchSports } from '../lib/matches';
import { supabase } from '../lib/supabase';
import { AGE_BANDS, circleEligibility } from '@chabuka/shared';
import type { Circle, Match, Profile, Sport } from '@chabuka/shared';

// Same rules the API enforces on join_circle (403): surface the reason on
// the card instead of offering a Join button the server will refuse.
function circleBlockReason(circle: Circle, profile: Profile | null, levels: Record<string, string>): string | null {
  const reason = circleEligibility({
    birthYear: profile?.birth_year ?? null,
    gender: profile?.gender ?? null,
    ageBands: circle.age_bands,
    genders: circle.genders,
  });
  if (reason) return reason;
  if (circle.sport_id && circle.levels.length > 0) {
    const level = levels[circle.sport_id];
    if (!level || !(circle.levels as string[]).includes(level)) {
      return `This circle is for ${circle.levels.join(', ')} players.`;
    }
  }
  return null;
}

export default function CirclesPage() {
  const { session, user, profile } = useAuth();
  const [list, setList] = useState<CircleListing[]>([]);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [sports, setSports] = useState<Sport[]>([]);
  const [events, setEvents] = useState<Record<string, Match[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [sportId, setSportId] = useState('');
  const [description, setDescription] = useState('');
  const [ageBand, setAgeBand] = useState('');
  const [level, setLevel] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [editingImages, setEditingImages] = useState<string | null>(null);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editCover, setEditCover] = useState<File | null>(null);

  const token = session?.access_token;

  const reload = useCallback(async () => {
    if (!user) return;
    setList(await fetchCircles(user.id));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([reload(), fetchSports()])
      .then(([, sportList]) => setSports(sportList))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load circles.'))
      .finally(() => setLoading(false));
  }, [reload, user]);

  useEffect(() => {
    if (!user || !supabase) return;
    void (async () => {
      const { data } = await supabase.from('user_sports').select('sport_id,level').eq('user_id', user.id);
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as { sport_id: string; level: string }[]) {
        map[row.sport_id] = row.level;
      }
      setLevels(map);
    })();
  }, [user]);

  const run = async (fn: (t: string) => Promise<unknown>) => {
    if (!token) {
      setActionError('Not signed in.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await fn(token);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleEvents = async (circleId: string) => {
    if (events[circleId]) {
      setEvents((prev) => {
        const next = { ...prev };
        delete next[circleId];
        return next;
      });
      return;
    }
    try {
      const rows = await fetchCircleEvents(circleId);
      setEvents((prev) => ({ ...prev, [circleId]: rows }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not load circle events.');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      setActionError('Not signed in.');
      return;
    }
    const accessToken = token;
    void (async () => {
      setBusy(true);
      setActionError(null);
      try {
        let photoUrl: string | undefined;
        let coverUrl: string | undefined;
        if (photoFile) photoUrl = await uploadImage(`circle-photos/${user?.id ?? 'shared'}`, photoFile);
        if (coverFile) coverUrl = await uploadImage(`circle-covers/${user?.id ?? 'shared'}`, coverFile);
        await createCircleAction(
          {
            name: name.trim(),
            area: area.trim(),
            sportId: sportId || undefined,
            description: description.trim() || undefined,
            ageBands: ageBand ? [ageBand] : [],
            levels: level ? [level] : [],
            photoUrl,
            coverUrl,
          },
          accessToken,
        );
        setShowForm(false);
        setPhotoFile(null);
        setCoverFile(null);
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const saveImages = (circleId: string) => {
    if (!token) {
      setActionError('Not signed in.');
      return;
    }
    const accessToken = token;
    void (async () => {
      setBusy(true);
      setActionError(null);
      try {
        const patch: { circleId: string; photoUrl?: string; coverUrl?: string } = { circleId };
        if (editPhoto) patch.photoUrl = await uploadImage(`circle-photos/${user?.id ?? 'shared'}`, editPhoto);
        if (editCover) patch.coverUrl = await uploadImage(`circle-covers/${user?.id ?? 'shared'}`, editCover);
        if (patch.photoUrl !== undefined || patch.coverUrl !== undefined) {
          await updateCircleAction(patch, accessToken);
          await reload();
        }
        setEditingImages(null);
        setEditPhoto(null);
        setEditCover(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="page">
      <h1>Circles</h1>
      <p className="muted">Groups around a sport and place. Events posted in your circles find you.</p>
      {loading ? <p className="loading">Loading circles…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && list.length === 0 && !showForm ? (
        <EmptyState
          title="No circles yet"
          hint="Create one for your sport and neighbourhood."
          actionLabel="Create circle"
          onAction={() => setShowForm(true)}
        />
      ) : null}
      {showForm ? (
        <div className="card">
          <h2>Create circle</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="circle-name">Name</label>
              <input id="circle-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lusaka Hiking" maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="circle-area">Area</label>
              <input id="circle-area" className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Lusaka" maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="circle-sport">Sport (optional)</label>
              <select id="circle-sport" className="input" value={sportId} onChange={(e) => setSportId(e.target.value)}>
                <option value="">Any sport</option>
                {sports.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="circle-age">Age group prerequisite (optional)</label>
              <select id="circle-age" className="input" value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
                <option value="">Open to all ages</option>
                {AGE_BANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="circle-level">Level prerequisite (optional)</label>
              <select id="circle-level" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Open to all levels</option>
                <option value="recreational">Recreational</option>
                <option value="intermediate">Intermediate</option>
                <option value="competitive">Competitive</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="circle-desc">Description (optional)</label>
              <input id="circle-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weekend hikes around Lusaka" maxLength={500} />
            </div>
            <div className="field">
              <label htmlFor="circle-photo">Photo (optional)</label>
              <input
                id="circle-photo"
                className="input"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="field">
              <label htmlFor="circle-cover">Cover (optional)</label>
              <input
                id="circle-cover"
                className="input"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {actionError ? <p className="error">{actionError}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create circle'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </form>
        </div>
      ) : (
        <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>Create circle</button>
      )}
      {actionError && !showForm ? <p className="error">{actionError}</p> : null}
      {list.map(({ circle, memberCount, isMember }) => {
        const blockReason = isMember ? null : circleBlockReason(circle, profile, levels);
        return (
        <div className="card" key={circle.id}>
          {circle.cover_url ? (
            <img className="cover-banner" src={circle.cover_url} alt="" />
          ) : null}
          <div className="row">
            {circle.photo_url ? (
              <img className="circle-photo" src={circle.photo_url} alt={`${circle.name} photo`} />
            ) : null}
            <strong>{circle.name}</strong>
            <span className="tag">{memberCount} in</span>
          </div>
          <p className="muted">
            {circle.area ?? ''}
            {circle.age_bands.length > 0 ? ` · ${circle.age_bands.join(', ')}` : ''}
            {circle.levels.length > 0 ? ` · ${circle.levels.join(', ')}` : ''}
            {circle.genders.length > 0 ? ` · ${circle.genders.join(', ')}` : ''}
          </p>
          {circle.description ? <p>{circle.description}</p> : null}
          <div className="actions-row">
            {isMember ? (
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { void run((t) => leaveCircleAction(circle.id, t)); }}>Leave</button>
            ) : blockReason ? (
              <span className="hint">{blockReason}</span>
            ) : (
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { void run((t) => joinCircleAction(circle.id, t)); }}>Join circle</button>
            )}
            <button className="btn" type="button" onClick={() => { void toggleEvents(circle.id); }}>
              {events[circle.id] ? 'Hide events' : 'Events'}
            </button>
          </div>
          {isMember ? (
            editingImages === circle.id ? (
              <div>
                <div className="field">
                  <label htmlFor={`edit-photo-${circle.id}`}>Photo</label>
                  <input
                    id={`edit-photo-${circle.id}`}
                    className="input"
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => setEditPhoto(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`edit-cover-${circle.id}`}>Cover</label>
                  <input
                    id={`edit-cover-${circle.id}`}
                    className="input"
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => setEditCover(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="actions-row">
                  <button className="btn btn-primary" type="button" disabled={busy} onClick={() => saveImages(circle.id)}>
                    {busy ? 'Saving…' : 'Save images'}
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => setEditingImages(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn" type="button" onClick={() => setEditingImages(circle.id)}>Edit images</button>
            )
          ) : null}
          {events[circle.id] ? (
            events[circle.id]!.length === 0 ? (
              <p className="muted">No upcoming events in this circle yet.</p>
            ) : (
              events[circle.id]!.map((m) => (
                <p key={m.id}>{m.title} · {new Date(m.starts_at).toLocaleString()}</p>
              ))
            )
          ) : null}
        </div>
        );
      })}
    </div>
  );
}
