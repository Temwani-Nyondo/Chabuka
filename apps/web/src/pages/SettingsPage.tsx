import { Fragment, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { GAME_TYPES, TIME_BANDS, WEEK_DAYS } from '@chabuka/shared';
import type { GameType, ProfileVisibility, TimeBand } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/upload';
import { useTheme } from '../lib/theme';
import type { ThemePref } from '../lib/theme';
import {
  API_BASE,
  fetchAgentTokens,
  mintAgentToken,
  revokeAgentToken,
  runAction,
  setAvailabilityAction,
  setGameTypesAction,
} from '../lib/api';
import type { AgentTokenRow } from '../lib/api';
import { useIsAdmin } from '../lib/admin';
import { CreatorSettings, PrivacySettings } from '../components/SettingsSocial';
import { Avatar, Button, Card, Chip, ErrorNote, PageHeader, Segmented, cx } from '../components/ui';

const fieldCls = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-brand';

function Block({ id, title, sub, children }: { id?: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-2.5" aria-label={title}>
      <div>
        <h2 className="m-0">{title}</h2>
        {sub ? <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p> : null}
      </div>
      <Card className="flex flex-col gap-3.5 p-4">{children}</Card>
    </section>
  );
}

function Saved({ msg }: { msg: string | null }) {
  if (!msg) return null;
  const ok = msg === 'Saved';
  return (
    <span role="status" className={cx('inline-flex items-center gap-1 text-[13px] font-semibold', ok ? 'text-brand-text' : 'text-danger')}>
      {ok ? <Check size={15} /> : null}
      {msg}
    </span>
  );
}

export default function SettingsPage() {
  const { profile, user, session, signOut, refreshProfile } = useAuth();
  const token = session?.access_token;
  const isAdmin = useIsAdmin();
  const { pref, choose } = useTheme();

  // Profile basics
  const [name, setName] = useState(profile?.name ?? '');
  const [area, setArea] = useState(profile?.area ?? '');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  useEffect(() => {
    setName(profile?.name ?? '');
    setArea(profile?.area ?? '');
  }, [profile?.name, profile?.area]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await runAction('update_profile', { name: name.trim(), area: area.trim() }, token);
      await refreshProfile();
      setProfileMsg('Saved');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setProfileBusy(false);
    }
  };

  const setPicture = async (kind: 'photo' | 'cover', file: File | null) => {
    if (!user || !supabase) return;
    setImgBusy(true);
    setProfileMsg(null);
    try {
      const url = file ? await uploadImage(kind === 'photo' ? `profile-photos/${user.id}` : `profile-covers/${user.id}`, file) : null;
      const { error } = await supabase.from('profiles').upsert({ id: user.id, ...(kind === 'photo' ? { photo_url: url } : { cover_url: url }) });
      if (error) throw new Error(error.message);
      await refreshProfile();
      setProfileMsg('Saved');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setImgBusy(false);
    }
  };

  // Week + game types
  const [week, setWeek] = useState<Set<string>>(new Set());
  const [weekSaved, setWeekSaved] = useState<Set<string>>(new Set());
  const [weekMsg, setWeekMsg] = useState<string | null>(null);
  const [weekBusy, setWeekBusy] = useState(false);
  const [gameTypes, setGameTypes] = useState<GameType[]>([]);
  const [typesSaved, setTypesSaved] = useState<GameType[]>([]);
  const [typesMsg, setTypesMsg] = useState<string | null>(null);
  const [typesBusy, setTypesBusy] = useState(false);

  useEffect(() => {
    if (!user || !supabase) return;
    void Promise.all([
      supabase.from('user_availability').select('day,time_band').eq('user_id', user.id),
      supabase.from('user_game_types').select('game_type').eq('user_id', user.id),
    ])
      .then(([{ data: avail }, { data: types }]) => {
        const set = new Set(((avail ?? []) as { day: number; time_band: string }[]).map((s) => `${s.day}-${s.time_band}`));
        setWeek(set);
        setWeekSaved(new Set(set));
        const t = ((types ?? []) as { game_type: string }[])
          .map((x) => x.game_type)
          .filter((g): g is GameType => (GAME_TYPES as readonly string[]).includes(g));
        setGameTypes(t);
        setTypesSaved(t);
      })
      .catch(() => undefined);
  }, [user]);

  const weekDirty = week.size !== weekSaved.size || [...week].some((k) => !weekSaved.has(k));
  const typesDirty = gameTypes.length !== typesSaved.length || gameTypes.some((g) => !typesSaved.includes(g));

  const saveWeek = async () => {
    if (!token) return;
    setWeekBusy(true);
    setWeekMsg(null);
    try {
      await setAvailabilityAction(
        {
          slots: [...week].map((k) => {
            const [d, b] = k.split('-');
            return { day: Number(d), timeBand: b as TimeBand };
          }),
        },
        token,
      );
      setWeekSaved(new Set(week));
      setWeekMsg('Saved');
    } catch (err) {
      setWeekMsg(err instanceof Error ? err.message : 'Could not save your week.');
    } finally {
      setWeekBusy(false);
    }
  };

  const saveTypes = async () => {
    if (!token) return;
    setTypesBusy(true);
    setTypesMsg(null);
    try {
      await setGameTypesAction({ gameTypes }, token);
      setTypesSaved(gameTypes);
      setTypesMsg('Saved');
    } catch (err) {
      setTypesMsg(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setTypesBusy(false);
    }
  };

  // AI assistant keys
  const [tokens, setTokens] = useState<AgentTokenRow[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const mcpUrl = `${API_BASE}/mcp`;

  const reloadKeys = async () => {
    if (!token) return;
    try {
      setTokens(await fetchAgentTokens(token));
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Could not load keys.');
    }
  };
  useEffect(() => {
    void reloadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per login token
  }, [token]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setKeyError('Copy failed. Long-press and copy it by hand.');
    }
  };

  const mint = async () => {
    if (!token) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const { token: key } = await mintAgentToken('Agent', token);
      setNewKey(key);
      await reloadKeys();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Could not create the key.');
    } finally {
      setKeyBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!token) return;
    setKeyBusy(true);
    try {
      await revokeAgentToken(id, token);
      await reloadKeys();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Could not revoke the key.');
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 pt-4">
      <PageHeader title="Settings" back="/you" />

      <Block title="Profile" sub="What teammates and players in your games see.">
        <div className="flex items-center gap-3">
          <Avatar name={profile?.name} src={profile?.photo_url} size={56} />
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
              {profile?.photo_url ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" hidden disabled={imgBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void setPicture('photo', f); e.target.value = ''; }} />
            </label>
            <label className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
              {profile?.cover_url ? 'Change cover' : 'Add cover'}
              <input type="file" accept="image/*" hidden disabled={imgBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void setPicture('cover', f); e.target.value = ''; }} />
            </label>
            {profile?.photo_url ? (
              <Button size="sm" variant="ghost" disabled={imgBusy} onClick={() => void setPicture('photo', null)}>
                Remove photo
              </Button>
            ) : null}
          </div>
        </div>
        <form onSubmit={saveProfile} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Name
            <input className={fieldCls} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Area
            <input className={fieldCls} value={area} maxLength={80} required onChange={(e) => setArea(e.target.value)} placeholder="Woodlands" />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={profileBusy}>
              {profileBusy ? 'Saving…' : 'Save'}
            </Button>
            <Saved msg={imgBusy ? 'Uploading…' : profileMsg} />
          </div>
        </form>
      </Block>

      {token && user ? (
        <Block id="privacy" title="Privacy" sub="Chabuka keeps social features small: no messages, no comments.">
          <PrivacySettings token={token} userId={user.id} current={(profile as { visibility?: ProfileVisibility } | null)?.visibility} />
        </Block>
      ) : null}

      {token ? (
        <Block id="creator" title="Become a creator">
          <CreatorSettings token={token} />
        </Block>
      ) : null}

      <Block title="Appearance">
        <Segmented<ThemePref>
          label="Theme"
          value={pref}
          onChange={choose}
          options={[
            { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun size={15} /> Light</span> },
            { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon size={15} /> Dark</span> },
            { value: 'system', label: <span className="inline-flex items-center gap-1.5"><Monitor size={15} /> System</span> },
          ]}
        />
      </Block>

      <Block id="week" title="When you’re usually free" sub="Games near you are ranked around these times.">
        <div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))] gap-1.5" role="group" aria-label="Weekly availability">
          <span />
          {TIME_BANDS.map((b) => (
            <span key={b} className="text-center text-[11px] font-bold capitalize text-muted">
              {b}
            </span>
          ))}
          {WEEK_DAYS.map((label, day) => (
            <Fragment key={day}>
              <span className="flex items-center text-[13px] font-semibold">{label}</span>
              {TIME_BANDS.map((b) => {
                const key = `${day}-${b}`;
                const on = week.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${label} ${b}`}
                    onClick={() => {
                      setWeekMsg(null);
                      setWeek((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    className={cx('h-10 cursor-pointer rounded-[10px] border', on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface hover:bg-surface-2')}
                  >
                    {on ? <Check size={16} className="mx-auto" /> : null}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={weekBusy || !weekDirty} onClick={() => void saveWeek()}>
            {weekBusy ? 'Saving…' : 'Save my week'}
          </Button>
          <span className="text-[13px] text-muted">{week.size} slot{week.size === 1 ? '' : 's'}</span>
          <Saved msg={weekMsg} />
        </div>
      </Block>

      <Block title="Games you want more of">
        <div className="flex flex-wrap gap-2">
          {GAME_TYPES.map((g) => (
            <Chip
              key={g}
              on={gameTypes.includes(g)}
              onClick={() => {
                setTypesMsg(null);
                setGameTypes((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
              }}
            >
              <span className="capitalize">{g.replace(/_/g, ' ')}</span>
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={typesBusy || !typesDirty} onClick={() => void saveTypes()}>
            {typesBusy ? 'Saving…' : 'Save'}
          </Button>
          <Saved msg={typesMsg} />
        </div>
      </Block>

      <Block title="Connect your AI assistant" sub="Let an assistant like Claude check your games, find courts and book for you.">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">1. Server link</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">{mcpUrl}</code>
            <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy('url', mcpUrl)}>
              {copied === 'url' ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">2. Your key</span>
          {newKey ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">{newKey}</code>
              <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy('key', newKey)}>
                {copied === 'key' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : (
            <Button variant="primary" className="self-start" disabled={keyBusy} onClick={() => void mint()}>
              {keyBusy ? 'Working…' : 'Create a key'}
            </Button>
          )}
          <span className="text-[13px] text-muted">
            3. In your assistant, add a custom MCP server with the link, and send the key as a Bearer authorization header. The key is shown once; only its hash is stored.
          </span>
        </div>
        <ErrorNote>{keyError}</ErrorNote>
        {tokens.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-[13px] font-semibold text-muted">Manage keys ({tokens.filter((t) => !t.revoked_at).length} active)</summary>
            <div className="mt-2 flex flex-col">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between border-t border-line py-2 text-[13px]">
                  <span className="text-muted">
                    {t.label} · {t.revoked_at ? 'revoked' : 'active'}
                  </span>
                  {!t.revoked_at ? (
                    <Button size="sm" variant="ghost" disabled={keyBusy} onClick={() => void revoke(t.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </Block>

      <Block title="Account">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[14px]">
          <Link to="/notifications">Notifications</Link>
          {isAdmin ? <Link to="/admin/venues">Admin: venues</Link> : null}
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/community">Community and safety</Link>
          <Link to="/data-deletion">Delete my data</Link>
        </div>
        <Button variant="danger" className="self-start" icon={<LogOut size={16} />} onClick={() => void signOut()}>
          Sign out
        </Button>
      </Block>
    </div>
  );
}
