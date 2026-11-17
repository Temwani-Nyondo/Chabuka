import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ageGroup,
  ageOn,
  checkInRunnerSchema,
  climb,
  createRaceSchema,
  enterRaceSchema,
  finishMarkSchema,
  importResultsSchema,
  moveRaceEntrySchema,
  nextBib,
  openRaceEntriesSchema,
  publishResultsSchema,
  raceEntryIdSchema,
  raceOfficialSchema,
  raceSettingsSchema,
  rankResults,
  removeDistanceSchema,
  resolveMarkSchema,
  routeLength,
  saveRouteSchema,
  setResultSchema,
  snapToRoute,
  startGunSchema,
  updateRaceSettingsSchema,
  upsertDistanceSchema,
  venueYmd,
  voidMarkSchema,
  waveFor,
  formatDuration,
  type RaceDistanceInput,
  type RaceSettings,
  type ResultStatus,
  type RoutePoint,
  TSHIRT_SIZES,
} from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';
import { detailColumns } from './competitions.js';
import { waitappCall } from './waitapp.js';
import { eventNewsToCircle } from './social.js';

// Race events (marathons, fun runs, trail runs, walks). A race is a competition with kind 'race'. Individual runners
// enter a distance; paid distances are WaitApp ticket tiers (WaitApp takes the money and sends ticket.issued with
// ref "race:<entryId>"), free ones are confirmed at once. Bibs are handed out from each distance's range and never
// reused. Results come from the finish-line tool (volunteers record bibs as runners cross) or a timing company's CSV.
// Every write uses the service client after the checks here.

type Deps = { fetch?: typeof fetch; now?: Date };

interface RaceRow {
  id: string;
  organiser_id: string;
  name: string;
  kind: string;
  status: string;
  starts_on: string;
  area: string | null;
  location: string | null;
  description: string | null;
  banner_url: string | null;
  registration_closes_at: string | null;
  race_settings: RaceSettings | null;
  waitapp_event_id: string | null;
  waitapp_checkout_url: string | null;
  registration_questions: { label: string; required: boolean }[] | null;
}

export interface DistanceRow {
  id: string;
  competition_id: string;
  name: string;
  distance_km: number;
  laps: number;
  starts_at: string;
  cutoff_minutes: number | null;
  min_age: number | null;
  field_limit: number;
  price: number;
  currency: string;
  waitapp_tier_name: string | null;
  waitapp_tier_id: string | null;
  bib_from: number;
  bib_to: number;
  next_bib: number | null;
  sort: number;
  gun_started_at: string | null;
  results_published: boolean;
}

interface EntryRow {
  id: string;
  competition_id: string;
  distance_id: string;
  /** Null for a guest entry made on WaitApp (no Chabuka account): see guest_email. */
  user_id: string | null;
  guest_email?: string | null;
  runner_name: string;
  gender: 'female' | 'male';
  birth_date: string;
  age_group: string | null;
  club: string | null;
  expected_minutes: number | null;
  wave: string | null;
  tshirt: string | null;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded';
  bib: number | null;
  paid_ref: string | null;
  ticket_ids: string[] | null;
  checked_in_at: string | null;
  created_at: string;
}

const PENDING_HOLD_MS = 2 * 60 * 60 * 1000;
const num = (v: unknown) => (v == null ? null : Number(v));

function settingsOf(race: RaceRow): RaceSettings {
  return raceSettingsSchema.parse(race.race_settings ?? {});
}

async function loadRace(svc: SupabaseClient, id: string): Promise<RaceRow> {
  const { data, error } = await svc.from('competitions').select('*').eq('id', id).maybeSingle();
  if (error) throw new ActionError(500, 'Could not load the race.');
  const race = data as RaceRow | null;
  if (!race || race.kind !== 'race') throw new ActionError(404, 'Race not found.');
  return race;
}

function normDistance(d: Record<string, unknown>): DistanceRow {
  return { ...(d as unknown as DistanceRow), distance_km: Number(d['distance_km']), price: Number(d['price'] ?? 0) };
}

async function loadDistance(svc: SupabaseClient, id: string): Promise<{ distance: DistanceRow; race: RaceRow }> {
  const { data } = await svc.from('race_distances').select('*').eq('id', id).maybeSingle();
  if (!data) throw new ActionError(404, 'Distance not found.');
  const distance = normDistance(data as Record<string, unknown>);
  return { distance, race: await loadRace(svc, distance.competition_id) };
}

async function distancesOf(svc: SupabaseClient, raceId: string): Promise<DistanceRow[]> {
  const { data } = await svc.from('race_distances').select('*').eq('competition_id', raceId).order('sort');
  return ((data ?? []) as Record<string, unknown>[]).map(normDistance);
}

async function entriesOf(svc: SupabaseClient, raceId: string): Promise<EntryRow[]> {
  const { data } = await svc.from('race_entries').select('*').eq('competition_id', raceId);
  return (data ?? []) as EntryRow[];
}

function requireOrganiser(race: RaceRow, userId: string) {
  if (race.organiser_id !== userId) throw new ActionError(403, 'Only the race organiser can do that.');
}

async function isOfficial(svc: SupabaseClient, race: RaceRow, userId: string, role: 'finish' | 'checkin'): Promise<boolean> {
  if (race.organiser_id === userId) return true;
  const { data } = await svc.from('race_officials').select('role').eq('competition_id', race.id).eq('user_id', userId);
  return ((data ?? []) as { role: string }[]).some((r) => r.role === role);
}

/** Pending payments older than the hold stop counting and are closed. Run whenever entries are read or written. */
async function expireStalePending(svc: SupabaseClient, raceId: string, now: Date) {
  const cutoff = new Date(now.getTime() - PENDING_HOLD_MS).toISOString();
  await svc.from('race_entries').update({ status: 'cancelled' }).eq('competition_id', raceId).eq('status', 'pending_payment').lt('created_at', cutoff);
}

function holding(e: EntryRow, now: Date): boolean {
  return e.status === 'confirmed' || (e.status === 'pending_payment' && now.getTime() - new Date(e.created_at).getTime() < PENDING_HOLD_MS);
}

