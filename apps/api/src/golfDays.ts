import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  autoGroups,
  buildFlightsSchema,
  claimScorerSchema,
  createGolfDaySchema,
  enterGolfDaySchema,
  golfEntryIdSchema,
  golfLeaderboard,
  planFlights,
  playingHandicap,
  publishGolfResultsSchema,
  saveGolfScoresSchema,
  setSideResultSchema,
  updateGolfDaySettingsSchema,
} from '@chabuka/shared';
import type { GolfDaySettings, HoleScores } from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';
import { detailColumns } from './competitions.js';
import { getCourse, roundsFromGolfDay } from './golf.js';
import type { CourseView } from './golf.js';
import { waitappCall } from './waitapp.js';

// Golf days (G3) and their scoring (G4). Modelled on races (races.ts): a competition row with kind 'golf_day', individual
// entries held for 30 minutes while a paid entry is checked out on WaitApp (ref "golf:<entryId>"), flights of up to four,
// then hole-by-hole scores kept by one scorer per flight with the organiser able to correct anything until results are
// published.

const PENDING_HOLD_MS = 30 * 60_000;
type Deps = { now?: Date; fetch?: typeof fetch };

interface GolfDayRow {
  id: string;
  organiser_id: string;
  sport_id: string;
  name: string;
  kind: string;
  status: string;
  area: string | null;
  location: string | null;
  starts_on: string;
  description: string | null;
  banner_url: string | null;
  circle_id?: string | null;
  golf_settings: GolfDaySettings | null;
  golf_results_published_at: string | null;
  waitapp_event_id: string | null;
  waitapp_checkout_url: string | null;
  registration_closes_at: string | null;
  [k: string]: unknown;
}

interface EntryRow {
  id: string;
  competition_id: string;
  user_id: string;
  player_name: string;
  handicap_index: number | string;
  phone: string | null;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded';
  flight_id: string | null;
  paid_ref: string | null;
  ticket_ids: string[] | null;
  checked_in_at: string | null;
  created_at: string;
}

interface FlightRow {
  id: string;
  competition_id: string;
  label: string;
  tee_time: string | null;
  start_hole: number;
  sort: number;
  scorer_entry_id: string | null;
}

export async function loadGolfDay(svc: SupabaseClient, id: string): Promise<GolfDayRow & { golf_settings: GolfDaySettings }> {
  const { data } = await svc.from('competitions').select('*').eq('id', id).maybeSingle();
  const g = data as GolfDayRow | null;
  if (!g || g.kind !== 'golf_day' || !g.golf_settings) throw new ActionError(404, 'Golf day not found.');
  return g as GolfDayRow & { golf_settings: GolfDaySettings };
}

const requireOrganiser = (g: GolfDayRow, userId: string) => {
  if (g.organiser_id !== userId) throw new ActionError(403, 'Only the organiser can do that.');
};

const hcp = (e: Pick<EntryRow, 'handicap_index'>) => Number(e.handicap_index);
const holding = (e: EntryRow, now: Date) => e.status === 'confirmed' || (e.status === 'pending_payment' && now.getTime() - new Date(e.created_at).getTime() < PENDING_HOLD_MS);

async function entriesOf(svc: SupabaseClient, golfDayId: string): Promise<EntryRow[]> {
  const { data } = await svc.from('golf_entries').select('*').eq('competition_id', golfDayId);
  return (data ?? []) as EntryRow[];
}

async function flightsOf(svc: SupabaseClient, golfDayId: string): Promise<FlightRow[]> {
  const { data } = await svc.from('golf_flights').select('*').eq('competition_id', golfDayId).order('sort');
  return ((data ?? []) as FlightRow[]).sort((a, b) => a.sort - b.sort);
}

