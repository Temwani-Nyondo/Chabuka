import { useEffect, useState } from 'react';
import { Link2, Plus, Trash2, UserPlus } from 'lucide-react';
import { DAY_LABELS, venueInstant, venueTime, venueYmd } from '@chabuka/shared';
import type { DayKey, WeeklyHours } from '@chabuka/shared';
import { runAction } from '../lib/api';
import { fetchStaff, fetchWaitAppInfo, setWaitAppLink, startWaitAppConnect } from '../lib/venueBooking';
import type { CalendarView, ClosureView, SpaceView, StaffView, WaitAppVenueInfo } from '../lib/venueBooking';
import { Badge, Button, ButtonLink, Card, ErrorNote, ListRow, Section, Segmented, Sheet } from './ui';
import { Field, ImageField, fieldCls } from './CompetitionForms';

// Venue setup: spaces, opening hours, closures, staff and the WaitApp link. Every change goes through the API, which
// writes to Chabuka for a Chabuka-only venue and to WaitApp for a linked one, so both apps always agree.

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

// --- Spaces -----------------------------------------------------------------------------

interface SpaceForm {
  name: string;
  sports: string;
  surface: string;
  sizeNote: string;
  unitCount: number;
  price: string;
  currency: string;
  bookingMode: 'request' | 'instant';
  photo: string | null;
  active: boolean;
  /** Golf: sold as tee times instead of by the hour. */
  kind: 'hourly' | 'tee';
  teeInterval: number;
  teePlayers: number;
}

const blankSpace = (sports: string[]): SpaceForm => ({
  name: '',
  sports: sports.join(', '),
  surface: '',
  sizeNote: '',
  unitCount: 1,
  price: '',
  currency: 'ZMW',
  bookingMode: 'request',
  photo: null,
  active: true,
  kind: sports.some((s) => s.toLowerCase() === 'golf') ? 'tee' : 'hourly',
  teeInterval: 10,
  teePlayers: 4,
});