function distanceRow(raceId: string, d: RaceDistanceInput, sort: number) {
  return {
    competition_id: raceId,
    name: d.name,
    distance_km: d.km,
    laps: d.laps,
    starts_at: d.startsAt,
    cutoff_minutes: d.cutoffMinutes ?? null,
    min_age: d.minAge ?? null,
    field_limit: d.fieldLimit,
    price: d.price,
    currency: d.currency,
    bib_from: d.bibFrom,
    bib_to: d.bibTo,
    sort,
  };
}

function checkBibRanges(list: { name: string; bib_from: number; bib_to: number }[]) {
  const sorted = [...list].sort((a, b) => a.bib_from - b.bib_from);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.bib_from <= sorted[i - 1]!.bib_to) {
      throw new ActionError(400, `The bib numbers of ${sorted[i - 1]!.name} and ${sorted[i]!.name} overlap. Give each distance its own range.`);
    }
  }
}

// --- Setup ------------------------------------------------------------------------------------

export async function createRace(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = createRaceSchema.parse(raw);
  checkBibRanges(input.distances.map((d) => ({ name: d.name, bib_from: d.bibFrom, bib_to: d.bibTo })));
  const id = crypto.randomUUID();
  const { error } = await svc.from('competitions').insert({
    id,
    organiser_id: userId,
    sport_id: input.sportId,
    name: input.name,
    kind: 'race',
    format: 'race',
    category: input.category,
    area: input.area,
    starts_on: input.startsOn,
    max_entries: Math.max(2, input.distances.reduce((n, d) => n + d.fieldLimit, 0)),
    status: 'registration',
    requires_approval: false,
    race_settings: input.settings,
    ...detailColumns(input),
  });
  if (error) throw new ActionError(500, 'Could not create the race.');
  const rows = input.distances.map((d, i) => ({ ...distanceRow(id, d, i), next_bib: d.bibFrom }));
  const { data, error: dErr } = await svc.from('race_distances').insert(rows).select('id');
  if (dErr) throw new ActionError(500, 'Could not save the distances.');
  return { competitionId: id, distanceIds: ((data ?? []) as { id: string }[]).map((r) => r.id) };
}

export async function updateRaceSettings(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = updateRaceSettingsSchema.parse(raw);
  const race = await loadRace(svc, input.competitionId);
  requireOrganiser(race, userId);
  await svc.from('competitions').update({ race_settings: input.settings }).eq('id', race.id);
  return { state: 'saved' };
}

export async function upsertDistance(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = upsertDistanceSchema.parse(raw);
  const race = await loadRace(svc, input.competitionId);
  requireOrganiser(race, userId);
  const all = await distancesOf(svc, race.id);
  const others = all.filter((d) => d.id !== input.distanceId);
  checkBibRanges([...others, { name: input.distance.name, bib_from: input.distance.bibFrom, bib_to: input.distance.bibTo }]);
  if (input.distanceId) {
    const current = all.find((d) => d.id === input.distanceId);
    if (!current) throw new ActionError(404, 'Distance not found.');
    const entries = (await entriesOf(svc, race.id)).filter((e) => e.distance_id === current.id && holding(e, new Date()));
    if (input.distance.fieldLimit < entries.length) throw new ActionError(409, `${entries.length} runners have already entered this distance.`);
    if (entries.some((e) => e.bib != null) && (input.distance.bibFrom !== current.bib_from || input.distance.bibTo < (current.next_bib ?? current.bib_from) - 1)) {
      throw new ActionError(409, 'Bibs are already handed out for this distance. You can only make the range longer.');
    }
    if (race.waitapp_event_id && current.price !== input.distance.price) {
      throw new ActionError(409, 'Entry is already on sale on WaitApp. Change the price there, or contact support.');
    }
    const { sort: _s, ...patch } = distanceRow(race.id, input.distance, current.sort);
    await svc.from('race_distances').update(patch).eq('id', current.id);
    return { state: 'saved', distanceId: current.id };
  }
  const { data, error } = await svc
    .from('race_distances')
    .insert({ ...distanceRow(race.id, input.distance, all.length), next_bib: input.distance.bibFrom })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not add the distance.');
  return { state: 'created', distanceId: (data as { id: string }).id };
}

export async function removeDistance(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = removeDistanceSchema.parse(raw);
  const race = await loadRace(svc, input.competitionId);
  requireOrganiser(race, userId);
  const entries = (await entriesOf(svc, race.id)).filter((e) => e.distance_id === input.distanceId && e.status !== 'cancelled');
  if (entries.length > 0) throw new ActionError(409, 'Runners have entered this distance. Move them first.');
  await svc.from('race_distances').delete().eq('id', input.distanceId).eq('competition_id', race.id);
  return { state: 'removed' };
}

export async function saveRoute(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = saveRouteSchema.parse(raw);
  const { distance, race } = await loadDistance(svc, input.distanceId);
  requireOrganiser(race, userId);
  const points = input.points as RoutePoint[];
  const lapM = routeLength(points);
  // Every POI gets its km along the course, worked out here so the list is always right.
  const pois = input.pois.map((p) => ({ ...p, km: snapToRoute(p.lat, p.lng, points).km }));
  const row = {
    distance_id: distance.id,
    points,
    source: input.source,
    distance_m: Math.round(lapM * Math.max(1, distance.laps)),
    climb_m: climb(points) * Math.max(1, distance.laps),
    pois,
    updated_at: new Date().toISOString(),
  };
  const { error } = await svc.from('race_routes').upsert(row, { onConflict: 'distance_id' });
  if (error) throw new ActionError(500, 'Could not save the route.');
  const target = distance.distance_km * 1000;
  const off = Math.abs(row.distance_m - target) / target;
  return {
    state: 'saved',
    distanceM: row.distance_m,
    climbM: row.climb_m,
    warning: off > 0.02 ? `The course measures ${(row.distance_m / 1000).toFixed(2)} km, not ${distance.distance_km} km.` : null,
  };
}

export async function appointRaceOfficial(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = raceOfficialSchema.parse(raw);
  const race = await loadRace(svc, input.competitionId);
  requireOrganiser(race, userId);
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === input.email.toLowerCase());
  if (!match) throw new ActionError(404, 'No Chabuka account uses that email yet.');
  if (input.remove) {
    await svc.from('race_officials').delete().eq('competition_id', race.id).eq('user_id', match.id).eq('role', input.role);
    return { state: 'removed' };
  }
  await svc.from('race_officials').upsert({ competition_id: race.id, user_id: match.id, role: input.role });
  await notifyUsers([match.id], 'race_official_appointed', { competitionId: race.id, title: race.name, role: input.role });
  return { state: 'appointed', userId: match.id };
}

