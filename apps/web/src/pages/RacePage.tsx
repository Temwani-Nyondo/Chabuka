import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Download, Flag, HandHeart, MapPin, Search, Timer, Upload, Users } from 'lucide-react';
import { CATEGORY_LABELS, POI_LABELS, RESULT_STATUS_LABELS, formatDuration, pace, parseResultsCsv, toGpx, venueTime, venueYmd } from '@chabuka/shared';
import type { CompetitionCategory, CsvResultRow } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { downloadText, fetchRace, fetchRaceEntries, fetchRaceResults } from '../lib/races';
import type { RaceDistance, RaceEntry, RaceView, ResultRow } from '../lib/races';
import RouteMap from '../components/RouteMap';
import { FollowButton } from '../components/Social';
import RoutePlanner from '../components/RoutePlanner';
import ElevationChart from '../components/ElevationChart';
import { EventDetailsFields, SponsorManager, detailsToInput, emptyDetails } from '../components/CompetitionForms';
import type { EventDetails } from '../components/CompetitionForms';
import { Badge, Button, ButtonLink, Card, Chip, EmptyState, ErrorNote, ListRow, Section, Segmented, Skeleton, StatTile, cx } from '../components/ui';
import PublishToCircle from '../components/PublishToCircle';
import { fieldCls } from '../components/CompetitionForms';

// A race: the event page runners see (distances, course maps, start list, results) and, for the organiser, everything
// to run it (courses, entries and race-pack check-in, officials, start gun, finish line, results import and publishing).

type Tab = 'overview' | 'route' | 'runners' | 'results' | 'manage';

const dayFmt = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (d: RaceDistance) => (d.price > 0 ? `${d.currency} ${d.price}` : 'Free');

