import { describe, expect, it } from 'vitest';
import {
  addClosureSchema,
  closuresAsBookings,
  computeSpaceSlots,
  firstFreeUnit,
  hourCells,
  openWindowFor,
  priceLine,
  requestSpaceSchema,
  venueInstant,
  venueTime,
  venueYmd,
  weeklyDates,
} from './venueSpaces';

// Same cases as WaitApp's lib/utils/spaceSlots.test.ts, so both apps offer the same times.
const DATE = '2026-11-19';
const BEFORE = new Date('2026-11-18T10:00:00Z');
const win = { open: 8 * 60, close: 12 * 60 };
const booked = (unitId: string, fromH: number, toH: number) => ({
  unitId,
  startsAt: `2026-11-19T${String(fromH - 2).padStart(2, '0')}:00:00.000Z`,
  endsAt: `2026-11-19T${String(toH - 2).padStart(2, '0')}:00:00.000Z`,
});

describe('computeSpaceSlots (WaitApp parity)', () => {
  it('offers every hour inside opening hours, with the longest booking that fits', () => {
    const slots = computeSpaceSlots({ date: DATE, window: win, unitIds: ['u1'], bookings: [], now: BEFORE });
    expect(slots.map((s) => s.start)).toEqual(['08:00', '09:00', '10:00', '11:00']);
    expect(slots.map((s) => s.maxHours)).toEqual([4, 3, 2, 1]);
    expect(slots[0]!.startsAt).toBe('2026-11-19T06:00:00.000Z');
  });
  it('hides taken times and shortens the ones just before a booking', () => {
    const slots = computeSpaceSlots({ date: DATE, window: win, unitIds: ['u1'], bookings: [booked('u1', 9, 11)], now: BEFORE });
    expect(slots.map((s) => `${s.start}:${s.maxHours}`)).toEqual(['08:00:1', '11:00:1']);
  });
  it('stays available while another unit is free', () => {
    const slots = computeSpaceSlots({ date: DATE, window: win, unitIds: ['u1', 'u2'], bookings: [booked('u1', 9, 11)], now: BEFORE });
    const nine = slots.find((s) => s.start === '09:00')!;
    expect(nine.unitsFree).toBe(1);
    expect(nine.maxHours).toBe(3);
    const both = computeSpaceSlots({
      date: DATE,
      window: win,
      unitIds: ['u1', 'u2'],
      bookings: [booked('u1', 9, 11), booked('u2', 9, 11)],
      now: BEFORE,
    });
    expect(both.find((s) => s.start === '09:00')).toBeUndefined();
  });
  it('returns nothing on a closed day or with no units, and skips past times', () => {
    expect(computeSpaceSlots({ date: DATE, window: null, unitIds: ['u1'], bookings: [], now: BEFORE })).toEqual([]);
    expect(computeSpaceSlots({ date: DATE, window: win, unitIds: [], bookings: [], now: BEFORE })).toEqual([]);
    const slots = computeSpaceSlots({ date: DATE, window: win, unitIds: ['u1'], bookings: [], now: new Date('2026-11-19T07:30:00Z') });
    expect(slots.map((s) => s.start)).toEqual(['10:00', '11:00']);
  });
  it('caps the offered length', () => {
    const long = computeSpaceSlots({ date: DATE, window: { open: 0, close: 1440 }, unitIds: ['u1'], bookings: [], maxHoursCap: 3, now: BEFORE });
    expect(Math.max(...long.map((s) => s.maxHours))).toBe(3);
  });
});

describe('firstFreeUnit', () => {
  const b = [booked('u1', 9, 11)];
  it('gives the first unit free for the whole window', () => {
    expect(firstFreeUnit(['u1', 'u2'], b, '2026-11-19T07:00:00.000Z', '2026-11-19T09:00:00.000Z')).toBe('u2');
    expect(firstFreeUnit(['u1', 'u2'], b, '2026-11-19T09:00:00.000Z', '2026-11-19T10:00:00.000Z')).toBe('u1');
  });
  it('returns null when every unit clashes', () => {
    expect(firstFreeUnit(['u1'], b, '2026-11-19T08:00:00.000Z', '2026-11-19T10:00:00.000Z')).toBeNull();
  });
});