/** The course must be one the organiser can use: a course at an approved venue, or one they entered themselves. */
async function usableCourse(svc: SupabaseClient, userId: string, courseId: string): Promise<CourseView> {
  const course = await getCourse(svc, courseId);
  if (course.venueId) {
    const { data } = await svc.from('venues').select('status').eq('id', course.venueId).maybeSingle();
    if ((data as { status?: string } | null)?.status !== 'approved') throw new ActionError(409, 'That course is not open yet.');
  } else {
    const { data } = await svc.from('golf_courses').select('created_by').eq('id', courseId).maybeSingle();
    if ((data as { created_by?: string } | null)?.created_by !== userId) throw new ActionError(403, 'Pick a course on Chabuka or one you entered.');
  }
  return course;
}

// --- Setup ------------------------------------------------------------------------------------------

export async function createGolfDay(svc: SupabaseClient, userId: string, raw: unknown) {
  const parsed = createGolfDaySchema.safeParse(raw);
  if (!parsed.success) throw new ActionError(400, parsed.error.issues[0]?.message ?? 'Check the golf day.');
  const input = parsed.data;
  const course = await usableCourse(svc, userId, input.settings.courseId);
  const { data: sport } = await svc.from('sports').select('id').eq('name', 'golf').maybeSingle();
  if (!sport) throw new ActionError(503, 'Golf is not set up yet.');
  const id = crypto.randomUUID();
  const { error } = await svc.from('competitions').insert({
    id,
    organiser_id: userId,
    sport_id: (sport as { id: string }).id,
    name: input.name,
    kind: 'golf_day',
    format: 'golf',
    category: input.category,
    area: input.area,
    starts_on: input.settings.firstTeeAt.slice(0, 10),
    max_entries: input.settings.fieldLimit,
    status: 'registration',
    requires_approval: false,
    golf_settings: input.settings,
    ...detailColumns({ ...input, location: input.location ?? course.name }),
  });
  if (error) throw new ActionError(500, 'Could not create the golf day.');
  return { competitionId: id };
}

export async function updateGolfDaySettings(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = updateGolfDaySettingsSchema.parse(raw);
  const g = await loadGolfDay(svc, input.competitionId);
  requireOrganiser(g, userId);
  if (input.settings.courseId !== g.golf_settings.courseId) {
    const entries = await entriesOf(svc, g.id);
    const { data } = entries.length ? await svc.from('golf_scores').select('entry_id').in('entry_id', entries.map((e) => e.id)).limit(1) : { data: [] };
    if ((data ?? []).length) throw new ActionError(409, 'Scores are already in: the course can no longer change.');
    await usableCourse(svc, userId, input.settings.courseId);
  }
  if (g.waitapp_event_id && input.settings.entryFee !== g.golf_settings.entryFee) {
    throw new ActionError(409, 'Paid entries are on sale: change the fee on WaitApp instead.');
  }
  await svc.from('competitions').update({ golf_settings: input.settings, max_entries: input.settings.fieldLimit }).eq('id', g.id);
  return { state: 'saved' };
}

/** A paid golf day goes on sale on WaitApp (one ticket type, "Entry"). Free ones need nothing. */
export async function openGolfEntries(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const { competitionId } = publishGolfResultsSchema.parse(raw);
  const g = await loadGolfDay(svc, competitionId);
  requireOrganiser(g, userId);
  const s = g.golf_settings;
  if (s.entryFee <= 0) return { state: 'free', checkoutUrl: null };
  if (g.waitapp_event_id) return { state: 'open', checkoutUrl: g.waitapp_checkout_url };
  const { status, data } = await waitappCall(
    svc,
    userId,
    '/api/partner/chabuka/events',
    {
      method: 'POST',
      body: {
        chabukaMatchId: g.id,
        title: g.name,
        ...(g.description ? { description: g.description.slice(0, 1000) } : {}),
        date: s.firstTeeAt,
        ...(g.location ? { venue: g.location.slice(0, 160) } : {}),
        ...(g.area ? { city: g.area } : {}),
        ...(g.banner_url ? { imageUrl: g.banner_url } : {}),
        capacity: s.fieldLimit,
        tiers: [{ name: 'Entry', price: s.entryFee, capacity: s.fieldLimit }],
      },
    },
    deps,
  );
  if (status >= 400 || typeof data['eventId'] !== 'string') {
    throw new ActionError(status === 409 ? 409 : 400, typeof data['error'] === 'string' ? (data['error'] as string) : 'WaitApp could not put the golf day on sale.');
  }
  await svc.from('competitions').update({ waitapp_event_id: data['eventId'], waitapp_checkout_url: String(data['checkoutUrl'] ?? '') }).eq('id', g.id);
  return { state: 'open', checkoutUrl: String(data['checkoutUrl'] ?? '') };
}

