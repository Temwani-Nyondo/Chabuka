import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, Inbox, Settings2, Sun, TrendingUp, X } from 'lucide-react';
import { addDaysYmd, venueTime, venueYmd, weekdayOf, DAY_KEYS, DAY_LABELS } from '@chabuka/shared';
import type { HourCell, Venue } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchVenueById } from '../lib/venues';
import { fetchCalendar, fetchRequests, fetchStats, fetchToday, longDay } from '../lib/venueBooking';
import type { CalBooking, CalendarView, RequestCard, VenueStats } from '../lib/venueBooking';
import VenueCalendar, { CalendarLegend } from '../components/VenueCalendar';
import { ClosuresCard, HoursCard, SpacesCard, StaffCard, WaitAppCard } from '../components/VenueSetup';
import VenueEditor from '../components/VenueEditor';
import { GolfCoursesCard } from '../components/golf/CourseEditor';
import { Badge, Button, Card, EmptyState, ErrorNote, ListRow, Meter, PageHeader, Section, Segmented, Sheet, Skeleton, StatTile } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

// Run a venue: calendar, requests, today's check-ins, setup and numbers. One screen for a Chabuka-only venue and a
// WaitApp-linked one: the API sends every change to wherever the venue's calendar lives.

type Tab = 'calendar' | 'requests' | 'today' | 'setup' | 'numbers';

function mondayOf(ymd: string): string {
  return addDaysYmd(ymd, -((weekdayOf(ymd) + 6) % 7));
}

export default function VenueManagePage() {
  const { venueId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'calendar';
  const { session, user } = useAuth();
  const token = session?.access_token ?? '';
  const today = venueYmd(new Date());
  const [venue, setVenue] = useState<Venue | null>(null);
  const [from, setFrom] = useState(mondayOf(today));
  const [date, setDate] = useState(today);
  const [cal, setCal] = useState<CalendarView | null>(null);
  const [requests, setRequests] = useState<RequestCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [v, c, r] = await Promise.all([fetchVenueById(venueId), fetchCalendar(token, venueId, from, 7), fetchRequests(token, venueId)]);
      setVenue(v);
      setCal(c);
      setRequests(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the venue.');
    }
  }, [token, venueId, from]);

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

  const setTab = (t: Tab) => setParams((p) => {
    p.set('tab', t);
    return p;
  });

  const waiting = requests?.length ?? 0;
  const isOwner = !!venue && venue.owner_id === user?.id;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-24 pt-4">
      <PageHeader
        title={venue?.name ?? 'Venue'}
        back="/venues/dashboard"
        sub={
          cal ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {cal.linked ? <Badge tone="brand">Linked to WaitApp</Badge> : <Badge tone="muted">Chabuka bookings</Badge>}
              {venue?.status === 'pending' ? <Badge tone="hl">Waiting for approval</Badge> : null}
            </span>
          ) : undefined
        }
      />
      <Segmented<Tab>
        label="Venue sections"
        value={tab}
        onChange={setTab}
        className="overflow-x-auto"
        options={[
          { value: 'calendar', label: <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} />Calendar</span> },
          { value: 'requests', label: <span className="inline-flex items-center gap-1.5"><Inbox size={15} />Requests{waiting ? ` ${waiting}` : ''}</span> },
          { value: 'today', label: <span className="inline-flex items-center gap-1.5"><Sun size={15} />Today</span> },
          { value: 'setup', label: <span className="inline-flex items-center gap-1.5"><Settings2 size={15} />Setup</span> },
          { value: 'numbers', label: <span className="inline-flex items-center gap-1.5"><TrendingUp size={15} />Numbers</span> },
        ]}
      />
      {notice ? <p className="m-0 rounded-xl bg-brand-soft px-3 py-2 text-[14px] font-semibold text-brand-text">{notice}</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {!cal ? (
        <Skeleton className="h-80" />
      ) : tab === 'calendar' ? (
        <CalendarTab venueId={venueId} cal={cal} from={from} date={date} token={token} act={act} onWeek={(f) => { setFrom(f); setDate(f < today && addDaysYmd(f, 6) >= today ? today : f); }} onDate={setDate} onSetup={() => setTab('setup')} />
      ) : tab === 'requests' ? (
        <RequestsTab venueId={venueId} requests={requests ?? []} token={token} act={act} />
      ) : tab === 'today' ? (
        <TodayTab venueId={venueId} token={token} act={act} />
      ) : tab === 'setup' ? (
        <div className="flex flex-col gap-6">
          <SpacesCard venueId={venueId} cal={cal} token={token} act={act} venueSports={venue?.sports ?? []} />
          <HoursCard venueId={venueId} hours={cal.hours} token={token} act={act} />
          {(venue?.sports ?? []).some((sp) => sp.toLowerCase() === 'golf') ? <GolfCoursesCard venueId={venueId} token={token} canEdit /> : null}
          <ClosuresCard venueId={venueId} cal={cal} token={token} act={act} />
          <StaffCard venueId={venueId} token={token} act={act} />
          <WaitAppCard venueId={venueId} linked={cal.linked} isOwner={isOwner} token={token} act={act} onChanged={() => void load()} />
          {isOwner && venue ? (
            <Section title="Venue details">
              <Card className="p-4">
                <VenueEditor venue={venue} token={token} onSaved={() => void load()} />
              </Card>
            </Section>
          ) : null}
        </div>
      ) : (
        <NumbersTab venueId={venueId} token={token} />
      )}
    </div>
  );
}

