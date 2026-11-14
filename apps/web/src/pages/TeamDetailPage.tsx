import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Copy, Crown, ScrollText, Settings2, Shirt as ShirtIcon, UserPlus } from 'lucide-react';
import { JOIN_POLICY_LABELS, TEAM_CATEGORY_LABELS } from '@chabuka/shared';
import type { JoinPolicy, Team, TeamRole } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchTeamDetail, isCaptainRole } from '../lib/teams';
import type { TeamDetail, TeamFixture, TeamMemberDetail } from '../lib/teams';
import { uploadImage } from '../lib/upload';
import {
  createInviteLinkAction,
  deleteTeamAction,
  removeMemberAction,
  revokeInviteLinkAction,
  setPositionAction,
  setRoleAction,
  updateTeamAction,
} from '../lib/api';
import { answerJoinRequest, askToJoinTeam, fetchTeamAdmin, handOverTeam, saveTeamSettings, setShirt } from '../lib/teamAdmin';
import type { TeamAdminView } from '../lib/teamAdmin';
import { AvailabilityCard } from '../components/MatchDay';
import { dayLabel, dayShort, timeLabel } from '../components/GameCard';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Crest,
  EmptyState,
  ErrorNote,
  FormGuide,
  ListRow,
  Section,
  Segmented,
  Sheet,
  Skeleton,
  StatTile,
  cx,
  kitColour,
} from '../components/ui';
import type { Result } from '../components/ui';

type Tab = 'overview' | 'fixtures' | 'squad' | 'admin';

const KIT_SWATCHES = ['#1d3f8f', '#b42318', '#0f766e', '#6b4e16', '#5b3fa8', '#9a3412', '#155e75', '#3f6212', '#111827', '#f2c230', '#e5e7eb', '#be185d'];
const ROLE_ORDER: Record<TeamRole, number> = { owner: 0, captain: 1, player: 2 };
const fieldCls = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-brand';

function scoreOf(f: TeamFixture): { us: number; them: number } | null {
  if (f.homeScore == null || f.awayScore == null) return null;
  return f.isHome === false ? { us: f.awayScore, them: f.homeScore } : { us: f.homeScore, them: f.awayScore };
}

function subjectOf(f: TeamFixture): { type: 'fixture' | 'match'; id: string } | null {
  if (f.kind === 'fixture') return { type: 'fixture', id: f.id };
  return f.matchId ? { type: 'match', id: f.matchId } : null;
}