// --- Entering ---------------------------------------------------------------------------------------

export async function enterGolfDay(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const parsed = enterGolfDaySchema.safeParse(raw);
  if (!parsed.success) throw new ActionError(400, parsed.error.issues[0]?.message ?? 'Check the entry.');
  const input = parsed.data;
  const now = deps.now ?? new Date();
  const g = await loadGolfDay(svc, input.competitionId);
  const s = g.golf_settings;
  if (g.status !== 'registration') throw new ActionError(409, 'Entries for this golf day are closed.');
  if (g.registration_closes_at && new Date(g.registration_closes_at) < now) throw new ActionError(409, 'Entries for this golf day have closed.');
  if (input.handicapIndex > s.maxHandicap) throw new ActionError(409, `This golf day takes handicaps up to ${s.maxHandicap}.`);
  const entries = await entriesOf(svc, g.id);
  if (entries.filter((e) => holding(e, now)).length >= s.fieldLimit) throw new ActionError(409, 'The field is full.');
  if (entries.some((e) => e.user_id === userId && holding(e, now) && e.player_name.toLowerCase() === input.playerName.toLowerCase())) {
    throw new ActionError(409, `${input.playerName} is already entered.`);
  }
  const id = crypto.randomUUID();
  const free = s.entryFee <= 0;
  const row = {
    id,
    competition_id: g.id,
    user_id: userId,
    player_name: input.playerName,
    handicap_index: input.handicapIndex,
    phone: input.phone,
    status: free ? 'confirmed' : 'pending_payment',
    ticket_ids: [] as string[],
    created_at: now.toISOString(),
  };
  const { error } = await svc.from('golf_entries').insert(row);
  if (error) throw new ActionError(500, 'Could not save the entry.');
  if (free) {
    await notifyUsers([userId], 'golf_entry_confirmed', { competitionId: g.id, title: g.name, player: input.playerName });
    return { state: 'confirmed', entryId: id, checkoutUrl: null };
  }
  if (!g.waitapp_checkout_url) {
    await svc.from('golf_entries').update({ status: 'cancelled' }).eq('id', id);
    throw new ActionError(409, 'Paid entry for this golf day is not open yet. Check back soon.');
  }
  const sep = g.waitapp_checkout_url.includes('?') ? '&' : '?';
  const checkoutUrl = `${g.waitapp_checkout_url}${sep}cref=${encodeURIComponent(`golf:${id}`)}&qty=1`;
  return { state: 'pending_payment', entryId: id, checkoutUrl, holdMinutes: PENDING_HOLD_MS / 60_000 };
}

/** ticket.issued with ref "golf:<entryId>": the entry is paid. Idempotent on the payment id. */
export async function confirmGolfFromTicket(svc: SupabaseClient, t: { eventId: string; paymentId: string; ticketIds: string[]; ref: string }): Promise<{ handled: boolean }> {
  const entryId = /^golf:([0-9a-f-]{36})$/i.exec(t.ref)?.[1];
  if (!entryId) return { handled: false };
  const { data } = await svc.from('golf_entries').select('*').eq('id', entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) return { handled: false };
  const g = await loadGolfDay(svc, entry.competition_id);
  if (g.waitapp_event_id !== t.eventId) throw new ActionError(400, 'That payment is for another event.');
  if (entry.paid_ref === t.paymentId || entry.status === 'refunded') return { handled: true };
  // Paid means in, even if the hold lapsed: WaitApp's ticket capacity already stopped overselling.
  await svc.from('golf_entries').update({ paid_ref: t.paymentId, ticket_ids: t.ticketIds, status: 'confirmed' }).eq('id', entry.id);
  await notifyUsers([entry.user_id], 'golf_entry_confirmed', { competitionId: g.id, title: g.name, player: entry.player_name });
  return { handled: true };
}

