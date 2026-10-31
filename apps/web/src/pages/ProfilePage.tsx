import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ageBand } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchMyTeams, isCaptainRole } from '../lib/teams';
import { useTheme } from '../lib/theme';
import { fetchAgentTokens, mintAgentToken, revokeAgentToken } from '../lib/api';
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
  const { profile, sportsCount, signOut, session, user } = useAuth();
  const [locker, setLocker] = useState<LockerRoom | null>(null);
  const { theme, toggle } = useTheme();
  const [tokens, setTokens] = useState<AgentTokenRow[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);

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
        const upcoming = rows
          .filter((m) => new Date(m.starts_at).getTime() >= Date.now() - 3600 * 1000)
          .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
        if (upcoming[0]) nextGame = { title: upcoming[0].title, startsAt: upcoming[0].starts_at };
      }
      const badges: string[] = [];
      if (gamesPlayed >= 1) badges.push('First game');
      if (gamesPlayed >= 5) badges.push('Regular');
      const mine = await fetchMyTeams(user.id).catch(() => []);
      if (mine.some((m) => isCaptainRole(m.role))) badges.push('Captain');
      const { count: organised } = await db
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('organiser_id', user.id);
      if ((organised ?? 0) > 0) badges.push('Organiser');
      setLocker({ gamesPlayed, streakWeeks, nextGame, badges });
    };
    void load().catch(() => setLocker({ gamesPlayed: 0, streakWeeks: 0, nextGame: null, badges: [] }));
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
    <div className="page">
      <h1>Profile</h1>
      <div className={`card player-card ${locker ? tierFor(locker.gamesPlayed).className : ''}`}>
        <span className="muted">Player card · {locker ? tierFor(locker.gamesPlayed).name : '…'}</span>
        <span className="player-name">{profile?.name ?? 'New player'}</span>
        <span className="muted">
          {[profile?.area, profile ? ageBand(profile.birth_year) : null, profile?.gender]
            .filter(Boolean)
            .join(' · ') || 'Area not set'}
        </span>
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
        <h2>Connect an AI agent</h2>
        <p className="muted">
          Give an agent a personal access token and it can act for you through Chabuka&apos;s MCP
          server. Only the hash is stored; the token shows once.
        </p>
        {newToken ? (
          <p>
            <strong>Your new token:</strong> <code>{newToken}</code>
          </p>
        ) : null}
        {tokenError ? <p className="error">{tokenError}</p> : null}
        <button className="btn btn-primary" type="button" disabled={tokenBusy} onClick={() => { void mint(); }}>
          {tokenBusy ? 'Working…' : 'Generate token'}
        </button>
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
      </div>
      <div className="card">
        <div className="row">
          <span className="muted">Theme</span>
          <button className="btn btn-ghost" type="button" onClick={toggle}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
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