// --- Calendar ---------------------------------------------------------------------------

function CalendarTab({
  venueId,
  cal,
  from,
  date,
  token,
  act,
  onWeek,
  onDate,
  onSetup,
}: {
  venueId: string;
  cal: CalendarView;
  from: string;
  date: string;
  token: string;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onWeek: (from: string) => void;
  onDate: (d: string) => void;
  onSetup: () => void;
}) {
  const [cell, setCell] = useState<{ spaceId: string; cell: HourCell } | null>(null);
  if (cal.spaces.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={22} />}
        title="Add your first space"
        body="List each pitch, court or hall, set your opening hours, and players can start booking."
        action={<Button variant="primary" onClick={onSetup}>Set up spaces</Button>}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" onClick={() => onWeek(addDaysYmd(from, -7))}>Previous week</Button>
        <strong className="text-[14px]">Week of {longDay(from)}</strong>
        <Button size="sm" onClick={() => onWeek(addDaysYmd(from, 7))}>Next week</Button>
      </div>
      <VenueCalendar cal={cal} from={from} date={date} onDate={onDate} onCell={(spaceId, c) => setCell({ spaceId, cell: c })} />
      <CalendarLegend />
      {cell ? (
        <CellSheet venueId={venueId} cal={cal} date={date} spaceId={cell.spaceId} cell={cell.cell} token={token} act={act} onClose={() => setCell(null)} />
      ) : null}
    </div>
  );
}

