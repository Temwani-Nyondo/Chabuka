import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TEAM_CATEGORY_LABELS } from '@chabuka/shared';
import type { Team } from '@chabuka/shared';
import { supabase } from '../lib/supabase';
import { fetchTeamDetail, isCaptainRole } from '../lib/teams';
import type { TeamDetail } from '../lib/teams';
import { uploadImage } from '../lib/upload';
import {
  createInviteLinkAction,
  deleteTeamAction,
  removeMemberAction,
  setPositionAction,
  setRoleAction,
  updateTeamAction,
} from '../lib/api';
import type { TeamRole } from '@chabuka/shared';

function formatWhen(iso: string | null): string {
  if (!iso) return 'Date TBC';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date TBC';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [invite, setInvite] = useState<{ code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', area: '', city: '', description: '' });
  const [uploading, setUploading] = useState(false);
  const [positions, setPositions] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!user || !id) return;
    setDetail(await fetchTeamDetail(id, user.id));
  }, [user, id]);

  useEffect(() => {
    reload()
      .then(() => {
        setDetail((d) => {
          if (d) {
            setForm({
              name: d.team.name,
              area: d.team.area ?? '',
              city: d.team.city ?? '',
              description: (d.team as Team & { description?: string | null }).description ?? '',
            });
          }
          return d;
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load this team.'),
      )
      .finally(() => setLoading(false));
  }, [reload]);

  if (loading) return <div className="page"><p className="loading">Loading team…</p></div>;
  if (error || !detail) {
    return (
      <div className="page">
        <p className="error">{error ?? 'Team not found.'}</p>
        <Link className="btn" to="/teams">Back to teams</Link>
      </div>
    );
  }

  const { team, myRole, members, fixtures } = detail;
  const isManager = myRole !== null && isCaptainRole(myRole);
  const isOwner = myRole === 'owner';
  const canAct = token != null;

  const act = async (fn: (t: string) => Promise<unknown>, done: string) => {
    if (!token) return;
    setError(null);
    setNotice(null);
    try {
      await fn(token);
      await reload();
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    void act(
      (t) =>
        updateTeamAction(
          {
            teamId: team.id,
            name: form.name.trim(),
            area: form.area.trim(),
            city: form.city.trim() || null,
            description: form.description.trim() || null,
          },
          t,
        ),
      'Team updated.',
    ).then(() => setEditing(false));
  };

  const uploadLogo = async (file: File) => {
    if (!supabase || !token) return;
    setUploading(true);
    setError(null);
    try {
      const path = `team-logos/${team.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateTeamAction({ teamId: team.id, logoUrl: data.publicUrl }, token);
      await reload();
      setNotice('Logo updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const uploadCover = async (file: File) => {
    if (!token) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(`team-covers/${team.id}`, file);
      await updateTeamAction({ teamId: team.id, coverUrl: url }, token);
      await reload();
      setNotice('Cover updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const results = fixtures.filter((f) => f.homeScore !== null && f.awayScore !== null);
  const upcoming = fixtures.filter((f) => f.homeScore === null || f.awayScore === null);

  return (
    <div className="page">
      <Link className="btn btn-ghost" to="/teams">← Teams</Link>
      <div className="card team-head">
        {team.cover_url ? (
          <img className="cover-banner" src={team.cover_url} alt="" />
        ) : null}
        {team.logo_url ? (
          <img className="team-logo" src={team.logo_url} alt={`${team.name} badge`} />
        ) : (
          <div className="team-logo team-logo-empty" aria-hidden="true">
            {team.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <h1>{team.name}</h1>
          <p className="muted">
            {TEAM_CATEGORY_LABELS[team.category]}
            {team.area ? ` · ${team.area}` : ''}
          </p>
          {(team as Team & { description?: string | null }).description ? (
            <p>{(team as Team & { description?: string | null }).description}</p>
          ) : null}
        </div>
        {isManager ? (
          <button className="btn" type="button" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close' : 'Edit'}
          </button>
        ) : null}
      </div>

      {isManager && editing ? (
        <form
          className="card"
          onSubmit={submitEdit}
        >
          <h2>Edit team</h2>
          <label className="field">
            Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={80}
            />
          </label>
          <label className="field">
            Area
            <input
              className="input"
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              maxLength={80}
            />
          </label>
          <label className="field">
            City
            <input
              className="input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              maxLength={80}
            />
          </label>
          <label className="field">
            Description
            <textarea
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={2000}
              rows={3}
            />
          </label>
          <label className="field">
            Team photo
            <input
              className="input"
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
          </label>
          <label className="field">
            Team cover
            <input
              className="input"
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadCover(file);
              }}
            />
          </label>
          {uploading ? <p className="muted">Uploading photo…</p> : null}
          <button className="btn btn-primary" type="submit">
            Save changes
          </button>
        </form>
      ) : null}

      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <h2>Squad ({members.length})</h2>
      {members.map((m) => (
        <div className="card" key={m.userId}>
          <div className="row">
            <strong>{m.name ?? 'Player'}</strong>
            <span className="tag">{m.role}</span>
          </div>
          <p className="muted">{m.position ?? 'No position set'}</p>
          {isManager && m.userId !== user?.id ? (
            <div className="row">
              <input
                className="input"
                placeholder="Position"
                aria-label={`Position for ${m.name ?? 'player'}`}
                value={positions[m.userId] ?? m.position ?? ''}
                onChange={(e) => setPositions({ ...positions, [m.userId]: e.target.value })}
                maxLength={40}
              />
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const pos = (positions[m.userId] ?? m.position ?? '').trim();
                  if (!pos) return;
                  void act(
                    (t) => setPositionAction({ teamId: team.id, userId: m.userId, position: pos }, t),
                    'Position saved.',
                  );
                }}
              >
                Save
              </button>
              {isOwner ? (
                <select
                  className="input"
                  aria-label={`Role for ${m.name ?? 'player'}`}
                  value={m.role}
                  onChange={(e) => {
                    void act(
                      (t) =>
                        setRoleAction(
                          { teamId: team.id, userId: m.userId, role: e.target.value as TeamRole },
                          t,
                        ),
                      'Role saved.',
                    );
                  }}
                >
                  <option value="owner">owner</option>
                  <option value="captain">captain</option>
                  <option value="player">player</option>
                </select>
              ) : null}
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  void act(
                    (t) => removeMemberAction({ teamId: team.id, userId: m.userId }, t),
                    'Player removed.',
                  );
                }}
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ))}

      {myRole ? (
        <div className="card">
          <h2>Invite players</h2>
          <p className="muted">Share this link — new members join Chabuka and land straight in {team.name}.</p>
          {invite ? (
            <div className="row">
              <code>{invite.code}</code>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(invite.code).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled={!canAct}
              onClick={() => {
                setCopied(false);
                void act(
                  async (t) => {
                    const out = await createInviteLinkAction({ teamId: team.id }, t);
                    setInvite(out.invite);
                  },
                  'Invite link created.',
                );
              }}
            >
              Create invite link
            </button>
          )}
        </div>
      ) : null}

      <h2>Upcoming</h2>
      {upcoming.length === 0 ? <p className="muted">Nothing scheduled.</p> : null}
      {upcoming.map((f) => (
        <div className="card" key={`${f.kind}-${f.id}`}>
          <div className="row">
            <strong>
              {f.kind === 'fixture' ? 'Fixture' : 'Challenge'} · {f.opponentName ?? 'TBD'}
            </strong>
            <span className="tag">{f.status}</span>
          </div>
          <p className="muted">
            {formatWhen(f.startsAt)}
            {f.competition ? ` · ${f.competition}` : ''}
          </p>
        </div>
      ))}

      <h2>Results</h2>
      {results.length === 0 ? <p className="muted">No results yet.</p> : null}
      {results.map((f) => {
        const mine = f.isHome ? f.homeScore : f.awayScore;
        const theirs = f.isHome ? f.awayScore : f.homeScore;
        const outcome = mine !== null && theirs !== null ? (mine > theirs ? 'Won' : mine < theirs ? 'Lost' : 'Drew') : '';
        return (
          <div className="card" key={`${f.kind}-${f.id}`}>
            <div className="row">
              <strong>
                {outcome} {mine ?? ''}–{theirs ?? ''} vs {f.opponentName}
              </strong>
              <span className="tag">{f.status}</span>
            </div>
            <p className="muted">
              {formatWhen(f.startsAt)}
              {f.competition ? ` · ${f.competition}` : ''}
            </p>
          </div>
        );
      })}

      {isOwner ? (
        <div className="card">
          <h2>Danger zone</h2>
          {!confirmDelete ? (
            <button className="btn" type="button" onClick={() => setConfirmDelete(true)}>
              Delete team
            </button>
          ) : (
            <div className="row">
              <span>Permanently delete {team.name}? Teams with open challenges or tournament history are protected.</span>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  void act(async (t) => {
                    await deleteTeamAction(team.id, t);
                    navigate('/teams');
                  }, '');
                }}
              >
                Yes, delete
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}