describe('opening hours and time', () => {
  it('reads the weekday window; empty means always open; closed day is null', () => {
    // 2026-11-19 is a Thursday
    expect(openWindowFor(DATE, { thu: { open: '17:00', close: '22:00' } })).toEqual({ open: 1020, close: 1320 });
    expect(openWindowFor(DATE, {})).toEqual({ open: 0, close: 1440 });
    expect(openWindowFor(DATE, { thu: { open: '17:00', close: '22:00', closed: true } })).toBeNull();
    expect(openWindowFor(DATE, { fri: { open: '17:00', close: '22:00' } })).toBeNull();
    expect(openWindowFor(DATE, { thu: { open: '08:00', close: '00:00' } })).toEqual({ open: 480, close: 1440 });
  });
  it('converts Lusaka local time both ways', () => {
    const at = venueInstant('2026-11-19', '18:00');
    expect(at.toISOString()).toBe('2026-11-19T16:00:00.000Z');
    expect(venueYmd('2026-11-19T22:30:00Z')).toBe('2026-11-20');
    expect(venueTime(at)).toBe('18:00');
    expect(weeklyDates('2026-11-26', 3)).toEqual(['2026-11-26', '2026-12-03', '2026-12-10']);
  });
});

describe('closures', () => {
  const closure = { space_id: null, starts_at: '2026-11-19T07:00:00.000Z', ends_at: '2026-11-19T08:00:00.000Z' };
  it('venue-wide closures block every unit of every space', () => {
    const bookings = closuresAsBookings([closure], 'space-a', ['1', '2']);
    expect(bookings).toHaveLength(2);
    const slots = computeSpaceSlots({ date: DATE, window: win, unitIds: ['1', '2'], bookings, now: BEFORE });
    expect(slots.find((s) => s.start === '09:00')).toBeUndefined();
    expect(slots.find((s) => s.start === '08:00')!.maxHours).toBe(1);
  });
  it('a space closure only blocks that space', () => {
    expect(closuresAsBookings([{ ...closure, space_id: 'space-b' }], 'space-a', ['1'])).toEqual([]);
  });
  it('refuses a closure that ends before it starts', () => {
    const bad = addClosureSchema.safeParse({
      venueId: '00000000-0000-4000-8000-000000000001',
      startsAt: '2026-11-19T10:00:00Z',
      endsAt: '2026-11-19T09:00:00Z',
      reason: 'Maintenance',
    });
    expect(bad.success).toBe(false);
  });
});

describe('hourCells', () => {
  const hours = { thu: { open: '08:00', close: '12:00' } };
  it('marks booked, requested, partly, closed and free hours', () => {
    const cells = hourCells({
      date: DATE,
      hours,
      spaceId: 's',
      unitCount: 2,
      now: BEFORE,
      bookings: [
        { id: 'b1', unit_no: 1, starts_at: '2026-11-19T06:00:00.000Z', ends_at: '2026-11-19T07:00:00.000Z', status: 'confirmed' },
        { id: 'b2', unit_no: 2, starts_at: '2026-11-19T06:00:00.000Z', ends_at: '2026-11-19T07:00:00.000Z', status: 'confirmed' },
        { id: 'b3', unit_no: 1, starts_at: '2026-11-19T07:00:00.000Z', ends_at: '2026-11-19T08:00:00.000Z', status: 'requested' },
      ],
      closures: [{ space_id: 's', starts_at: '2026-11-19T09:00:00.000Z', ends_at: '2026-11-19T10:00:00.000Z' }],
    });
    expect(cells.map((c) => `${c.start}:${c.state}`)).toEqual(['08:00:booked', '09:00:partly', '10:00:free', '11:00:closed']);
  });
});

describe('inputs and price', () => {
  it('defaults a request to one week', () => {
    const r = requestSpaceSchema.parse({
      venueId: '00000000-0000-4000-8000-000000000001',
      spaceId: 'x',
      date: DATE,
      startTime: '18:00',
      hours: 1,
    });
    expect(r.weeks).toBe(1);
    expect(r.skipTaken).toBe(false);
  });
  it('says who collects the money', () => {
    expect(priceLine({ hourly_price: null }, 1, false)).toBe('Free');
    expect(priceLine({ hourly_price: 300, currency: 'ZMW' }, 2, false)).toBe('ZMW 600, pay at the venue');
    expect(priceLine({ hourly_price: 300, currency: 'ZMW' }, 1, true)).toBe('ZMW 300, paid through WaitApp');
  });
});