/** Puts the paid distances on sale on WaitApp: one ticket tier per distance, capped at its field limit. */
export async function openRaceEntries(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = openRaceEntriesSchema.parse(raw);
  const race = await loadRace(svc, input.competitionId);
  requireOrganiser(race, userId);
  const distances = await distancesOf(svc, race.id);
  const paid = distances.filter((d) => d.price > 0);
  if (paid.length === 0) return { state: 'free', checkoutUrl: null };
  if (race.waitapp_event_id) return { state: 'open', checkoutUrl: race.waitapp_checkout_url };
  const first = [...distances].sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]!;
  const { status, data } = await waitappCall(
    svc,
    userId,
    '/api/partner/chabuka/events',
    {
      method: 'POST',
      body: {
        chabukaMatchId: race.id,
        // Tickets for this event are only sold through an entry (WaitApp refuses a bare ticket without one).
        entryKind: 'race',
        title: race.name,
        ...(race.description ? { description: race.description.slice(0, 1000) } : {}),
        date: first.starts_at,
        ...(race.location ? { venue: race.location.slice(0, 160) } : {}),
        ...(race.area ? { city: race.area } : {}),
        ...(race.banner_url ? { imageUrl: race.banner_url } : {}),
        capacity: paid.reduce((n, d) => n + d.field_limit, 0),
        tiers: paid.map((d) => ({ name: d.name.slice(0, 60), price: d.price, capacity: d.field_limit })),
      },
    },
    deps,
  );
  if (status >= 400 || typeof data['eventId'] !== 'string') {
    throw new ActionError(status === 409 ? 409 : 400, typeof data['error'] === 'string' ? (data['error'] as string) : 'WaitApp could not put the race on sale.');
  }
  await svc.from('competitions').update({ waitapp_event_id: data['eventId'], waitapp_checkout_url: String(data['checkoutUrl'] ?? '') }).eq('id', race.id);
  const tiers = Array.isArray(data['tiers']) ? (data['tiers'] as { id?: string; name?: string }[]) : [];
  for (const d of paid) {
    const tierName = d.name.slice(0, 60);
    const tierId = tiers.find((t) => t.name === tierName)?.id ?? null;
    await svc.from('race_distances').update({ waitapp_tier_name: tierName, waitapp_tier_id: tierId }).eq('id', d.id);
  }
  return { state: 'open', checkoutUrl: String(data['checkoutUrl'] ?? '') };
}

// --- Entering ---------------------------------------------------------------------------------

async function assignBib(svc: SupabaseClient, entry: EntryRow, distance: DistanceRow): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data } = await svc.from('race_entries').select('bib').eq('competition_id', entry.competition_id);
    const taken = new Set(((data ?? []) as { bib: number | null }[]).map((r) => r.bib).filter((b): b is number => b != null));
    const { data: fresh } = await svc.from('race_distances').select('next_bib').eq('id', distance.id).maybeSingle();
    const bib = nextBib(distance.bib_from, distance.bib_to, (fresh as { next_bib: number | null } | null)?.next_bib ?? distance.next_bib, taken);
    if (bib == null) throw new ActionError(409, `${distance.name} has run out of bib numbers. The organiser needs to extend the range.`);
    const { error } = await svc.from('race_entries').update({ bib, status: 'confirmed' }).eq('id', entry.id);
    if (!error) {
      await svc.from('race_distances').update({ next_bib: bib + 1 }).eq('id', distance.id);
      return bib;
    }
    // Lost a race for that number (unique index): try the next one.
  }
  throw new ActionError(409, 'Could not give out a bib number. Try again.');
}

/**
 * Enter a runner. `userId` is the Chabuka account entering; null for a guest entry made on WaitApp, which carries
 * the WaitApp customer's email instead (deps.guestEmail). Every rule (age, field size, questions) applies the same.
 */
export async function enterRace(svc: SupabaseClient, userId: string | null, raw: unknown, deps: Deps & { guestEmail?: string } = {}) {
  const input = enterRaceSchema.parse(raw);
  const now = deps.now ?? new Date();
  const race = await loadRace(svc, input.competitionId);
  if (race.status !== 'registration') throw new ActionError(409, 'Entries for this race are closed.');
  if (race.registration_closes_at && new Date(race.registration_closes_at) < now) throw new ActionError(409, 'Entries for this race have closed.');
  const { distance } = await loadDistance(svc, input.distanceId);
  if (distance.competition_id !== race.id) throw new ActionError(400, 'That distance belongs to another race.');
  const raceDay = venueYmd(distance.starts_at);
  const age = ageOn(input.birthDate, raceDay);
  if (age < 0 || age > 110) throw new ActionError(400, 'Check the date of birth.');
  if (distance.min_age != null && age < distance.min_age) {
    throw new ActionError(409, `Runners must be at least ${distance.min_age} on race day for the ${distance.name}.`);
  }
  await expireStalePending(svc, race.id, now);
  const entries = await entriesOf(svc, race.id);
  const live = entries.filter((e) => e.distance_id === distance.id && holding(e, now));
  if (live.length >= distance.field_limit) throw new ActionError(409, `The ${distance.name} is full.`);
  const guestEmail = userId ? null : (deps.guestEmail ?? '').trim().toLowerCase() || null;
  if (!userId && !guestEmail) throw new ActionError(400, 'An email is needed for a guest entry.');
  const dupe = entries.find(
    (e) =>
      (userId ? e.user_id === userId : !e.user_id && e.guest_email === guestEmail) &&
      holding(e, now) &&
      e.runner_name.toLowerCase() === input.runnerName.toLowerCase() &&
      e.birth_date === input.birthDate,
  );
  if (dupe) throw new ActionError(409, `${input.runnerName} is already entered in this race.`);
  const settings = settingsOf(race);
  const required = (race.registration_questions ?? []).filter((q) => q.required);
  for (const q of required) {
    if (!input.answers.find((a) => a.label === q.label && a.answer.trim())) throw new ActionError(400, `Answer: ${q.label}`);
  }
  const id = crypto.randomUUID();
  const row = {
    id,
    competition_id: race.id,
    distance_id: distance.id,
    user_id: userId,
    ...(guestEmail ? { guest_email: guestEmail, source: 'waitapp' } : {}),
    runner_name: input.runnerName,
    gender: input.gender,
    birth_date: input.birthDate,
    age_group: ageGroup(input.birthDate, raceDay, settings.ageBands),
    club: input.club || null,
    expected_minutes: input.expectedMinutes ?? null,
    wave: waveFor(input.expectedMinutes, settings.waves),
    tshirt: settings.tshirts ? (input.tshirt ?? null) : null,
    status: 'pending_payment' as const,
    answers: input.answers,
    waiver_accepted_at: now.toISOString(),
    created_at: now.toISOString(),
  };
  const { error } = await svc.from('race_entries').insert(row);
  if (error) throw new ActionError(500, 'Could not save the entry.');
  await svc.from('race_entry_private').insert({
    entry_id: id,
    phone: input.phone,
    emergency_name: input.emergencyName,
    emergency_phone: input.emergencyPhone,
    medical_note: input.medicalNote || null,
  });
  const entry = { ...row, bib: null, paid_ref: null, ticket_ids: [], checked_in_at: null } as EntryRow;

  if (distance.price <= 0) {
    const bib = await assignBib(svc, entry, distance);
    await notifyUsers([userId], 'race_entry_confirmed', { competitionId: race.id, title: race.name, distance: distance.name, bib, runner: input.runnerName });
    return { state: 'confirmed', entryId: id, bib, checkoutUrl: null };
  }
  if (!race.waitapp_checkout_url) {
    await svc.from('race_entries').update({ status: 'cancelled' }).eq('id', id);
    throw new ActionError(409, 'Paid entry for this race is not open yet. Check back soon.');
  }
  const sep = race.waitapp_checkout_url.includes('?') ? '&' : '?';
  // One ticket, the right ticket type preselected, and the entry reference WaitApp sends back when it is paid.
  const tier = distance.waitapp_tier_id ? `&tier=${encodeURIComponent(distance.waitapp_tier_id)}` : '';
  const checkoutUrl = `${race.waitapp_checkout_url}${sep}cref=${encodeURIComponent(`race:${id}`)}${tier}&qty=1`;
  return { state: 'pending_payment', entryId: id, bib: null, checkoutUrl, holdMinutes: PENDING_HOLD_MS / 60_000 };
}

