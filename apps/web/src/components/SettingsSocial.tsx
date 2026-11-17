import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROFILE_VISIBILITY, VISIBILITY_LABELS } from '@chabuka/shared';
import type { ProfileVisibility } from '@chabuka/shared';
import { runAction } from '../lib/api';
import { supabase } from '../lib/supabase';
import { fetchMyCreator } from '../lib/social';
import { Badge, Button, ButtonLink, ErrorNote, cx } from './ui';
import { Field, fieldCls } from './CompetitionForms';

// Settings: who sees my record, my blocked list, and becoming a creator.

export function PrivacySettings({ token, userId, current }: { token: string; userId: string; current: ProfileVisibility | null | undefined }) {
  const [value, setValue] = useState<ProfileVisibility>(current ?? 'connections');
  const [msg, setMsg] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!supabase) return;
    const db = supabase;
    void (async () => {
      const { data } = await db.from('blocks').select('blocked_user_id').eq('blocker_id', userId);
      const ids = ((data ?? []) as { blocked_user_id: string }[]).map((b) => b.blocked_user_id);
      if (!ids.length) return setBlocked([]);
      const { data: names } = await db.from('public_profiles').select('id,name').in('id', ids);
      setBlocked(((names ?? []) as { id: string; name: string | null }[]).map((n) => ({ id: n.id, name: n.name ?? 'Player' })));
    })();
  }, [userId]);
  const choose = async (v: ProfileVisibility) => {
    setValue(v);
    setMsg(null);
    try {
      await runAction('set_visibility', { visibility: v }, token);
      setMsg('Saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[14px] font-semibold">Who can see my record, teams and sports</span>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Profile visibility">
        {PROFILE_VISIBILITY.map((v) => (
          <label key={v} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-[14px]', value === v ? 'border-brand bg-brand-soft' : 'border-line')}>
            <input type="radio" name="visibility" checked={value === v} onChange={() => void choose(v)} className="h-4 w-4" />
            {VISIBILITY_LABELS[v]}
          </label>
        ))}
      </div>
      <p className="m-0 text-[13px] text-muted">Everyone can see your name and photo. Your age, gender and area are never shown to other players.</p>
      {msg ? <span className={cx('text-[13px] font-semibold', msg === 'Saved' ? 'text-brand-text' : 'text-danger')}>{msg}</span> : null}
      <div className="flex items-center justify-between gap-2">
        <Link to={`/players/${userId}`} className="text-[13px] font-semibold text-brand-text">See your profile as others do</Link>
      </div>
      {blocked.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold">Blocked</span>
          {blocked.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 text-[14px]">
              {b.name}
              <Button size="sm" variant="ghost" onClick={() => void runAction('unblock_user', { userId: b.id }, token).then(() => setBlocked((l) => l.filter((x) => x.id !== b.id)))}>
                Unblock
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CreatorSettings({ token }: { token: string }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchMyCreator>> | undefined>(undefined);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [sports, setSports] = useState('');
  const [links, setLinks] = useState('');
  const [pitch, setPitch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetchMyCreator(token).then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (status === undefined) return null;
  if (status?.status === 'approved') {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px]">
          You are a creator: <Link to={`/c/${status.handle}`} className="font-semibold text-brand-text">@{status.handle}</Link>
        </span>
        <ButtonLink to="/studio" size="sm" variant="primary">Creator studio</ButtonLink>
      </div>
    );
  }
  if (status?.status === 'pending') return <span className="text-[14px]"><Badge tone="hl">Under review</Badge> We'll let you know when an admin has looked at your application.</span>;
  if (status?.status === 'suspended') return <span className="text-[14px] text-muted">Your creator page is suspended. {status.reviewNote}</span>;
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await runAction(
        'apply_creator',
        {
          handle: handle.trim(),
          displayName: name.trim(),
          bio: bio.trim(),
          sports: sports.split(',').map((s) => s.trim()).filter(Boolean),
          links: links.split('\n').map((s) => s.trim()).filter(Boolean),
          pitch: pitch.trim(),
        },
        token,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the application.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {status?.status === 'rejected' ? <ErrorNote>Not approved last time: {status.reviewNote}</ErrorNote> : null}
      <p className="m-0 text-[14px] text-muted">Creators get a page people can follow, and can publish posts and articles: match reports, training tips, local sports news. An admin approves each creator.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Handle" hint="chabuka.app/c/handle">
          <input className={fieldCls} value={handle} maxLength={24} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="lusaka_runner" />
        </Field>
        <Field label="Display name">
          <input className={fieldCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label="Bio">
        <textarea className={`${fieldCls} h-20 py-2`} value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} />
      </Field>
      <Field label="Sports you cover" hint="Separate with commas">
        <input className={fieldCls} value={sports} onChange={(e) => setSports(e.target.value)} />
      </Field>
      <Field label="Links to your work (optional)" hint="One https:// link per line">
        <textarea className={`${fieldCls} h-16 py-2`} value={links} onChange={(e) => setLinks(e.target.value)} />
      </Field>
      <Field label="Why you want to be a creator">
        <textarea className={`${fieldCls} h-24 py-2`} value={pitch} maxLength={2000} onChange={(e) => setPitch(e.target.value)} />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button variant="primary" disabled={busy || pitch.trim().length < 20 || handle.length < 3 || name.trim().length < 2} onClick={() => void apply()}>
        Apply
      </Button>
    </div>
  );
}
