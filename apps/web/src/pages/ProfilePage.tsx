import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ageBand } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/upload';
import { fetchMyTeams, isCaptainRole } from '../lib/teams';
import type { MyTeam } from '../lib/teams';
import { fetchCircles } from '../lib/circles';
import type { CircleListing } from '../lib/circles';
import { SKINS, useSkin, useTheme } from '../lib/theme';
import { API_BASE, fetchAgentTokens, mintAgentToken, revokeAgentToken } from '../lib/api';
import type { AgentTokenRow } from '../lib/api';

interface LockerRoom {
  gamesPlayed: number;
  streakWeeks: number;
  nextGame: { title: string; startsAt: string } | null;
  badges: string[];
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function tierFor(gamesPlayed: number): { name: string; className: string } {
  if (gamesPlayed >= 20) return { name: 'Gold', className: 'tier-gold' };
  if (gamesPlayed >= 5) return { name: 'Silver', className: 'tier-silver' };
  return { name: 'Bronze', className: 'tier-bronze' };
}

export default function ProfilePage() {
  const { profile, sportsCount, signOut, session, user, refreshProfile } = useAuth();
  const [uploadingImg, setUploadingImg] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const uploadPicture = async (kind: 'photo' | 'cover', file: File) => {
    if (!user || !supabase) return;
    setUploadingImg(true);
    setImgError(null);
    try {
      const url = await uploadImage(kind === 'photo' ? `profile-photos/${user.id}` : `profile-covers/${user.id}`, file);
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, ...(kind === 'photo' ? { photo_url: url } : { cover_url: url }) });
      if (error) throw new Error(error.message);
      await refreshProfile();
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploadingImg(false);
    }
  };
  const [locker, setLocker] = useState<LockerRoom | null>(null);
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [myCircles, setMyCircles] = useState<CircleListing[]>([]);
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; startsAt: string }[]>([]);
  const { theme, toggle } = useTheme();
  const { skin, setSkin } = useSkin();
  const [tokens, setTokens] = useState<AgentTokenRow[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const mcpUrl = `${API_BASE}/mcp`;
  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setTokenError('Copy failed — long-press and copy it manually.');
    }
  };

  const accessToken = session?.access_token;

  const reloadTokens = async () => {
    if (!accessToken) return;
    try {
      setTokens(await fetchAgentTokens(accessToken));
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Could not load agent tokens.');
    }
  };

  useEffect(() => {
    void reloadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per login token
  }, [accessToken]);

  useEffect(() => {
    const db = supabase;
    if (!user || !db) return;
    const load = async () => {
      const { data: parts } = await db
        .from('match_participants')
        .select('match_id')
        .eq('user_id', user.id)
        .eq('status', 'joined');
      const matchIds = [...new Set(((parts ?? []) as { match_id: string }[]).map((p) => p.match_id))];
      let gamesPlayed = 0;
      let nextGame: LockerRoom['nextGame'] = null;
      let streakWeeks = 0;
      let upcomingRows: { id: string; title: string; starts_at: string }[] = [];
      if (matchIds.length > 0) {
        const { data: matchRows } = await db
          .from('matches')
          .select('id,title,starts_at,status,organiser_id')
          .in('id', matchIds);
        const rows = (matchRows ?? []) as {
          id: string;
          title: string;
          starts_at: string;
          status: string;
          organiser_id: string;
        }[];
        const finished = rows
          .filter((m) => m.status === 'finished')
          .map((m) => new Date(m.starts_at).getTime());
        gamesPlayed = finished.length;
        // Streak: consecutive calendar weeks (Mon-start) with a finished game.
        const weeks = new Set(
          finished.map((t) => {
            const d = new Date(t);
            const monday = new Date(d);
            monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            monday.setHours(0, 0, 0, 0);
            return monday.getTime();
          }),
        );
        const cursor = new Date();
        cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
        cursor.setHours(0, 0, 0, 0);
        while (weeks.has(cursor.getTime())) {
          streakWeeks += 1;
          cursor.setDate(cursor.getDate() - 7);
        }
        upcomingRows = rows
          .filter((m) => new Date(m.starts_at).getTime() >= Date.now() - 3600 * 1000)
          .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
        if (upcomingRows[0]) nextGame = { title: upcomingRows[0].title, startsAt: upcomingRows[0].starts_at };
      }
      const badges: string[] = [];
      if (gamesPlayed >= 1) badges.push('First game');
      if (gamesPlayed >= 5) badges.push('Regular');
      const mine = await fetchMyTeams(user.id).catch(() => []);
      setMyTeams(mine);
      if (mine.some((m) => isCaptainRole(m.role))) badges.push('Captain');
      const { count: organised } = await db
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('organiser_id', user.id);
      if ((organised ?? 0) > 0) badges.push('Organiser');
      setLocker({ gamesPlayed, streakWeeks, nextGame, badges });
      setUpcoming(
        upcomingRows.slice(0, 5).map((m) => ({ id: m.id, title: m.title, startsAt: m.starts_at })),
      );
      void fetchCircles(user.id)
        .then((all) => setMyCircles(all.filter((c) => c.isMember).slice(0, 6)))
        .catch(() => setMyCircles([]));
    };
    void load().catch(() => {
      setLocker({ gamesPlayed: 0, streakWeeks: 0, nextGame: null, badges: [] });
      setUpcoming([]);
      setMyTeams([]);
      setMyCircles([]);
    });
  }, [user]);

  const mint = async () => {
    if (!accessToken) {
      setTokenError('Not signed in.');
      return;
    }
    setTokenBusy(true);
    setTokenError(null);
    try {
      const { token } = await mintAgentToken('Agent', accessToken);
      setNewToken(token);
      await reloadTokens();
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Could not create the token.');
    } finally {
      setTokenBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!accessToken) return;
    setTokenBusy(true);
    try {
      await revokeAgentToken(id, accessToken);
      await reloadTokens();
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Could not revoke the token.');
    } finally {
      setTokenBusy(false);
    }
  };

  return (
    <div className="page floodlight">
      <div className="page-head">
        <span className="eyebrow">Locker room</span>
        <h1>Profile</h1>
        <p>Your card, your stats, your crew.</p>
      </div>
      <div className={`card player-card ${locker ? tierFor(locker.gamesPlayed).className : ''}`}>
        {profile?.cover_url ? (
          <img className="cover-banner" src={profile.cover_url} alt="" />
        ) : null}
        <span className="muted">Player card · {locker ? tierFor(locker.gamesPlayed).name : '…'}</span>
        <div className="player-identity">
          {profile?.photo_url ? (
            <img className="avatar-preview" src={profile.photo_url} alt={`${profile.name ?? 'Player'} photo`} />
          ) : null}
          <div>
            <span className="player-name">{profile?.name ?? 'New player'}</span>
            <br />
            <span className="muted">
              {[profile?.area, profile ? ageBand(profile.birth_year) : null, profile?.gender]
                .filter(Boolean)
                .join(' · ') || 'Area not set'}
            </span>
          </div>
        </div>
        {imgError ? <p className="error">{imgError}</p> : null}
        <div className="actions-row">
          <label className="btn" htmlFor="profile-photo">Photo</label>
          <input
            id="profile-photo"
            type="file"
            accept="image/*"
            hidden
            disabled={uploadingImg}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPicture('photo', file);
              e.target.value = '';
            }}
          />
          <label className="btn" htmlFor="profile-cover">Cover</label>
          <input
            id="profile-cover"
            type="file"
            accept="image/*"
            hidden
            disabled={uploadingImg}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPicture('cover', file);
              e.target.value = '';
            }}
          />
          {uploadingImg ? <span className="muted">Uploading…</span> : null}
        </div>
        <div className="player-stats">
          <div className="player-stat">
            <strong>{sportsCount}</strong>
            <span>Sports</span>
          </div>
          <div className="player-stat">
            <strong>{locker ? locker.gamesPlayed : '…'}</strong>
            <span>Games</span>
          </div>
          <div className="player-stat">
            <strong>{locker ? `${locker.streakWeeks} wk` : '…'}</strong>
            <span>Streak</span>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="row">
          <h2>My schedule</h2>
          <Link className="muted" to="/explore">Find games</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="muted">No upcoming games yet. Find one on Explore and it shows up here.</p>
        ) : (
          upcoming.map((m) => (
            <div className="row" key={m.id}>
              <strong>{m.title}</strong>
              <span className="tag">{dateFmt.format(new Date(m.startsAt))}</span>
            </div>
          ))
        )}
      </div>
      <div className="card">
        <div className="row">
          <h2>My crews</h2>
          <Link className="muted" to="/teams">Manage teams</Link>
        </div>
        {myTeams.length === 0 ? (
          <p className="muted">No crews yet. Create a team to gather your side.</p>
        ) : (
          myTeams.map(({ team, role }) => (
            <Link className="row card-link" key={team.id} to={`/teams/${team.id}`}>
              <strong>{team.name}</strong>
              <span className="tag">{role}</span>
            </Link>
          ))
        )}
      </div>
      <div className="card">
        <div className="row">
          <h2>My circles</h2>
          <Link className="muted" to="/circles">All circles</Link>
        </div>
        {myCircles.length === 0 ? (
          <p className="muted">No circles yet. Join one to get its events and notices.</p>
        ) : (
          myCircles.map(({ circle, memberCount }) => (
            <div className="row" key={circle.id}>
              <strong>{circle.name}</strong>
              <span className="tag">{memberCount} members</span>
            </div>
          ))
        )}
      </div>
      {locker && locker.badges.length > 0 ? (
        <div className="card">
          <span className="muted">Badge shelf</span>
          <div className="badge-row">
            {locker.badges.map((b) => (
              <span className="tag" key={b}>{b}</span>
            ))}
          </div>
        </div>
      ) : null}
      {locker?.nextGame ? (
        <div className="card ticket">
          <div className="row">
            <strong>Next game</strong>
            <span className="tag">{dateFmt.format(new Date(locker.nextGame.startsAt))}</span>
          </div>
          <p>{locker.nextGame.title}</p>
        </div>
      ) : null}
      <div className="card">
        <h2>Connect your AI assistant</h2>
        <p className="muted">
          Point your AI app at Chabuka and it can check your games, find courts and book for
          you. Works with any assistant that accepts a custom MCP server (e.g. Claude).
        </p>
        <div className="field">
          <span>Step 1 — server link</span>
          <div className="row">
            <code>{mcpUrl}</code>
            <button className="btn btn-ghost" type="button" onClick={() => { void copyText('url', mcpUrl); }}>
              {copied === 'url' ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
        <div className="field">
          <span>Step 2 — your key (connects the link to your account)</span>
          {newToken ? (
            <div className="row">
              <code>{newToken}</code>
              <button className="btn btn-ghost" type="button" onClick={() => { void copyText('token', newToken); }}>
                {copied === 'token' ? 'Copied' : 'Copy key'}
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" type="button" disabled={tokenBusy} onClick={() => { void mint(); }}>
              {tokenBusy ? 'Working…' : 'Get my key'}
            </button>
          )}
        </div>
        <p className="muted">
          Step 3 — in your AI app, add a custom MCP server: paste the link as the server URL
          and send your key as a <code>Bearer</code> authorization header. The key shows once;
          only its hash is stored.
        </p>
        {tokenError ? <p className="error">{tokenError}</p> : null}
        {tokens.length > 0 ? (
          <details>
            <summary className="muted">Advanced: manage keys ({tokens.filter((t) => !t.revoked_at).length} active)</summary>
            {tokens.map((t) => (
              <div className="row" key={t.id}>
                <span className="muted">
                  {t.label} · {t.revoked_at ? 'revoked' : 'active'}
                </span>
                {!t.revoked_at ? (
                  <button className="btn btn-ghost" type="button" disabled={tokenBusy} onClick={() => { void revoke(t.id); }}>
                    Revoke
                  </button>
                ) : null}
              </div>
            ))}
          </details>
        ) : null}
      </div>
      <div className="card">
        <div className="row">
          <span className="muted">Theme</span>
          <button className="btn btn-ghost" type="button" onClick={toggle}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
        <div className="field">
          <span>Background skin</span>
          <div className="chips">
            {SKINS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={skin === s.value ? 'chip chip-active' : 'chip'}
                aria-pressed={skin === s.value}
                onClick={() => setSkin(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted">
        <Link to="/notifications">Notifications</Link> · <Link to="/privacy">Privacy</Link> ·{' '}
        <Link to="/terms">Terms</Link> · <Link to="/community">Community &amp; safety</Link>
      </p>
      <button
        className="btn btn-ghost"
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