/** ticket.issued with ref "race:<entryId>": the entry is paid. Idempotent on the payment id. */
export async function confirmRaceFromTicket(
  svc: SupabaseClient,
  t: { eventId: string; paymentId: string; ticketIds: string[]; ref: string; tierName?: string | null },
): Promise<{ handled: boolean }> {
  const entryId = /^race:([0-9a-f-]{36})$/i.exec(t.ref)?.[1];
  if (!entryId) return { handled: false };
  const { data } = await svc.from('race_entries').select('*').eq('id', entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) return { handled: false };
  const race = await loadRace(svc, entry.competition_id);
  if (race.waitapp_event_id !== t.eventId) throw new ActionError(400, 'That payment is for another event.');
  if (entry.paid_ref === t.paymentId) return { handled: true };
  if (entry.status === 'refunded') return { handled: true };
  await svc.from('race_entries').update({ paid_ref: t.paymentId, ticket_ids: t.ticketIds }).eq('id', entry.id);
  // Paid means in, even if the hold had lapsed: WaitApp's tier capacity already stopped overselling.
  let { distance } = await loadDistance(svc, entry.distance_id);
  // The runner bought a different ticket type than the distance they filled in: they get the distance they paid for.
  if (t.tierName && distance.waitapp_tier_name && t.tierName !== distance.waitapp_tier_name) {
    const paidFor = (await distancesOf(svc, race.id)).find((d) => d.waitapp_tier_name === t.tierName);
    if (!paidFor) {
      await notifyUsers([race.organiser_id], 'race_payment_mismatch', { competitionId: race.id, title: race.name, runner: entry.runner_name, tier: t.tierName });
      return { handled: true };
    }
    await svc.from('race_entries').update({ distance_id: paidFor.id }).eq('id', entry.id);
    entry.distance_id = paidFor.id;
    distance = paidFor;
  }
  const bib = entry.bib ?? (await assignBib(svc, { ...entry, paid_ref: t.paymentId }, distance));
  await notifyUsers([entry.user_id], 'race_entry_confirmed', { competitionId: race.id, title: race.name, distance: distance.name, bib, runner: entry.runner_name });
  return { handled: true };
}

/** The WaitApp event behind a race, if `eventId` is one. */
export async function raceForEvent(svc: SupabaseClient, eventId: string): Promise<RaceRow | null> {
  const { data } = await svc.from('competitions').select('*').eq('waitapp_event_id', eventId).maybeSingle();
  const race = data as RaceRow | null;
  return race && race.kind === 'race' ? race : null;
}

/** ticket.refunded for a race: the entry is refunded and its place freed. The bib is never reused. */
export async function raceTicketsRefunded(svc: SupabaseClient, race: RaceRow, ticketIds: string[]) {
  const hit = (await entriesOf(svc, race.id)).filter((e) => (e.ticket_ids ?? []).some((t) => ticketIds.includes(t)) && e.status !== 'refunded');
  for (const e of hit) {
    await svc.from('race_entries').update({ status: 'refunded' }).eq('id', e.id);
    await notifyUsers([e.user_id], 'race_entry_refunded', { competitionId: race.id, title: race.name, runner: e.runner_name });
  }
  return { handled: true };
}

export async function cancelRaceEntry(svc: SupabaseClient, userId: string, raw: unknown) {
  const { entryId } = raceEntryIdSchema.parse(raw);
  const { data } = await svc.from('race_entries').select('*').eq('id', entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) throw new ActionError(404, 'Entry not found.');
  const race = await loadRace(svc, entry.competition_id);
  const organiser = race.organiser_id === userId;
  if (entry.user_id !== userId && !organiser) throw new ActionError(403, 'Only the runner who entered or the organiser can cancel.');
  if (entry.status === 'cancelled' || entry.status === 'refunded') return { state: entry.status };
  if (entry.paid_ref && !organiser) {
    throw new ActionError(409, 'This entry is paid. Ask the organiser to cancel it: refunds are handled on WaitApp under their policy.');
  }
  await svc.from('race_entries').update({ status: 'cancelled' }).eq('id', entry.id);
  if (organiser && entry.user_id !== userId) {
    await notifyUsers([entry.user_id], 'race_entry_cancelled', { competitionId: race.id, title: race.name, runner: entry.runner_name });
  }
  return { state: 'cancelled' };
}

