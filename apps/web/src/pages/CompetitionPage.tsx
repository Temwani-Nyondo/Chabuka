import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  Globe,
  HandHeart,
  MapPin,
  Phone,
  ScrollText,
  Share2,
  Shirt as ShirtIcon,
  Trophy,
  Users,
} from 'lucide-react';
import { CATEGORY_LABELS, COMPETITION_STATUS_LABELS, FORMAT_LABELS, SPONSOR_TIERS, SPONSOR_TIER_LABELS, roundName } from '@chabuka/shared';
import type { Fixture } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { followCompetitionAction, runAction } from '../lib/api';
import { fetchCompetitionView, fetchOrganiserEntries } from '../lib/competitions';
import type { CompetitionView, PrivateEntry } from '../lib/competitions';
import { sportBackdrop, sportLabel } from '../components/GameCard';
import Bracket from '../components/Bracket';
import {
  EventDetailsFields,
  Field,
  RegistrationFields,
  SponsorManager,
  detailsToInput,
  fieldCls,
  registrationToInput,
} from '../components/CompetitionForms';
import type { EventDetails, RegistrationSettings } from '../components/CompetitionForms';
import { Badge, Button, ButtonLink, Card, Crest, EmptyState, ErrorNote, Section, Segmented, Sheet, Skeleton, cx } from '../components/ui';