export function SpacesCard({ venueId, cal, token, act, venueSports }: { venueId: string; cal: CalendarView; token: string; act: Act; venueSports: string[] }) {
  const [editing, setEditing] = useState<SpaceView | 'new' | null>(null);
  const [form, setForm] = useState<SpaceForm>(blankSpace(venueSports));

  const open = (s: SpaceView | 'new') => {
    setEditing(s);
    setForm(
      s === 'new'
        ? blankSpace(venueSports)
        : {
            name: s.name,
            sports: s.sports.join(', '),
            surface: s.surface ?? '',
            sizeNote: s.size_note ?? '',
            unitCount: s.unit_count,
            price: s.hourly_price != null ? String(s.hourly_price) : '',
            currency: s.currency ?? 'ZMW',
            bookingMode: s.booking_mode,
            photo: s.photos[0] ?? null,
            active: s.active,
            kind: s.booking_kind === 'tee' ? 'tee' : 'hourly',
            teeInterval: s.tee?.intervalMin ?? 10,
            teePlayers: s.tee?.playersPerSlot ?? 4,
            ...(s.booking_kind === 'tee' && s.tee?.pricePerPlayer != null ? { price: String(s.tee.pricePerPlayer) } : {}),
          },
    );
  };

  const save = async () => {
    const price = form.price.trim() ? Number(form.price) : null;
    const ok = await act(
      () =>
        runAction(
          'upsert_space',
          {
            venueId,
            ...(editing && editing !== 'new' ? { spaceId: editing.id } : {}),
            name: form.name.trim(),
            sports: form.sports.split(',').map((s) => s.trim()).filter(Boolean),
            ...(form.surface.trim() ? { surface: form.surface.trim() } : {}),
            ...(form.sizeNote.trim() ? { sizeNote: form.sizeNote.trim() } : {}),
            unitCount: form.unitCount,
            hourlyPrice: price != null && !Number.isNaN(price) ? price : null,
            ...(price ? { currency: form.currency.trim().toUpperCase() || 'ZMW' } : {}),
            bookingMode: form.bookingMode,
            photos: form.photo ? [form.photo] : [],
            active: form.active,
            bookingKind: form.kind,
            ...(form.kind === 'tee'
              ? { tee: { intervalMin: form.teeInterval, playersPerSlot: form.teePlayers, pricePerPlayer: price != null && !Number.isNaN(price) ? price : null } }
              : {}),
          },
          token,
        ),
      'Space saved.',
    );
    if (ok) setEditing(null);
  };

  return (
    <Section title="Spaces" count={cal.spaces.length} action={<Button size="sm" icon={<Plus size={16} />} onClick={() => open('new')}>Add a space</Button>}>
      {cal.spaces.length === 0 ? (
        <Card className="p-4 text-[14px] text-muted">Add each pitch, court or hall people can book. If you have two identical five-a-side pitches, add one space with 2 units.</Card>
      ) : (
        <Card>
          {cal.spaces.map((s) => (
            <ListRow
              key={s.id}
              onClick={() => open(s)}
              title={s.name}
              sub={[
                s.booking_kind === 'tee' && s.tee ? `Tee times every ${s.tee.intervalMin} min, up to ${s.tee.playersPerSlot}` : null,
                s.booking_kind !== 'tee' && s.unit_count > 1 ? `${s.unit_count} units` : null,
                s.booking_kind === 'tee'
                  ? s.tee?.pricePerPlayer ? `${s.currency ?? 'ZMW'} ${s.tee.pricePerPlayer} per player` : 'Free'
                  : s.hourly_price ? `${s.currency ?? ''} ${s.hourly_price}/hr`.trim() : 'Free',
                s.booking_mode === 'instant' ? 'Instant, paid up front' : 'You approve each request',
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={s.active ? null : <Badge tone="muted">Hidden</Badge>}
              chevron
            />
          ))}
        </Card>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New space' : 'Edit space'}>
        <div className="flex flex-col gap-3.5">
          <Field label="Name">
            <input className={fieldCls} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pitch 1, Court A, Main hall" />
          </Field>
          <Field label="Sports" hint="Separate with commas">
            <input className={fieldCls} value={form.sports} onChange={(e) => setForm({ ...form, sports: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Surface">
              <input className={fieldCls} value={form.surface} maxLength={40} onChange={(e) => setForm({ ...form, surface: e.target.value })} placeholder="Astro turf" />
            </Field>
            <Field label="Size">
              <input className={fieldCls} value={form.sizeNote} maxLength={60} onChange={(e) => setForm({ ...form, sizeNote: e.target.value })} placeholder="5-a-side" />
            </Field>
          </div>
          {!cal.linked && venueSports.some((sp) => sp.toLowerCase() === 'golf') ? (
            <Segmented
              label="How it is booked"
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v })}
              options={[
                { value: 'tee', label: 'Tee times' },
                { value: 'hourly', label: 'By the hour' },
              ]}
            />
          ) : null}
          {form.kind === 'tee' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minutes between tee times">
                <input className={fieldCls} type="number" min={6} max={20} value={form.teeInterval} onChange={(e) => setForm({ ...form, teeInterval: Math.max(6, Math.min(20, Number(e.target.value) || 10)) })} />
              </Field>
              <Field label="Golfers per tee time">
                <input className={fieldCls} type="number" min={1} max={4} value={form.teePlayers} onChange={(e) => setForm({ ...form, teePlayers: Math.max(1, Math.min(4, Number(e.target.value) || 4)) })} />
              </Field>
            </div>
          ) : (
            <Field label="Units" hint="How many of this space can be booked at the same time">
              <input className={fieldCls} type="number" min={1} max={20} value={form.unitCount} onChange={(e) => setForm({ ...form, unitCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
            </Field>
          )}
          {form.kind === 'tee' ? <p className="m-0 text-[13px] text-muted">Your closing time is the last tee time. Golfers pay at the course.</p> : null}
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <Field label={form.kind === 'tee' ? 'Green fee per player' : 'Price per hour'} hint={cal.linked ? 'Paid through WaitApp' : 'Leave empty if free. Players pay at the venue.'}>
              <input className={fieldCls} inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Currency">
              <input className={fieldCls} value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          {cal.linked ? (
            <Segmented
              label="How bookings are confirmed"
              value={form.bookingMode}
              onChange={(v) => setForm({ ...form, bookingMode: v })}
              options={[
                { value: 'request', label: 'You approve' },
                { value: 'instant', label: 'Instant, paid up front' },
              ]}
            />
          ) : null}
          <ImageField label="Photo" value={form.photo} folder="venues" wide onChange={(url) => setForm({ ...form, photo: url })} />
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-5 w-5" />
            Show to players
          </label>
          <div className="flex gap-2">
            <Button variant="primary" block disabled={form.name.trim().length === 0} onClick={() => void save()}>
              Save space
            </Button>
            {editing && editing !== 'new' ? (
              <Button
                variant="danger"
                icon={<Trash2 size={16} />}
                onClick={() =>
                  void act(() => runAction('delete_space', { venueId, spaceId: editing.id }, token), cal.linked ? 'Space hidden.' : 'Space deleted.').then((ok) => ok && setEditing(null))
                }
              >
                {cal.linked ? 'Hide' : 'Delete'}
              </Button>
            ) : null}
          </div>
        </div>
      </Sheet>
    </Section>
  );
}

// --- Opening hours ----------------------------------------------------------------------

const ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function HoursCard({ venueId, hours, token, act }: { venueId: string; hours: WeeklyHours; token: string; act: Act }) {
  const fill = (h: WeeklyHours) =>
    Object.fromEntries(ORDER.map((d) => [d, h[d] ?? { open: '06:00', close: '22:00', closed: Object.keys(h).length > 0 }])) as Required<WeeklyHours>;
  const [draft, setDraft] = useState<Required<WeeklyHours>>(fill(hours));
  useEffect(() => setDraft(fill(hours)), [hours]);
  const set = (d: DayKey, patch: Partial<{ open: string; close: string; closed: boolean }>) => setDraft({ ...draft, [d]: { ...draft[d], ...patch } });

  return (
    <Section title="Opening hours">
      <Card className="flex flex-col gap-2 p-3.5">
        {Object.keys(hours).length === 0 ? <p className="m-0 text-[13px] text-muted">Not set yet: players can book any hour until you save these.</p> : null}
        {ORDER.map((d) => (
          <div key={d} className="grid grid-cols-[90px_1fr] items-center gap-2 sm:grid-cols-[110px_1fr]">
            <label className="flex items-center gap-2 text-[14px] font-semibold">
              <input type="checkbox" checked={!draft[d].closed} onChange={(e) => set(d, { closed: !e.target.checked })} className="h-4 w-4" />
              {DAY_LABELS[d].slice(0, 3)}
            </label>
            {draft[d].closed ? (
              <span className="text-[14px] text-muted">Closed</span>
            ) : (
              <div className="flex items-center gap-2">
                <input type="time" step={3600} className={`${fieldCls} h-10`} value={draft[d].open} onChange={(e) => set(d, { open: e.target.value })} aria-label={`${DAY_LABELS[d]} opens`} />
                <span className="text-muted">to</span>
                <input type="time" step={3600} className={`${fieldCls} h-10`} value={draft[d].close} onChange={(e) => set(d, { close: e.target.value })} aria-label={`${DAY_LABELS[d]} closes`} />
              </div>
            )}
          </div>
        ))}
        <Button variant="primary" onClick={() => void act(() => runAction('set_hours', { venueId, hours: draft }, token), 'Opening hours saved.')}>
          Save hours
        </Button>
      </Card>
    </Section>
  );
}

// --- Closures ---------------------------------------------------------------------------

export function ClosuresCard({ venueId, cal, token, act }: { venueId: string; cal: CalendarView; token: string; act: Act }) {
  const [open, setOpen] = useState(false);
  const today = venueYmd(new Date());
  const [spaceId, setSpaceId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [fromTime, setFromTime] = useState('06:00');
  const [toDate, setToDate] = useState(today);
  const [toTime, setToTime] = useState('22:00');
  const [reason, setReason] = useState('');
  const [hit, setHit] = useState<string | null>(null);
  const upcoming = cal.closures.filter((c) => new Date(c.ends_at) > new Date());

  const save = async (cancelBookings: boolean) => {
    setHit(null);
    const body = {
      venueId,
      ...(spaceId ? { spaceId } : {}),
      startsAt: venueInstant(fromDate, fromTime).toISOString(),
      endsAt: venueInstant(toDate, toTime).toISOString(),
      reason: reason.trim(),
      cancelBookings,
    };
    try {
      await runAction('add_closure', body, token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not add the closure.';
      if (/falls? inside/.test(msg)) {
        setHit(msg);
        return;
      }
      await act(() => Promise.reject(e), '');
      return;
    }
    await act(() => Promise.resolve(), cancelBookings ? 'Closed. The players were told why.' : 'Closure added.');
    setOpen(false);
    setReason('');
  };

  const label = (c: ClosureView) =>
    `${venueYmd(c.starts_at)} ${venueTime(c.starts_at)} to ${venueYmd(c.ends_at) === venueYmd(c.starts_at) ? '' : `${venueYmd(c.ends_at)} `}${venueTime(c.ends_at)}`;

  return (
    <Section title="Closures" action={<Button size="sm" icon={<Plus size={16} />} onClick={() => setOpen(true)}>Add a closure</Button>}>
      {upcoming.length === 0 ? (
        <Card className="p-4 text-[14px] text-muted">No closures in this week. Add one for maintenance, a holiday or a private event.</Card>
      ) : (
        <Card>
          {upcoming.map((c) => (
            <ListRow
              key={c.id}
              title={c.reason ?? 'Closed'}
              sub={`${c.space_id ? (cal.spaces.find((s) => s.id === c.space_id)?.name ?? 'Space') : 'Whole venue'} · ${label(c)}`}
              trailing={
                <Button size="sm" variant="ghost" aria-label="Remove closure" onClick={() => void act(() => runAction('remove_closure', { venueId, closureId: c.id }, token), 'Closure removed.')}>
                  <Trash2 size={16} />
                </Button>
              }
            />
          ))}
        </Card>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a closure">
        <div className="flex flex-col gap-3.5">
          <Field label="What is closed">
            <select className={fieldCls} value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              <option value="">Whole venue</option>
              {cal.spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input type="date" className={fieldCls} value={fromDate} min={today} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="Time">
              <input type="time" className={fieldCls} value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </Field>
            <Field label="Until">
              <input type="date" className={fieldCls} value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
            <Field label="Time">
              <input type="time" className={fieldCls} value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason players will see">
            <input className={fieldCls} value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} placeholder="Pitch resurfacing" />
          </Field>
          {hit ? (
            <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <p className="m-0 text-[14px]">{hit}</p>
              <Button variant="danger" block onClick={() => void save(true)}>
                Close and cancel those bookings
              </Button>
            </div>
          ) : (
            <Button variant="primary" block disabled={reason.trim().length === 0} onClick={() => void save(false)}>
              Save closure
            </Button>
          )}
        </div>
      </Sheet>
    </Section>
  );
}

// --- Staff ------------------------------------------------------------------------------

export function StaffCard({ venueId, token, act }: { venueId: string; token: string; act: Act }) {
  const [view, setView] = useState<StaffView | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    fetchStaff(token, venueId)
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load staff.'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, token]);

  return (
    <Section title="Staff">
      <Card>
        {view?.owner ? <ListRow title={view.owner.name} sub="Owner" /> : null}
        {view?.staff.map((s) => (
          <ListRow
            key={s.userId}
            title={s.name}
            sub="Manager: runs bookings, closures and spaces"
            trailing={
              view.canManageStaff ? (
                <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => void act(() => runAction('remove_venue_staff', { venueId, userId: s.userId }, token), 'Removed.').then(load)}>
                  <Trash2 size={16} />
                </Button>
              ) : null
            }
          />
        ))}
      </Card>
      {view?.canManageStaff ? (
        <div className="flex gap-2">
          <input className={fieldCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Their Chabuka account email" aria-label="Staff email" />
          <Button
            icon={<UserPlus size={16} />}
            disabled={!email.includes('@')}
            onClick={() =>
              void act(() => runAction('add_venue_staff', { venueId, email: email.trim() }, token), 'Added as a manager.').then((ok) => {
                if (ok) {
                  setEmail('');
                  void load();
                }
              })
            }
          >
            Add
          </Button>
        </div>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Section>
  );
}

// --- WaitApp link -----------------------------------------------------------------------

const WAITAPP_ORIGIN = 'https://waitapp.online';

// Paid online bookings: one step links this venue to its own WaitApp venue account (the venue handshake). WaitApp gets the
// venue as described here (Google place, pin, photos, hours), the owner signs in or signs up there with their details
// filled in, and the spaces, hours, closures and upcoming bookings come across.
export function WaitAppCard({ venueId, linked, isOwner, token, act, onChanged }: { venueId: string; linked: boolean; isOwner: boolean; token: string; act: Act; onChanged: () => void }) {
  const [info, setInfo] = useState<WaitAppVenueInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linked) { setInfo(null); return; }
    let stop = false;
    fetchWaitAppInfo(token, venueId).then((r) => { if (!stop) setInfo(r); }).catch(() => undefined);
    return () => { stop = true; };
  }, [linked, token, venueId]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const { url } = await startWaitAppConnect(token, venueId);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the WaitApp link.');
      setStarting(false);
    }
  }

  // Linked the old way (through the owner's personal WaitApp connection): offer the one-step reconnect.
  const oldLink = linked && info !== null && !info.perVenue;

  return (
    <Section title="Payments">
      <Card className="flex flex-col gap-2.5 p-4">
        <div className="flex items-center gap-2">
          <Link2 size={18} className="text-muted" />
          <strong className="flex-1">{linked ? 'Linked to WaitApp' : 'Paid bookings are off'}</strong>
          {linked ? <Badge tone="brand">Paid bookings on</Badge> : <Badge tone="muted">Pay at the venue</Badge>}
        </div>
        {linked ? (
          <p className="m-0 text-[14px] text-muted">
            Players pay when they book, and WaitApp pays you out. You can run the venue from here or from WaitApp: both show the same bookings, closures and spaces.
          </p>
        ) : (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] text-muted">
            <li>Players pay online when they book, so no-shows cost you less.</li>
            <li>Paid bookings confirm straight away.</li>
            <li>WaitApp collects the money and pays you out, keeping its booking commission.</li>
            <li>Your venue details, Google Maps pin, spaces and hours go across. Nothing to retype.</li>
          </ul>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        {!isOwner ? (
          <p className="m-0 text-[13px] text-muted">Only the venue owner can change this.</p>
        ) : !linked ? (
          <Button variant="primary" onClick={() => void start()} disabled={starting}>
            {starting ? 'Opening WaitApp...' : 'Take paid bookings online'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {oldLink && (
              <>
                <p className="m-0 text-[13px]">This venue was linked through your personal WaitApp connection. Reconnect it so it has its own link.</p>
                <Button variant="primary" onClick={() => void start()} disabled={starting}>{starting ? 'Opening WaitApp...' : 'Reconnect'}</Button>
              </>
            )}
            <ButtonLink href={`${WAITAPP_ORIGIN}/admin/settings?tab=settlement`}>Add payout details on WaitApp</ButtonLink>
            {info?.bookingPage && (
              <ButtonLink href={info.bookingPage}>Your WaitApp booking page</ButtonLink>
            )}
            <Button variant="danger" onClick={() => void act(() => setWaitAppLink(token, venueId, false), 'Unlinked. Chabuka keeps a copy of your spaces and hours.').then(onChanged)}>
              Unlink WaitApp
            </Button>
          </div>
        )}
      </Card>
    </Section>
  );
}