function bookingLine(b: CalBooking, teams: Record<string, string>): string {
  return [
    `${venueTime(b.startsAt)} to ${venueTime(b.endsAt)}`,
    b.unitNo ? `unit ${b.unitNo}` : null,
    b.teamId && teams[b.teamId] ? teams[b.teamId] : null,
    b.source === 'walk_in' ? 'walk-in' : b.source === 'waitapp' ? 'booked on WaitApp' : null,
    b.paid ? 'paid' : b.awaitingPayment ? 'payment due' : b.amount ? `${b.currency ?? ''} ${b.amount} at the venue`.trim() : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function CellSheet({
  venueId,
  cal,
  date,
  spaceId,
  cell,
  token,
  act,
  onClose,
}: {
  venueId: string;
  cal: CalendarView;
  date: string;
  spaceId: string;
  cell: HourCell;
  token: string;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const space = cal.spaces.find((s) => s.id === spaceId)!;
  const here = cal.bookings.filter((b) => cell.bookingIds.includes(b.id));
  const closure = cal.closures.find((c) => (!c.space_id || c.space_id === spaceId) && new Date(c.starts_at) < new Date(new Date(cell.startsAt).getTime() + 3_600_000) && new Date(c.ends_at) > new Date(cell.startsAt));
  const [walkIn, setWalkIn] = useState(false);
  const [guest, setGuest] = useState('');
  const [phone, setPhone] = useState('');
  const [hours, setHours] = useState(1);
  const canBook = cell.state !== 'past' && cell.state !== 'closed' && cell.booked < cell.units;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (await act(fn, ok)) onClose();
  };

  return (
    <Sheet open onClose={onClose} title={`${space.name}, ${longDay(date)} ${cell.start}`}>
      <div className="flex flex-col gap-3">
        {closure ? (
          <Card className="flex items-center gap-3 p-3">
            <span className="flex-1 text-[14px]">Closed: {closure.reason}</span>
            <Button size="sm" onClick={() => void run(() => runAction('remove_closure', { venueId, closureId: closure.id }, token), 'Closure removed.')}>
              Reopen
            </Button>
          </Card>
        ) : null}
        {here.length > 0 ? (
          <Card>
            {here.map((b) => (
              <div key={b.id} className="flex flex-col gap-2 border-line px-3.5 py-3 [&+&]:border-t">
                <div className="flex items-center gap-2">
                  <strong className="flex-1">{b.who}</strong>
                  <Badge tone={b.status === 'confirmed' ? 'brand' : 'hl'}>{b.status === 'confirmed' ? 'Booked' : 'Requested'}</Badge>
                </div>
                <span className="text-[13px] text-muted">{bookingLine(b, cal.teams)}</span>
                {b.phone ? <a href={`tel:${b.phone}`} className="text-[13px] font-semibold text-brand-text">{b.phone}</a> : null}
                {b.note ? <span className="text-[13px]">"{b.note}"</span> : null}
                {b.code ? <span className="text-[13px] text-muted">Code {b.code}</span> : null}
                <div className="flex flex-wrap gap-2">
                  {b.status === 'requested' ? (
                    <>
                      <Button size="sm" variant="primary" icon={<Check size={15} />} onClick={() => void run(() => runAction('respond_space_booking', { venueId, ...(b.groupId ? { groupId: b.groupId } : { bookingId: b.id }), decision: 'confirm', mode: 'free_only' }, token), 'Accepted.')}>
                        Accept{b.groupId ? ' all weeks' : ''}
                      </Button>
                      <Button size="sm" variant="danger" icon={<X size={15} />} onClick={() => void run(() => runAction('respond_space_booking', { venueId, ...(b.groupId ? { groupId: b.groupId } : { bookingId: b.id }), decision: 'decline' }, token), 'Declined.')}>
                        Decline
                      </Button>
                    </>
                  ) : null}
                  {b.status === 'confirmed' && !cal.linked && !b.checkedIn && venueYmd(b.startsAt) === venueYmd(new Date()) ? (
                    <Button size="sm" onClick={() => void run(() => runAction('check_in_space_booking', { venueId, bookingId: b.id }, token), 'Checked in.')}>
                      Check in
                    </Button>
                  ) : null}
                  {b.status === 'confirmed' && new Date(b.startsAt) > new Date() ? (
                    <Button size="sm" variant="danger" onClick={() => void run(() => runAction('cancel_space_booking', { venueId, bookingId: b.id, reason: 'Cancelled by the venue' }, token), 'Booking cancelled. The player was told.')}>
                      Cancel booking
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </Card>
        ) : null}

        {canBook && !walkIn ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setWalkIn(true)}>
              Book for someone
            </Button>
            {!closure ? (
              <Button
                onClick={() =>
                  void run(
                    () =>
                      runAction(
                        'add_closure',
                        { venueId, spaceId, startsAt: cell.startsAt, endsAt: new Date(new Date(cell.startsAt).getTime() + 3_600_000).toISOString(), reason: 'Not available' },
                        token,
                      ),
                    'Hour closed.',
                  )
                }
              >
                Close this hour
              </Button>
            ) : null}
          </div>
        ) : null}

        {walkIn ? (
          <div className="flex flex-col gap-3">
            <Field label="Name">
              <input className={fieldCls} value={guest} maxLength={80} onChange={(e) => setGuest(e.target.value)} placeholder="Who is it for?" />
            </Field>
            <Field label="Phone (optional)">
              <input className={fieldCls} value={phone} maxLength={30} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Hours">
              <select className={fieldCls} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {[1, 2, 3, 4].map((h) => (
                  <option key={h} value={h}>
                    {h} hour{h === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="primary"
              block
              disabled={guest.trim().length < 2}
              onClick={() =>
                void run(
                  () =>
                    runAction(
                      'walk_in_booking',
                      { venueId, spaceId, date, startTime: cell.start, hours, guestName: guest.trim(), ...(phone.trim() ? { guestPhone: phone.trim() } : {}) },
                      token,
                    ),
                  'Booked.',
                )
              }
            >
              Save booking
            </Button>
          </div>
        ) : null}
        {!canBook && here.length === 0 && !closure ? <p className="m-0 text-[14px] text-muted">This hour has passed.</p> : null}
      </div>
    </Sheet>
  );
}

// --- Requests ---------------------------------------------------------------------------

function RequestsTab({
  venueId,
  requests,
  token,
  act,
}: {
  venueId: string;
  requests: RequestCard[];
  token: string;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (requests.length === 0) {
    return <EmptyState icon={<Inbox size={22} />} title="No requests waiting" body="New booking requests show here, from Chabuka and from WaitApp." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {requests.map((r) => {
        const block = r.dates.length > 1;
        const free = r.dates.length - r.clashes.length;
        const target = r.groupId ? { groupId: r.groupId } : { bookingId: r.bookingIds[0] };
        const day = DAY_LABELS[DAY_KEYS[r.weekday]!];
        return (
          <Card key={r.key} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-bold">
                  {r.who}
                  {r.team ? <span className="font-semibold text-muted"> for {r.team}</span> : null}
                </p>
                <p className="m-0 text-[14px]">
                  {r.spaceName} · {block ? `${day}s` : longDay(r.dates[0]!)} {r.start} to {r.end}
                  {block ? ` · ${r.dates.length} weeks` : ''}
                </p>
              </div>
              {r.source === 'waitapp' ? <Badge tone="muted">From WaitApp</Badge> : null}
            </div>
            {block ? <p className="m-0 text-[13px] text-muted">{r.dates.map((d) => longDay(d)).join(', ')}</p> : null}
            {r.clashes.length > 0 ? (
              <p className="m-0 text-[13px] font-semibold text-danger">
                {r.clashes.length === r.dates.length ? 'That time is already taken or closed.' : `${r.clashes.length} clash: ${r.clashes.map(longDay).join(', ')}`}
              </p>
            ) : null}
            {r.note ? <p className="m-0 text-[14px]">"{r.note}"</p> : null}
            <input className={fieldCls} placeholder="Reply note (optional)" maxLength={300} value={notes[r.key] ?? ''} onChange={(e) => setNotes({ ...notes, [r.key]: e.target.value })} />
            <div className="flex flex-wrap gap-2">
              {r.clashes.length === 0 ? (
                <Button variant="primary" icon={<Check size={16} />} onClick={() => void act(() => runAction('respond_space_booking', { venueId, ...target, decision: 'confirm', mode: 'all', note: notes[r.key] || undefined }, token), block ? 'All weeks accepted.' : 'Accepted.')}>
                  {block ? 'Accept all' : 'Accept'}
                </Button>
              ) : free > 0 ? (
                <Button variant="primary" icon={<Check size={16} />} onClick={() => void act(() => runAction('respond_space_booking', { venueId, ...target, decision: 'confirm', mode: 'free_only', note: notes[r.key] || undefined }, token), `Accepted ${free} week${free === 1 ? '' : 's'}.`)}>
                  Accept the {free} free
                </Button>
              ) : null}
              <Button variant="danger" icon={<X size={16} />} onClick={() => void act(() => runAction('respond_space_booking', { venueId, ...target, decision: 'decline', note: notes[r.key] || undefined }, token), 'Declined.')}>
                Decline
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// --- Today ------------------------------------------------------------------------------

function TodayTab({ venueId, token, act }: { venueId: string; token: string; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean> }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchToday>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchToday(token, venueId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load today's bookings."));
  }, [token, venueId]);
  useEffect(load, [load]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-40" />;
  const spaceName = new Map(data.spaces.map((s) => [s.id, s.name]));
  if (data.bookings.length === 0) return <EmptyState icon={<Sun size={22} />} title="Nothing booked today" body={longDay(data.date)} />;
  return (
    <Section title={longDay(data.date)} count={data.bookings.length}>
      <Card>
        {data.bookings.map((b) => (
          <ListRow
            key={b.id}
            title={`${venueTime(b.startsAt)} ${b.who}`}
            sub={[spaceName.get(b.spaceId ?? '') ?? 'Space', bookingLine(b, data.teams), b.code ? `code ${b.code}` : null].filter(Boolean).join(' · ')}
            trailing={
              b.checkedIn ? (
                <Badge tone="brand">In</Badge>
              ) : !data.linked ? (
                <Button size="sm" onClick={() => void act(() => runAction('check_in_space_booking', { venueId, bookingId: b.id }, token), 'Checked in.').then(load)}>
                  Check in
                </Button>
              ) : null
            }
          />
        ))}
      </Card>
      {data.linked ? <p className="m-0 text-[13px] text-muted">This venue checks people in with the WaitApp scanner.</p> : null}
    </Section>
  );
}

// --- Numbers ----------------------------------------------------------------------------

function NumbersTab({ venueId, token }: { venueId: string; token: string }) {
  const [s, setS] = useState<VenueStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchStats(token, venueId)
      .then(setS)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the numbers.'));
  }, [token, venueId]);
  const change = useMemo(() => (s && s.lastWeekHours > 0 ? Math.round(((s.thisWeekHours - s.lastWeekHours) / s.lastWeekHours) * 100) : null), [s]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!s) return <Skeleton className="h-40" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={`${Math.round(s.thisWeekHours)}h`} label="Booked this week" />
        <StatTile value={`${Math.round(s.lastWeekHours)}h`} label="Last week" />
        <StatTile value={`${Math.round(s.fillRate * 100)}%`} label="Hours filled" />
        <StatTile value={s.waiting} label="Requests waiting" />
      </div>
      <Card className="flex flex-col gap-2 p-4">
        <strong>Fill rate this week</strong>
        <Meter value={s.thisWeekHours} max={Math.max(1, s.openHours)} />
        <span className="text-[13px] text-muted">
          {Math.round(s.thisWeekHours)} of {Math.round(s.openHours)} open hours across all spaces
          {change != null ? ` · ${change >= 0 ? '+' : ''}${change}% on last week` : ''}
        </span>
      </Card>
      <Section title="Busiest start times">
        {s.busiest.length === 0 ? (
          <Card className="p-4 text-[14px] text-muted">Not enough bookings yet.</Card>
        ) : (
          <Card>
            {s.busiest.map((b) => (
              <ListRow key={b.hour} title={b.hour} trailing={<span className="text-[14px] font-bold">{b.count}</span>} />
            ))}
          </Card>
        )}
      </Section>
    </div>
  );
}