/** The WaitApp event behind a golf day, if `eventId` is one. */
export async function golfDayForEvent(svc: SupabaseClient, eventId: string): Promise<GolfDayRow | null> {
  const { data } = await svc.from('competitions').select('*').eq('waitapp_event_id', eventId).maybeSingle();
  const g = data as GolfDayRow | null;
  return g && g.kind === 'golf_day' ? g : null;
}

export async function golfTicketsRefunded(svc: SupabaseClient, g: GolfDayRow, ticketIds: string[]) {
  const hit = (await entriesOf(svc, g.id)).filter((e) => (e.ticket_ids ?? []).some((t) => ticketIds.includes(t)) && e.status !== 'refunded');
  for (const e of hit) {
    await svc.from('golf_entries').update({ status: 'refunded', flight_id: null }).eq('id', e.id);
    await notifyUsers([e.user_id], 'golf_entry_refunded', { competitionId: g.id, title: g.name, player: e.player_name });
  }
  return { handled: true };
}

export async function cancelGolfEntry(svc: SupabaseClient, userId: string, raw: unknown) {
  const { entryId } = golfEntryIdSchema.parse(raw);
  const { data } = await svc.from('golf_entries').select('*').eq('id', entryId).maybeSingle();
  const entry = data as EntryRow | null;
  if (!entry) throw new ActionError(404, 'Entry not found.');
  const g = await loadGolfDay(svc, entry.competition_id);
  const organiser = g.organiser_id === userId;
  if (entry.user_id !== userId && !organiser) throw new ActionError(403, 'Only the player who entered or the organiser can cancel.');
  if (entry.status === 'cancelled' || entry.status === 'refunded') return { state: entry.status };
  if (entry.paid_ref && !organiser) throw new ActionError(409, 'This entry is paid. Ask the organiser: refunds are handled on WaitApp under their policy.');
  await svc.from('golf_entries').update({ status: 'cancelled', flight_id: null }).eq('id', entry.id);
  if (organiser && entry.user_id !== userId) await notifyUsers([entry.user_id], 'golf_entry_cancelled', { competitionId: g.id, title: g.name, player: entry.player_name });
  return { state: 'cancelled' };
}

// --- Flights ----------------------------------------------------------------------------------------

export async function buildFlights(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = buildFlightsSchema.parse(raw);
  const g = await loadGolfDay(svc, input.competitionId);
  requireOrganiser(g, userId);
  if (g.golf_results_published_at) throw new ActionError(409, 'Results are published.');
  const course = await getCourse(svc, g.golf_settings.courseId);
  // Only confirmed (paid or free) players are grouped; a payment still in progress joins when it lands.
  const confirmed = (await entriesOf(svc, g.id)).filter((e) => e.status === 'confirmed');
  const ids = new Set(confirmed.map((e) => e.id));
  let groups: string[][];
  if (input.mode === 'manual') {
    groups = input.groups ?? [];
    const seen = new Set<string>();
    for (const grp of groups) {
      for (const id of grp) {
        if (!ids.has(id)) throw new ActionError(400, 'Every player in a flight must have a confirmed entry.');
        if (seen.has(id)) throw new ActionError(400, 'A player can only be in one flight.');
        seen.add(id);
      }
    }
  } else {
    groups = autoGroups(confirmed.map((e) => ({ id: e.id, handicapIndex: hcp(e) })));
  }
  if (!groups.length) throw new ActionError(409, 'No confirmed players to group yet.');
  const plan = planFlights(groups, g.golf_settings, course.holes);
  // Rebuild from scratch: entries first lose their flight, then the old flights go.
  await svc.from('golf_entries').update({ flight_id: null }).eq('competition_id', g.id);
  await svc.from('golf_flights').delete().eq('competition_id', g.id);
  const byId = new Map(confirmed.map((e) => [e.id, e]));
  const made: { id: string; label: string; teeTime: string | null; startHole: number | null; players: string[] }[] = [];
  for (const [i, f] of plan.entries()) {
    const fid = crypto.randomUUID();
    const { error } = await svc.from('golf_flights').insert({ id: fid, competition_id: g.id, label: f.label, tee_time: f.teeTime, start_hole: f.startHole ?? 1, sort: i });
    if (error) throw new ActionError(500, 'Could not save the flights.');
    for (const eid of f.entryIds) await svc.from('golf_entries').update({ flight_id: fid }).eq('id', eid);
    made.push({ id: fid, label: f.label, teeTime: f.teeTime, startHole: f.startHole, players: f.entryIds.map((e) => byId.get(e)?.player_name ?? 'Player') });
  }
  if (input.notify) {
    for (const f of made) {
      const flight = plan.find((p) => p.label === f.label)!;
      const users = [...new Set(flight.entryIds.map((e) => byId.get(e)?.user_id).filter((u): u is string => !!u))];
      await notifyUsers(users, 'golf_flight', { competitionId: g.id, title: g.name, flight: f.label, teeTime: f.teeTime, startHole: f.startHole, players: f.players });
    }
  }
  return { state: 'built', flights: made };
}

