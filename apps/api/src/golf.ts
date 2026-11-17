import type { SupabaseClient } from '@supabase/supabase-js';
import { golfCourseInputSchema, golfRecord, logRoundSchema, playingHandicap, roundTotals } from '@chabuka/shared';
import type { GolfHole, GolfRoundLine, HoleScores } from '@chabuka/shared';
import { ActionError } from './actions.js';
import { isVenueManager, loadVenueRow } from './venueBooking.js';

// Golf G1: course cards. A golf venue's owner or staff keep its course card (holes, par, stroke index); an organiser
// can enter a course that is not on Chabuka (no venue) for a golf day there, and only they can edit it.

interface CourseRow {
  id: string;
  venue_id: string | null;
  name: string;
  holes: 9 | 18;
  tee_set: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface CourseView {
  id: string;
  venueId: string | null;
  name: string;
  holes: 9 | 18;
  teeSet: string | null;
  par: number;
  card: GolfHole[];
}

async function cardOf(svc: SupabaseClient, courseId: string): Promise<GolfHole[]> {
  const { data } = await svc.from('golf_holes').select('hole_no,par,stroke_index,yards').eq('course_id', courseId).order('hole_no');
  return ((data ?? []) as { hole_no: number; par: number; stroke_index: number; yards: number | null }[])
    .map((h) => ({ holeNo: h.hole_no, par: h.par, strokeIndex: h.stroke_index, yards: h.yards }))
    .sort((a, b) => a.holeNo - b.holeNo);
}

function view(row: CourseRow, card: GolfHole[]): CourseView {
  return { id: row.id, venueId: row.venue_id, name: row.name, holes: row.holes, teeSet: row.tee_set, par: card.reduce((n, h) => n + h.par, 0), card };
}

export async function getCourse(svc: SupabaseClient, courseId: string): Promise<CourseView> {
  const { data } = await svc.from('golf_courses').select('*').eq('id', courseId).maybeSingle();
  const row = data as CourseRow | null;
  if (!row) throw new ActionError(404, 'Course not found.');
  return view(row, await cardOf(svc, row.id));
}

/** A venue's course cards (a golf club can have more than one course or tee set). */
export async function venueCourses(svc: SupabaseClient, venueId: string): Promise<CourseView[]> {
  const { data } = await svc.from('golf_courses').select('*').eq('venue_id', venueId).order('name');
  const rows = (data ?? []) as CourseRow[];
  return Promise.all(rows.map(async (r) => view(r, await cardOf(svc, r.id))));
}

/** Courses an organiser can pick for a golf day: every venue course, plus their own off-Chabuka ones. */
export async function pickableCourses(svc: SupabaseClient, userId: string): Promise<(CourseView & { venueName: string | null })[]> {
  const { data } = await svc.from('golf_courses').select('*').order('name').limit(400);
  const rows = ((data ?? []) as CourseRow[]).filter((r) => r.venue_id || r.created_by === userId);
  const venueIds = [...new Set(rows.map((r) => r.venue_id).filter((v): v is string => !!v))];
  const { data: venues } = venueIds.length ? await svc.from('venues').select('id,name,status').in('id', venueIds) : { data: [] };
  const vMap = new Map(((venues ?? []) as { id: string; name: string; status: string }[]).map((v) => [v.id, v]));
  const out: (CourseView & { venueName: string | null })[] = [];
  for (const r of rows) {
    const v = r.venue_id ? vMap.get(r.venue_id) : null;
    if (r.venue_id && v?.status !== 'approved') continue;
    out.push({ ...view(r, await cardOf(svc, r.id)), venueName: v?.name ?? null });
  }
  return out;
}

async function canEdit(svc: SupabaseClient, row: Pick<CourseRow, 'venue_id' | 'created_by'>, userId: string): Promise<boolean> {
  if (row.venue_id) return isVenueManager(svc, await loadVenueRow(svc, row.venue_id), userId);
  return row.created_by === userId;
}

/** Create or update a course card (all holes at once). */
export async function saveCourse(svc: SupabaseClient, userId: string, raw: unknown): Promise<CourseView> {
  const parsed = golfCourseInputSchema.safeParse(raw);
  if (!parsed.success) throw new ActionError(400, parsed.error.issues[0]?.message ?? 'Check the course card.');
  const input = parsed.data;
  const venueId = input.venueId ?? null;
  let courseId = input.courseId ?? null;
  if (courseId) {
    const { data } = await svc.from('golf_courses').select('*').eq('id', courseId).maybeSingle();
    const row = data as CourseRow | null;
    if (!row) throw new ActionError(404, 'Course not found.');
    if (!(await canEdit(svc, row, userId))) throw new ActionError(403, 'Only the venue owner, its staff or whoever entered this course can change it.');
    await svc.from('golf_courses').update({ name: input.name, holes: input.holes, tee_set: input.teeSet ?? null, updated_at: new Date().toISOString() }).eq('id', courseId);
  } else {
    if (venueId) {
      const venue = await loadVenueRow(svc, venueId);
      if (!(await isVenueManager(svc, venue, userId))) throw new ActionError(403, 'Only the venue owner or its staff can add its course.');
      if (!(venue.sports ?? []).some((s) => s.toLowerCase() === 'golf')) throw new ActionError(409, 'Add golf to the venue\'s sports first.');
    }
    const { data, error } = await svc
      .from('golf_courses')
      .insert({ venue_id: venueId, name: input.name, holes: input.holes, tee_set: input.teeSet ?? null, created_by: userId })
      .select('id')
      .single();
    if (error || !data) throw new ActionError(500, 'Could not save the course.');
    courseId = (data as { id: string }).id;
  }
  // The card is replaced whole: simpler than diffing 18 rows, and a course card is small.
  await svc.from('golf_holes').delete().eq('course_id', courseId);
  for (const h of input.card) {
    const { error } = await svc.from('golf_holes').insert({ course_id: courseId, hole_no: h.holeNo, par: h.par, stroke_index: h.strokeIndex, yards: h.yards ?? null });
    if (error) throw new ActionError(500, 'Could not save the course card.');
  }
  return getCourse(svc, courseId);
}

export async function deleteCourse(svc: SupabaseClient, userId: string, courseId: string): Promise<{ state: 'deleted' }> {
  const { data } = await svc.from('golf_courses').select('*').eq('id', courseId).maybeSingle();
  const row = data as CourseRow | null;
  if (!row) throw new ActionError(404, 'Course not found.');
  if (!(await canEdit(svc, row, userId))) throw new ActionError(403, 'Only the venue owner, its staff or whoever entered this course can remove it.');
  await svc.from('golf_courses').delete().eq('id', courseId);
  return { state: 'deleted' };
}


// --- Rounds and the golf record (G5) ------------------------------------------------------------------

interface RoundRow {
  id: string;
  user_id: string;
  course_name: string;
  source: 'casual' | 'golf_day';
  source_id: string | null;
  played_on: string;
  holes: 9 | 18;
  gross: number | null;
  net: number | null;
  points: number | null;
}

const roundLine = (r: RoundRow): GolfRoundLine => ({ id: r.id, courseName: r.course_name, playedOn: r.played_on, holes: r.holes, gross: r.gross, net: r.net, points: r.points, source: r.source });

/** Log a round by hand: hole scores (gross, net and Stableford worked out) or just the total. */
export async function logRound(svc: SupabaseClient, userId: string, raw: unknown, deps: { now?: Date } = {}) {
  const parsed = logRoundSchema.safeParse(raw);
  if (!parsed.success) throw new ActionError(400, parsed.error.issues[0]?.message ?? 'Check the round.');
  const input = parsed.data;
  if (input.playedOn > (deps.now ?? new Date()).toISOString().slice(0, 10)) throw new ActionError(400, 'That date is in the future.');
  const course = await getCourse(svc, input.courseId);
  const scores: HoleScores = {};
  for (const [k, v] of Object.entries(input.scores)) {
    const hole = Number(k);
    if (hole < 1 || hole > course.holes) throw new ActionError(400, `This course has ${course.holes} holes.`);
    scores[hole] = v;
  }
  const playingHcp = input.handicapIndex != null ? playingHandicap(input.handicapIndex, 100, course.holes) : null;
  let gross: number | null = input.total ?? null;
  let net: number | null = gross != null && playingHcp != null ? gross - playingHcp : null;
  let points: number | null = null;
  if (Object.keys(scores).length) {
    const t = roundTotals(course.card, scores, playingHcp ?? 0);
    if (t.thru !== course.holes) throw new ActionError(400, `Enter all ${course.holes} holes, or just the total.`);
    gross = t.gross;
    net = playingHcp != null ? t.net : null;
    points = playingHcp != null ? t.points : null;
  }
  const { data, error } = await svc
    .from('golf_rounds')
    .insert({
      user_id: userId,
      course_id: course.id,
      course_name: course.name,
      source: 'casual',
      played_on: input.playedOn,
      holes: course.holes,
      handicap_index: input.handicapIndex ?? null,
      playing_hcp: playingHcp,
      scores,
      gross,
      net,
      points,
    })
    .select('id')
    .single();
  if (error || !data) throw new ActionError(500, 'Could not save the round.');
  return { state: 'saved', roundId: (data as { id: string }).id, gross, net, points };
}

export async function deleteRound(svc: SupabaseClient, userId: string, roundId: string) {
  const { data } = await svc.from('golf_rounds').select('user_id,source').eq('id', roundId).maybeSingle();
  const r = data as { user_id: string; source: string } | null;
  if (!r) throw new ActionError(404, 'Round not found.');
  if (r.user_id !== userId) throw new ActionError(403, 'That is not your round.');
  if (r.source === 'golf_day') throw new ActionError(409, 'Golf day rounds come from the published results.');
  await svc.from('golf_rounds').delete().eq('id', roundId);
  return { state: 'deleted' };
}

/** A golfer's golf: their record, recent rounds, upcoming tee times and golf days. */
export async function myGolf(svc: SupabaseClient, userId: string, deps: { now?: Date } = {}) {
  const now = (deps.now ?? new Date()).toISOString();
  const { data: rows } = await svc.from('golf_rounds').select('*').eq('user_id', userId).order('played_on', { ascending: false }).limit(200);
  const rounds = ((rows ?? []) as RoundRow[]).map(roundLine).sort((a, b) => b.playedOn.localeCompare(a.playedOn));
  const { data: entries } = await svc.from('golf_entries').select('competition_id,status').eq('user_id', userId);
  const live = ((entries ?? []) as { competition_id: string; status: string }[]).filter((e) => e.status === 'confirmed' || e.status === 'pending_payment');
  const compIds = [...new Set(live.map((e) => e.competition_id))];
  const { data: comps } = compIds.length ? await svc.from('competitions').select('id,name,status,golf_settings').in('id', compIds) : { data: [] };
  const golfDays = ((comps ?? []) as { id: string; name: string; status: string; golf_settings: { firstTeeAt?: string } | null }[])
    .filter((c) => c.status !== 'finished' && c.status !== 'cancelled' && (c.golf_settings?.firstTeeAt ?? '') >= now.slice(0, 10))
    .map((c) => ({ id: c.id, name: c.name, firstTeeAt: c.golf_settings?.firstTeeAt ?? null }));
  const { data: tee } = await svc.from('bookings').select('id,venue_id,starts_at,status,players').eq('requester_id', userId).gt('starts_at', now);
  const teeTimes = ((tee ?? []) as { id: string; venue_id: string; starts_at: string; status: string; players: number | null }[])
    .filter((b) => b.players != null && (b.status === 'requested' || b.status === 'confirmed'))
    .map((b) => ({ bookingId: b.id, venueId: b.venue_id, startsAt: b.starts_at, players: b.players, status: b.status }));
  return { record: golfRecord(rounds), rounds: rounds.slice(0, 20), golfDays, teeTimes };
}

/** Called when a golf day's results are published: every complete card becomes a round on the golfer's record. */
export async function roundsFromGolfDay(
  svc: SupabaseClient,
  g: { id: string; golf_settings: { courseId: string; firstTeeAt: string } },
  rows: { userId: string; handicapIndex: number; playingHcp: number; scores: HoleScores }[],
) {
  const course = await getCourse(svc, g.golf_settings.courseId);
  for (const r of rows) {
    const t = roundTotals(course.card, r.scores, r.playingHcp);
    if (t.thru !== course.holes) continue;
    await svc.from('golf_rounds').upsert(
      {
        user_id: r.userId,
        course_id: course.id,
        course_name: course.name,
        source: 'golf_day',
        source_id: g.id,
        played_on: g.golf_settings.firstTeeAt.slice(0, 10),
        holes: course.holes,
        handicap_index: r.handicapIndex,
        playing_hcp: r.playingHcp,
        scores: r.scores,
        gross: t.gross,
        net: t.net,
        points: t.points,
      },
      { onConflict: 'user_id,source_id' },
    );
  }
}
