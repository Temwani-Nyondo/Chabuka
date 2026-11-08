import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPlatformAdmin, listVenuesForReview, requireAdmin, reviewVenue } from './venues.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const VENUE = '33333333-3333-4333-8333-333333333333';

// Chainable fake: reads resolve from `tables`, writes are recorded.
function fakeService(tables: Record<string, Record<string, unknown>[]>, updateError?: { code: string }) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const service = {
    from(table: string) {
      let rows = tables[table] ?? [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return builder;
        },
        order: () => builder,
        update: (payload: unknown) => {
          writes.push({ table, op: 'update', payload });
          // Real code chains .eq(...) after update.
          return { eq: () => Promise.resolve({ error: updateError ?? null }) };
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return { service: service as unknown as SupabaseClient, writes };
}

describe('platform admin check', () => {
  it('recognises an admin and refuses everyone else', async () => {
    const { service } = fakeService({ platform_admins: [{ user_id: ADMIN }] });
    expect(await isPlatformAdmin(service, ADMIN)).toBe(true);
    expect(await isPlatformAdmin(service, OWNER)).toBe(false);
    await expect(requireAdmin(service, OWNER)).rejects.toMatchObject({ status: 403 });
  });
});

describe('listVenuesForReview', () => {
  it('returns pending venues with the owner name', async () => {
    const { service } = fakeService({
      venues: [
        { id: VENUE, name: 'New Pitch', status: 'pending', owner_id: OWNER, sports: [], facility_types: [] },
        { id: 'x', name: 'Live Pitch', status: 'approved', owner_id: OWNER, sports: [], facility_types: [] },
      ],
      profiles: [{ id: OWNER, name: 'Venue Owner' }],
    });
    const rows = await listVenuesForReview(service, 'pending');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'New Pitch', owner_name: 'Venue Owner' });
  });
});

describe('reviewVenue', () => {
  const venues = [{ id: VENUE, name: 'New Pitch', owner_id: OWNER, status: 'pending' }];

  it('approves and records who decided', async () => {
    const { service, writes } = fakeService({ venues });
    const result = await reviewVenue(service, ADMIN, VENUE, { decision: 'approve' });
    expect(result).toEqual({ status: 'approved' });
    expect(writes[0]?.payload).toMatchObject({ status: 'approved', reviewed_by: ADMIN });
  });

  it('rejecting needs a reason the owner can act on', async () => {
    const { service } = fakeService({ venues });
    await expect(reviewVenue(service, ADMIN, VENUE, { decision: 'reject' })).rejects.toMatchObject({ status: 400 });
    const ok = await reviewVenue(service, ADMIN, VENUE, { decision: 'reject', note: 'Please add the exact location.' });
    expect(ok).toEqual({ status: 'rejected' });
  });

  it('404s for an unknown venue', async () => {
    const { service } = fakeService({ venues: [] });
    await expect(reviewVenue(service, ADMIN, VENUE, { decision: 'approve' })).rejects.toMatchObject({ status: 404 });
  });

  it('explains a duplicate place instead of a generic error', async () => {
    const { service } = fakeService({ venues }, { code: '23505' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(reviewVenue(service, ADMIN, VENUE, { decision: 'approve' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('already uses this place'),
    });
  });
});