// --- Scoring (G4) -----------------------------------------------------------------------------------

/** A player in a flight takes the card for the whole flight (only while no one else has it). */
export async function claimScorer(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = claimScorerSchema.parse(raw);
  const g = await loadGolfDay(svc, input.competitionId);
  if (g.golf_results_published_at) throw new ActionError(409, 'Results are published.');
  const flight = (await flightsOf(svc, g.id)).find((f) => f.id === input.flightId);
  if (!flight) throw new ActionError(404, 'Flight not found.');
  const mine = (await entriesOf(svc, g.id)).find((e) => e.flight_id === flight.id && e.user_id === userId && e.status === 'confirmed');
  if (!mine && g.organiser_id !== userId) throw new ActionError(403, 'Only a player in this flight can keep its card.');
  if (flight.scorer_entry_id && flight.scorer_entry_id !== mine?.id && g.organiser_id !== userId) throw new ActionError(409, 'Someone in your flight is already keeping the card.');
  if (mine) await svc.from('golf_flights').update({ scorer_entry_id: mine.id }).eq('id', flight.id);
  return { state: 'scorer', flightId: flight.id };
}

export async function saveGolfScores(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const input = saveGolfScoresSchema.parse(raw);
  const g = await loadGolfDay(svc, input.competitionId);
  if (g.golf_results_published_at) throw new ActionError(409, 'Results are published: scores are locked.');
  const course = await getCourse(svc, g.golf_settings.courseId);
  const entries = await entriesOf(svc, g.id);
  const flights = await flightsOf(svc, g.id);
  const organiser = g.organiser_id === userId;
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const sc of input.scores) {
    const e = byId.get(sc.entryId);
    if (!e || e.status !== 'confirmed') throw new ActionError(404, 'That player is not in this golf day.');
    if (sc.holeNo > course.holes) throw new ActionError(400, `This course has ${course.holes} holes.`);
    if (organiser) continue;
    const flight = flights.find((f) => f.id === e.flight_id);
    const scorer = flight?.scorer_entry_id ? byId.get(flight.scorer_entry_id) : null;
    // The flight's scorer keeps everyone's card; before anyone claims it, a player may enter their own.
    const allowed = scorer ? scorer.user_id === userId : e.user_id === userId;
    if (!allowed) throw new ActionError(403, scorer ? 'Your flight\'s scorer keeps the card.' : 'You can only enter your own score until someone keeps the flight\'s card.');
  }
  const at = (deps.now ?? new Date()).toISOString();
  for (const sc of input.scores) {
    const { error } = await svc
      .from('golf_scores')
      .upsert({ entry_id: sc.entryId, hole_no: sc.holeNo, strokes: sc.strokes, entered_by: userId, updated_at: at }, { onConflict: 'entry_id,hole_no' });
    if (error) throw new ActionError(500, 'Could not save the score.');
  }
  if (g.status === 'registration') await svc.from('competitions').update({ status: 'live' }).eq('id', g.id);
  return { state: 'saved', count: input.scores.length };
}

