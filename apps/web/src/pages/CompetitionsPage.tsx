import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from '../components/EmptyState';
import MatchFoundOverlay from '../components/MatchFoundOverlay';
import { useAuth } from '../auth/AuthContext';
import {
  closeRegistrationAction,
  createCompetitionAction,
  followCompetitionAction,
  postAnnouncementAction,
  postResultAction,
  registerEntryAction,
} from '../lib/api';
import { fetchBoard, fetchCompetitions } from '../lib/competitions';
import type { Board } from '../lib/competitions';
import { fetchSports } from '../lib/matches';
import { fetchMyTeams, isCaptainRole } from '../lib/teams';
import type { Sport } from '@chabuka/shared';
import { COMPETITION_STATUS_LABELS } from '@chabuka/shared';
import type { CreateCompetitionInput } from '@chabuka/shared';

type Tab = 'fixtures' | 'standings' | 'results' | 'news';

export default function CompetitionsPage() {
  const { session, user } = useAuth();
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchCompetitions>>>([]);
  const [myTeams, setMyTeams] = useState<Awaited<ReturnType<typeof fetchMyTeams>>>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<Tab>('fixtures');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [maxEntries, setMaxEntries] = useState(6);
  const [sportId, setSportId] = useState('');

  const [scores, setScores] = useState<Record<string, { home: string; away: string }>>({});
  const [announceText, setAnnounceText] = useState('');
  const [reveal, setReveal] = useState<{ home: string; away: string; homeScore: number; awayScore: number } | null>(null);

  const reloadList = useCallback(async () => {
    setList(await fetchCompetitions());
  }, []);

  const reloadBoard = useCallback(async () => {
    if (!selectedId || !user) {
      setBoard(null);
      return;
    }
    setBoard(await fetchBoard(selectedId, user.id));
  }, [selectedId, user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([reloadList(), fetchMyTeams(user.id), fetchSports()])
      .then(([, mine, sportList]) => {
        setMyTeams(mine);
        setSports(sportList);
        if (sportList[0]) setSportId((prev) => prev || sportList[0]!.id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load tournaments.'),
      )
      .finally(() => setLoading(false));
  }, [reloadList, user]);

  useEffect(() => {
    reloadBoard().catch((err: unknown) =>
      setActionError(err instanceof Error ? err.message : 'Could not open the board.'),
    );
  }, [reloadBoard]);

  const token = session?.access_token;

  const run = async (fn: (token: string) => Promise<unknown>, after?: () => Promise<void>) => {
    if (!token) {
      setActionError('Not signed in.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await fn(token);
      await reloadList();
      await reloadBoard();
      if (after) await after();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const captainTeams = myTeams.filter((m) => isCaptainRole(m.role)).map((m) => m.team);

  const createSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      setActionError('Not signed in.');
      return;
    }
    const input: CreateCompetitionInput = {
      name: name.trim(),
      sportId,
      area: area.trim(),
      startsOn,
      maxEntries,
    };
    if (!input.name || !input.area || !input.startsOn || !input.sportId) {
      setActionError('Fill name, area, start date and pick a sport.');
      return;
    }
    void run(
      (t) => createCompetitionAction(input, t),
      async () => {
        setShowForm(false);
        setName('');
        setArea('');
        setStartsOn('');
      },
    );
  };

  const teamName = (id: string) => board?.teams.get(id)?.name ?? 'Team';
  const isOrganiser = board && user ? board.competition.organiser_id === user.id : false;

  return (
    <div className="page">
      <h1>Season</h1>
      {reveal ? (
        <MatchFoundOverlay
          home={reveal.home}
          away={reveal.away}
          homeScore={reveal.homeScore}
          awayScore={reveal.awayScore}
          onClose={() => setReveal(null)}
        />
      ) : null}
      <p className="muted">Tournaments first: fixtures, results, standings, announcements.</p>
      {loading ? <p className="loading">Loading tournaments…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && list.length === 0 && !showForm ? (
        <EmptyState
          title="No tournaments yet"
          hint="Create a tournament to generate fixtures and a live table."
          actionLabel="Create tournament"
          onAction={() => setShowForm(true)}
        />
      ) : null}

      {showForm ? (
        <div className="card">
          <h2>Create tournament</h2>
          <form onSubmit={createSubmit}>
            <div className="field">
              <label htmlFor="comp-name">Name</label>
              <input
                id="comp-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Saturday Football"
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor="comp-area">Area</label>
              <input
                id="comp-area"
                className="input"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Woodlands"
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor="comp-start">Starts</label>
              <input
                id="comp-start"
                className="input"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="comp-max">Max teams (2–16)</label>
              <input
                id="comp-max"
                className="input"
                type="number"
                min={2}
                max={16}
                value={maxEntries}
                onChange={(e) => setMaxEntries(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="comp-sport">Sport</label>
              <select
                id="comp-sport"
                className="input"
                value={sportId}
                onChange={(e) => setSportId(e.target.value)}
              >
                <option value="">Pick a sport…</option>
                {sports.map((sport) => (
                  <option key={sport.id} value={sport.id}>
                    {sport.name}
                  </option>
                ))}
              </select>
              <p className="hint">Pick a sport from your teams, or create a team first.</p>
            </div>
            {actionError && showForm ? <p className="error">{actionError}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create tournament'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </form>
        </div>
      ) : (
        <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>
          Create tournament
        </button>
      )}

      {list.map(({ competition }) => (
        <div className="card" key={competition.id}>
          <div className="row">
            <strong>{competition.name}</strong>
            <span className="tag">{COMPETITION_STATUS_LABELS[competition.status]}</span>
          </div>
          <p className="muted">
            {competition.area ?? ''} · starts {competition.starts_on}
          </p>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setSelectedId(selectedId === competition.id ? null : competition.id);
              setTab('fixtures');
            }}
          >
            {selectedId === competition.id ? 'Close board' : 'Open board'}
          </button>
        </div>
      ))}

      {selectedId && board ? (
        <div>
          <div className="chips">
            {(['fixtures', 'standings', 'results', 'news'] as Tab[]).map((t) => (
              <button
                key={t}
                className={tab === t ? 'chip chip-active' : 'chip'}
                type="button"
                onClick={() => setTab(t)}
              >
                {t[0]?.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="actions-row">
            {!board.following ? (
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => {
                  void run((t) => followCompetitionAction(board.competition.id, t));
                }}
              >
                Follow
              </button>
            ) : (
              <span className="tag">Following</span>
            )}
            {isOrganiser && board.competition.status === 'registration' && board.entries.length >= 2 ? (
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  void run((t) => closeRegistrationAction(board.competition.id, t));
                }}
              >
                Start tournament
              </button>
            ) : null}
          </div>
          {actionError ? <p className="error">{actionError}</p> : null}

          {board.competition.status === 'registration' ? (
            <div className="card">
              <h2>Entries ({board.entries.length})</h2>
              {board.entries.length === 0 ? <p className="muted">No teams entered yet.</p> : null}
              {board.entries.map((id) => (
                <p key={id}>{board.teams.get(id)?.name ?? 'Team'}</p>
              ))}
              <div className="chips">
                {captainTeams
                  .filter((team) => !board.entries.includes(team.id))
                  .map((team) => (
                    <button
                      key={team.id}
                      className="chip"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void run((t) =>
                          registerEntryAction(
                            { competitionId: board.competition.id, teamId: team.id },
                            t,
                          ),
                        );
                      }}
                    >
                      Enter {team.name}
                    </button>
                  ))}
              </div>
            </div>
          ) : null}

          {tab === 'fixtures' ? (
            <div>
              {board.fixtures.filter((f) => f.status === 'scheduled').length === 0 ? (
                <EmptyState title="No fixtures yet" hint="Start the tournament to generate them." />
              ) : null}
              {board.fixtures
                .filter((f) => f.status === 'scheduled')
                .map((f) => (
                  <div className="card" key={f.id}>
                    <div className="row">
                      <strong>
                        {teamName(f.home_team_id)} vs {teamName(f.away_team_id)}
                      </strong>
                      <span className="tag">Scheduled</span>
                    </div>
                    {isOrganiser ? (
                      <div className="actions-row">
                        <input
                          className="input"
                          style={{ maxWidth: 90 }}
                          inputMode="numeric"
                          placeholder="Home"
                          value={scores[f.id]?.home ?? ''}
                          onChange={(e) =>
                            setScores((prev) => ({
                              ...prev,
                              [f.id]: { home: e.target.value, away: prev[f.id]?.away ?? '' },
                            }))
                          }
                        />
                        <input
                          className="input"
                          style={{ maxWidth: 90 }}
                          inputMode="numeric"
                          placeholder="Away"
                          value={scores[f.id]?.away ?? ''}
                          onChange={(e) =>
                            setScores((prev) => ({
                              ...prev,
                              [f.id]: { home: prev[f.id]?.home ?? '', away: e.target.value },
                            }))
                          }
                        />
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const home = Number(scores[f.id]?.home);
                            const away = Number(scores[f.id]?.away);
                            if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
                              setActionError('Enter whole-number scores.');
                              return;
                            }
                            const homeName = teamName(f.home_team_id);
                            const awayName = teamName(f.away_team_id);
                            void run((t) => postResultAction({ fixtureId: f.id, homeScore: home, awayScore: away }, t)).then(
                              () => setReveal({ home: homeName, away: awayName, homeScore: home, awayScore: away }),
                            );
                          }}
                        >
                          Post result
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
            </div>
          ) : null}

          {tab === 'results' ? (
            <div>
              {board.fixtures.filter((f) => f.status === 'finished').length === 0 ? (
                <EmptyState title="No results yet" hint="Results appear here as fixtures finish." />
              ) : null}
              {board.fixtures
                .filter((f) => f.status === 'finished')
                .map((f) => (
                  <div className="card" key={f.id}>
                    <div className="row">
                      <strong>
                        {teamName(f.home_team_id)} {f.home_score}–{f.away_score} {teamName(f.away_team_id)}
                      </strong>
                      <span className="tag">Full time</span>
                    </div>
                  </div>
                ))}
            </div>
          ) : null}

          {tab === 'standings' ? (
            <div className="card">
              <h2>Standings</h2>
              {board.standings.map((row, i) => (
                <div className="row" key={row.teamId}>
                  <span>
                    {i + 1}. {teamName(row.teamId)}
                  </span>
                  <span className="muted">
                    P{row.played} W{row.won} D{row.drawn} L{row.lost} · {row.points} pts
                  </span>
                </div>
              ))}
              {board.standings.length === 0 ? <p className="muted">No entries yet.</p> : null}
            </div>
          ) : null}

          {tab === 'news' ? (
            <div>
              {board.announcements.length === 0 ? (
                <EmptyState title="No announcements" hint="Organiser updates land here." />
              ) : null}
              {board.announcements.map((a) => (
                <div className="card" key={a.id}>
                  <p>{a.text}</p>
                  <p className="muted">{a.type}</p>
                </div>
              ))}
              {isOrganiser ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!announceText.trim()) return;
                    void run((t) =>
                      postAnnouncementAction({ competitionId: board.competition.id, text: announceText.trim() }, t),
                    );
                    setAnnounceText('');
                  }}
                >
                  <div className="field">
                    <input
                      className="input"
                      value={announceText}
                      onChange={(e) => setAnnounceText(e.target.value)}
                      placeholder="Post an announcement…"
                      maxLength={500}
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    Announce
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