export default function TeamDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const token = session?.access_token;
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [admin, setAdmin] = useState<TeamAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<TeamMemberDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [invite, setInvite] = useState<{ code: string; expires_at: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'fixtures' || tabParam === 'squad' || tabParam === 'admin' ? tabParam : 'overview';
  const setTab = (t: Tab) => {
    params.set('tab', t);
    setParams(params, { replace: true });
  };

  const reload = useCallback(async () => {
    if (!user || !id) return;
    const [d, a] = await Promise.all([fetchTeamDetail(id, user.id), token ? fetchTeamAdmin(token, id).catch(() => null) : Promise.resolve(null)]);
    setDetail(d);
    setAdmin(a);
  }, [user, id, token]);

  useEffect(() => {
    reload()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this team.'))
      .finally(() => setLoading(false));
  }, [reload]);

  const act = async (fn: (t: string) => Promise<unknown>, done: string) => {
    if (!token) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn(token);
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const fixtures = detail?.fixtures ?? [];
  const { upcoming, results, record, form } = useMemo(() => {
    const now = Date.now() - 3 * 3600 * 1000;
    const up = fixtures
      .filter((f) => !scoreOf(f) && f.status !== 'declined' && f.status !== 'expired' && (!f.startsAt || new Date(f.startsAt).getTime() >= now))
      .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
    const res = fixtures.filter((f) => scoreOf(f)).sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''));
    const rec = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    for (const f of res) {
      const s = scoreOf(f)!;
      rec.p += 1;
      rec.gf += s.us;
      rec.ga += s.them;
      if (s.us > s.them) rec.w += 1;
      else if (s.us < s.them) rec.l += 1;
      else rec.d += 1;
    }
    const fm: Result[] = res
      .slice(0, 5)
      .reverse()
      .map((f) => {
        const s = scoreOf(f)!;
        return s.us > s.them ? 'W' : s.us < s.them ? 'L' : 'D';
      });
    return { upcoming: up, results: res, record: rec, form: fm };
  }, [fixtures]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-4 pt-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pt-6">
        <ErrorNote>{error ?? 'Team not found.'}</ErrorNote>
        <ButtonLink to="/teams" className="mt-4">
          Back to teams
        </ButtonLink>
      </div>
    );
  }

  const { team, myRole, members } = detail;
  const isLeader = myRole !== null && isCaptainRole(myRole);
  const isOwner = myRole === 'owner';
  const colour = team.kit_colour ?? admin?.kitColour ?? kitColour(team.id);
  const description = (team as Team & { description?: string | null }).description;
  const squad = members.slice().sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.shirt ?? 999) - (b.shirt ?? 999) || (a.name ?? '').localeCompare(b.name ?? ''));
  const next = upcoming[0] ?? null;
  const nextSubject = next ? subjectOf(next) : null;
  const policy: JoinPolicy = admin?.joinPolicy ?? team.join_policy ?? 'invite';
  const pendingCount = admin?.requests.length ?? 0;

  const tabs: { value: Tab; label: ReactNode }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'fixtures', label: 'Fixtures' },
    { value: 'squad', label: `Squad ${members.length}` },
    ...(isLeader ? [{ value: 'admin' as Tab, label: pendingCount ? `Admin · ${pendingCount}` : 'Admin' }] : []),
  ];

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 pb-8">
      {/* Header */}
      <section className="relative overflow-hidden text-white lg:mt-4 lg:rounded-3xl" style={{ background: colour }}>
        {team.cover_url ? <img src={team.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" /> : null}
        <div className="relative px-4 pb-5">
          <div className="-mx-2.5 flex h-14 items-center justify-between">
            <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-white">
              <ChevronLeft size={22} />
            </button>
            {isLeader ? (
              <button type="button" aria-label="Team settings" onClick={() => setTab('admin')} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-white">
                <Settings2 size={20} />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-3.5">
            <Crest id={team.id} name={team.name} src={team.logo_url} size={64} className="border-2 border-white/85" />
            <div className="min-w-0">
              <h1 className="m-0 text-white">{team.name}</h1>
              <p className="m-0 text-[13px] text-white/85">
                {[TEAM_CATEGORY_LABELS[team.category], team.area].filter(Boolean).join(' · ')} · {members.length} player{members.length === 1 ? '' : 's'}
              </p>
              {form.length ? (
                <span className="mt-1.5 inline-flex rounded-md bg-black/20 p-1">
                  <FormGuide results={form} />
                </span>
              ) : null}
            </div>
          </div>
          {description ? <p className="m-0 mt-3 max-w-[60ch] text-[14px] text-white/90">{description}</p> : null}
          {!myRole ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {admin?.myRequest ? (
                <Badge tone="hl">Request sent</Badge>
              ) : policy === 'invite' ? (
                <span className="text-[13px] text-white/85">Joins by invite link from the captain.</span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<UserPlus size={15} />}
                  disabled={busy}
                  onClick={() => void act(async (t) => {
                    const r = await askToJoinTeam(t, team.id);
                    setNotice(r.state === 'joined' ? `You joined ${team.name}.` : 'Request sent. A captain will answer.');
                  }, '')}
                >
                  {policy === 'open' ? 'Join team' : 'Ask to join'}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-5 px-4">
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
          <Segmented label="Team sections" value={tab} onChange={setTab} options={tabs} className="min-w-max" />
        </div>
        {notice ? <p className="m-0 text-[14px] font-semibold text-brand-text" role="status">{notice}</p> : null}
        <ErrorNote>{error}</ErrorNote>

        {tab === 'overview' ? (
          <>
            <Section title="Next game">
              {next ? (
                <div className="flex flex-col gap-3">
                  <FixtureCard f={next} colour={colour} team={team} />
                  {nextSubject && myRole ? <AvailabilityCard type={nextSubject.type} id={nextSubject.id} /> : null}
                  {nextSubject && isLeader ? (
                    <div className="flex flex-wrap gap-2">
                      <ButtonLink to={`/lineup/${nextSubject.type}/${nextSubject.id}?side=${next.isHome === false ? 'away' : 'home'}`} variant="primary" size="sm" icon={<ShirtIcon size={15} />}>
                        Pick the lineup
                      </ButtonLink>
                      {nextSubject.type === 'match' ? (
                        <ButtonLink to={`/games/${nextSubject.id}`} size="sm">
                          Match centre
                        </ButtonLink>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState title="Nothing scheduled" body={isLeader ? 'Challenge a team from Explore, or enter a competition.' : 'Your captain will set the next game.'} />
              )}
            </Section>

            <Section title="Record">
              <div className="grid grid-cols-4 gap-2">
                <StatTile value={record.p} label="Played" />
                <StatTile value={record.w} label="Won" />
                <StatTile value={record.d} label="Drawn" />
                <StatTile value={record.l} label="Lost" />
              </div>
              {record.p ? (
                <p className="m-0 text-[13px] text-muted">
                  Goals {record.gf} for, {record.ga} against ({record.gf - record.ga >= 0 ? '+' : ''}
                  {record.gf - record.ga})
                </p>
              ) : null}
            </Section>

            {results.length ? (
              <Section title="Latest results" action={<button type="button" className="cursor-pointer border-0 bg-transparent text-[13px] font-semibold text-brand-text" onClick={() => setTab('fixtures')}>All</button>}>
                <ResultsList results={results.slice(0, 4)} />
              </Section>
            ) : null}
          </>
        ) : null}

        {tab === 'fixtures' ? (
          <>
            <Section title="Coming up" count={upcoming.length}>
              {upcoming.length === 0 ? (
                <p className="m-0 text-[14px] text-muted">Nothing scheduled.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {upcoming.map((f) => {
                    const subj = subjectOf(f);
                    return (
                      <div key={`${f.kind}-${f.id}`} className="flex flex-col gap-2">
                        <FixtureCard f={f} colour={colour} team={team} />
                        {subj && myRole ? (
                          <div className="flex flex-wrap gap-2">
                            {subj.type === 'match' ? <ButtonLink to={`/games/${subj.id}`} size="sm">Match centre</ButtonLink> : null}
                            {isLeader ? (
                              <ButtonLink to={`/lineup/${subj.type}/${subj.id}?side=${f.isHome === false ? 'away' : 'home'}`} size="sm" icon={<ShirtIcon size={15} />}>
                                Lineup
                              </ButtonLink>
                            ) : null}
                            <ButtonLink to={`/rules/${subj.type}/${subj.id}`} size="sm" variant="ghost" icon={<ScrollText size={15} />}>
                              Rules
                            </ButtonLink>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
            <Section title="Results" count={results.length}>
              {results.length === 0 ? <p className="m-0 text-[14px] text-muted">No results yet.</p> : <ResultsList results={results} />}
            </Section>
          </>
        ) : null}

        {tab === 'squad' ? (
          <Section title="Squad" count={members.length} action={isLeader ? <span className="text-[12px] text-muted">Tap a player to manage</span> : undefined}>
            <Card className="overflow-hidden">
              {squad.map((m) => {
                const mine = m.userId === user?.id;
                const canOpen = isLeader || mine;
                return (
                  <ListRow
                    key={m.userId}
                    onClick={canOpen ? () => setMember(m) : undefined}
                    chevron={canOpen}
                    leading={
                      <span className="relative">
                        <Avatar name={m.name} src={m.photoUrl} size={40} />
                        <span
                          className="tnum absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-md border-2 border-surface px-1 text-[10px] font-extrabold text-white"
                          style={{ background: colour }}
                        >
                          {m.shirt ?? '–'}
                        </span>
                      </span>
                    }
                    title={
                      <>
                        {mine ? 'You' : (m.name ?? 'Player')}
                        {m.role !== 'player' ? (
                          <Badge tone="brand" className="ml-2 align-middle">
                            {m.role === 'owner' ? 'Owner' : 'Captain'}
                          </Badge>
                        ) : null}
                      </>
                    }
                    sub={m.position ?? 'No position set'}
                  />
                );
              })}
            </Card>
            {myRole ? (
              <InviteCard
                team={team}
                invite={invite}
                copied={copied}
                busy={busy}
                onCreate={() => {
                  setCopied(false);
                  void act(async (t) => {
                    const out = await createInviteLinkAction({ teamId: team.id }, t);
                    setInvite(out.invite);
                  }, 'Invite link created.');
                }}
                onCopy={() => {
                  if (!invite) return;
                  void navigator.clipboard.writeText(`${window.location.origin}/invite/${invite.code}`).then(() => setCopied(true));
                }}
                onRevoke={() => {
                  if (!invite) return;
                  void act(async (t) => {
                    await revokeInviteLinkAction(invite.code, t);
                    setInvite(null);
                  }, 'Invite link revoked.');
                }}
              />
            ) : null}
          </Section>
        ) : null}

        {tab === 'admin' && isLeader ? (
          <>
            <Section title="Join requests" count={pendingCount}>
              {pendingCount === 0 ? (
                <p className="m-0 text-[14px] text-muted">{policy === 'request' ? 'Nobody waiting.' : 'Switch on "Players can ask to join" below to accept requests.'}</p>
              ) : (
                <Card className="overflow-hidden">
                  {admin?.requests.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3.5 py-3 [&+&]:border-t [&+&]:border-line">
                      <Avatar name={r.name} src={r.photoUrl} size={40} />
                      <span className="min-w-0 flex-1">
                        <strong>{r.name}</strong>
                        {r.message ? <span className="block text-[13px] text-muted">“{r.message}”</span> : null}
                      </span>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act((t) => answerJoinRequest(t, r.id, 'decline'), `Declined ${r.name}.`)}>
                        Decline
                      </Button>
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void act((t) => answerJoinRequest(t, r.id, 'accept'), `${r.name} joined the squad.`)}>
                        Accept
                      </Button>
                    </div>
                  ))}
                </Card>
              )}
            </Section>

            <Section title="How players join">
              <Card className="flex flex-col gap-2 p-3.5">
                <Segmented<JoinPolicy>
                  label="Join policy"
                  value={policy}
                  onChange={(v) => void act((t) => saveTeamSettings(t, { teamId: team.id, joinPolicy: v }), `Now: ${JOIN_POLICY_LABELS[v]}.`)}
                  options={[
                    { value: 'invite', label: 'Invite only' },
                    { value: 'request', label: 'By request' },
                    { value: 'open', label: 'Open' },
                  ]}
                />
                <p className="m-0 text-[13px] text-muted">
                  {policy === 'invite'
                    ? 'Only people with your invite link can join.'
                    : policy === 'request'
                      ? 'Players can ask from the team page; a captain accepts or declines.'
                      : 'Anyone can join straight from the team page.'}
                </p>
              </Card>
            </Section>

            <Section title="Kit colour">
              <Card className="flex flex-col gap-3 p-3.5">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kit colour">
                  {KIT_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={colour.toLowerCase() === c}
                      aria-label={`Colour ${c}`}
                      disabled={busy}
                      onClick={() => void act((t) => saveTeamSettings(t, { teamId: team.id, kitColour: c }), 'Kit colour saved.')}
                      className={cx('h-10 w-10 cursor-pointer rounded-xl border-2', colour.toLowerCase() === c ? 'border-ink' : 'border-line')}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <p className="m-0 text-[13px] text-muted">Used for shirts on the lineup pitch, the team header and the versus screen.</p>
              </Card>
            </Section>

            <Section title="Team">
              <Card className="overflow-hidden">
                <ListRow onClick={() => setEditOpen(true)} title="Edit name, area, photo and cover" sub="What other teams see" />
                <ListRow to={`/rules/team/${team.id}`} title="Team rules" sub="Kit, subs, fines, whatever your side agrees" />
              </Card>
            </Section>

            {isOwner ? (
              <Section title="Danger zone">
                <Card className="flex flex-col gap-2 p-3.5">
                  {!confirmDelete ? (
                    <Button variant="danger" className="self-start" onClick={() => setConfirmDelete(true)}>
                      Delete team
                    </Button>
                  ) : (
                    <>
                      <p className="m-0 text-[14px]">Permanently delete {team.name}? Teams with open challenges or tournament history are protected.</p>
                      <div className="flex gap-2">
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() =>
                            void act(async (t) => {
                              await deleteTeamAction(team.id, t);
                              navigate('/teams');
                            }, '')
                          }
                        >
                          Yes, delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              </Section>
            ) : null}
          </>
        ) : null}
      </div>

      <Sheet open={member !== null} onClose={() => setMember(null)} title={member ? (member.userId === user?.id ? 'You' : (member.name ?? 'Player')) : ''}>
        {member ? (
          <MemberSheet
            key={member.userId}
            member={member}
            isSelf={member.userId === user?.id}
            isLeader={isLeader}
            isOwner={isOwner}
            busy={busy}
            onShirt={async (n) => {
              if (await act((t) => setShirt(t, team.id, member.userId, n), n ? `Number ${n} saved.` : 'Number cleared.')) setMember(null);
            }}
            onPosition={async (pos) => {
              if (await act((t) => setPositionAction({ teamId: team.id, userId: member.userId, position: pos }, t), 'Position saved.')) setMember(null);
            }}
            onRole={async (role) => {
              if (await act((t) => setRoleAction({ teamId: team.id, userId: member.userId, role }, t), 'Role saved.')) setMember(null);
            }}
            onHandOver={async () => {
              if (await act((t) => handOverTeam(t, team.id, member.userId), `${member.name ?? 'They'} now own the team. You are a captain.`)) setMember(null);
            }}
            onRemove={async () => {
              if (await act((t) => removeMemberAction({ teamId: team.id, userId: member.userId }, t), 'Player removed.')) setMember(null);
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="Edit team">
        <EditTeamForm
          team={team}
          description={description ?? ''}
          busy={busy}
          onSave={async (v) => {
            if (await act((t) => updateTeamAction({ teamId: team.id, ...v }, t), 'Team updated.')) setEditOpen(false);
          }}
          onLogo={async (file) => {
            if (!supabase) return;
            await act(async (t) => {
              const path = `team-logos/${team.id}/${crypto.randomUUID()}.jpg`;
              const { error: upErr } = await supabase!.storage.from('avatars').upload(path, file, { upsert: false });
              if (upErr) throw new Error(upErr.message);
              const { data } = supabase!.storage.from('avatars').getPublicUrl(path);
              await updateTeamAction({ teamId: team.id, logoUrl: data.publicUrl }, t);
            }, 'Logo updated.');
          }}
          onCover={async (file) => {
            await act(async (t) => {
              const url = await uploadImage(`team-covers/${team.id}`, file);
              await updateTeamAction({ teamId: team.id, coverUrl: url }, t);
            }, 'Cover updated.');
          }}
        />
      </Sheet>
    </div>
  );
}

function FixtureCard({ f, colour, team }: { f: TeamFixture; colour: string; team: Team }) {
  const s = scoreOf(f);
  const opponentId = f.opponentId ?? f.id;
  return (
    <Card className="flex flex-col gap-3 p-3.5">
      <div className="flex items-center justify-between text-[12px] font-bold text-muted">
        <span>{f.competition ? f.competition.toUpperCase() : f.kind === 'challenge' ? 'FRIENDLY' : 'FIXTURE'}</span>
        <span>{f.startsAt ? `${dayLabel(f.startsAt)} · ${timeLabel(f.startsAt)}` : 'Date to be set'}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
        <span className="flex flex-col items-center gap-1">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[14px] font-extrabold text-white" style={{ background: colour }}>
            {team.name.slice(0, 2).toUpperCase()}
          </span>
          <strong className="text-[13px]">{team.name}</strong>
        </span>
        <span className="tnum text-[13px] font-extrabold tracking-[0.1em] text-muted">{s ? `${s.us}–${s.them}` : 'VS'}</span>
        <span className="flex flex-col items-center gap-1">
          <Crest id={opponentId} name={f.opponentName ?? 'TBD'} size={44} />
          <strong className="text-[13px]">{f.opponentName ?? 'Opponent to be confirmed'}</strong>
        </span>
      </div>
      {f.status === 'open' || f.status === 'reschedule_proposed' ? (
        <span className="text-center text-[12px] font-semibold text-muted">{f.status === 'open' ? 'Challenge open: waiting for an opponent' : 'New time proposed'}</span>
      ) : null}
    </Card>
  );
}

function ResultsList({ results }: { results: TeamFixture[] }) {
  return (
    <Card className="overflow-hidden">
      {results.map((f) => {
        const s = scoreOf(f)!;
        const r: Result = s.us > s.them ? 'W' : s.us < s.them ? 'L' : 'D';
        return (
          <ListRow
            key={`${f.kind}-${f.id}`}
            to={f.matchId ? `/games/${f.matchId}` : undefined}
            chevron={false}
            leading={
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
                <span className="text-[10px] font-bold uppercase text-brand-text">{f.startsAt ? dayShort(f.startsAt) : ''}</span>
                <FormGuide results={[r]} size={18} />
              </span>
            }
            title={`vs ${f.opponentName ?? 'Opponent'}`}
            sub={f.competition ?? 'Friendly'}
            trailing={<span className="tnum text-[17px] font-extrabold">{s.us}–{s.them}</span>}
          />
        );
      })}
    </Card>
  );
}

function InviteCard({
  team,
  invite,
  copied,
  busy,
  onCreate,
  onCopy,
  onRevoke,
}: {
  team: Team;
  invite: { code: string; expires_at: string | null } | null;
  copied: boolean;
  busy: boolean;
  onCreate: () => void;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  return (
    <Card className="flex flex-col gap-2.5 p-3.5">
      <strong>Invite players</strong>
      <p className="m-0 text-[13px] text-muted">New players join Chabuka and land straight in {team.name}. Each link works once.</p>
      {invite ? (
        <>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">{`${window.location.origin}/invite/${invite.code}`}</code>
            <Button size="sm" icon={<Copy size={14} />} onClick={onCopy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="self-start" disabled={busy} onClick={onRevoke}>
            Revoke link
          </Button>
        </>
      ) : (
        <Button variant="primary" className="self-start" disabled={busy} onClick={onCreate}>
          Create invite link
        </Button>
      )}
    </Card>
  );
}

function MemberSheet({
  member,
  isSelf,
  isLeader,
  isOwner,
  busy,
  onShirt,
  onPosition,
  onRole,
  onHandOver,
  onRemove,
}: {
  member: TeamMemberDetail;
  isSelf: boolean;
  isLeader: boolean;
  isOwner: boolean;
  busy: boolean;
  onShirt: (n: number | null) => void;
  onPosition: (p: string) => void;
  onRole: (r: TeamRole) => void;
  onHandOver: () => void;
  onRemove: () => void;
}) {
  const [shirt, setShirtValue] = useState(member.shirt ? String(member.shirt) : '');
  const [position, setPosition] = useState(member.position ?? '');
  const [confirm, setConfirm] = useState<'handover' | 'remove' | null>(null);
  const n = shirt.trim() === '' ? null : Number(shirt);
  const shirtValid = n === null || (Number.isInteger(n) && n >= 1 && n <= 99);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-semibold">
          Shirt number
          <input className={fieldCls} inputMode="numeric" value={shirt} maxLength={2} placeholder="1–99" onChange={(e) => setShirtValue(e.target.value.replace(/\D/g, ''))} />
        </label>
        <Button disabled={busy || !shirtValid || n === (member.shirt ?? null)} onClick={() => onShirt(n)}>
          Save
        </Button>
      </div>
      {isLeader && !isSelf ? (
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-semibold">
            Position
            <input className={fieldCls} value={position} maxLength={40} placeholder="Goalkeeper, Midfield…" onChange={(e) => setPosition(e.target.value)} />
          </label>
          <Button disabled={busy || !position.trim() || position.trim() === (member.position ?? '')} onClick={() => onPosition(position.trim())}>
            Save
          </Button>
        </div>
      ) : null}
      {isOwner && !isSelf ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Role</span>
          <Segmented<TeamRole>
            label="Role"
            value={member.role === 'owner' ? 'captain' : member.role}
            onChange={(r) => onRole(r)}
            options={[
              { value: 'player', label: 'Player' },
              { value: 'captain', label: 'Captain' },
            ]}
          />
        </div>
      ) : null}
      {isOwner && !isSelf ? (
        confirm === 'handover' ? (
          <Card className="flex flex-col gap-2 p-3">
            <p className="m-0 text-[14px]">Make {member.name ?? 'this player'} the owner? You stay on as a captain and cannot undo this yourself.</p>
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy} onClick={onHandOver}>
                Hand over
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Button icon={<Crown size={16} />} onClick={() => setConfirm('handover')}>
            Make owner
          </Button>
        )
      ) : null}
      {isLeader && !isSelf && member.role !== 'owner' ? (
        confirm === 'remove' ? (
          <Card className="flex flex-col gap-2 p-3">
            <p className="m-0 text-[14px]">Remove {member.name ?? 'this player'} from the team?</p>
            <div className="flex gap-2">
              <Button variant="danger" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="danger" onClick={() => setConfirm('remove')}>
            Remove from team
          </Button>
        )
      ) : null}
    </div>
  );
}

function EditTeamForm({
  team,
  description,
  busy,
  onSave,
  onLogo,
  onCover,
}: {
  team: Team;
  description: string;
  busy: boolean;
  onSave: (v: { name: string; area: string; city: string | null; description: string | null }) => void;
  onLogo: (f: File) => void;
  onCover: (f: File) => void;
}) {
  const [form, setForm] = useState({ name: team.name, area: team.area ?? '', city: team.city ?? '', description });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ name: form.name.trim(), area: form.area.trim(), city: form.city.trim() || null, description: form.description.trim() || null });
  };
  const label = 'flex flex-col gap-1.5 text-[13px] font-semibold';
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <label className={label}>
        Name
        <input className={fieldCls} value={form.name} required maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className={label}>
        Area
        <input className={fieldCls} value={form.area} maxLength={80} onChange={(e) => setForm({ ...form, area: e.target.value })} />
      </label>
      <label className={label}>
        City
        <input className={fieldCls} value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} />
      </label>
      <label className={label}>
        About the team
        <textarea className={cx(fieldCls, 'h-24 py-2')} value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
          Team badge
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = ''; }} />
        </label>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
          Cover photo
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onCover(f); e.target.value = ''; }} />
        </label>
      </div>
      <Button type="submit" variant="primary" size="lg" block disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
