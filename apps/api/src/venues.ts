import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewVenueSchema, type ReviewVenueInput } from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';

// Venue approval. A venue is visible and bookable only once a platform admin
// approves it. Admins live in the platform_admins table (managed with the
// service role or SQL, never through the app), and every write here uses the
// service client because the database refuses review changes from anyone else.

export async function isPlatformAdmin(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await service.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw new ActionError(500, 'Could not check admin access.');
  return !!data;
}

export async function requireAdmin(service: SupabaseClient, userId: string): Promise<void> {
  if (!(await isPlatformAdmin(service, userId))) throw new ActionError(403, 'Admins only.');
}

export interface ReviewRow {
  id: string;
  name: string;
  area: string | null;
  sports: string[];
  facility_types: string[];
  contact: string | null;
  lat: number | null;
  lng: number | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

/** Venues waiting for a decision (oldest first), with who submitted them. */
export async function listVenuesForReview(
  service: SupabaseClient,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
): Promise<ReviewRow[]> {
  const { data, error } = await service
    .from('venues')
    .select('id,name,area,sports,facility_types,contact,lat,lng,status,review_note,owner_id')
    .eq('status', status)
    .order('name');
  if (error) throw new ActionError(500, 'Could not load venues.');
  const rows = (data ?? []) as Omit<ReviewRow, 'owner_name'>[];
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await service.from('profiles').select('id,name').in('id', ownerIds);
    for (const o of (owners ?? []) as { id: string; name: string | null }[]) names.set(o.id, o.name ?? 'Unnamed');
  }
  return rows.map((r) => ({ ...r, owner_name: r.owner_id ? (names.get(r.owner_id) ?? null) : null }));
}

export async function reviewVenue(
  service: SupabaseClient,
  adminId: string,
  venueId: string,
  input: ReviewVenueInput,
): Promise<{ status: 'approved' | 'rejected' }> {
  const parsed = reviewVenueSchema.parse(input);
  if (parsed.decision === 'reject' && !parsed.note) {
    throw new ActionError(400, 'Say why the venue was rejected so the owner can fix it.');
  }
  const { data: venue, error } = await service.from('venues').select('id,name,owner_id,status').eq('id', venueId).maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the venue.');
  const row = venue as { id: string; name: string; owner_id: string | null; status: string } | null;
  if (!row) throw new ActionError(404, 'Venue not found.');
  const status = parsed.decision === 'approve' ? 'approved' : 'rejected';
  const { error: updErr } = await service
    .from('venues')
    .update({
      status,
      review_note: parsed.note ?? null,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', venueId);
  if (updErr) {
    if ((updErr as { code?: string }).code === '23505') {
      throw new ActionError(409, 'Another live venue already uses this place.');
    }
    throw new ActionError(500, 'Could not save the decision.');
  }
  if (row.owner_id) {
    await notifyUsers([row.owner_id], status === 'approved' ? 'venue_approved' : 'venue_rejected', {
      venueId,
      title: row.name,
      note: parsed.note ?? null,
    });
  }
  return { status };
}
