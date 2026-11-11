import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { createCircleAction, joinCircleAction, leaveCircleAction, updateCircleAction } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { fetchCircleFeed, fetchCircles } from '../lib/circles';
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
  const [events, setEvents] = useState<Record<string, { match: Match; tagged: boolean }[]>>({});
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tab, setTab] = useState<'fixtures' | 'about'>('fixtures');
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

  // Open a joined circle: one at a time; fixtures load in the effect below.
  const openCircle = (circle: Circle) => {
    setTab('fixtures');
    setEditingImages(null);
    setOpenId((cur) => (cur === circle.id ? null : circle.id));
  };

  useEffect(() => {
    if (!openId || !user || events[openId]) return;
    const circle = list.find((l) => l.circle.id === openId)?.circle;
    if (!circle) return;
    fetchCircleFeed(circle, user.id)
      .then((rows) => setEvents((prev) => ({ ...prev, [openId]: rows })))
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : 'Could not load circle fixtures.'));
  }, [openId, user, list, events]);

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
      <div className="page-head">
        <span className="eyebrow">Your crowds</span>
        <h1>Circles</h1>
        <p>Groups around a sport and place. Events posted in your circles find you.</p>
      </div>
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
      {(() => {
        const joined = list.filter((l) => l.isMember);
        const others = list.filter((l) => !l.isMember);
        const preview = others.find((l) => l.circle.id === previewId) ?? null;
        const meta = (c: Circle) =>
          [c.area, ...c.age_bands, ...c.levels, ...c.genders].filter(Boolean).join(' · ');
        const initial = (c: Circle) => (c.name.trim()[0] ?? '?').toUpperCase();
        return (
          <>
            {joined.length > 0 ? (
              <section className="circle-section">
                <h2 className="circle-section-title">Your circles</h2>
                {joined.map(({ circle, memberCount }) => {
                  const open = openId === circle.id;
                  const rows = events[circle.id];
                  return (
                    <div className={`circle-card${open ? ' circle-card-open' : ''}`} key={circle.id}>
                      <button
                        type="button"
                        className="circle-card-head"
                        aria-expanded={open}
                        onClick={() => openCircle(circle)}
                      >
                        {circle.photo_url ? (
                          <img className="circle-photo" src={circle.photo_url} alt="" />
                        ) : (
                          <span className="circle-photo circle-photo-fallback" aria-hidden="true">{initial(circle)}</span>
                        )}
                        <span className="circle-card-text">
                          <strong>{circle.name}</strong>
                          <span className="muted">{memberCount} {memberCount === 1 ? 'member' : 'members'}{circle.area ? ` · ${circle.area}` : ''}</span>
                        </span>
                        <span className="circle-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                      </button>
                      {open ? (
                        <div className="circle-card-body">
                          {circle.cover_url ? <img className="cover-banner" src={circle.cover_url} alt="" /> : null}
                          <div className="circle-tabs" role="tablist">
                            <button type="button" role="tab" aria-selected={tab === 'fixtures'} className={`chip${tab === 'fixtures' ? ' chip-active' : ''}`} onClick={() => setTab('fixtures')}>Fixtures</button>
                            <button type="button" role="tab" aria-selected={tab === 'about'} className={`chip${tab === 'about' ? ' chip-active' : ''}`} onClick={() => setTab('about')}>About</button>
                          </div>
                          {tab === 'fixtures' ? (
                            rows === undefined ? (
                              <p className="loading">Loading fixtures…</p>
                            ) : rows.length === 0 ? (
                              <p className="muted">No fixtures yet. Games in this circle&apos;s sport land here automatically.</p>
                            ) : (
                              <ul className="circle-fixtures">
                                {rows.map(({ match: m, tagged }) => (
                                  <li key={m.id}>
                                    <strong>{m.title}</strong>
                                    <span className="muted">
                                      {new Date(m.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                      {tagged ? '' : ' · from Explore'}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : (
                            <div>
                              {circle.description ? <p>{circle.description}</p> : null}
                              {meta(circle) ? <p className="muted">{meta(circle)}</p> : null}
                              {editingImages === circle.id ? (
                                <div>
                                  <div className="field">
                                    <label htmlFor={`edit-photo-${circle.id}`}>Photo</label>
                                    <input id={`edit-photo-${circle.id}`} className="input" type="file" accept="image/*" disabled={busy} onChange={(e) => setEditPhoto(e.target.files?.[0] ?? null)} />
                                  </div>
                                  <div className="field">
                                    <label htmlFor={`edit-cover-${circle.id}`}>Cover</label>
                                    <input id={`edit-cover-${circle.id}`} className="input" type="file" accept="image/*" disabled={busy} onChange={(e) => setEditCover(e.target.files?.[0] ?? null)} />
                                  </div>
                                  <div className="actions-row">
                                    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => saveImages(circle.id)}>{busy ? 'Saving…' : 'Save images'}</button>
                                    <button className="btn btn-ghost" type="button" onClick={() => setEditingImages(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="actions-row">
                                  <button className="btn" type="button" onClick={() => setEditingImages(circle.id)}>Edit images</button>
                                  <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setOpenId(null); void run((t) => leaveCircleAction(circle.id, t)); }}>Leave circle</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ) : null}
            {others.length > 0 ? (
              <section className="circle-section">
                <h2 className="circle-section-title">Discover circles</h2>
                <div className="circle-tiles">
                  {others.map(({ circle, memberCount }) => (
                    <button
                      type="button"
                      key={circle.id}
                      className={`circle-tile${previewId === circle.id ? ' circle-tile-active' : ''}`}
                      aria-pressed={previewId === circle.id}
                      onClick={() => setPreviewId(previewId === circle.id ? null : circle.id)}
                    >
                      {circle.photo_url ? (
                        <img className="circle-tile-img" src={circle.photo_url} alt="" />
                      ) : (
                        <span className="circle-tile-img circle-photo-fallback" aria-hidden="true">{initial(circle)}</span>
                      )}
                      <strong>{circle.name}</strong>
                      <span className="muted">{memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
                    </button>
                  ))}
                </div>
                {preview ? (
                  <div className="card circle-preview">
                    <div className="row">
                      <strong>{preview.circle.name}</strong>
                      <span className="tag">{preview.memberCount} in</span>
                    </div>
                    {meta(preview.circle) ? <p className="muted">{meta(preview.circle)}</p> : null}
                    {preview.circle.description ? <p>{preview.circle.description}</p> : null}
                    {(() => {
                      const reason = circleBlockReason(preview.circle, profile, levels);
                      return reason ? (
                        <span className="hint">{reason}</span>
                      ) : (
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const id = preview.circle.id;
                            void run((t) => joinCircleAction(id, t)).then(() => {
                              setPreviewId(null);
                              setOpenId(id);
                            });
                          }}
                        >
                          Join circle
                        </button>
                      );
                    })()}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        );
      })()}
    </div>
  );
}