function countdown(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} to go` : `${hours} hour${hours === 1 ? '' : 's'} to go`;
}

export default function RacePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [view, setView] = useState<RaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setView(await fetchRace(token, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the race.');
    }
  }, [token, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      setError(null);
      setNotice(null);
      try {
        await fn();
        if (ok) setNotice(ok);
        await load();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        return false;
      }
    },
    [load],
  );

  if (!view) return <div className="mx-auto max-w-4xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-64" />}</div>;
  const { race } = view;
  const first = [...view.distances].sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const togo = first ? countdown(first.starts_at) : null;
  const official = view.isOrganiser || view.roles.length > 0;
  const setTab = (t: Tab) =>
    setParams((p) => {
      p.set('tab', t);
      p.delete('setup');
      return p;
    });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-24">
      <header className="relative overflow-hidden text-white lg:mt-4 lg:rounded-3xl">
        <img src={race.banner_url || '/sports/trail.jpg'} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
        <div className="relative flex flex-col gap-2 px-4 pb-5 pt-16">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[12px] font-bold">{CATEGORY_LABELS[race.category as CompetitionCategory] ?? 'Race'}</span>
            {togo ? <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[12px] font-bold">{togo}</span> : null}
            {race.status === 'finished' ? <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[12px] font-bold">Results out</span> : null}
          </div>
          <h1 className="m-0 text-white">{race.name}</h1>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-white/90">
            <span className="inline-flex items-center gap-1"><CalendarDays size={15} />{dayFmt(race.starts_on)}</span>
            <span className="inline-flex items-center gap-1"><MapPin size={15} />{race.location || race.area}</span>
          </p>
          {!view.isOrganiser ? (
            <div className="pt-1">
              <FollowButton subjectType="competition" subjectId={race.id} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {view.distances.map((d) => (
              <span key={d.id} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[13px] font-bold">{d.name}</span>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4">
        <Segmented<Tab>
          label="Race sections"
          value={tab}
          onChange={setTab}
          className="overflow-x-auto"
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'route', label: 'Route' },
            { value: 'runners', label: 'Runners' },
            { value: 'results', label: 'Results' },
            ...(official ? [{ value: 'manage' as Tab, label: 'Manage' }] : []),
          ]}
        />
        {notice ? <p className="m-0 rounded-xl bg-brand-soft px-3 py-2 text-[14px] font-semibold text-brand-text">{notice}</p> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {tab === 'overview' ? <Overview view={view} /> : null}
        {tab === 'route' ? <RouteTab view={view} /> : null}
        {tab === 'runners' ? <Runners view={view} /> : null}
        {tab === 'results' ? <Results raceId={race.id} token={token} distances={view.distances} /> : null}
        {tab === 'manage' && official ? <Manage view={view} token={token} act={act} reload={load} openRoute={params.get('setup') === 'route'} /> : null}
      </div>
    </div>
  );
}

// --- Overview ---------------------------------------------------------------------------------

function Overview({ view }: { view: RaceView }) {
  const { race, settings } = view;
  const open = race.status === 'registration' && (!race.registration_closes_at || new Date(race.registration_closes_at) > new Date());
  return (
    <div className="flex flex-col gap-5">
      {view.mine.length > 0 ? (
        <Section title="Your entries">
          <Card>
            {view.mine.map((e) => {
              const d = view.distances.find((x) => x.id === e.distance_id);
              const secs = e.result ? Number(e.result.chip_seconds ?? e.result.gun_seconds) : null;
              return (
                <ListRow
                  key={e.id}
                  title={`${e.runner_name} · ${d?.name ?? ''}`}
                  sub={
                    e.status === 'pending_payment'
                      ? 'Waiting for payment on WaitApp'
                      : e.status === 'refunded'
                        ? 'Refunded'
                        : [e.bib ? `Bib ${e.bib}` : null, e.wave ? `Wave ${e.wave}` : null, d ? `Start ${venueTime(d.starts_at)}` : null, e.result && d?.results_published ? `Finished ${formatDuration(secs)}` : null]
                            .filter(Boolean)
                            .join(' · ')
                  }
                  trailing={e.bib ? <span className="rounded-lg bg-ink px-2 py-1 font-mono text-[15px] font-extrabold text-bg">{e.bib}</span> : null}
                />
              );
            })}
          </Card>
          {settings.packCollection ? <p className="m-0 text-[13px] text-muted">Race-pack collection: {settings.packCollection}</p> : null}
        </Section>
      ) : null}

      <Section title="Distances">
        <div className="grid gap-3 sm:grid-cols-2">
          {view.distances.map((d) => {
            const left = Math.max(0, d.field_limit - d.held);
            return (
              <Card key={d.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="m-0 text-[18px] font-bold">{d.name}</p>
                    <p className="m-0 text-[13px] text-muted">
                      {Number(d.distance_km).toFixed(d.distance_km % 1 ? 1 : 0)} km{d.laps > 1 ? `, ${d.laps} laps` : ''} · start {venueTime(d.starts_at)}
                      {d.cutoff_minutes ? ` · cut-off ${formatDuration(d.cutoff_minutes * 60)}` : ''}
                    </p>
                  </div>
                  <Badge tone={d.price > 0 ? 'neutral' : 'brand'}>{money(d)}</Badge>
                </div>
                <span className="text-[13px] text-muted">
                  {left > 0 ? `${left} places left` : 'Full'}
                  {d.min_age ? ` · ${d.min_age}+ on race day` : ''}
                </span>
                {open && left > 0 ? (
                  <ButtonLink to={`/races/${race.id}/enter?distance=${d.id}`} variant="primary" size="sm">
                    Enter the {d.name}
                  </ButtonLink>
                ) : null}
              </Card>
            );
          })}
        </div>
        {!open ? <p className="m-0 text-[13px] text-muted">Entries are closed.</p> : race.registration_closes_at ? <p className="m-0 text-[13px] text-muted">Entries close {new Date(race.registration_closes_at).toLocaleString()}.</p> : null}
      </Section>

      {race.description ? (
        <Section title="About">
          <p className="m-0 whitespace-pre-line text-[15px]">{race.description}</p>
        </Section>
      ) : null}

      {race.cause_name ? (
        <Card className="flex gap-3 p-4">
          <HandHeart size={22} className="shrink-0 text-brand-text" />
          <div className="flex flex-col gap-1">
            <strong>Running for {race.cause_name}</strong>
            {race.cause_description ? <p className="m-0 text-[14px]">{race.cause_description}</p> : null}
            {race.fundraising_note ? <p className="m-0 text-[13px] text-muted">{race.fundraising_note}</p> : null}
            {race.cause_url ? <a href={race.cause_url} target="_blank" rel="noreferrer" className="text-[13px] font-bold text-brand-text">About the cause</a> : null}
          </div>
        </Card>
      ) : null}

      {race.host_name ? (
        <Card className="flex items-center gap-3 p-4">
          {race.host_logo_url ? <img src={race.host_logo_url} alt="" className="h-12 w-12 rounded-xl object-cover" /> : null}
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-muted">Hosted by</span>
            <strong>{race.host_name}</strong>
            {race.host_contact ? <span className="text-[13px] text-muted">{race.host_contact}</span> : null}
          </div>
        </Card>
      ) : null}

      {view.sponsors.length > 0 ? (
        <Section title="Sponsors">
          <div className="flex flex-wrap gap-3">
            {view.sponsors.map((s) => (
              <a key={s.id} href={s.url ?? undefined} target="_blank" rel="noreferrer" className={cx('flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 no-underline', s.tier === 'title' && 'w-full')}>
                {s.logo_url ? <img src={s.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : null}
                <span className="font-bold text-ink">{s.name}</span>
              </a>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// --- Route ------------------------------------------------------------------------------------

function DistanceSwitch({ distances, value, onChange }: { distances: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  if (distances.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Distance">
      {distances.map((d) => (
        <Chip key={d.id} on={d.id === value} onClick={() => onChange(d.id)}>
          {d.name}
        </Chip>
      ))}
    </div>
  );
}

function RouteTab({ view }: { view: RaceView }) {
  const [distanceId, setDistanceId] = useState(view.distances[0]?.id ?? '');
  const d = view.distances.find((x) => x.id === distanceId);
  const route = view.routes.find((r) => r.distance_id === distanceId);
  return (
    <div className="flex flex-col gap-3">
      <DistanceSwitch distances={view.distances} value={distanceId} onChange={setDistanceId} />
      {!route || route.points.length < 2 ? (
        <EmptyState icon={<MapPin size={22} />} title="Course coming soon" body="The organiser has not published this course yet." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile value={`${(route.distance_m / 1000).toFixed(2)} km`} label="Distance" />
            <StatTile value={route.climb_m ? `${route.climb_m} m` : '–'} label="Climb" />
            <StatTile value={route.pois.filter((p) => p.type === 'water').length} label="Water points" />
          </div>
          <RouteMap points={route.points} pois={route.pois} laps={d?.laps ?? 1} height={420} />
          <ElevationChart points={route.points} />
          {route.pois.length > 0 ? (
            <Card>
              {route.pois.map((p, i) => (
                <ListRow key={i} title={p.label || POI_LABELS[p.type]} trailing={<span className="text-[14px] font-bold">km {p.km}</span>} />
              ))}
            </Card>
          ) : null}
          <Button size="sm" icon={<Download size={15} />} className="self-start" onClick={() => downloadText(`${view.race.name} ${d?.name ?? ''}.gpx`, toGpx(`${view.race.name} ${d?.name ?? ''}`, route.points, route.pois))}>
            Download GPX for your watch
          </Button>
        </>
      )}
    </div>
  );
}

// --- Runners ----------------------------------------------------------------------------------

function Runners({ view }: { view: RaceView }) {
  const [q, setQ] = useState('');
  const [distanceId, setDistanceId] = useState(view.distances[0]?.id ?? '');
  const list = view.startList.filter((r) => (view.distances.length < 2 || r.distanceId === distanceId) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || String(r.bib ?? '').includes(q)));
  return (
    <div className="flex flex-col gap-3">
      <DistanceSwitch distances={view.distances} value={distanceId} onChange={setDistanceId} />
      <label className="relative">
        <Search size={16} className="absolute left-3 top-3.5 text-muted" />
        <input className={cx(fieldCls, 'pl-9')} placeholder="Search name or bib" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {list.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title="No runners yet" body="Confirmed runners appear here with their bib number." />
      ) : (
        <Card>
          {list.slice(0, 300).map((r) => (
            <ListRow key={`${r.bib}-${r.name}`} leading={<span className="w-12 font-mono font-bold">{r.bib}</span>} title={r.name} sub={[r.club, r.wave ? `Wave ${r.wave}` : null].filter(Boolean).join(' · ')} />
          ))}
        </Card>
      )}
      {list.length > 300 ? <p className="m-0 text-[13px] text-muted">Showing 300 of {list.length}. Search to narrow down.</p> : null}
    </div>
  );
}

// --- Results ----------------------------------------------------------------------------------

function Results({ raceId, token, distances }: { raceId: string; token: string; distances: RaceDistance[] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchRaceResults>> | null>(null);
  const [distanceId, setDistanceId] = useState('');
  const [who, setWho] = useState<'all' | 'female' | 'male'>('all');
  const [age, setAge] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    fetchRaceResults(token, raceId)
      .then((r) => {
        setData(r);
        setDistanceId((cur) => cur || r.distances[0]?.id || '');
      })
      .catch(() => setData({ distances: [], results: [] }));
  }, [token, raceId]);
  const km = distances.find((d) => d.id === distanceId)?.distance_km ?? 0;
  const rows = useMemo(
    () =>
      (data?.results ?? []).filter(
        (r) => r.distanceId === distanceId && (who === 'all' || r.gender === who) && (!age || r.ageGroup === age) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || String(r.bib ?? '') === q),
      ),
    [data, distanceId, who, age, q],
  );
  const ageGroups = [...new Set((data?.results ?? []).filter((r) => r.distanceId === distanceId).map((r) => r.ageGroup).filter((a): a is string => !!a))].sort();
  if (!data) return <Skeleton className="h-40" />;
  if (data.distances.length === 0) return <EmptyState icon={<Timer size={22} />} title="Results are not out yet" body="They appear here once the organiser publishes them." />;
  const pos = (r: ResultRow) => (who === 'all' && !age ? r.overall : age ? r.agePos : r.genderPos);
  return (
    <div className="flex flex-col gap-3">
      <DistanceSwitch distances={data.distances} value={distanceId} onChange={setDistanceId} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<'all' | 'female' | 'male'> label="Who" value={who} onChange={setWho} options={[{ value: 'all', label: 'Everyone' }, { value: 'female', label: 'Women' }, { value: 'male', label: 'Men' }]} />
        <select className="h-10 rounded-xl border border-line bg-surface px-2 text-[14px]" value={age} onChange={(e) => setAge(e.target.value)} aria-label="Age group">
          <option value="">All ages</option>
          {ageGroups.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input className={cx(fieldCls, 'h-10 max-w-[200px]')} placeholder="Name or bib" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data.distances.find((d) => d.id === distanceId)?.published ? <Badge tone="hl" className="self-start">Not published yet: only you can see these</Badge> : null}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="px-3 py-2">#</th>
              <th className="px-2 py-2">Bib</th>
              <th className="px-2 py-2">Runner</th>
              <th className="px-2 py-2 text-right">Time</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">Pace</th>
              <th className="hidden px-3 py-2 sm:table-cell">Group</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const secs = r.chipSeconds ?? r.gunSeconds;
              return (
                <tr key={r.entryId} className={cx('border-t border-line', r.mine && 'bg-brand-soft')}>
                  <td className="px-3 py-2 font-bold">{pos(r) ?? ''}</td>
                  <td className="px-2 py-2 font-mono">{r.bib}</td>
                  <td className="px-2 py-2">
                    <span className="font-semibold">{r.name}</span>
                    {r.club ? <span className="block text-[12px] text-muted">{r.club}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-bold">{r.status === 'finished' ? formatDuration(secs) : RESULT_STATUS_LABELS[r.status]}</td>
                  <td className="hidden px-2 py-2 text-right text-muted sm:table-cell">{r.status === 'finished' ? pace(secs, km) : ''}</td>
                  <td className="hidden px-3 py-2 text-muted sm:table-cell">
                    {r.gender === 'female' ? 'W' : 'M'} {r.ageGroup ?? ''}
                    {r.agePos ? ` (${r.agePos})` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Manage -----------------------------------------------------------------------------------

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

function Manage({ view, token, act, reload, openRoute }: { view: RaceView; token: string; act: Act; reload: () => Promise<void>; openRoute: boolean }) {
  const [section, setSection] = useState<'courses' | 'entries' | 'raceday' | 'setup'>(openRoute ? 'courses' : view.isOrganiser ? 'entries' : 'raceday');
  const org = view.isOrganiser;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {org ? <Chip on={section === 'courses'} onClick={() => setSection('courses')}>Courses</Chip> : null}
        <Chip on={section === 'entries'} onClick={() => setSection('entries')}>Entries and check-in</Chip>
        <Chip on={section === 'raceday'} onClick={() => setSection('raceday')}>Race day</Chip>
        {org ? <Chip on={section === 'setup'} onClick={() => setSection('setup')}>Sales, staff, sponsors</Chip> : null}
      </div>
      {section === 'courses' && org ? <Courses view={view} reload={reload} /> : null}
      {section === 'entries' ? <Entries view={view} token={token} act={act} /> : null}
      {section === 'raceday' ? <RaceDay view={view} token={token} act={act} /> : null}
      {section === 'setup' && org ? <SalesStaff view={view} token={token} act={act} reload={reload} /> : null}
    </div>
  );
}

function Courses({ view, reload }: { view: RaceView; reload: () => Promise<void> }) {
  const [distanceId, setDistanceId] = useState(view.distances[0]?.id ?? '');
  const d = view.distances.find((x) => x.id === distanceId);
  const route = view.routes.find((r) => r.distance_id === distanceId) ?? null;
  const other = view.routes.find((r) => r.distance_id !== distanceId && r.points.length > 1);
  if (!d) return null;
  return (
    <div className="flex flex-col gap-3">
      <DistanceSwitch distances={view.distances} value={distanceId} onChange={setDistanceId} />
      <RoutePlanner
        key={d.id}
        distance={{ id: d.id, name: d.name, distance_km: Number(d.distance_km), laps: d.laps }}
        initial={route}
        centre={other ? { lat: other.points[0]![0], lng: other.points[0]![1] } : null}
        onSaved={() => void reload()}
      />
    </div>
  );
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function Entries({ view, token, act }: { view: RaceView; token: string; act: Act }) {
  const [entries, setEntries] = useState<RaceEntry[] | null>(null);
  const [q, setQ] = useState('');
  const [distanceId, setDistanceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchRaceEntries(token, view.race.id)
      .then(setEntries)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load entries.'));
  }, [token, view.race.id]);
  useEffect(load, [load]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!entries) return <Skeleton className="h-40" />;
  const dName = (id: string) => view.distances.find((d) => d.id === id)?.name ?? '';
  const list = entries.filter((e) => (!distanceId || e.distance_id === distanceId) && (!q || e.runner_name.toLowerCase().includes(q.toLowerCase()) || String(e.bib ?? '') === q.trim()));
  const confirmed = entries.filter((e) => e.status === 'confirmed');
  const exportCsv = () => {
    const head = ['Bib', 'Name', 'Gender', 'Date of birth', 'Age group', 'Distance', 'Wave', 'Club', 'T-shirt', 'Status', 'Phone', 'Emergency contact', 'Emergency phone', 'Medical', 'Collected'];
    const rows = entries.map((e) => [e.bib, e.runner_name, e.gender, e.birth_date, e.age_group, dName(e.distance_id), e.wave, e.club, e.tshirt, e.status, e.private?.phone, e.private?.emergency_name, e.private?.emergency_phone, e.private?.medical_note, e.checked_in_at ? 'yes' : '']);
    downloadText(`${view.race.name} entries.csv`, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <StatTile value={confirmed.length} label="Confirmed" />
        <StatTile value={entries.filter((e) => e.status === 'pending_payment').length} label="Awaiting payment" />
        <StatTile value={confirmed.filter((e) => e.checked_in_at).length} label="Packs collected" />
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="h-10 rounded-xl border border-line bg-surface px-2 text-[14px]" value={distanceId} onChange={(e) => setDistanceId(e.target.value)} aria-label="Distance">
          <option value="">All distances</option>
          {view.distances.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <input className={cx(fieldCls, 'h-10 max-w-[240px]')} placeholder="Search name or bib" value={q} onChange={(e) => setQ(e.target.value)} />
        {view.isOrganiser ? <Button size="sm" icon={<Download size={15} />} onClick={exportCsv}>Export CSV</Button> : null}
      </div>
      <Card>
        {list.slice(0, 200).map((e) => (
          <ListRow
            key={e.id}
            leading={<span className="w-12 font-mono font-bold">{e.bib ?? '–'}</span>}
            title={e.runner_name}
            sub={[dName(e.distance_id), e.tshirt ? `T-shirt ${e.tshirt}` : null, e.status === 'pending_payment' ? 'awaiting payment' : e.status !== 'confirmed' ? e.status : null, e.private ? `ICE ${e.private.emergency_name} ${e.private.emergency_phone}` : null]
              .filter(Boolean)
              .join(' · ')}
            trailing={
              e.status === 'confirmed' ? (
                e.checked_in_at ? (
                  <Button size="sm" variant="ghost" onClick={() => void act(() => runAction('check_in_runner', { entryId: e.id, undo: true }, token), 'Undone.').then(load)}>
                    Collected
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void act(() => runAction('check_in_runner', { entryId: e.id }, token), `Bib ${e.bib} collected.`).then(load)}>
                    Hand out pack
                  </Button>
                )
              ) : null
            }
          />
        ))}
        {list.length === 0 ? <p className="m-0 p-4 text-[14px] text-muted">No entries match.</p> : null}
      </Card>
    </div>
  );
}

function RaceDay({ view, token, act }: { view: RaceView; token: string; act: Act }) {
  const [csv, setCsv] = useState<{ distanceId: string; rows: CsvResultRow[]; errors: { line: number; message: string }[] } | null>(null);
  const finishRole = view.isOrganiser || view.roles.includes('finish');
  return (
    <div className="flex flex-col gap-3">
      {view.distances.map((d) => (
        <Card key={d.id} className="flex flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-[16px]">{d.name}</strong>
            {d.results_published ? <Badge tone="brand">Results published</Badge> : d.gun_started_at ? <Badge tone="live">Running</Badge> : <Badge tone="muted">Not started</Badge>}
          </div>
          <span className="text-[13px] text-muted">
            {d.gun_started_at ? `Started ${venueYmd(d.gun_started_at)} ${new Date(d.gun_started_at).toLocaleTimeString()}` : `Planned start ${venueTime(d.starts_at)}`} · {d.entered} confirmed
          </span>
          {finishRole ? (
            <div className="flex flex-wrap gap-2">
              {!d.gun_started_at ? (
                <Button variant="primary" icon={<Flag size={16} />} onClick={() => void act(() => runAction('start_gun', { distanceId: d.id }, token), `${d.name} started. The clock is running.`)}>
                  Start the clock now
                </Button>
              ) : null}
              <ButtonLink to={`/races/${view.race.id}/line?distance=${d.id}`} icon={<Timer size={16} />}>
                Open finish line
              </ButtonLink>
            </div>
          ) : null}
          {view.isOrganiser ? (
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-bold hover:bg-surface-2">
                <Upload size={15} /> Import timing CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setCsv({ distanceId: d.id, ...parseResultsCsv(await f.text()) });
                  }}
                />
              </label>
              <Button size="sm" variant={d.results_published ? 'secondary' : 'primary'} onClick={() => void act(() => runAction('publish_results', { distanceId: d.id, publish: !d.results_published }, token), d.results_published ? 'Results hidden.' : 'Results published. Runners have been told their time.')}>
                {d.results_published ? 'Hide results' : 'Publish results'}
              </Button>
            </div>
          ) : null}
          {csv?.distanceId === d.id ? (
            <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <strong className="text-[14px]">{csv.rows.length} results read{csv.errors.length ? `, ${csv.errors.length} rows with problems` : ''}</strong>
              {csv.errors.slice(0, 8).map((er) => (
                <span key={er.line} className="text-[13px] text-danger">Line {er.line}: {er.message}</span>
              ))}
              {csv.rows.slice(0, 5).map((r) => (
                <span key={r.line} className="font-mono text-[13px]">
                  {r.bib} {r.status === 'finished' ? formatDuration(r.chipSeconds ?? r.gunSeconds) : r.status.toUpperCase()}
                </span>
              ))}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={csv.rows.length === 0}
                  onClick={() =>
                    void act(async () => {
                      const r = await runAction<{ imported: number; unknownBibs: number[] }>(
                        'import_results',
                        { distanceId: d.id, mode: 'replace', rows: csv.rows.map(({ bib, gunSeconds, chipSeconds, status }) => ({ bib, gunSeconds, chipSeconds, status })) },
                        token,
                      );
                      setCsv(null);
                      if (r.unknownBibs.length) throw new Error(`Imported ${r.imported}. These bibs are not in the ${d.name}: ${r.unknownBibs.slice(0, 20).join(', ')}`);
                    }, 'Results imported. Check them, then publish.')
                  }
                >
                  Replace results with this file
                </Button>
                <Button size="sm" onClick={() => setCsv(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </Card>
      ))}
      <p className="m-0 text-[13px] text-muted">
        Finish-line volunteers need the Finish role (Manage, Sales, staff, sponsors). Each volunteer opens the finish line on their phone and types bib numbers as runners cross.
      </p>
    </div>
  );
}

function SalesStaff({ view, token, act, reload }: { view: RaceView; token: string; act: Act; reload: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'finish' | 'checkin'>('finish');
  const paid = view.distances.filter((d) => d.price > 0);
  return (
    <div className="flex flex-col gap-5">
      <Section title="Paid entry">
        <Card className="flex flex-col gap-2 p-4 text-[14px]">
          {paid.length === 0 ? (
            <span className="text-muted">Every distance is free: runners are confirmed straight away.</span>
          ) : view.race.waitapp_checkout_url ? (
            <>
              <span>
                <Badge tone="brand">On sale</Badge> {paid.map((d) => `${d.name} ${money(d)}`).join(', ')} through WaitApp.
              </span>
              <span className="text-muted">Runners fill in their details here, pay on WaitApp, and get their bib as soon as the payment clears. Refunds are done on WaitApp.</span>
            </>
          ) : (
            <>
              <span>Put the paid distances on sale. Your WaitApp account takes the payments.</span>
              <div className="flex flex-wrap gap-2">
                <ButtonLink to="/connect/waitapp" size="sm">Connect WaitApp</ButtonLink>
                <Button size="sm" variant="primary" onClick={() => void act(() => runAction('open_race_entries', { competitionId: view.race.id }, token), 'Paid entries are on sale.')}>
                  Put entries on sale
                </Button>
              </div>
            </>
          )}
        </Card>
      </Section>
      <Section title="Race staff">
        <Card className="flex flex-col gap-2 p-4">
          <p className="m-0 text-[13px] text-muted">Finish-line volunteers record bibs as runners cross; check-in staff hand out race packs.</p>
          <div className="flex flex-wrap gap-2">
            <input className={cx(fieldCls, 'max-w-[260px]')} type="email" placeholder="Their Chabuka account email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Segmented<'finish' | 'checkin'> label="Role" value={role} onChange={setRole} options={[{ value: 'finish', label: 'Finish line' }, { value: 'checkin', label: 'Check-in' }]} />
            <Button disabled={!email.includes('@')} onClick={() => void act(() => runAction('appoint_race_official', { competitionId: view.race.id, email: email.trim(), role }, token), 'Added.').then((ok) => ok && setEmail(''))}>
              Add
            </Button>
          </div>
        </Card>
      </Section>
      <Section title="Sponsors">
        <SponsorManager competitionId={view.race.id} sponsors={view.sponsors as never} onChanged={() => void reload()} />
      </Section>
      <Section title="Circle">
        <PublishToCircle competitionId={view.race.id} circleId={view.race.circle_id} token={token} onChanged={() => void reload()} />
      </Section>
      <Section title="Event details">
        <DetailsEditor view={view} token={token} act={act} />
      </Section>
    </div>
  );
}

function DetailsEditor({ view, token, act }: { view: RaceView; token: string; act: Act }) {
  const r = view.race;
  const [details, setDetails] = useState<EventDetails>({
    ...emptyDetails,
    description: r.description ?? '',
    bannerUrl: r.banner_url,
    location: r.location ?? '',
    hostName: r.host_name ?? '',
    hostLogoUrl: r.host_logo_url,
    hostContact: r.host_contact ?? '',
    hostWebsite: r.host_website ?? '',
    causeName: r.cause_name ?? '',
    causeDescription: r.cause_description ?? '',
    causeUrl: r.cause_url ?? '',
    fundraisingNote: r.fundraising_note ?? '',
  });
  return (
    <Card className="flex flex-col gap-4 p-4">
      <EventDetailsFields value={details} onChange={setDetails} category={r.category as CompetitionCategory} folder={`competitions/${r.id}`} />
      <Button variant="primary" onClick={() => void act(() => runAction('update_competition', { competitionId: r.id, ...detailsToInput(details) }, token), 'Details saved.')}>
        Save details
      </Button>
    </Card>
  );
}