export async function setSideResult(svc: SupabaseClient, userId: string, raw: unknown) {
  const input = setSideResultSchema.parse(raw);
  const g = await loadGolfDay(svc, input.competitionId);
  requireOrganiser(g, userId);
  if (!g.golf_settings.sideContests.some((c) => c.type === input.type && c.hole === input.hole)) throw new ActionError(400, 'That contest is not part of this golf day.');
  if (input.entryId) {
    const e = (await entriesOf(svc, g.id)).find((x) => x.id === input.entryId && x.status === 'confirmed');
    if (!e) throw new ActionError(404, 'That player is not in this golf day.');
  }
  await svc
    .from('golf_side_results')
    .upsert({ competition_id: g.id, type: input.type, hole: input.hole, entry_id: input.entryId, note: input.note || null }, { onConflict: 'competition_id,type,hole' });
  return { state: 'saved' };
}

export async function publishGolfResults(svc: SupabaseClient, userId: string, raw: unknown, deps: Deps = {}) {
  const { competitionId } = publishGolfResultsSchema.parse(raw);
  const g = await loadGolfDay(svc, competitionId);
  requireOrganiser(g, userId);
  if (g.golf_results_published_at) return { state: 'published' };
  const at = (deps.now ?? new Date()).toISOString();
  await svc.from('competitions').update({ golf_results_published_at: at, status: 'finished' }).eq('id', g.id);
  const confirmed = (await entriesOf(svc, g.id)).filter((e) => e.status === 'confirmed');
  const users = [...new Set(confirmed.map((e) => e.user_id))];
  await notifyUsers(users, 'golf_results', { competitionId: g.id, title: g.name });
  // Complete cards go on each golfer's record (G5). An account that entered several players (a parent, a captain)
  // only gets the round played in the account holder's own name.
  try {
    const course = await getCourse(svc, g.golf_settings.courseId);
    const { data: scoreRows } = confirmed.length ? await svc.from('golf_scores').select('entry_id,hole_no,strokes').in('entry_id', confirmed.map((e) => e.id)) : { data: [] };
    const byEntry = new Map<string, HoleScores>();
    for (const r of (scoreRows ?? []) as { entry_id: string; hole_no: number; strokes: number | null }[]) {
      const m = byEntry.get(r.entry_id) ?? {};
      m[r.hole_no] = r.strokes;
      byEntry.set(r.entry_id, m);
    }
    const { data: names } = users.length ? await svc.from('profiles').select('id,name').in('id', users) : { data: [] };
    const nameOf = new Map(((names ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, (p.name ?? '').trim().toLowerCase()]));
    const own = confirmed.filter((e) => {
      const n = nameOf.get(e.user_id);
      const several = confirmed.filter((x) => x.user_id === e.user_id).length > 1;
      return !several || (!!n && e.player_name.trim().toLowerCase() === n);
    });
    await roundsFromGolfDay(
      svc,
      g,
      own.map((e) => ({ userId: e.user_id, handicapIndex: hcp(e), playingHcp: playingHandicap(hcp(e), g.golf_settings.allowancePct, course.holes), scores: byEntry.get(e.id) ?? {} })),
    );
  } catch {
    // Records never block publishing.
  }
  try {
    const social = await import('./social.js');
    await social.eventNewsToCircle(svc, g.id, `${g.name}: results are in.`);
  } catch {
    // Circle news is best effort.
  }
  return { state: 'published' };
}

// --- Reads --------------------------------------------------------------------------------------------

