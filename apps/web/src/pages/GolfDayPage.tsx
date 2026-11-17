import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Flag, Minus, Plus, Trophy } from 'lucide-react';
import { SIDE_CONTEST_LABELS } from '@chabuka/shared';
import type { SideContest } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchGolfDay, fetchGolfEntries, golfPost } from '../lib/golf';
import type { GolfDayView } from '../lib/golf';
import PublishToCircle from '../components/PublishToCircle';
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Section, Segmented, Skeleton } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

// A golf day: the course and format, entering with a handicap, the field and flights, the live leaderboard (refreshed
// every 20 seconds while play is on), the scorecard for whoever keeps their flight's card, and the organiser's tools.

type Tab = 'overview' | 'field' | 'leaderboard' | 'card' | 'manage';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const toParLabel = (n: number | null) => (n == null ? '' : n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

export default function GolfDayPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { session, profile } = useAuth();
  const token = session?.access_token ?? '';
  const [view, setView] = useState<GolfDayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams((p) => { p.set('tab', t); return p; }, { replace: true });

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setView(await fetchGolfDay(token, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the golf day.');
    }
  }, [token, id]);
  useEffect(() => void load(), [load]);

  // Live while play is on: the leaderboard and cards refresh every 20 seconds.
  const live = view?.golfDay.status === 'live' && !view.published;
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(t);
  }, [live, load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    }
  };

  if (!view) return <div className="mx-auto max-w-3xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-60" />}</div>;
  const s = view.settings;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'field', label: `Field · ${view.entered}` },
    { value: 'leaderboard', label: 'Leaderboard' },
    ...(view.scorerFlights.length && !view.published ? [{ value: 'card' as Tab, label: 'Scorecard' }] : []),
    ...(view.isOrganiser ? [{ value: 'manage' as Tab, label: 'Manage' }] : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4">
      <PageHeader
        title={view.golfDay.name}
        back="/competitions"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="brand">Golf day</Badge>
            {view.published ? <Badge tone="muted">Results in</Badge> : live ? <Badge tone="hl">Live</Badge> : null}
            <span className="text-[13px] text-muted">{when(s.firstTeeAt)}</span>
          </span>
        }
      />
      <Segmented label="Golf day" value={tab} onChange={setTab} options={tabs} />
      {notice ? <p className="m-0 text-[14px] text-muted">{notice}</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {tab === 'overview' ? <Overview view={view} token={token} defaultName={profile?.name ?? ''} act={act} /> : null}
      {tab === 'field' ? <FieldTab view={view} /> : null}
      {tab === 'leaderboard' ? <Leaderboard view={view} /> : null}
      {tab === 'card' ? <Scorecard view={view} token={token} act={act} /> : null}
      {tab === 'manage' && view.isOrganiser ? <Manage view={view} token={token} act={act} reload={load} /> : null}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

function Overview({ view, token, defaultName, act }: { view: GolfDayView; token: string; defaultName: string; act: Act }) {
  const s = view.settings;
  const [name, setName] = useState(defaultName);
  const [hcp, setHcp] = useState('');
  const [phone, setPhone] = useState('');
  const open = view.golfDay.status === 'registration';
  const fee = s.entryFee > 0 ? `K${s.entryFee}` : 'Free';

  async function enter() {
    const r = await golfPost<{ state: string; checkoutUrl: string | null }>(token, '/enter', { competitionId: view.golfDay.id, playerName: name.trim(), handicapIndex: Number(hcp), phone: phone.trim() }, 'Could not enter.');
    if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
  }

  return (
    <>
      {view.golfDay.banner_url ? <img src={view.golfDay.banner_url} alt="" className="h-44 w-full rounded-2xl object-cover" /> : null}
      <Card className="flex flex-col gap-2 p-4 text-[14px]">
        <p className="m-0"><strong>{view.course.name}</strong>{view.course.teeSet ? ` (${view.course.teeSet})` : ''} · {view.course.holes} holes, par {view.course.par}</p>
        <p className="m-0 text-muted">
          {s.scoring === 'stableford' ? 'Stableford' : 'Stroke play'}, {s.allowancePct}% handicap allowance · {s.startType === 'shotgun' ? 'Shotgun start' : `Tee times every ${s.intervalMin} min`} · {fee}
        </p>
        {s.sideContests.length ? (
          <p className="m-0 text-muted">{s.sideContests.map((c) => `${SIDE_CONTEST_LABELS[c.type]} on ${c.hole}`).join(' · ')}</p>
        ) : null}
        {view.golfDay.description ? <p className="m-0 whitespace-pre-line">{view.golfDay.description}</p> : null}
      </Card>

      {view.mine.length ? (
        <Section title="Your entry">
          <Card className="flex flex-col gap-2 p-4">
            {view.mine.map((m) => {
              const flight = view.flights.find((f) => f.id === m.flightId);
              return (
                <div key={m.entryId} className="flex items-center gap-2">
                  <span className="flex-1">
                    <strong>{m.name}</strong> · handicap {m.handicapIndex}
                    <span className="block text-[13px] text-muted">
                      {m.status === 'pending_payment' ? 'Waiting for payment on WaitApp' : flight ? `${flight.label}, ${s.startType === 'shotgun' ? `starting on hole ${flight.startHole}` : `tees off ${when(flight.teeTime)}`}` : 'Flights not out yet'}
                    </span>
                  </span>
                  {m.status !== 'refunded' && open ? (
                    <Button size="sm" variant="ghost" onClick={() => void act(() => golfPost(token, '/cancel-entry', { entryId: m.entryId }), 'Entry cancelled.')}>Cancel</Button>
                  ) : null}
                </div>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {open ? (
        <Section title={view.mine.length ? 'Enter someone else' : 'Enter'}>
          <Card className="flex flex-col gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Player">
                <input className={fieldCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Handicap index" hint={`Up to ${s.maxHandicap}`}>
                <input className={fieldCls} inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="18.4" />
              </Field>
              <Field label="Phone" hint="For the organiser">
                <input className={fieldCls} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" disabled={name.trim().length < 2 || hcp.trim() === '' || Number.isNaN(Number(hcp)) || phone.trim().length < 6} onClick={() => void act(enter, s.entryFee > 0 ? 'Opening WaitApp to pay…' : 'You are in.')}>
              {s.entryFee > 0 ? `Enter and pay ${fee} on WaitApp` : 'Enter'}
            </Button>
          </Card>
        </Section>
      ) : null}
    </>
  );
}

function FieldTab({ view }: { view: GolfDayView }) {
  const byId = new Map(view.field.map((f) => [f.entryId, f]));
  if (!view.field.length) return <EmptyState icon={<Flag size={22} />} title="No entries yet" body="Players appear here once they enter." />;
  if (!view.flights.length) {
    return (
      <Card>
        {view.field.map((f) => (
          <div key={f.entryId} className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[14px] last:border-0">
            <span>{f.name}</span>
            <span className="text-muted">hcp {f.handicapIndex} · plays {f.playingHcp}</span>
          </div>
        ))}
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {view.flights.map((fl) => (
        <Card key={fl.id} className="p-4">
          <p className="m-0 mb-1 font-semibold">{fl.label}</p>
          <p className="m-0 mb-2 text-[13px] text-muted">{view.settings.startType === 'shotgun' ? `Starts on hole ${fl.startHole}` : when(fl.teeTime)}</p>
          {fl.entryIds.map((e) => (
            <p key={e} className="m-0 text-[14px]">
              {byId.get(e)?.name ?? 'Player'} <span className="text-muted">({byId.get(e)?.playingHcp ?? 0})</span>
              {fl.scorerEntryId === e ? <span className="text-[12px] text-muted"> · keeps the card</span> : null}
            </p>
          ))}
        </Card>
      ))}
    </div>
  );
}

function Leaderboard({ view }: { view: GolfDayView }) {
  const stable = view.settings.scoring === 'stableford';
  const [open, setOpen] = useState<string | null>(null);
  const started = view.leaderboard.some((r) => r.thru > 0);
  return (
    <>
      {!started ? <EmptyState icon={<Trophy size={22} />} title="No scores yet" body="The leaderboard fills in as flights enter their scores." /> : null}
      {started ? (
        <Card>
          <div className="grid grid-cols-[44px_1fr_52px_60px] gap-2 border-b border-line px-4 py-2 text-[12px] font-semibold text-muted">
            <span>Pos</span><span>Player</span><span>Thru</span><span className="text-right">{stable ? 'Pts' : 'Net'}</span>
          </div>
          {view.leaderboard.filter((r) => r.thru > 0).map((r) => (
            <div key={r.entryId}>
              <button type="button" onClick={() => setOpen(open === r.entryId ? null : r.entryId)} className="grid w-full cursor-pointer grid-cols-[44px_1fr_52px_60px] gap-2 border-0 border-b border-line bg-surface px-4 py-2.5 text-left text-[14px] text-ink hover:bg-surface-2">
                <span className="font-semibold">{r.position}</span>
                <span>{r.name} <span className="text-[12px] text-muted">({r.playingHcp})</span></span>
                <span className="text-muted">{r.thru === view.course.holes ? 'F' : r.thru}</span>
                <span className="text-right font-semibold">{stable ? r.points : r.net == null ? 'NR' : `${r.net}`}</span>
              </button>
              {open === r.entryId ? (
                <div className="overflow-x-auto border-b border-line px-4 py-2">
                  <table className="text-[12px]">
                    <tbody>
                      <tr><th className="pr-2 text-left text-muted">Hole</th>{view.course.card.map((h) => <td key={h.holeNo} className="px-1 text-center text-muted">{h.holeNo}</td>)}</tr>
                      <tr><th className="pr-2 text-left text-muted">Par</th>{view.course.card.map((h) => <td key={h.holeNo} className="px-1 text-center text-muted">{h.par}</td>)}</tr>
                      <tr><th className="pr-2 text-left">Score</th>{r.holes.map((h) => <td key={h.holeNo} className="px-1 text-center font-semibold">{h.played ? (h.gross ?? '-') : ''}</td>)}</tr>
                      {stable ? <tr><th className="pr-2 text-left text-muted">Pts</th>{r.holes.map((h) => <td key={h.holeNo} className="px-1 text-center text-muted">{h.played ? h.points : ''}</td>)}</tr> : null}
                    </tbody>
                  </table>
                  {!stable ? <p className="m-0 mt-1 text-[12px] text-muted">Gross {r.gross ?? 'NR'} ({toParLabel(r.toPar)})</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}
      {view.sideResults.length ? (
        <Section title="Side contests">
          <Card className="flex flex-col gap-1 p-4 text-[14px]">
            {view.sideResults.map((x) => (
              <p key={`${x.type}${x.hole}`} className="m-0">{SIDE_CONTEST_LABELS[x.type as SideContest]} (hole {x.hole}): <strong>{x.winner ?? 'not won'}</strong>{x.note ? ` · ${x.note}` : ''}</p>
            ))}
          </Card>
        </Section>
      ) : null}
    </>
  );
}

function Scorecard({ view, token, act }: { view: GolfDayView; token: string; act: Act }) {
  const flights = view.flights.filter((f) => view.scorerFlights.includes(f.id));
  const [flightId, setFlightId] = useState(flights[0]?.id ?? '');
  const flight = flights.find((f) => f.id === flightId) ?? flights[0];
  const holes = view.course.card;
  const startHole = flight?.startHole ?? 1;
  // Holes in playing order from the flight's starting hole (shotgun groups start mid-course).
  const order = useMemo(() => [...holes.filter((h) => h.holeNo >= startHole), ...holes.filter((h) => h.holeNo < startHole)], [holes, startHole]);
  const rows = (flight?.entryIds ?? []).map((e) => view.leaderboard.find((r) => r.entryId === e)).filter((r): r is GolfDayView['leaderboard'][number] => !!r);
  const firstOpen = order.find((h) => rows.some((r) => !r.holes.find((x) => x.holeNo === h.holeNo)?.played))?.holeNo ?? order[0]?.holeNo ?? 1;
  const [holeNo, setHoleNo] = useState(firstOpen);
  const hole = holes.find((h) => h.holeNo === holeNo);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const myEntry = view.mine.find((m) => m.flightId === flight?.id);

  useEffect(() => {
    const d: Record<string, number | null> = {};
    for (const r of rows) {
      const h = r.holes.find((x) => x.holeNo === holeNo);
      d[r.entryId] = h?.played ? (h.gross ?? null) : (hole?.par ?? 4);
    }
    setDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeNo, flightId, view]);

  if (!flight) return <EmptyState icon={<Flag size={22} />} title="No card to keep" body="Your flight's card shows here once flights are out." />;
  const idx = order.findIndex((h) => h.holeNo === holeNo);
  const next = () => setHoleNo(order[Math.min(order.length - 1, idx + 1)]!.holeNo);
  const prev = () => setHoleNo(order[Math.max(0, idx - 1)]!.holeNo);

  async function save() {
    const scores = rows.map((r) => ({ entryId: r.entryId, holeNo, strokes: draft[r.entryId] ?? null }));
    const ok = await act(() => golfPost(token, '/scores', { competitionId: view.golfDay.id, scores }, 'Could not save the scores.'), `Hole ${holeNo} saved.`);
    if (ok && idx < order.length - 1) next();
  }

  return (
    <div className="flex flex-col gap-3">
      {flights.length > 1 ? (
        <select className={fieldCls} value={flight.id} onChange={(e) => setFlightId(e.target.value)} aria-label="Flight">
          {flights.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      ) : null}
      {myEntry && flight.scorerEntryId !== myEntry.entryId ? (
        <Card className="flex items-center gap-3 p-3 text-[14px]">
          <span className="flex-1">{flight.scorerEntryId ? 'Someone else keeps this card. You can still follow it here.' : 'Keep the card for your whole flight?'}</span>
          {!flight.scorerEntryId ? (
            <Button size="sm" onClick={() => void act(() => golfPost(token, '/claim-scorer', { competitionId: view.golfDay.id, flightId: flight.id }), 'You keep the card.')}>Keep the card</Button>
          ) : null}
        </Card>
      ) : null}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" disabled={idx <= 0} onClick={prev}>Previous</Button>
          <strong className="text-[18px]">Hole {holeNo} · par {hole?.par}{hole?.yards ? ` · ${hole.yards} yds` : ''}</strong>
          <Button size="sm" variant="ghost" disabled={idx >= order.length - 1} onClick={next}>Next</Button>
        </div>
        <p className="m-0 text-center text-[12px] text-muted">Stroke index {hole?.strokeIndex}</p>
        {rows.map((r) => {
          const v = draft[r.entryId];
          const received = r.holes.find((x) => x.holeNo === holeNo)?.received ?? 0;
          return (
            <div key={r.entryId} className="flex items-center gap-3">
              <span className="flex-1 text-[15px]">
                {r.name}
                {received ? <span className="text-[12px] text-muted"> · {received > 0 ? `${received} shot${received > 1 ? 's' : ''}` : 'gives one back'}</span> : null}
              </span>
              <Button size="sm" aria-label={`One less for ${r.name}`} icon={<Minus size={14} />} onClick={() => setDraft({ ...draft, [r.entryId]: Math.max(1, (v ?? hole?.par ?? 4) - 1) })}>{''}</Button>
              <span className="w-10 text-center text-[22px] font-bold">{v ?? '-'}</span>
              <Button size="sm" aria-label={`One more for ${r.name}`} icon={<Plus size={14} />} onClick={() => setDraft({ ...draft, [r.entryId]: Math.min(20, (v ?? hole?.par ?? 4) + 1) })}>{''}</Button>
              {view.settings.scoring === 'stableford' ? (
                <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, [r.entryId]: null })}>Pick up</Button>
              ) : null}
            </div>
          );
        })}
        <Button variant="primary" block onClick={() => void save()}>Save hole {holeNo}</Button>
      </Card>
    </div>
  );
}

function Manage({ view, token, act, reload }: { view: GolfDayView; token: string; act: Act; reload: () => Promise<void> }) {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof fetchGolfEntries>> | null>(null);
  const gid = view.golfDay.id;
  useEffect(() => {
    fetchGolfEntries(token, gid).then(setEntries).catch(() => setEntries([]));
  }, [token, gid, view]);
  const s = view.settings;
  return (
    <div className="flex flex-col gap-4">
      {s.entryFee > 0 && !view.golfDay.waitapp_checkout_url ? (
        <Card className="flex flex-col gap-2 p-4">
          <p className="m-0 text-[14px]">Paid entry runs through WaitApp tickets. Put the golf day on sale so players can pay.</p>
          <Button variant="primary" onClick={() => void act(() => golfPost(token, '/open-entries', { competitionId: gid }), 'Entries are on sale on WaitApp.')}>Open paid entries</Button>
        </Card>
      ) : null}
      <Section title="Flights">
        <Card className="flex flex-col gap-2 p-4">
          <p className="m-0 text-[14px] text-muted">Group the confirmed players into flights of three or four by handicap{s.startType === 'shotgun' ? ', each starting on its own hole' : ', each with a tee time'}. Players are told their group and time.</p>
          <Button onClick={() => void act(() => golfPost(token, '/flights', { competitionId: gid, mode: 'auto' }), 'Flights are out.')}>{view.flights.length ? 'Rebuild flights' : 'Make flights'}</Button>
        </Card>
      </Section>
      <Section title="Entries" count={entries?.length ?? 0}>
        <Card>
          {(entries ?? []).map((e) => (
            <div key={e.entryId} className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[14px] last:border-0">
              <span className="flex-1">{e.name} <span className="text-muted">· {e.handicapIndex}</span></span>
              <span className="text-[13px] text-muted">{e.phone}</span>
              <Badge tone={e.status === 'confirmed' ? 'brand' : 'muted'}>{e.status === 'pending_payment' ? 'paying' : e.status}</Badge>
            </div>
          ))}
        </Card>
      </Section>
      {s.sideContests.length ? (
        <Section title="Side contests">
          <Card className="flex flex-col gap-3 p-4">
            {s.sideContests.map((c) => (
              <Field key={`${c.type}${c.hole}`} label={`${SIDE_CONTEST_LABELS[c.type]}, hole ${c.hole}`}>
                <select
                  className={fieldCls}
                  defaultValue=""
                  onChange={(e) => void act(() => golfPost(token, '/side-result', { competitionId: gid, type: c.type, hole: c.hole, entryId: e.target.value || null }), 'Saved.')}
                >
                  <option value="">Choose the winner</option>
                  {view.field.map((f) => <option key={f.entryId} value={f.entryId}>{f.name}</option>)}
                </select>
              </Field>
            ))}
          </Card>
        </Section>
      ) : null}
      <Section title="Circle">
        <PublishToCircle competitionId={gid} circleId={view.golfDay.circle_id} token={token} onChanged={() => void reload()} />
      </Section>
      {!view.published ? (
        <Section title="Results">
          <Card className="flex flex-col gap-2 p-4">
            <p className="m-0 text-[14px] text-muted">Publishing locks every card, tells the players and posts to the circle. Correct any card first from the Scorecard tab.</p>
            <Button variant="primary" onClick={() => void act(() => golfPost(token, '/publish', { competitionId: gid }), 'Results published.')}>Publish results</Button>
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