export async function moveRaceEntry(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = moveRaceEntrySchema.parse(raw);
  const { data } = await svc.from('race_entries').select('*').eq('id', input.entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) throw new ActionError(404, 'Entry not found.');
  const race = await loadRace(svc, entry.competition_id);
  requireOrganiser(race, userId);
  const { distance } = await loadDistance(svc, input.distanceId);
  if (distance.competition_id !== race.id) throw new ActionError(400, 'That distance belongs to another race.');
  if (distance.id === entry.distance_id) return { state: 'unchanged' };
  const live = (await entriesOf(svc, race.id)).filter((e) => e.distance_id === distance.id && holding(e, new Date()));
  if (live.length >= distance.field_limit) throw new ActionError(409, `The ${distance.name} is full.`);
  await svc.from('race_entries').update({ distance_id: distance.id, bib: null }).eq('id', entry.id);
  await svc.from('race_results').delete().eq('entry_id', entry.id);
  const bib = entry.status === 'confirmed' ? await assignBib(svc, { ...entry, distance_id: distance.id }, distance) : null;
  await notifyUsers([entry.user_id], 'race_entry_moved', { competitionId: race.id, title: race.name, distance: distance.name, bib, runner: entry.runner_name });
  return { state: 'moved', bib };
}

export async function checkInRunner(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = checkInRunnerSchema.parse(raw);
  const { data } = await svc.from('race_entries').select('*').eq('id', input.entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) throw new ActionError(404, 'Entry not found.');
  const race = await loadRace(svc, entry.competition_id);
  if (!(await isOfficial(svc, race, userId, 'checkin'))) throw new ActionError(403, 'Only race check-in staff can do that.');
  if (entry.status !== 'confirmed') throw new ActionError(409, 'Only confirmed runners can collect a race pack.');
  await svc.from('race_entries').update({ checked_in_at: input.undo ? null : new Date().toISOString() }).eq('id', entry.id);
  return { state: input.undo ? 'undone' : 'checked_in', bib: entry.bib, tshirt: entry.tshirt };
}

// --- Race day: start gun, finish line, results ---------------------------------------------------

export async function startGun(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = startGunSchema.parse(raw);
  const { distance, race } = await loadDistance(svc, input.distanceId);
  if (!(await isOfficial(svc, race, userId, 'finish'))) throw new ActionError(403, 'Only race officials can start the clock.');
  if (input.clear) {
    const { data } = await svc.from('race_finish_marks').select('id').eq('distance_id', distance.id).eq('voided', false);
    if (((data ?? []) as unknown[]).length > 0) throw new ActionError(409, 'Runners have already finished. Fix the start time instead of clearing it.');
    await svc.from('race_distances').update({ gun_started_at: null }).eq('id', distance.id);
    return { state: 'cleared' };
  }
  const at = input.at ?? (deps.now ?? new Date()).toISOString();
  await svc.from('race_distances').update({ gun_started_at: at }).eq('id', distance.id);
  if (race.status === 'registration') await svc.from('competitions').update({ status: 'live' }).eq('id', race.id);
  // Changing the start time re-times every finish so far.
  await retimeDistance(svc, { ...distance, gun_started_at: at });
  return { state: 'started', at };
}

async function retimeDistance(svc: SupabaseClient, distance: DistanceRow) {
  if (!distance.gun_started_at) return;
  const { data } = await svc.from('race_results').select('entry_id,source').eq('distance_id', distance.id);
  const lineResults = ((data ?? []) as { entry_id: string; source: string }[]).filter((r) => r.source === 'line');
  if (lineResults.length === 0) return;
  const { data: marks } = await svc.from('race_finish_marks').select('*').eq('distance_id', distance.id).eq('voided', false);
  const entries = (await entriesOf(svc, distance.competition_id)).filter((e) => e.distance_id === distance.id);
  for (const r of lineResults) {
    const e = entries.find((x) => x.id === r.entry_id);
    const m = ((marks ?? []) as { bib: number | null; recorded_at: string }[]).filter((x) => x.bib === e?.bib).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))[0];
    if (!m) continue;
    const secs = Math.max(0, (new Date(m.recorded_at).getTime() - new Date(distance.gun_started_at).getTime()) / 1000);
    await svc.from('race_results').update({ gun_seconds: Math.round(secs * 10) / 10 }).eq('entry_id', r.entry_id);
  }
}

interface MarkRow {
  id: string;
  distance_id: string;
  bib: number | null;
  recorded_at: string;
  recorded_by: string | null;
  client_id: string;
  voided: boolean;
}

async function resultFromMark(svc: SupabaseClient, distance: DistanceRow, raceId: string, bib: number, recordedAt: string): Promise<{ entry: EntryRow | null; warning: string | null; seconds: number | null }> {
  const entries = await entriesOf(svc, raceId);
  const entry = entries.find((e) => e.bib === bib && e.status === 'confirmed') ?? null;
  if (!entry) return { entry: null, warning: `No confirmed runner has bib ${bib}.`, seconds: null };
  if (entry.distance_id !== distance.id) {
    const { data: other } = await svc.from('race_distances').select('name').eq('id', entry.distance_id).maybeSingle();
    return { entry, warning: `Bib ${bib} is entered in the ${(other as { name?: string } | null)?.name ?? 'other distance'}.`, seconds: null };
  }
  const { data: existing } = await svc.from('race_results').select('entry_id,source').eq('entry_id', entry.id).maybeSingle();
  if (existing) return { entry, warning: `Bib ${bib} has already finished.`, seconds: null };
  const seconds = distance.gun_started_at ? Math.max(0, (new Date(recordedAt).getTime() - new Date(distance.gun_started_at).getTime()) / 1000) : null;
  await svc.from('race_results').upsert({
    entry_id: entry.id,
    distance_id: distance.id,
    gun_seconds: seconds == null ? null : Math.round(seconds * 10) / 10,
    status: 'finished',
    source: 'line',
    updated_at: new Date().toISOString(),
  });
  return { entry, warning: null, seconds };
}

