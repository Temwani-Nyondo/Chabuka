import { z } from 'zod';

// --- Venue spaces (Phase 4): one booking model shared with WaitApp ----------------------
//
// A venue has spaces (Pitch 1, Court A, Hall). A space has `unitCount` interchangeable units, an hourly price and a
// booking mode. The venue has weekly opening hours and closures. Free start times are worked out live, on the hour.
// This is the same model WaitApp's Bookable Venue uses (roomFacilityTypes kind "facility" + operatingHours), and
// computeSpaceSlots / openWindowFor below are ports of WaitApp's lib/utils/spaceSlots.ts and facilityBooking.ts with the
// same test cases, so a Chabuka-only venue and a WaitApp-linked venue offer players exactly the same times.
// Closures are applied by turning them into bookings on every unit they cover, so the slot rule itself never changes.

/** Chabuka venues are in Zambia for now: Africa/Lusaka, UTC+2, no daylight saving. */
export const VENUE_TZ_OFFSET_MINUTES = 120;

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

/** Same shape as WaitApp's OperatingHours, so linking copies it as is. Empty = always open. */
export type WeeklyHours = Partial<Record<DayKey, { open: string; close: string; closed?: boolean }>>;

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const HOUR = 3_600_000;

function toMinutes(v: string | undefined): number | null {
  if (!v || !/^\d{1,2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** The instant of a venue-local date and time. */
export function venueInstant(ymd: string, time = '00:00'): Date {
  const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - VENUE_TZ_OFFSET_MINUTES * 60_000);
}

/** The venue-local date (YYYY-MM-DD) of an instant. */
export function venueYmd(at: Date | string): string {
  const t = new Date(typeof at === 'string' ? at : at.getTime());
  const local = new Date(t.getTime() + VENUE_TZ_OFFSET_MINUTES * 60_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** The venue-local time (HH:MM) of an instant. */
export function venueTime(at: Date | string): string {
  const t = new Date(typeof at === 'string' ? at : at.getTime());
  const local = new Date(t.getTime() + VENUE_TZ_OFFSET_MINUTES * 60_000);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/**
 * The open window for a venue-local day, in minutes since local midnight, or null when closed that day.
 * No hours set at all means always open. A close of "00:00" or "24:00" means midnight at the end of the day.
 */
export function openWindowFor(ymd: string, hours: WeeklyHours | null | undefined): { open: number; close: number } | null {
  if (!hours || Object.keys(hours).length === 0) return { open: 0, close: 1440 };
  const cfg = hours[DAY_KEYS[weekdayOf(ymd)]!];
  if (!cfg || cfg.closed) return null;
  const open = toMinutes(cfg.open);
  let close = toMinutes(cfg.close);
  if (open == null || close == null) return { open: 0, close: 1440 };
  if (close === 0 || close === 1440) close = 1440;
  return { open, close };
}

export interface UnitBooking {
  unitId: string;
  startsAt: string;
  endsAt: string;
}

export interface SpaceSlot {
  start: string; // HH:MM venue-local
  startsAt: string; // ISO
  maxHours: number; // longest booking that fits from this start
  unitsFree: number; // units free for at least one hour from this start
}

export interface SpaceSlotInput {
  date: string;
  window: { open: number; close: number } | null;
  unitIds: string[];
  bookings: UnitBooking[];
  stepMinutes?: number;
  maxHoursCap?: number;
  now?: Date;
}

export interface TeeSlotInput {
  date: string;
  window: { open: number; close: number } | null;
  tee: TeeConfig;
  /** Confirmed tee bookings that day (players each). */
  bookings: { startsAt: string; players: number }[];
  closures: { startsAt: string; endsAt: string }[];
  now?: Date;
}

/**
 * Tee times for one day: every `intervalMin` from opening to the last tee time (closing), with the spots left. A tee
 * time inside a closure, in the past, or full is left out. `unitsFree` carries the spots left so the same slot shape
 * serves pitches and tee sheets; `maxHours` is 0 for a tee time.
 */
export function teeSlots(input: TeeSlotInput): SpaceSlot[] {
  const { date, window, tee } = input;
  if (!window) return [];
  const now = (input.now ?? new Date()).getTime();
  const dayStart = venueInstant(date).getTime();
  const out: SpaceSlot[] = [];
  for (let min = window.open; min <= window.close; min += tee.intervalMin) {
    const startMs = dayStart + min * 60_000;
    if (startMs <= now) continue;
    const endMs = startMs + tee.intervalMin * 60_000;
    if (input.closures.some((c) => new Date(c.startsAt).getTime() < endMs && new Date(c.endsAt).getTime() > startMs)) continue;
    const booked = input.bookings.filter((b) => new Date(b.startsAt).getTime() === startMs).reduce((n, b) => n + (b.players || 1), 0);
    const left = tee.playersPerSlot - booked;
    if (left <= 0) continue;
    out.push({ start: hhmm(min), startsAt: new Date(startMs).toISOString(), maxHours: 0, unitsFree: left });
  }
  return out;
}

/** Free start times for one space on one day (port of WaitApp's computeSpaceSlots). */
export function computeSpaceSlots(input: SpaceSlotInput): SpaceSlot[] {
  const { date, window, unitIds, bookings } = input;
  if (!window || unitIds.length === 0) return [];
  const step = Math.max(15, input.stepMinutes ?? 60);
  const cap = Math.max(1, input.maxHoursCap ?? 8);
  const now = (input.now ?? new Date()).getTime();
  const dayStart = venueInstant(date).getTime();
  const slots: SpaceSlot[] = [];
  for (let min = window.open; min + 60 <= window.close; min += step) {
    const startMs = dayStart + min * 60_000;
    if (startMs <= now) continue;
    const room = Math.min(cap, Math.floor((window.close - min) / 60));
    let best = 0;
    let freeNow = 0;
    for (const unit of unitIds) {
      const mine = bookings.filter((b) => b.unitId === unit);
      let hours = 0;
      while (hours < room) {
        const a = startMs + hours * HOUR;
        const b = a + HOUR;
        if (mine.some((x) => new Date(x.startsAt).getTime() < b && new Date(x.endsAt).getTime() > a)) break;
        hours += 1;
      }
      if (hours >= 1) freeNow += 1;
      best = Math.max(best, hours);
    }
    if (best >= 1) slots.push({ start: hhmm(min), startsAt: new Date(startMs).toISOString(), maxHours: best, unitsFree: freeNow });
  }
  return slots;
}

/** The first unit free for the whole window, or null. */
export function firstFreeUnit(unitIds: string[], bookings: UnitBooking[], startsAt: string, endsAt: string): string | null {
  const a = new Date(startsAt).getTime();
  const b = new Date(endsAt).getTime();
  for (const unit of unitIds) {
    const clash = bookings.some(
      (x) => x.unitId === unit && new Date(x.startsAt).getTime() < b && new Date(x.endsAt).getTime() > a,
    );
    if (!clash) return unit;
  }
  return null;
}

export function unitIdsFor(unitCount: number): string[] {
  return Array.from({ length: Math.max(1, unitCount) }, (_, i) => String(i + 1));
}

export interface ClosureLike {
  space_id: string | null;
  starts_at: string;
  ends_at: string;
}

/** Closures that cover a space (its own, or venue-wide), as bookings on every unit. */
export function closuresAsBookings(closures: ClosureLike[], spaceId: string, unitIds: string[]): UnitBooking[] {
  const out: UnitBooking[] = [];
  for (const c of closures) {
    if (c.space_id && c.space_id !== spaceId) continue;
    for (const unitId of unitIds) out.push({ unitId, startsAt: c.starts_at, endsAt: c.ends_at });
  }
  return out;
}

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();

/** The same local date in each of the next `weeks` weeks, starting with `ymd`. */
export function weeklyDates(ymd: string, weeks: number): string[] {
  return Array.from({ length: Math.max(1, weeks) }, (_, i) => addDaysYmd(ymd, i * 7));
}

export type CellState = 'free' | 'partly' | 'requested' | 'booked' | 'closed' | 'past' | 'shut';

export interface CellBooking {
  id: string;
  unit_no: number | null;
  starts_at: string;
  ends_at: string;
  status: string; // requested | confirmed | ...
}

export interface HourCell {
  start: string;
  startsAt: string;
  state: CellState;
  booked: number;
  requested: number;
  units: number;
  bookingIds: string[];
  closed: boolean;
}

/** One space's hours for the owner calendar. `shut` = outside opening hours. */
export function hourCells(input: {
  date: string;
  hours: WeeklyHours | null | undefined;
  spaceId: string;
  unitCount: number;
  bookings: CellBooking[];
  closures: ClosureLike[];
  fromHour?: number;
  toHour?: number;
  now?: Date;
}): HourCell[] {
  const window = openWindowFor(input.date, input.hours);
  const units = Math.max(1, input.unitCount);
  const now = (input.now ?? new Date()).getTime();
  const from = input.fromHour ?? (window ? Math.floor(window.open / 60) : 8);
  const to = input.toHour ?? (window ? Math.ceil(window.close / 60) : 22);
  const out: HourCell[] = [];
  for (let h = from; h < to; h += 1) {
    const startsAt = venueInstant(input.date, `${pad(h)}:00`).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + HOUR).toISOString();
    const inHours = !!window && h * 60 >= window.open && (h + 1) * 60 <= window.close;
    const closed = input.closures.some(
      (c) => (!c.space_id || c.space_id === input.spaceId) && overlaps(c.starts_at, c.ends_at, startsAt, endsAt),
    );
    const touching = input.bookings.filter((b) => overlaps(b.starts_at, b.ends_at, startsAt, endsAt));
    const booked = touching.filter((b) => b.status === 'confirmed').length;
    const requested = touching.filter((b) => b.status === 'requested').length;
    let state: CellState;
    if (closed) state = 'closed';
    else if (booked >= units) state = 'booked';
    else if (requested > 0 && booked + requested >= units) state = 'requested';
    else if (new Date(startsAt).getTime() <= now) state = 'past';
    else if (!inHours) state = 'shut';
    else if (booked > 0 || requested > 0) state = 'partly';
    else state = 'free';
    out.push({ start: `${pad(h)}:00`, startsAt, state, booked, requested, units, bookingIds: touching.map((b) => b.id), closed });
  }
  return out;
}

// --- Rows -----------------------------------------------------------------------------

export const BOOKING_MODES = ['request', 'instant'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/**
 * Golf (G2): a space is sold either by the hour (pitches, courts, halls) or as a tee sheet: start times every
 * `intervalMin` minutes, up to `playersPerSlot` golfers each, priced per player and paid at the course. The venue's
 * closing time is its last tee time.
 */
export const SPACE_KINDS = ['hourly', 'tee'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const teeConfigSchema = z.object({
  intervalMin: z.number().int().min(6).max(20),
  playersPerSlot: z.number().int().min(1).max(4),
  pricePerPlayer: z.number().min(0).max(1_000_000).nullable().optional(),
});
export type TeeConfig = z.infer<typeof teeConfigSchema>;

export const venueSpaceSchema = z.object({
  id: z.string().uuid(),
  venue_id: z.string().uuid(),
  name: z.string(),
  sports: z.array(z.string()).default([]),
  surface: z.string().nullable().optional(),
  size_note: z.string().nullable().optional(),
  unit_count: z.number().int().positive().default(1),
  hourly_price: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.string().nullable().optional(),
  booking_mode: z.enum(BOOKING_MODES).default('request'),
  photos: z.array(z.string()).default([]),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
  waitapp_type_id: z.string().nullable().optional(),
  booking_kind: z.enum(SPACE_KINDS).default('hourly'),
  tee: teeConfigSchema.nullable().optional(),
});
export type VenueSpace = z.infer<typeof venueSpaceSchema>;

export const venueClosureSchema = z.object({
  id: z.string(),
  venue_id: z.string().uuid(),
  space_id: z.string().nullable().optional(),
  starts_at: z.string(),
  ends_at: z.string(),
  reason: z.string().nullable().optional(),
});
export type VenueClosure = z.infer<typeof venueClosureSchema>;

// --- Inputs ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time');

// partialRecord: a venue may list only the days it opens (a missing day is closed, like WaitApp's operatingHours).
export const weeklyHoursSchema = z.partialRecord(
  z.enum(DAY_KEYS),
  z.object({ open: timeSchema, close: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/), closed: z.boolean().optional() }),
);

export const upsertSpaceSchema = z.object({
  venueId: uuid,
  spaceId: uuid.optional(),
  name: z.string().trim().min(1, 'Name the space').max(60),
  sports: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  surface: z.string().trim().max(40).optional(),
  sizeNote: z.string().trim().max(60).optional(),
  unitCount: z.number().int().min(1).max(20).default(1),
  hourlyPrice: z.number().min(0).max(1_000_000).nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  bookingMode: z.enum(BOOKING_MODES).default('request'),
  photos: z.array(z.string().url().max(500)).max(6).default([]),
  active: z.boolean().default(true),
  bookingKind: z.enum(SPACE_KINDS).default('hourly'),
  tee: teeConfigSchema.optional(),
});
export type UpsertSpaceInput = z.infer<typeof upsertSpaceSchema>;

export const deleteSpaceSchema = z.object({ venueId: uuid, spaceId: uuid });
export type DeleteSpaceInput = z.infer<typeof deleteSpaceSchema>;

export const setHoursSchema = z.object({ venueId: uuid, hours: weeklyHoursSchema });
export type SetHoursInput = z.infer<typeof setHoursSchema>;

export const addClosureSchema = z
  .object({
    venueId: uuid,
    spaceId: z.string().min(1).max(80).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1, 'Give a reason players will see').max(120),
    cancelBookings: z.boolean().default(false),
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), { message: 'The closure must end after it starts.' });
export type AddClosureInput = z.infer<typeof addClosureSchema>;

export const removeClosureSchema = z.object({ venueId: uuid, closureId: z.string().min(1).max(80) });
export type RemoveClosureInput = z.infer<typeof removeClosureSchema>;

export const walkInBookingSchema = z.object({
  venueId: uuid,
  spaceId: z.string().min(1).max(80),
  date: ymdSchema,
  startTime: timeSchema,
  hours: z.number().int().min(1).max(12),
  /** Tee times: how many golfers. */
  players: z.number().int().min(1).max(4).optional(),
  guestName: z.string().trim().min(2, 'Who is it for?').max(80),
  guestPhone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(200).optional(),
});
export type WalkInBookingInput = z.infer<typeof walkInBookingSchema>;

export const requestSpaceSchema = z.object({
  venueId: uuid,
  spaceId: z.string().min(1).max(80),
  date: ymdSchema,
  startTime: timeSchema,
  hours: z.number().int().min(1).max(8),
  /** Tee times: how many golfers (the tee time's length is the venue's interval, so `hours` is ignored). */
  players: z.number().int().min(1).max(4).optional(),
  weeks: z.number().int().min(1).max(12).default(1),
  teamId: uuid.optional(),
  matchId: uuid.optional(),
  fixtureId: uuid.optional(),
  note: z.string().trim().max(300).optional(),
  // Linked (WaitApp) venues need a contact for the venue; native venues use the profile.
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  // Send even though some weeks are taken (the player saw the list and agreed).
  skipTaken: z.boolean().default(false),
});
export type RequestSpaceInput = z.infer<typeof requestSpaceSchema>;

export const respondSpaceBookingSchema = z
  .object({
    venueId: uuid,
    bookingId: z.string().min(1).max(80).optional(),
    groupId: uuid.optional(),
    decision: z.enum(['confirm', 'decline']),
    mode: z.enum(['all', 'free_only']).default('free_only'),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => Boolean(v.bookingId || v.groupId), { message: 'Pick a booking.' });
export type RespondSpaceBookingInput = z.infer<typeof respondSpaceBookingSchema>;

export const cancelSpaceBookingSchema = z
  .object({
    // Sent by the venue's own screens: on a WaitApp-linked venue the calendar's ids are WaitApp booking ids.
    venueId: uuid.optional(),
    bookingId: z.string().min(1).max(80).optional(),
    groupId: uuid.optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => Boolean(v.bookingId || v.groupId), { message: 'Pick a booking.' });
export type CancelSpaceBookingInput = z.infer<typeof cancelSpaceBookingSchema>;

export const checkInSpaceBookingSchema = z.object({ venueId: uuid, bookingId: z.string().min(1).max(80) });
export type CheckInSpaceBookingInput = z.infer<typeof checkInSpaceBookingSchema>;

export const venueStaffSchema = z.object({ venueId: uuid, email: z.string().trim().email().max(120) });
export type VenueStaffInput = z.infer<typeof venueStaffSchema>;
export const removeVenueStaffSchema = z.object({ venueId: uuid, userId: uuid });
export type RemoveVenueStaffInput = z.infer<typeof removeVenueStaffSchema>;

/** Price line for players. Native venues never take money: the venue collects it. */
export function priceLine(space: { hourly_price?: number | null; currency?: string | null }, hours: number, linked: boolean): string | null {
  if (space.hourly_price == null || space.hourly_price <= 0) return 'Free';
  const total = space.hourly_price * hours;
  const amount = `${space.currency ?? ''} ${total.toLocaleString('en', { maximumFractionDigits: 2 })}`.trim();
  return linked ? `${amount}, paid through WaitApp` : `${amount}, pay at the venue`;
}