export async function getGolfDayView(svc: SupabaseClient, userId: string, id: string) {
  const g = await loadGolfDay(svc, id);
  const s = g.golf_settings;
  const course = await getCourse(svc, s.courseId);
  const entries = (await entriesOf(svc, g.id)).filter((e) => e.status === 'confirmed');
  const flights = await flightsOf(svc, g.id);
  const { data: scoreRows } = entries.length ? await svc.from('golf_scores').select('entry_id,hole_no,strokes').in('entry_id', entries.map((e) => e.id)) : { data: [] };
  const scores = new Map<string, HoleScores>();
  for (const r of (scoreRows ?? []) as { entry_id: string; hole_no: number; strokes: number | null }[]) {
    const m = scores.get(r.entry_id) ?? {};
    m[r.hole_no] = r.strokes;
    scores.set(r.entry_id, m);
  }
  const field = entries.map((e) => ({ id: e.id, name: e.player_name, playingHcp: playingHandicap(hcp(e), s.allowancePct, course.holes), scores: scores.get(e.id) ?? {} }));
  const board = golfLeaderboard(course.card, field, s.scoring, 'net');
  const { data: sides } = await svc.from('golf_side_results').select('type,hole,entry_id,note').eq('competition_id', g.id);
  const nameOf = new Map(entries.map((e) => [e.id, e.player_name]));
  const organiser = g.organiser_id === userId;
  const { data: mineAll } = await svc.from('golf_entries').select('*').eq('competition_id', g.id).eq('user_id', userId);
  const mine = ((mineAll ?? []) as EntryRow[]).filter((e) => e.status !== 'cancelled');
  const scorerFlights = flights
    .filter((f) => {
      if (organiser) return true;
      const scorer = f.scorer_entry_id ? entries.find((e) => e.id === f.scorer_entry_id) : null;
      return scorer ? scorer.user_id === userId : entries.some((e) => e.flight_id === f.id && e.user_id === userId);
    })
    .map((f) => f.id);
  return {
    golfDay: {
      id: g.id,
      name: g.name,
      status: g.status,
      area: g.area,
      location: g.location,
      description: g.description,
      banner_url: g.banner_url,
      circle_id: g.circle_id ?? null,
      host_name: g['host_name'] ?? null,
      cause_name: g['cause_name'] ?? null,
      registration_closes_at: g.registration_closes_at,
      waitapp_checkout_url: g.waitapp_checkout_url,
      organiser_id: g.organiser_id,
    },
    settings: s,
    course,
    isOrganiser: organiser,
    published: !!g.golf_results_published_at,
    entered: entries.length,
    // The start list is public, like a race's: name, handicap, flight.
    field: entries.map((e) => ({ entryId: e.id, name: e.player_name, handicapIndex: hcp(e), playingHcp: playingHandicap(hcp(e), s.allowancePct, course.holes), flightId: e.flight_id })),
    flights: flights.map((f) => ({ id: f.id, label: f.label, teeTime: f.tee_time, startHole: f.start_hole, scorerEntryId: f.scorer_entry_id, entryIds: entries.filter((e) => e.flight_id === f.id).map((e) => e.id) })),
    leaderboard: board.map((r) => ({
      entryId: r.id,
      name: r.name,
      playingHcp: r.playingHcp,
      position: r.positionLabel,
      thru: r.totals.thru,
      gross: r.totals.gross,
      net: r.totals.net,
      points: r.totals.points,
      toPar: r.totals.toPar,
      holes: r.totals.perHole.map((h) => ({ holeNo: h.holeNo, gross: h.gross, played: h.played, points: h.points, received: h.received })),
    })),
    sideResults: ((sides ?? []) as { type: string; hole: number; entry_id: string | null; note: string | null }[]).map((x) => ({ type: x.type, hole: x.hole, winner: x.entry_id ? (nameOf.get(x.entry_id) ?? null) : null, note: x.note })),
    mine: mine.map((e) => ({ entryId: e.id, name: e.player_name, status: e.status, flightId: e.flight_id, handicapIndex: hcp(e) })),
    scorerFlights,
  };
}

/** The organiser's entry list, with phones. */
export async function getGolfEntries(svc: SupabaseClient, userId: string, id: string) {
  const g = await loadGolfDay(svc, id);
  requireOrganiser(g, userId);
  return (await entriesOf(svc, g.id))
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((e) => ({ entryId: e.id, name: e.player_name, handicapIndex: hcp(e), phone: e.phone, status: e.status, flightId: e.flight_id, paid: !!e.paid_ref }));
}