/**
 * A volunteer records a runner crossing the line: a bib, or a blank mark to fix later. Server time is used unless the
 * phone's time (sent when it was offline) is within two minutes of it. Idempotent per clientId, so a phone can resend.
 */
export async function finishMark(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = finishMarkSchema.parse(raw);
  const now = deps.now ?? new Date();
  const { distance, race } = await loadDistance(svc, input.distanceId);
  if (!(await isOfficial(svc, race, userId, 'finish'))) throw new ActionError(403, 'Only finish-line officials can record finishes.');
  if (!distance.gun_started_at) throw new ActionError(409, `Start the clock for the ${distance.name} first.`);
  const { data: dup } = await svc.from('race_finish_marks').select('*').eq('distance_id', distance.id).eq('client_id', input.clientId).maybeSingle();
  if (dup) return { state: 'duplicate', markId: (dup as MarkRow).id };
  const device = new Date(input.deviceAt).getTime();
  const recordedAt = Math.abs(device - now.getTime()) <= 120_000 || device < now.getTime() ? new Date(Math.min(device, now.getTime())).toISOString() : now.toISOString();
  // A queued mark from an offline phone may be minutes old: trust it only if it's after the gun and not in the future.
  const at = new Date(recordedAt).getTime() < new Date(distance.gun_started_at).getTime() ? now.toISOString() : recordedAt;
  const { data: mark, error } = await svc
    .from('race_finish_marks')
    .insert({ distance_id: distance.id, bib: input.bib, recorded_at: at, recorded_by: userId, client_id: input.clientId, voided: false })
    .select('id')
    .single();
  if (error) throw new ActionError(500, 'Could not record the finish.');
  const { data: all } = await svc.from('race_finish_marks').select('id').eq('distance_id', distance.id).eq('voided', false);
  const position = ((all ?? []) as unknown[]).length;
  let result: { entry: EntryRow | null; warning: string | null; seconds: number | null } = { entry: null, warning: null, seconds: null };
  if (input.bib != null) result = await resultFromMark(svc, distance, race.id, input.bib, at);
  return {
    state: 'recorded',
    markId: (mark as { id: string }).id,
    position,
    bib: input.bib,
    runner: result.entry?.runner_name ?? null,
    time: result.seconds != null ? formatDuration(result.seconds) : null,
    warning: result.warning,
  };
}

async function markForOfficial(svc: SupabaseClient, userId: string, markId: string) {
  const { data } = await svc.from('race_finish_marks').select('*').eq('id', markId).maybeSingle();
  const mark = data as MarkRow | null;
  if (!mark) throw new ActionError(404, 'Mark not found.');
  const { distance, race } = await loadDistance(svc, mark.distance_id);
  if (!(await isOfficial(svc, race, userId, 'finish'))) throw new ActionError(403, 'Only finish-line officials can change finishes.');
  return { mark, distance, race };
}

export async function voidMark(svc: SupabaseClient, userId: string, raw: unknown) {
  const { markId } = voidMarkSchema.parse(raw);
  const { mark, distance, race } = await markForOfficial(svc, userId, markId);
  await svc.from('race_finish_marks').update({ voided: true }).eq('id', mark.id);
  if (mark.bib != null) {
    const { data: others } = await svc.from('race_finish_marks').select('id,bib,voided').eq('distance_id', distance.id).eq('bib', mark.bib).eq('voided', false);
    if (((others ?? []) as unknown[]).length === 0) {
      const entry = (await entriesOf(svc, race.id)).find((e) => e.bib === mark.bib);
      if (entry) {
        const { data: res } = await svc.from('race_results').select('source').eq('entry_id', entry.id).maybeSingle();
        if ((res as { source?: string } | null)?.source === 'line') await svc.from('race_results').delete().eq('entry_id', entry.id);
      }
    }
  }
  return { state: 'voided' };
}

export async function resolveMark(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = resolveMarkSchema.parse(raw);
  const { mark, distance, race } = await markForOfficial(svc, userId, input.markId);
  if (mark.voided) throw new ActionError(409, 'That mark was undone.');
  await svc.from('race_finish_marks').update({ bib: input.bib }).eq('id', mark.id);
  const r = await resultFromMark(svc, distance, race.id, input.bib, mark.recorded_at);
  return { state: 'resolved', runner: r.entry?.runner_name ?? null, warning: r.warning };
}

export async function importResults(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = importResultsSchema.parse(raw);
  const { distance, race } = await loadDistance(svc, input.distanceId);
  requireOrganiser(race, userId);
  const entries = (await entriesOf(svc, race.id)).filter((e) => e.distance_id === distance.id && e.status === 'confirmed' && e.bib != null);
  const byBib = new Map(entries.map((e) => [e.bib!, e]));
  if (input.mode === 'replace') await svc.from('race_results').delete().eq('distance_id', distance.id);
  const unknown: number[] = [];
  let imported = 0;
  for (const r of input.rows) {
    const e = byBib.get(r.bib);
    if (!e) {
      unknown.push(r.bib);
      continue;
    }
    await svc.from('race_results').upsert({
      entry_id: e.id,
      distance_id: distance.id,
      gun_seconds: r.gunSeconds ?? r.chipSeconds,
      chip_seconds: r.chipSeconds,
      status: r.status,
      source: 'csv',
      updated_at: new Date().toISOString(),
    });
    imported += 1;
  }
  return { state: 'imported', imported, unknownBibs: unknown };
}

export async function setResult(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = setResultSchema.parse(raw);
  const { data } = await svc.from('race_entries').select('*').eq('id', input.entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) throw new ActionError(404, 'Entry not found.');
  const race = await loadRace(svc, entry.competition_id);
  requireOrganiser(race, userId);
  if (input.status === 'finished' && input.gunSeconds == null && input.chipSeconds == null) throw new ActionError(400, 'Give a finish time.');
  await svc.from('race_results').upsert({
    entry_id: entry.id,
    distance_id: entry.distance_id,
    gun_seconds: input.status === 'finished' ? (input.gunSeconds ?? input.chipSeconds ?? null) : null,
    chip_seconds: input.status === 'finished' ? (input.chipSeconds ?? null) : null,
    status: input.status,
    source: 'manual',
    updated_at: new Date().toISOString(),
  });
  return { state: 'saved' };
}

