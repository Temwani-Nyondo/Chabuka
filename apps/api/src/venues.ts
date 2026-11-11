import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminAddVenueSchema,
  reviewClaimSchema,
  reviewVenueSchema,
  type AdminAddVenueInput,
  type ReviewClaimInput,
  type ReviewVenueInput,
} from '@chabuka/shared';
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

// --- Claims and admin listings -------------------------------------------------

export interface ClaimRow {
  id: string;
  venue_id: string;
  venue_name: string;
  user_id: string;
  user_name: string | null;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export async function listClaims(
  service: SupabaseClient,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
): Promise<ClaimRow[]> {
  const { data, error } = await service
    .from('venue_claims')
    .select('id,venue_id,user_id,message,status,created_at')
    .eq('status', status)
    .order('created_at')
    .limit(200);
  if (error) throw new ActionError(500, 'Could not load claims.');
  const rows = (data ?? []) as Omit<ClaimRow, 'venue_name' | 'user_name'>[];
  const venueIds = [...new Set(rows.map((r) => r.venue_id))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const venueNames = new Map<string, string>();
  const userNames = new Map<string, string>();
  if (venueIds.length > 0) {
    const { data: v } = await service.from('venues').select('id,name').in('id', venueIds);
    for (const x of (v ?? []) as { id: string; name: string }[]) venueNames.set(x.id, x.name);
  }
  if (userIds.length > 0) {
    const { data: u } = await service.from('profiles').select('id,name').in('id', userIds);
    for (const x of (u ?? []) as { id: string; name: string | null }[]) userNames.set(x.id, x.name ?? 'Unnamed');
  }
  return rows.map((r) => ({
    ...r,
    venue_name: venueNames.get(r.venue_id) ?? 'Venue',
    user_name: userNames.get(r.user_id) ?? null,
  }));
}

export async function reviewClaim(
  service: SupabaseClient,
  adminId: string,
  claimId: string,
  input: ReviewClaimInput,
): Promise<{ status: 'approved' | 'rejected' }> {
  const parsed = reviewClaimSchema.parse(input);
  if (parsed.decision === 'reject' && !parsed.note) {
    throw new ActionError(400, 'Say why the claim was rejected so they know what to fix.');
  }
  const { data, error } = await service
    .from('venue_claims')
    .select('id,venue_id,user_id,status')
    .eq('id', claimId)
    .maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the claim.');
  const claim = data as { id: string; venue_id: string; user_id: string; status: string } | null;
  if (!claim) throw new ActionError(404, 'Claim not found.');
  if (claim.status !== 'pending') throw new ActionError(409, 'This claim was already decided.');
  const { data: venueRow } = await service.from('venues').select('id,name,owner_id').eq('id', claim.venue_id).maybeSingle();
  const venue = venueRow as { id: string; name: string; owner_id: string | null } | null;
  if (!venue) throw new ActionError(404, 'Venue not found.');
  const status = parsed.decision === 'approve' ? 'approved' : 'rejected';

  if (status === 'approved') {
    if (venue.owner_id && venue.owner_id !== claim.user_id) {
      throw new ActionError(409, 'This venue already has an owner.');
    }
    const { error: ownerErr } = await service.from('venues').update({ owner_id: claim.user_id }).eq('id', venue.id);
    if (ownerErr) throw new ActionError(500, 'Could not assign the owner.');
  }
  const { error: updErr } = await service
    .from('venue_claims')
    .update({ status, review_note: parsed.note ?? null, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq('id', claim.id);
  if (updErr) throw new ActionError(500, 'Could not save the decision.');
  if (status === 'approved') {
    // Any other pending claims on the same venue lose.
    await service
      .from('venue_claims')
      .update({ status: 'rejected', review_note: 'Another claim was approved.', reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq('venue_id', venue.id)
      .eq('status', 'pending');
  }
  await notifyUsers([claim.user_id], status === 'approved' ? 'venue_claim_approved' : 'venue_claim_rejected', {
    venueId: venue.id,
    title: venue.name,
    note: parsed.note ?? null,
  });
  return { status };
}

/** Admin pre-lists a real venue (approved at once). With ownerEmail it is assigned straight away. */
export async function adminAddVenue(
  service: SupabaseClient,
  adminId: string,
  input: AdminAddVenueInput,
): Promise<{ venueId: string; ownerId: string | null }> {
  const parsed = adminAddVenueSchema.parse(input);
  let ownerId: string | null = null;
  if (parsed.ownerEmail) {
    const { data: list } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === parsed.ownerEmail!.toLowerCase());
    if (!match) throw new ActionError(404, 'No Chabuka account uses that email yet.');
    ownerId = match.id;
  }
  const { data, error } = await service
    .from('venues')
    .insert({
      owner_id: ownerId,
      google_place_id: parsed.googlePlaceId ?? null,
      name: parsed.name,
      area: parsed.area,
      lat: parsed.lat ?? null,
      lng: parsed.lng ?? null,
      sports: parsed.sports,
      facility_types: parsed.facilityTypes,
      price_note: parsed.priceNote || null,
      contact: parsed.contact ?? null,
      photos: [],
      status: 'approved',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new ActionError(409, 'This place is already listed.');
    throw new ActionError(500, 'Could not add the venue.');
  }
  return { venueId: (data as { id: string }).id, ownerId };
}
