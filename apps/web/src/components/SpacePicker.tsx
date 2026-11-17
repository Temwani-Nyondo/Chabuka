import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Repeat } from 'lucide-react';
import { addDaysYmd, priceLine, venueYmd } from '@chabuka/shared';
import type { SpaceSlot } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchAvailability, fetchSpaces, dayChip, longDay } from '../lib/venueBooking';
import type { AvailabilityView, SpacesResult } from '../lib/venueBooking';
import { fetchMyTeams } from '../lib/teams';
import type { MyTeam } from '../lib/teams';
import { fetchMyMatches } from '../lib/matches';
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, Sheet, Skeleton, cx } from './ui';
import { Field, fieldCls } from './CompetitionForms';

// Book a space: one picker for every venue. A Chabuka-only venue's request goes to the owner (pay at the venue if it
// has a price); a WaitApp-linked venue's goes to WaitApp, which takes the payment. Same screens either way.

interface Made {
  id: string;
  date: string;
  status: string;
  checkoutUrl: string | null;
}

type Result =
  | { state: 'needs_confirm'; free: string[]; taken: string[] }
  | { state: 'requested'; linked: boolean; groupId: string | null; made: Made[]; failed: string[] };

export default function SpacePicker({
  venueId,
  fixed,
  onBooked,
}: {
  venueId: string;
  // Booking for a fixture: the competition screen passes it and the request is tied to it.
  fixed?: { fixtureId?: string; matchId?: string; date?: string };
  onBooked?: () => void;
}) {
  const { session, user } = useAuth();
  const token = session?.access_token;
  const today = venueYmd(new Date());
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysYmd(today, i)), [today]);
  const [info, setInfo] = useState<SpacesResult | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [date, setDate] = useState(fixed?.date && fixed.date >= today ? fixed.date : today);
  const [av, setAv] = useState<AvailabilityView | null>(null);
  const [loadingAv, setLoadingAv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<SpaceSlot | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchSpaces(token, venueId)
      .then((r) => {
        setInfo(r);
        setSpaceId((cur) => cur ?? r.spaces[0]?.id ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the spaces.'));
  }, [token, venueId]);

  useEffect(() => {
    if (!token || !spaceId) return;
    setLoadingAv(true);
    setAv(null);
    fetchAvailability(token, venueId, spaceId, date)
      .then(setAv)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load free times.'))
      .finally(() => setLoadingAv(false));
  }, [token, venueId, spaceId, date]);

  if (error && !info) return <ErrorNote>{error}</ErrorNote>;
  if (!info) return <Skeleton className="h-40" />;
  if (info.spaces.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={22} />}
        title="Online booking is not set up yet"
        body="This venue has not listed its pitches or courts on Chabuka. Contact them directly for now."
      />
    );
  }
  const space = info.spaces.find((s) => s.id === spaceId) ?? info.spaces[0]!;

  return (
    <div className="flex flex-col gap-3">
      {info.spaces.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a space">
          {info.spaces.map((s) => (
            <Chip key={s.id} on={s.id === space.id} onClick={() => setSpaceId(s.id)}>
              {s.name}
            </Chip>
          ))}
        </div>
      ) : null}
      <Card className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-bold">{space.name}</p>
            <p className="m-0 text-[13px] text-muted">
              {[space.surface, space.size_note, space.unit_count > 1 ? `${space.unit_count} available at once` : null].filter(Boolean).join(' · ') || 'Book by the hour'}
            </p>
          </div>
          <Badge tone={space.hourly_price || space.tee?.pricePerPlayer ? 'neutral' : 'brand'}>
            {space.booking_kind === 'tee'
              ? space.tee?.pricePerPlayer ? `${space.currency ?? 'ZMW'} ${space.tee.pricePerPlayer} per player` : 'Free'
              : space.hourly_price ? `${space.currency ?? ''} ${space.hourly_price}/hr`.trim() : 'Free'}
          </Badge>
        </div>
      </Card>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Choose a day">
        {days.map((d) => {
          const c = dayChip(d);
          const on = d === date;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDate(d)}
              aria-pressed={on}
              className={cx(
                'flex h-16 w-14 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border text-[12px] font-semibold',
                on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink hover:bg-surface-2',
              )}
            >
              <span className={on ? '' : 'text-muted'}>{d === today ? 'Today' : c.dow}</span>
              <span className="text-[18px] font-bold leading-tight">{c.day}</span>
            </button>
          );
        })}
      </div>

      <div>
        <p className="m-0 mb-2 text-[13px] font-semibold text-muted">{longDay(date)}</p>
        {loadingAv ? (
          <Skeleton className="h-24" />
        ) : !av ? null : av.closed ? (
          <p className="m-0 text-[14px] text-muted">Closed this day.</p>
        ) : av.slots.length === 0 ? (
          <p className="m-0 text-[14px] text-muted">Nothing free this day. Try another day.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {av.slots.map((s) => (
              <button
                key={s.start}
                type="button"
                onClick={() => setPick(s)}
                className="flex h-12 cursor-pointer flex-col items-center justify-center rounded-xl border border-line bg-surface text-[14px] font-bold text-ink hover:border-brand hover:bg-brand-soft"
              >
                {s.start}
                {av.tee ? (
                  <span className="text-[11px] font-semibold text-muted">{s.unitsFree} {s.unitsFree === 1 ? 'spot' : 'spots'}</span>
                ) : space.unit_count > 1 ? (
                  <span className="text-[11px] font-semibold text-muted">{s.unitsFree} free</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {pick && token && user ? (
        <BookingSheet
          token={token}
          userId={user.id}
          venueId={venueId}
          space={space}
          date={date}
          slot={pick}
          av={av}
          linked={info.linked}
          fixed={fixed}
          onClose={() => setPick(null)}
          onDone={() => {
            setPick(null);
            onBooked?.();
            if (spaceId) fetchAvailability(token, venueId, spaceId, date).then(setAv).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function BookingSheet({
  token,
  userId,
  venueId,
  space,
  date,
  slot,
  av,
  linked,
  fixed,
  onClose,
  onDone,
}: {
  token: string;
  userId: string;
  venueId: string;
  space: SpacesResult['spaces'][number];
  date: string;
  slot: SpaceSlot;
  av: AvailabilityView | null;
  linked: boolean;
  fixed?: { fixtureId?: string; matchId?: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [hours, setHours] = useState(1);
  // Golf tee sheet: how many golfers (up to the spots left at this tee time).
  const tee = av?.tee ?? null;
  const [players, setPlayers] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [teamId, setTeamId] = useState('');
  const [matchId, setMatchId] = useState(fixed?.matchId ?? '');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [games, setGames] = useState<{ id: string; title: string; starts_at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetchMyTeams(userId).then(setTeams).catch(() => setTeams([]));
    if (!fixed) {
      fetchMyMatches(userId)
        .then((list) =>
          setGames(
            list
              .filter((l) => l.match.organiser_id === userId)
              .map((l) => ({ id: l.match.id, title: l.match.title, starts_at: l.match.starts_at })),
          ),
        )
        .catch(() => setGames([]));
    }
  }, [userId, fixed]);

  const maxHours = tee ? 0 : Math.min(3, slot.maxHours);
  const price = tee
    ? tee.pricePerPlayer
      ? `${av?.currency === 'ZMW' || !av?.currency ? 'K' : `${av.currency} `}${tee.pricePerPlayer * players}, paid at the course`
      : 'Free'
    : priceLine({ hourly_price: av?.price ?? space.hourly_price, currency: av?.currency ?? space.currency }, hours, linked);
  const endLabel = (() => {
    const [h, m] = slot.start.split(':').map(Number) as [number, number];
    return `${String((h + hours) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();

  const send = async (skipTaken: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await runAction<Result>(
        'request_space',
        {
          venueId,
          spaceId: space.id,
          date,
          startTime: slot.start,
          hours: tee ? 1 : hours,
          ...(tee ? { players } : {}),
          weeks: repeat ? weeks : 1,
          ...(teamId ? { teamId } : {}),
          ...(matchId ? { matchId } : {}),
          ...(fixed?.fixtureId ? { fixtureId: fixed.fixtureId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(linked ? { name: name.trim(), phone: phone.trim() } : {}),
          skipTaken,
        },
        token,
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  if (result?.state === 'requested') {
    const pay = result.made.filter((m) => m.checkoutUrl);
    return (
      <Sheet open onClose={onDone} title={result.made.length > 1 ? `${result.made.length} weeks requested` : 'Request sent'}>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[15px]">
            {pay.length > 0
              ? 'Held for you. Pay now to keep it.'
              : linked
                ? 'The venue answers through WaitApp. You will get a notification with the payment link once they accept.'
                : 'The venue will confirm. You will get a notification, and your booking code appears under You, My bookings.'}
          </p>
          {result.failed.length > 0 ? <ErrorNote>{`These weeks could not be booked: ${result.failed.map(longDay).join(', ')}.`}</ErrorNote> : null}
          {pay.map((m) => (
            <a key={m.id} href={m.checkoutUrl!} target="_blank" rel="noreferrer" className="font-bold text-brand-text">
              Pay for {longDay(m.date)} on WaitApp
            </a>
          ))}
          <Button variant="primary" block onClick={onDone}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={`${space.name}, ${longDay(date)}`}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="m-0 text-[13px] font-semibold text-muted">{tee ? 'Tee time' : 'Time'}</p>
          <p className="m-0 text-[22px] font-bold">{tee ? slot.start : `${slot.start} to ${endLabel}`}</p>
        </div>
        {tee ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Golfers">
            {Array.from({ length: Math.max(1, slot.unitsFree) }, (_, i) => i + 1).map((n) => (
              <Chip key={n} on={n === players} onClick={() => setPlayers(n)}>
                {n} {n === 1 ? 'golfer' : 'golfers'}
              </Chip>
            ))}
          </div>
        ) : null}
        {maxHours > 1 ? (
          <div className="flex gap-2" role="group" aria-label="How long">
            {Array.from({ length: maxHours }, (_, i) => i + 1).map((h) => (
              <Chip key={h} on={h === hours} onClick={() => setHours(h)}>
                {h} hour{h === 1 ? '' : 's'}
              </Chip>
            ))}
          </div>
        ) : null}

        <label className="flex items-center gap-3 rounded-xl border border-line p-3">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
          <Repeat size={18} className="text-muted" />
          <span className="flex-1 text-[14px] font-semibold">Same time every week</span>
          {repeat ? (
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-[14px]" aria-label="Number of weeks">
              {[2, 3, 4, 6, 8, 10, 12].map((w) => (
                <option key={w} value={w}>
                  {w} weeks
                </option>
              ))}
            </select>
          ) : null}
        </label>

        {teams.length > 0 ? (
          <Field label="For a team (optional)">
            <select className={fieldCls} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Just me</option>
              {teams.map((t) => (
                <option key={t.team.id} value={t.team.id}>
                  {t.team.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {!fixed && games.length > 0 ? (
          <Field label="For a game you host (optional)">
            <select className={fieldCls} value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">No game</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {linked ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Your name">
              <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            </Field>
            <Field label="Phone for the venue">
              <input className={fieldCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" autoComplete="tel" />
            </Field>
          </div>
        ) : null}
        <Field label="Note for the venue (optional)">
          <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. 10 players, need bibs" />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-[14px]">
          <span className="text-muted">{repeat ? `Each week` : 'Price'}</span>
          <span className="font-bold">{price}</span>
        </div>

        {result?.state === 'needs_confirm' ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <p className="m-0 text-[14px] font-semibold">
              {result.taken.length} of {result.taken.length + result.free.length} weeks are already taken:
            </p>
            <p className="m-0 text-[13px] text-muted">{result.taken.map(longDay).join(', ')}</p>
            <Button variant="primary" block disabled={busy} onClick={() => void send(true)}>
              Request the {result.free.length} free week{result.free.length === 1 ? '' : 's'}
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" block disabled={busy || (linked && (name.trim().length < 2 || phone.trim().length < 6))} onClick={() => void send(false)}>
            {busy ? 'Sending…' : av?.bookingMode === 'instant' ? 'Book and pay' : repeat ? `Request ${weeks} weeks` : 'Request to book'}
          </Button>
        )}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </Sheet>
  );
}