/** Ranks a distance's results (overall, gender, age group) and shows them to everyone; runners hear their time. */
export async function publishResults(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = publishResultsSchema.parse(raw);
  const { distance, race } = await loadDistance(svc, input.distanceId);
  requireOrganiser(race, userId);
  if (!input.publish) {
    await svc.from('race_distances').update({ results_published: false }).eq('id', distance.id);
    return { state: 'hidden' };
  }
  const { data } = await svc.from('race_results').select('*').eq('distance_id', distance.id);
  const results = (data ?? []) as { entry_id: string; gun_seconds: number | string | null; chip_seconds: number | string | null; status: ResultStatus }[];
  const entries = new Map((await entriesOf(svc, race.id)).map((e) => [e.id, e]));
  const ranks = rankResults(
    results.map((r) => ({
      entryId: r.entry_id,
      gender: entries.get(r.entry_id)?.gender ?? 'male',
      ageGroup: entries.get(r.entry_id)?.age_group ?? null,
      status: r.status,
      seconds: num(r.chip_seconds) ?? num(r.gun_seconds),
    })),
  );
  for (const [entryId, pos] of ranks) {
    await svc.from('race_results').update({ overall_pos: pos.overall, gender_pos: pos.gender, age_pos: pos.age }).eq('entry_id', entryId);
  }
  const firstTime = !distance.results_published;
  await svc.from('race_distances').update({ results_published: true }).eq('id', distance.id);
  const finishers = results.filter((r) => r.status === 'finished').length;
  if (firstTime) {
    for (const r of results) {
      const e = entries.get(r.entry_id);
      if (!e) continue;
      const pos = ranks.get(r.entry_id);
      await notifyUsers([e.user_id], 'race_result', {
        competitionId: race.id,
        title: race.name,
        distance: distance.name,
        runner: e.runner_name,
        time: formatDuration(num(r.chip_seconds) ?? num(r.gun_seconds)),
        position: pos?.overall ?? null,
        of: finishers,
        status: r.status,
      });
    }
  }
  if (firstTime) await eventNewsToCircle(svc, race.id, `${race.name}: ${distance.name} results are out (${finishers} finishers).`);
  const allDone = (await distancesOf(svc, race.id)).every((d) => d.id === distance.id || d.results_published);
  if (allDone) await svc.from('competitions').update({ status: 'finished' }).eq('id', race.id);
  return { state: 'published', finishers };
}

// --- Reads ------------------------------------------------------------------------------------

export async function getRaceView(svc: SupabaseClient, userId: string, raceId: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const race = await loadRace(svc, raceId);
  await expireStalePending(svc, race.id, now);
  const [distances, entries, routesRes, sponsorsRes, officialsRes] = await Promise.all([
    distancesOf(svc, race.id),
    entriesOf(svc, race.id),
    svc.from('race_routes').select('*').in('distance_id', (await distancesOf(svc, race.id)).map((d) => d.id)),
    svc.from('competition_sponsors').select('*').eq('competition_id', race.id).order('sort'),
    svc.from('race_officials').select('user_id,role').eq('competition_id', race.id),
  ]);
  const roles = ((officialsRes.data ?? []) as { user_id: string; role: string }[]).filter((o) => o.user_id === userId).map((o) => o.role);
  const mineIds = entries.filter((e) => e.user_id === userId).map((e) => e.id);
  const { data: myResults } = mineIds.length ? await svc.from('race_results').select('*').in('entry_id', mineIds) : { data: [] };
  const { data: orgProfile } = await svc.from('profiles').select('name').eq('id', race.organiser_id).maybeSingle();
  return {
    race: { ...race, organiser_name: (orgProfile as { name?: string } | null)?.name ?? null },
    settings: settingsOf(race),
    isOrganiser: race.organiser_id === userId,
    roles,
    distances: distances.map((d) => ({
      ...d,
      entered: entries.filter((e) => e.distance_id === d.id && e.status === 'confirmed').length,
      held: entries.filter((e) => e.distance_id === d.id && holding(e, now)).length,
    })),
    routes: (routesRes.data ?? []) as { distance_id: string; points: RoutePoint[]; source: string; distance_m: number; climb_m: number; pois: unknown[] }[],
    sponsors: sponsorsRes.data ?? [],
    startList: entries
      .filter((e) => e.status === 'confirmed')
      .map((e) => ({ bib: e.bib, name: e.runner_name, club: e.club, distanceId: e.distance_id, wave: e.wave }))
      .sort((a, b) => (a.bib ?? 0) - (b.bib ?? 0)),
    mine: entries
      .filter((e) => e.user_id === userId && e.status !== 'cancelled')
      .map((e) => ({ ...e, result: ((myResults ?? []) as { entry_id: string }[]).find((r) => r.entry_id === e.id) ?? null })),
  };
}

export async function getRaceEntries(svc: SupabaseClient, userId: string, raceId: string) {
  const race = await loadRace(svc, raceId);
  const checkin = await isOfficial(svc, race, userId, 'checkin');
  if (race.organiser_id !== userId && !checkin) throw new ActionError(403, 'Only the organiser and race staff can see entries.');
  const entries = (await entriesOf(svc, race.id)).filter((e) => e.status !== 'cancelled');
  const ids = entries.map((e) => e.id);
  const { data: priv } = ids.length && race.organiser_id === userId ? await svc.from('race_entry_private').select('*').in('entry_id', ids) : { data: [] };
  const { data: res } = ids.length ? await svc.from('race_results').select('*').in('entry_id', ids) : { data: [] };
  const p = new Map(((priv ?? []) as { entry_id: string }[]).map((x) => [x.entry_id, x]));
  const r = new Map(((res ?? []) as { entry_id: string }[]).map((x) => [x.entry_id, x]));
  return {
    entries: entries
      .map((e) => ({ ...e, private: p.get(e.id) ?? null, result: r.get(e.id) ?? null }))
      .sort((a, b) => (a.bib ?? 1e9) - (b.bib ?? 1e9) || a.runner_name.localeCompare(b.runner_name)),
  };
}