type Tab = 'overview' | 'table' | 'fixtures' | 'teams' | 'news' | 'manage';

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function dateRange(start: string, end?: string | null): string {
  const s = new Date(start);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (!end || end === start) return s.toLocaleDateString(undefined, opts);
  return `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(end).toLocaleDateString(undefined, opts)}`;
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function CompetitionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, session } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<CompetitionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultFor, setResultFor] = useState<Fixture | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Fixture | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setView(await fetchCompetitionView(id, user.id));
  }, [id, user]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this competition.'));
  }, [reload]);

  const tabParam = params.get('tab') as Tab | null;
  const setTab = (t: Tab) => {
    params.set('tab', t);
    setParams(params, { replace: true });
  };

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

  if (!view) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-3 px-4 pt-4">
        {error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-56" />}
      </div>
    );
  }

  const c = view.competition;
  const approved = view.entries.filter((e) => e.status === 'approved');
  const pending = view.entries.filter((e) => e.status === 'pending');
  const hasTable = view.fixtures.length > 0 && (view.tables.length > 0 || !!view.knockout);
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    ...(hasTable ? [{ value: 'table' as Tab, label: c.format === 'knockout' ? 'Bracket' : 'Table' }] : []),
    ...(view.fixtures.length ? [{ value: 'fixtures' as Tab, label: 'Fixtures' }] : []),
    { value: 'teams', label: `Teams ${approved.length}` },
    { value: 'news', label: 'News' },
    ...(view.isOrganiser ? [{ value: 'manage' as Tab, label: pending.length ? `Manage · ${pending.length}` : 'Manage' }] : []),
  ];
  const tab: Tab = tabs.some((t) => t.value === tabParam) ? (tabParam as Tab) : 'overview';
  const banner = c.banner_url || sportBackdrop(view.sport?.name);
  const closesAt = c.registration_closes_at ? new Date(c.registration_closes_at) : null;
  const open = c.status === 'registration' && (!closesAt || closesAt.getTime() > Date.now());
  const full = approved.length + pending.length >= c.max_entries;
  const teamName = (tid: string | null | undefined) => (tid ? (view.teams.get(tid)?.name ?? 'Team') : 'To be decided');

  const share = async () => {
    const url = `${window.location.origin}/competitions/${c.id}`;
    try {
      if (navigator.share) await navigator.share({ title: c.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice('Link copied.');
      }
    } catch {
      // Share dismissed.
    }
  };

  const cta = (() => {
    if (view.myEntry?.status === 'approved') return <Badge tone="brand">Your team is in</Badge>;
    if (view.myEntry?.status === 'pending') return <Badge tone="hl">Entry waiting for approval</Badge>;
    if (open && !full) {
      return (
        <ButtonLink to={`/competitions/${c.id}/register`} variant="primary" size="lg">
          Enter a team
        </ButtonLink>
      );
    }
    if (c.status === 'registration') return <Badge tone="muted">{full ? 'Entries full' : 'Entries closed'}</Badge>;
    return null;
  })();

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 pb-10">
      {/* Event header */}
      <section className="relative overflow-hidden bg-cover bg-center text-white lg:mt-4 lg:rounded-3xl" style={{ backgroundImage: `url(${banner})` }}>
        <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
        <div className="relative flex flex-col gap-3 px-4 pb-5 pt-2 sm:px-6 sm:pb-7">
          <div className="-mx-2.5 flex h-12 items-center justify-between">
            <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-white">
              <ChevronLeft size={22} />
            </button>
            <button type="button" aria-label="Share" onClick={() => void share()} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-white">
              <Share2 size={19} />
            </button>
          </div>
          <div className="mt-8 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[12px] font-bold text-[#0e1411]">{CATEGORY_LABELS[c.category]}</span>
            <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[12px] font-bold">{FORMAT_LABELS[c.format]}</span>
            {view.sport ? <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[12px] font-bold">{sportLabel(view.sport.name)}</span> : null}
            <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[12px] font-bold">{COMPETITION_STATUS_LABELS[c.status]}</span>
          </div>
          <h1 className="m-0 max-w-[22ch] text-[30px] leading-tight text-white sm:text-[38px]">{c.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-white/90">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={15} /> {dateRange(c.starts_on, c.ends_on)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={15} /> {view.venueName ?? c.location ?? c.area}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} /> {approved.length}/{c.max_entries} teams
            </span>
          </div>
          {c.host_name || view.organiserName ? (
            <div className="flex items-center gap-2 text-[14px]">
              {c.host_logo_url ? <img src={c.host_logo_url} alt="" className="h-8 w-8 rounded-lg bg-white object-contain p-0.5" /> : null}
              <span className="text-white/85">
                Hosted by <strong className="text-white">{c.host_name || view.organiserName}</strong>
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {cta}
            {!view.following && !view.isOrganiser ? (
              <Button size="lg" disabled={busy} onClick={() => void act((t) => followCompetitionAction(c.id, t), 'You’ll get the results and news.')}>
                Follow
              </Button>
            ) : view.following ? (
              <span className="rounded-full bg-black/35 px-3 py-1.5 text-[13px] font-semibold">Following</span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-5 px-4">
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
          <Segmented label="Competition sections" value={tab} onChange={setTab} options={tabs} className="min-w-max" />
        </div>
        {notice ? <p className="m-0 text-[14px] font-semibold text-brand-text" role="status">{notice}</p> : null}
        <ErrorNote>{error}</ErrorNote>

        {tab === 'overview' ? <Overview view={view} open={open} closesAt={closesAt} /> : null}

        {tab === 'table' ? (
          <div className="flex flex-col gap-5">
            {view.tables.map((t) => (
              <Section key={t.label ?? 'league'} title={t.label ? `Group ${t.label}` : 'Table'}>
                <LeagueTable rows={t.rows} view={view} advance={c.format === 'groups_knockout' ? (c.advance_per_group ?? 2) : 0} />
              </Section>
            ))}
            {view.knockout ? (
              <Section title="Knockout">
                <Bracket rounds={view.knockout.rounds} byRound={view.knockout.byRound} teams={view.teams} highlightTeamIds={view.myCaptainTeamIds} />
              </Section>
            ) : c.format === 'groups_knockout' ? (
              <p className="m-0 text-[14px] text-muted">The knockout is drawn when the group games are done.</p>
            ) : null}
          </div>
        ) : null}

        {tab === 'fixtures' ? (
          <FixtureList
            view={view}
            teamName={teamName}
            onReport={(f) => setResultFor(f)}
            onConfirm={(f) => void act((t) => runAction('confirm_result', { fixtureId: f.id }, t), 'Result confirmed.')}
            onSchedule={(f) => setScheduleFor(f)}
            busy={busy}
          />
        ) : null}

        {tab === 'teams' ? (
          approved.length === 0 ? (
            <EmptyState icon={<Users size={22} />} title="No teams yet" body={open ? 'Be the first to enter.' : 'Entries are closed.'} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {approved.map((e) => {
                const team = view.teams.get(e.team_id);
                return (
                  <Link key={e.team_id} to={`/teams/${e.team_id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-ink no-underline hover:border-line-strong">
                    <Crest id={e.team_id} name={team?.name ?? 'Team'} src={team?.logo_url} size={40} />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">{team?.name ?? 'Team'}</strong>
                      <span className="text-[13px] text-muted">{[team?.area, e.group_label ? `Group ${e.group_label}` : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )
        ) : null}

        {tab === 'news' ? <News view={view} busy={busy} onPost={(text) => act((t) => runAction('post_announcement', { competitionId: c.id, text, type: 'update' }, t), 'Posted.')} /> : null}

        {tab === 'manage' && view.isOrganiser ? <Manage view={view} busy={busy} act={act} onSettle={(f) => setResultFor(f)} onSchedule={(f) => setScheduleFor(f)} reload={reload} /> : null}
      </div>

      <Sheet open={resultFor !== null} onClose={() => setResultFor(null)} title={view.isOrganiser ? 'Enter the result' : 'Report the result'}>
        {resultFor ? (
          <ResultForm
            key={resultFor.id}
            f={resultFor}
            teamName={teamName}
            organiser={view.isOrganiser}
            busy={busy}
            onSubmit={async (home, away, winner) => {
              let message = 'Saved.';
              const ok = await act(async (t) => {
                const r = await runAction<{ state: string }>('report_result', { fixtureId: resultFor.id, homeScore: home, awayScore: away, winnerTeamId: winner ?? undefined }, t);
                message =
                  r.state === 'final' ? 'Result in.' : r.state === 'disputed' ? 'The other captain reported a different score. The organiser will decide.' : 'Sent. The other captain confirms it.';
              }, '');
              if (ok) {
                setNotice(message);
                setResultFor(null);
              }
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={scheduleFor !== null} onClose={() => setScheduleFor(null)} title="Schedule the game">
        {scheduleFor ? (
          <ScheduleForm
            key={scheduleFor.id}
            f={scheduleFor}
            busy={busy}
            onSubmit={async (patch) => {
              if (await act((t) => runAction('schedule_fixture', { fixtureId: scheduleFor.id, ...patch }, t), 'Saved. Both squads are told.')) setScheduleFor(null);
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function Overview({ view, open, closesAt }: { view: CompetitionView; open: boolean; closesAt: Date | null }) {
  const c = view.competition;
  const facts: [string, ReactNode][] = [
    ['Format', FORMAT_LABELS[c.format]],
    ['Teams', `Up to ${c.max_entries}`],
    ...(c.team_size_min || c.team_size_max ? ([['Squad size', `${c.team_size_min ?? 1}–${c.team_size_max ?? 'any'} players`]] as [string, ReactNode][]) : []),
    ...(c.entry_fee_note ? ([['Entry fee', c.entry_fee_note]] as [string, ReactNode][]) : []),
    ...(c.format !== 'knockout' ? ([['Points', `Win ${c.points_win} · Draw ${c.points_draw} · Loss ${c.points_loss}`]] as [string, ReactNode][]) : []),
    ...(closesAt && c.status === 'registration' ? ([['Entries close', `${dayFmt.format(closesAt)} ${timeFmt.format(closesAt)}`]] as [string, ReactNode][]) : []),
    ['Entries', c.requires_approval ? 'Approved by the organiser' : 'Accepted automatically'],
  ];
  const tiers = SPONSOR_TIERS.map((t) => ({ tier: t, list: view.sponsors.filter((s) => s.tier === t) })).filter((g) => g.list.length);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-5">
        {c.description ? (
          <Section title="About">
            <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{c.description}</p>
          </Section>
        ) : null}
        {c.cause_name ? (
          <Card className="flex flex-col gap-2 border-[var(--hl-text)]/30 bg-hl p-4 text-hl-text">
            <span className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.06em]">
              <HandHeart size={16} /> In support of
            </span>
            <strong className="text-[18px]">{c.cause_name}</strong>
            {c.cause_description ? <p className="m-0 whitespace-pre-line text-[14px]">{c.cause_description}</p> : null}
            {c.fundraising_note ? <p className="m-0 text-[14px] font-bold">{c.fundraising_note}</p> : null}
            {c.cause_url ? (
              <a href={c.cause_url} target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-hl-text underline">
                About the cause
              </a>
            ) : null}
          </Card>
        ) : null}
        {tiers.length ? (
          <Section title="Sponsors">
            <div className="flex flex-col gap-4">
              {tiers.map((g) => (
                <div key={g.tier} className="flex flex-col gap-2">
                  <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">{SPONSOR_TIER_LABELS[g.tier]}</span>
                  <div className={cx('grid gap-2', g.tier === 'title' ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3')}>
                    {g.list.map((s) => {
                      const inner = (
                        <>
                          {s.logo_url ? (
                            <img src={s.logo_url} alt="" className={cx('object-contain', g.tier === 'title' ? 'h-16 w-32' : 'h-10 w-20')} />
                          ) : null}
                          <strong className={g.tier === 'title' ? 'text-[18px]' : 'text-[14px]'}>{s.name}</strong>
                        </>
                      );
                      const cls = cx('flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-ink no-underline', g.tier === 'title' && 'p-4');
                      return s.url ? (
                        <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className={cx(cls, 'hover:border-line-strong')}>
                          {inner}
                        </a>
                      ) : (
                        <div key={s.id} className={cls}>
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
        {!c.description && !c.cause_name && !tiers.length ? (
          <p className="m-0 text-[14px] text-muted">The organiser hasn’t added a description yet.</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-[14px] [&+&]:border-t [&+&]:border-line">
              <span className="text-muted">{k}</span>
              <strong className="text-right">{v}</strong>
            </div>
          ))}
        </Card>
        <ButtonLink to={`/rules/competition/${c.id}`} icon={<ScrollText size={16} />}>
          Rule book
        </ButtonLink>
        {c.host_name || c.host_contact || c.host_website ? (
          <Card className="flex flex-col gap-2 p-3.5">
            <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Host</span>
            <div className="flex items-center gap-2.5">
              {c.host_logo_url ? <img src={c.host_logo_url} alt="" className="h-10 w-10 rounded-lg object-contain" /> : null}
              <strong>{c.host_name || view.organiserName}</strong>
            </div>
            {c.host_contact ? (
              <span className="inline-flex items-center gap-1.5 text-[14px]">
                <Phone size={14} /> {c.host_contact}
              </span>
            ) : null}
            {c.host_website ? (
              <a href={c.host_website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] text-brand-text">
                <Globe size={14} /> Website
              </a>
            ) : null}
          </Card>
        ) : null}
        {open ? (
          <ButtonLink to={`/competitions/${c.id}/register`} variant="primary" size="lg" block>
            Enter a team
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}

function LeagueTable({ rows, view, advance }: { rows: CompetitionView['tables'][number]['rows']; view: CompetitionView; advance: number }) {
  return (
    <Card className="overflow-x-auto">
      <table className="tnum w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-[11px] font-bold text-muted">
            {['#', 'Team', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map((h, i) => (
              <th key={h} scope="col" className={cx('px-2 py-2 font-bold', i === 1 ? 'text-left' : 'text-center', i === 0 && 'pl-3.5', i === 7 && 'pr-3.5', i >= 3 && i <= 5 && 'hidden sm:table-cell')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const team = view.teams.get(r.teamId);
            const mine = view.myCaptainTeamIds.includes(r.teamId) || view.myTeams.some((m) => m.team.id === r.teamId);
            return (
              <tr key={r.teamId} className={cx('border-t', advance && i === advance ? 'border-dashed border-line-strong' : 'border-line', mine && 'bg-brand-soft')}>
                <td className="py-2.5 pl-3.5 text-center">
                  <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-md font-extrabold', advance && i < advance ? 'bg-brand-soft text-brand-text' : 'text-muted')}>{i + 1}</span>
                </td>
                <td className="px-2 py-2.5">
                  <Link to={`/teams/${r.teamId}`} className="flex items-center gap-2 font-bold text-ink no-underline">
                    <Crest id={r.teamId} name={team?.name ?? 'Team'} src={team?.logo_url} size={24} />
                    <span className="truncate">{team?.name ?? 'Team'}</span>
                  </Link>
                </td>
                <td className="px-2 text-center">{r.played}</td>
                <td className="hidden px-2 text-center sm:table-cell">{r.won}</td>
                <td className="hidden px-2 text-center sm:table-cell">{r.drawn}</td>
                <td className="hidden px-2 text-center sm:table-cell">{r.lost}</td>
                <td className="px-2 text-center">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                <td className="pr-3.5 text-center font-extrabold">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {advance ? <p className="m-0 border-t border-line px-3.5 py-2 text-[12px] text-muted">Top {advance} go through to the knockout.</p> : null}
    </Card>
  );
}

function FixtureList({
  view,
  teamName,
  onReport,
  onConfirm,
  onSchedule,
  busy,
}: {
  view: CompetitionView;
  teamName: (id: string | null | undefined) => string;
  onReport: (f: Fixture) => void;
  onConfirm: (f: Fixture) => void;
  onSchedule: (f: Fixture) => void;
  busy: boolean;
}) {
  const groups = useMemo(() => {
    const rounds = view.knockout?.rounds ?? 0;
    const label = (f: Fixture) =>
      f.stage === 'knockout' ? roundName(f.round ?? 1, rounds) : f.stage === 'group' ? `Group ${f.group_label} · Matchday ${f.round ?? 1}` : `Matchday ${f.round ?? 1}`;
    const order = (f: Fixture) => (f.stage === 'knockout' ? 1000 + (f.round ?? 0) : (f.round ?? 0) * 10 + (f.group_label ? f.group_label.charCodeAt(0) - 64 : 0));
    const map = new Map<string, { order: number; list: Fixture[] }>();
    for (const f of view.fixtures) {
      const k = label(f);
      const g = map.get(k) ?? { order: order(f), list: [] };
      g.list.push(f);
      map.set(k, g);
    }
    return [...map.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [view.fixtures, view.knockout]);

  return (
    <div className="flex flex-col gap-5">
      {groups.map(([label, g]) => (
        <Section key={label} title={label}>
          <Card className="overflow-hidden">
            {g.list.map((f) => (
              <FixtureRow key={f.id} f={f} view={view} teamName={teamName} onReport={onReport} onConfirm={onConfirm} onSchedule={onSchedule} busy={busy} />
            ))}
          </Card>
        </Section>
      ))}
    </div>
  );
}

function FixtureRow({
  f,
  view,
  teamName,
  onReport,
  onConfirm,
  onSchedule,
  busy,
}: {
  f: Fixture;
  view: CompetitionView;
  teamName: (id: string | null | undefined) => string;
  onReport: (f: Fixture) => void;
  onConfirm: (f: Fixture) => void;
  onSchedule: (f: Fixture) => void;
  busy: boolean;
}) {
  const scored = f.status === 'finished' && f.home_score != null && f.away_score != null;
  const myHome = !!f.home_team_id && view.myCaptainTeamIds.includes(f.home_team_id);
  const myAway = !!f.away_team_id && view.myCaptainTeamIds.includes(f.away_team_id);
  const mySide = myHome ? 'home' : myAway ? 'away' : null;
  const both = !!f.home_team_id && !!f.away_team_id;
  const awaiting = !scored && f.reported_side && f.status !== 'disputed';
  const canConfirm = awaiting && mySide && f.reported_side !== mySide;
  const iReported = awaiting && mySide && f.reported_side === mySide;
  const canReport = both && !scored && f.status !== 'cancelled' && (mySide || view.isOrganiser) && !iReported;
  const side = (tid: string | null, score: number | null | undefined, alignRight?: boolean) => {
    const team = tid ? view.teams.get(tid) : null;
    const won = scored && f.winner_team_id === tid;
    return (
      <span className={cx('flex min-w-0 flex-1 items-center gap-2', alignRight && 'flex-row-reverse text-right')}>
        {team ? <Crest id={team.id} name={team.name} src={team.logo_url} size={28} /> : <span className="h-7 w-7 shrink-0 rounded-lg border border-dashed border-line-strong" />}
        <span className={cx('min-w-0 truncate text-[14px] font-bold', !team && 'font-semibold text-muted')}>
          {teamName(tid)}
          {won ? ' (pens)' : ''}
        </span>
        {scored ? <span className="tnum ml-auto shrink-0 text-[17px] font-extrabold">{score}</span> : null}
      </span>
    );
  };
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 [&+&]:border-t [&+&]:border-line">
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span>
          {f.starts_at ? `${dayFmt.format(new Date(f.starts_at))} · ${timeFmt.format(new Date(f.starts_at))}` : 'Date to be set'}
          {f.venue_name ? ` · ${f.venue_name}` : ''}
        </span>
        {f.status === 'disputed' ? (
          <Badge tone="live">Disputed</Badge>
        ) : f.status === 'postponed' ? (
          <Badge tone="hl">Postponed</Badge>
        ) : f.status === 'cancelled' ? (
          <Badge tone="muted">Cancelled</Badge>
        ) : awaiting ? (
          <Badge tone="hl">
            Reported {f.reported_home}–{f.reported_away}, awaiting confirmation
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        {side(f.home_team_id, f.home_score)}
        <span className="hidden text-[12px] font-extrabold tracking-[0.1em] text-muted sm:block">{scored ? '' : 'VS'}</span>
        {side(f.away_team_id, f.away_score)}
      </div>
      {(canConfirm || canReport || iReported || (mySide && both) || (view.isOrganiser && !scored)) ? (
        <div className="flex flex-wrap gap-2">
          {canConfirm ? (
            <>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onConfirm(f)}>
                Confirm {f.reported_home}–{f.reported_away}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => onReport(f)}>
                That’s wrong
              </Button>
            </>
          ) : canReport ? (
            <Button size="sm" variant={view.isOrganiser || f.status === 'disputed' ? 'primary' : 'secondary'} disabled={busy} onClick={() => onReport(f)}>
              {view.isOrganiser ? (f.status === 'disputed' ? 'Settle result' : 'Enter result') : 'Report result'}
            </Button>
          ) : iReported ? (
            <span className="text-[13px] font-semibold text-muted">Waiting for the other captain to confirm.</span>
          ) : null}
          {mySide && both ? (
            <ButtonLink to={`/lineup/fixture/${f.id}?side=${mySide}`} size="sm" icon={<ShirtIcon size={14} />}>
              Lineup
            </ButtonLink>
          ) : null}
          {view.isOrganiser && !scored ? (
            <Button size="sm" variant="ghost" onClick={() => onSchedule(f)}>
              Schedule
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultForm({
  f,
  teamName,
  organiser,
  busy,
  onSubmit,
}: {
  f: Fixture;
  teamName: (id: string | null | undefined) => string;
  organiser: boolean;
  busy: boolean;
  onSubmit: (home: number, away: number, winner: string | null) => void;
}) {
  const [home, setHome] = useState(f.reported_home ?? f.home_score ?? 0);
  const [away, setAway] = useState(f.reported_away ?? f.away_score ?? 0);
  const [winner, setWinner] = useState<string | null>(f.reported_winner ?? f.winner_team_id ?? null);
  const level = home === away;
  const needsWinner = f.stage === 'knockout' && level;
  const stepper = (value: number, set: (n: number) => void, name: string) => (
    <div className="flex flex-col items-center gap-2">
      <span className="max-w-[150px] truncate text-center text-[13px] font-bold">{name}</span>
      <div className="flex items-center gap-2">
        <Button aria-label={`One less for ${name}`} onClick={() => set(Math.max(0, value - 1))}>
          −
        </Button>
        <span className="tnum w-12 text-center text-[36px] font-extrabold">{value}</span>
        <Button aria-label={`One more for ${name}`} onClick={() => set(Math.min(999, value + 1))}>
          +
        </Button>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {f.status === 'disputed' && f.reported_home != null ? (
        <p className="m-0 flex items-start gap-2 rounded-xl bg-hl p-3 text-[13px] text-hl-text">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> The captains disagree. The first report was {f.reported_home}–{f.reported_away}. Your decision is final.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {stepper(home, setHome, teamName(f.home_team_id))}
        {stepper(away, setAway, teamName(f.away_team_id))}
      </div>
      {needsWinner ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Level after full time: who won on penalties?</span>
          <Segmented
            label="Penalty winner"
            value={winner ?? ''}
            onChange={(v) => setWinner(v || null)}
            options={[
              { value: f.home_team_id ?? '', label: teamName(f.home_team_id) },
              { value: f.away_team_id ?? '', label: teamName(f.away_team_id) },
            ]}
          />
        </div>
      ) : null}
      <p className="m-0 text-[13px] text-muted">
        {organiser ? 'As organiser, your result counts straight away.' : 'The other captain confirms it. If they report a different score, the organiser decides.'}
      </p>
      <Button variant="primary" size="lg" block disabled={busy || (needsWinner && !winner)} onClick={() => onSubmit(home, away, needsWinner ? winner : null)}>
        {busy ? 'Saving…' : organiser ? 'Save result' : 'Send result'}
      </Button>
    </div>
  );
}

function ScheduleForm({ f, busy, onSubmit }: { f: Fixture; busy: boolean; onSubmit: (patch: Record<string, unknown>) => void }) {
  const [when, setWhen] = useState(toLocalInput(f.starts_at));
  const [venue, setVenue] = useState(f.venue_name ?? '');
  const [status, setStatus] = useState<'scheduled' | 'postponed' | 'cancelled'>(f.status === 'postponed' || f.status === 'cancelled' ? f.status : 'scheduled');
  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Date and time">
        <input className={fieldCls} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="Venue or pitch">
        <input className={fieldCls} maxLength={160} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Pitch 2, Olympic Youth Centre" />
      </Field>
      <Segmented<'scheduled' | 'postponed' | 'cancelled'>
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'scheduled', label: 'On' },
          { value: 'postponed', label: 'Postponed' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={busy}
        onClick={() => onSubmit({ startsAt: when ? new Date(when).toISOString() : null, venueName: venue.trim(), status })}
      >
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

function News({ view, busy, onPost }: { view: CompetitionView; busy: boolean; onPost: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-3">
      {view.isOrganiser ? (
        <Card className="flex flex-col gap-2 p-3.5">
          <textarea className={cx(fieldCls, 'h-20 py-2')} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Kick-off moved to 09:00. Teams please arrive by 08:30." />
          <Button
            variant="primary"
            className="self-end"
            disabled={busy || !text.trim()}
            onClick={() => void onPost(text.trim()).then((ok) => ok && setText(''))}
          >
            Post update
          </Button>
        </Card>
      ) : null}
      {view.announcements.length === 0 ? (
        <p className="m-0 text-[14px] text-muted">No news yet.</p>
      ) : (
        <Card className="overflow-hidden">
          {view.announcements.map((a) => (
            <div key={a.id} className="px-3.5 py-3 text-[14px] [&+&]:border-t [&+&]:border-line">
              <p className="m-0 whitespace-pre-line">{a.text}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Manage({
  view,
  busy,
  act,
  onSettle,
  onSchedule,
  reload,
}: {
  view: CompetitionView;
  busy: boolean;
  act: (fn: (t: string) => Promise<unknown>, done: string) => Promise<boolean>;
  onSettle: (f: Fixture) => void;
  onSchedule: (f: Fixture) => void;
  reload: () => Promise<void>;
}) {
  const { session } = useAuth();
  const token = session?.access_token;
  const c = view.competition;
  const [entries, setEntries] = useState<PrivateEntry[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [sponsorsOpen, setSponsorsOpen] = useState(false);
  const [confirmDraw, setConfirmDraw] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const loadEntries = useCallback(() => {
    if (!token) return;
    fetchOrganiserEntries(token, c.id)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [token, c.id]);
  useEffect(() => loadEntries(), [loadEntries, view]);

  const approved = view.entries.filter((e) => e.status === 'approved').length;
  const disputes = view.fixtures.filter((f) => f.status === 'disputed');
  const unscheduled = view.fixtures.filter((f) => !f.starts_at && f.status === 'scheduled' && f.home_team_id && f.away_team_id);
  const groupGamesLeft = view.fixtures.filter((f) => f.stage === 'group' && f.status !== 'finished' && f.status !== 'cancelled').length;
  const needsKnockout = c.format === 'groups_knockout' && c.status === 'live' && !view.fixtures.some((f) => f.stage === 'knockout');

  return (
    <div className="flex flex-col gap-5">
      <Section title="Next step">
        <Card className="flex flex-col gap-3 p-3.5">
          {c.status === 'registration' ? (
            <>
              <p className="m-0 text-[14px]">
                <strong>{approved}</strong> approved team{approved === 1 ? '' : 's'} of {c.max_entries}. When you’re ready, close entries and make the{' '}
                {c.format === 'knockout' ? 'draw' : c.format === 'groups_knockout' ? 'group draw and fixtures' : 'fixtures'}. Teams are drawn at random.
              </p>
              {confirmDraw ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    icon={<Trophy size={16} />}
                    onClick={() => void act((t) => runAction('generate_fixtures', { competitionId: c.id }, t), 'Fixtures made. Every squad has been told.').then(() => setConfirmDraw(false))}
                  >
                    Close entries and make the draw
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDraw(false)}>
                    Not yet
                  </Button>
                </div>
              ) : (
                <Button variant="primary" className="self-start" disabled={approved < 2} onClick={() => setConfirmDraw(true)}>
                  Make the fixtures
                </Button>
              )}
            </>
          ) : needsKnockout ? (
            <>
              <p className="m-0 text-[14px]">
                {groupGamesLeft ? `${groupGamesLeft} group game${groupGamesLeft === 1 ? '' : 's'} left to play.` : 'The group stage is done.'} Then draw the knockout from the group tables.
              </p>
              <Button
                variant="primary"
                className="self-start"
                disabled={busy || groupGamesLeft > 0}
                onClick={() => void act((t) => runAction('start_knockout', { competitionId: c.id }, t), 'Knockout drawn.')}
              >
                Draw the knockout
              </Button>
            </>
          ) : c.status === 'live' ? (
            <p className="m-0 text-[14px]">
              Running. {unscheduled.length ? `${unscheduled.length} game${unscheduled.length === 1 ? '' : 's'} still need a date.` : 'Every game has a date.'}
            </p>
          ) : (
            <p className="m-0 text-[14px]">{COMPETITION_STATUS_LABELS[c.status]}.</p>
          )}
        </Card>
      </Section>

      {disputes.length ? (
        <Section title="Disputed results" count={disputes.length}>
          <Card className="overflow-hidden">
            {disputes.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-3.5 py-3 [&+&]:border-t [&+&]:border-line">
                <span className="min-w-0 flex-1 text-[14px]">
                  <strong>
                    {view.teams.get(f.home_team_id ?? '')?.name} vs {view.teams.get(f.away_team_id ?? '')?.name}
                  </strong>
                  <span className="block text-[13px] text-muted">
                    First report {f.reported_home}–{f.reported_away}
                  </span>
                </span>
                <Button size="sm" variant="primary" onClick={() => onSettle(f)}>
                  Settle
                </Button>
              </div>
            ))}
          </Card>
        </Section>
      ) : null}

      {unscheduled.length && c.status === 'live' ? (
        <Section title="Needs a date" count={unscheduled.length}>
          <Card className="overflow-hidden">
            {unscheduled.slice(0, 8).map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-line">
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                  {view.teams.get(f.home_team_id ?? '')?.name} vs {view.teams.get(f.away_team_id ?? '')?.name}
                </span>
                <Button size="sm" onClick={() => onSchedule(f)}>
                  Schedule
                </Button>
              </div>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Entries" count={entries?.length}>
        {entries === null ? (
          <Skeleton className="h-24" />
        ) : entries.length === 0 ? (
          <p className="m-0 text-[14px] text-muted">No entries yet. Share the event page to get teams in.</p>
        ) : (
          <Card className="overflow-hidden">
            {entries
              .filter((e) => e.status !== 'withdrawn')
              .sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0))
              .map((e) => (
                <details key={e.teamId} className="group px-3.5 py-3 [&+&]:border-t [&+&]:border-line" open={e.status === 'pending'}>
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <Crest id={e.teamId} name={e.teamName} size={36} />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">{e.teamName}</strong>
                      <span className="text-[13px] text-muted">{e.contactName ?? 'No contact'}</span>
                    </span>
                    <Badge tone={e.status === 'approved' ? 'brand' : e.status === 'pending' ? 'hl' : 'muted'}>
                      {e.status === 'approved' ? 'Approved' : e.status === 'pending' ? 'Waiting' : 'Declined'}
                    </Badge>
                  </summary>
                  <div className="mt-3 flex flex-col gap-1.5 pl-12 text-[14px]">
                    {e.contactPhone ? (
                      <a href={`tel:${e.contactPhone}`} className="inline-flex items-center gap-1.5 text-brand-text">
                        <Phone size={14} /> {e.contactPhone}
                      </a>
                    ) : null}
                    {e.squadSize ? <span>Squad of {e.squadSize}</span> : null}
                    {e.answers
                      .filter((a) => a.answer)
                      .map((a) => (
                        <span key={a.label}>
                          <span className="text-muted">{a.label}:</span> {a.answer}
                        </span>
                      ))}
                    {e.note ? <span className="text-muted">“{e.note}”</span> : null}
                    {c.status === 'registration' && e.status !== 'approved' ? (
                      <div className="mt-1 flex gap-2">
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => void act((t) => runAction('review_entry', { competitionId: c.id, teamId: e.teamId, decision: 'approve' }, t), `${e.teamName} approved.`)}>
                          Approve
                        </Button>
                        {e.status === 'pending' ? (
                          <Button size="sm" disabled={busy} onClick={() => void act((t) => runAction('review_entry', { competitionId: c.id, teamId: e.teamId, decision: 'reject' }, t), `${e.teamName} declined.`)}>
                            Decline
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
          </Card>
        )}
      </Section>

      <Section title="Event">
        <Card className="overflow-hidden">
          <ManageRow title="Edit details, banner, host and cause" sub="Everything on the Overview tab" onClick={() => setEditOpen(true)} />
          <ManageRow title={`Sponsors (${view.sponsors.length})`} sub="Logos and links by level" onClick={() => setSponsorsOpen(true)} />
          <Link to={`/rules/competition/${c.id}`} className="flex items-center gap-3 px-3.5 py-3 text-ink no-underline hover:bg-surface-2 [&+&]:border-t [&+&]:border-line">
            <span className="flex-1">
              <strong className="block">Rule book</strong>
              <span className="text-[13px] text-muted">Every fixture uses these rules</span>
            </span>
          </Link>
        </Card>
      </Section>

      {c.status !== 'finished' && c.status !== 'cancelled' ? (
        <Section title="Cancel">
          <Card className="flex flex-col gap-2 p-3.5">
            {confirmCancel ? (
              <>
                <p className="m-0 text-[14px]">Cancel {c.name}? Every entered team is told. This can’t be undone.</p>
                <div className="flex gap-2">
                  <Button variant="danger" disabled={busy} onClick={() => void act((t) => runAction('cancel_competition', { competitionId: c.id }, t), 'Cancelled.')}>
                    Cancel the event
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                    Keep it
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="danger" className="self-start" onClick={() => setConfirmCancel(true)}>
                Cancel the event
              </Button>
            )}
          </Card>
        </Section>
      ) : null}

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="Edit the event" wide>
        <EditForm
          view={view}
          busy={busy}
          onSave={async (patch) => {
            if (await act((t) => runAction('update_competition', { competitionId: c.id, ...patch }, t), 'Saved.')) setEditOpen(false);
          }}
        />
      </Sheet>
      <Sheet open={sponsorsOpen} onClose={() => setSponsorsOpen(false)} title="Sponsors">
        <SponsorManager competitionId={c.id} sponsors={view.sponsors} onChanged={() => void reload()} />
      </Sheet>
    </div>
  );
}

function ManageRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-surface px-3.5 py-3 text-left text-ink hover:bg-surface-2 [&+&]:border-t [&+&]:border-line">
      <span className="flex-1">
        <strong className="block">{title}</strong>
        <span className="text-[13px] text-muted">{sub}</span>
      </span>
    </button>
  );
}

function EditForm({ view, busy, onSave }: { view: CompetitionView; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const c = view.competition;
  const [name, setName] = useState(c.name);
  const [details, setDetails] = useState<EventDetails>({
    description: c.description ?? '',
    bannerUrl: c.banner_url ?? null,
    location: c.location ?? '',
    hostName: c.host_name ?? '',
    hostLogoUrl: c.host_logo_url ?? null,
    hostContact: c.host_contact ?? '',
    hostWebsite: c.host_website ?? '',
    causeName: c.cause_name ?? '',
    causeDescription: c.cause_description ?? '',
    causeUrl: c.cause_url ?? '',
    fundraisingNote: c.fundraising_note ?? '',
    entryFeeNote: c.entry_fee_note ?? '',
  });
  const [registration, setRegistration] = useState<RegistrationSettings>({
    requiresApproval: c.requires_approval,
    closesAt: toLocalInput(c.registration_closes_at),
    teamSizeMin: c.team_size_min ? String(c.team_size_min) : '',
    teamSizeMax: c.team_size_max ? String(c.team_size_max) : '',
    questions: c.registration_questions,
  });
  return (
    <div className="flex flex-col gap-5">
      <Field label="Name">
        <input className={fieldCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <EventDetailsFields value={details} onChange={setDetails} category={c.category} folder={`competitions/${c.id}`} />
      {c.status === 'registration' ? (
        <>
          <h3 className="m-0 text-[15px]">Registration</h3>
          <RegistrationFields value={registration} onChange={setRegistration} category={c.category} />
        </>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={busy || !name.trim()}
        onClick={() => onSave({ name: name.trim(), ...detailsToInput(details), ...(c.status === 'registration' ? registrationToInput(registration) : {}) })}
      >
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );
}