export async function getLineState(svc: SupabaseClient, userId: string, distanceId: string) {
  const { distance, race } = await loadDistance(svc, distanceId);
  if (!(await isOfficial(svc, race, userId, 'finish'))) throw new ActionError(403, 'Only finish-line officials can open the finish line.');
  const { data } = await svc.from('race_finish_marks').select('*').eq('distance_id', distance.id).order('recorded_at', { ascending: false });
  const marks = ((data ?? []) as MarkRow[]).filter((m) => !m.voided);
  const entries = (await entriesOf(svc, race.id)).filter((e) => e.status === 'confirmed');
  const byBib = new Map(entries.map((e) => [e.bib, e]));
  const ordered = [...marks].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const position = new Map(ordered.map((m, i) => [m.id, i + 1]));
  const gun = distance.gun_started_at ? new Date(distance.gun_started_at).getTime() : null;
  return {
    race: { id: race.id, name: race.name },
    distance: { id: distance.id, name: distance.name, gunStartedAt: distance.gun_started_at, km: distance.distance_km },
    otherDistances: (await distancesOf(svc, race.id)).map((d) => ({ id: d.id, name: d.name, gunStartedAt: d.gun_started_at })),
    finished: marks.length,
    starters: entries.filter((e) => e.distance_id === distance.id).length,
    marks: marks.slice(0, 40).map((m) => ({
      id: m.id,
      bib: m.bib,
      position: position.get(m.id) ?? null,
      runner: m.bib != null ? (byBib.get(m.bib)?.runner_name ?? null) : null,
      wrongDistance: m.bib != null && byBib.get(m.bib) != null && byBib.get(m.bib)!.distance_id !== distance.id,
      time: gun ? formatDuration((new Date(m.recorded_at).getTime() - gun) / 1000) : null,
      recordedAt: m.recorded_at,
    })),
  };
}

export async function getRaceResults(svc: SupabaseClient, userId: string, raceId: string) {
  const race = await loadRace(svc, raceId);
  const distances = await distancesOf(svc, race.id);
  const visible = distances.filter((d) => d.results_published || race.organiser_id === userId);
  const ids = visible.map((d) => d.id);
  const { data } = ids.length ? await svc.from('race_results').select('*').in('distance_id', ids) : { data: [] };
  const entries = new Map((await entriesOf(svc, race.id)).map((e) => [e.id, e]));
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const e = entries.get(String(r['entry_id']));
    return {
      entryId: String(r['entry_id']),
      distanceId: String(r['distance_id']),
      bib: e?.bib ?? null,
      name: e?.runner_name ?? '',
      club: e?.club ?? null,
      gender: e?.gender ?? null,
      ageGroup: e?.age_group ?? null,
      gunSeconds: num(r['gun_seconds']),
      chipSeconds: num(r['chip_seconds']),
      status: r['status'] as ResultStatus,
      overall: num(r['overall_pos']),
      genderPos: num(r['gender_pos']),
      agePos: num(r['age_pos']),
      mine: e?.user_id === userId,
    };
  });
  return {
    distances: visible.map((d) => ({ id: d.id, name: d.name, km: d.distance_km, published: d.results_published })),
    results: rows.sort((a, b) => (a.overall ?? 1e9) - (b.overall ?? 1e9) || (a.gunSeconds ?? 1e9) - (b.gunSeconds ?? 1e9)),
  };
}

export async function myRaces(svc: SupabaseClient, userId: string) {
  const { data } = await svc.from('race_entries').select('*').eq('user_id', userId);
  const entries = ((data ?? []) as EntryRow[]).filter((e) => e.status === 'confirmed' || e.status === 'pending_payment');
  if (entries.length === 0) return [];
  const raceIds = [...new Set(entries.map((e) => e.competition_id))];
  const { data: races } = await svc.from('competitions').select('id,name,starts_on,area,banner_url').in('id', raceIds);
  const { data: dists } = await svc.from('race_distances').select('*').in('competition_id', raceIds);
  const { data: res } = await svc.from('race_results').select('*').in('entry_id', entries.map((e) => e.id));
  const rMap = new Map(((races ?? []) as { id: string }[]).map((r) => [r.id, r]));
  const dMap = new Map(((dists ?? []) as Record<string, unknown>[]).map((d) => [String(d['id']), normDistance(d)]));
  const resMap = new Map(((res ?? []) as { entry_id: string }[]).map((r) => [r.entry_id, r]));
  return entries
    .map((e) => {
      const d = dMap.get(e.distance_id);
      const result = resMap.get(e.id) as Record<string, unknown> | undefined;
      const published = !!d?.results_published;
      return {
        entryId: e.id,
        race: rMap.get(e.competition_id) ?? null,
        distance: d ? { id: d.id, name: d.name, km: d.distance_km, startsAt: d.starts_at } : null,
        runner: e.runner_name,
        bib: e.bib,
        wave: e.wave,
        status: e.status,
        result:
          result && published
            ? { seconds: num(result['chip_seconds']) ?? num(result['gun_seconds']), status: result['status'] as ResultStatus, overall: num(result['overall_pos']), genderPos: num(result['gender_pos']), agePos: num(result['age_pos']) }
            : null,
      };
    })
    .sort((a, b) => (b.distance?.startsAt ?? '').localeCompare(a.distance?.startsAt ?? ''));
}

/**
 * What someone needs to fill in to enter this race, for an entry form outside Chabuka (WaitApp). Public: the race
 * page already shows all of this. Rules are checked again by enterRace when the entry is sent.
 */
export async function raceEntryForm(svc: SupabaseClient, raceId: string, now = new Date()) {
  const race = await loadRace(svc, raceId);
  const settings = settingsOf(race);
  const entries = await entriesOf(svc, race.id);
  const distances = (await distancesOf(svc, race.id)).map((d) => ({
    id: d.id,
    name: d.name,
    km: d.distance_km,
    startsAt: d.starts_at,
    price: d.price,
    currency: d.currency,
    minAge: d.min_age,
    spotsLeft: Math.max(0, d.field_limit - entries.filter((e) => e.distance_id === d.id && holding(e, now)).length),
  }));
  const open = race.status === 'registration' && !(race.registration_closes_at && new Date(race.registration_closes_at) < now);
  return {
    kind: 'race' as const,
    competitionId: race.id,
    name: race.name,
    area: race.area,
    location: race.location,
    startsOn: race.starts_on,
    bannerUrl: race.banner_url,
    open,
    closesAt: race.registration_closes_at,
    distances,
    tshirts: settings.tshirts,
    tshirtSizes: TSHIRT_SIZES,
    waiverText: settings.waiverText,
    questions: (race.registration_questions ?? []).map((q) => ({ label: q.label, required: q.required })),
  };
}
