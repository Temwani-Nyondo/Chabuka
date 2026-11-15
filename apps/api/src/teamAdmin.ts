import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formationsFor, ruleTemplateFor, validateLineup } from '@chabuka/shared';
import type {
  Availability,
  AvailabilityResponseInput,
  Formation,
  JoinPolicy,
  LineupSlot,
  LineupSubject,
  RuleItem,
  SaveLineupInput,
  SaveRuleBookInput,
} from '@chabuka/shared';
import type { z } from 'zod';
import type {
  joinTeamSchema,
  respondJoinRequestSchema,
  setShirtNumberSchema,
  teamSettingsSchema,
  transferOwnershipSchema,
} from '@chabuka/shared';
import { ActionError, notifyUsers } from './actions.js';

// Team administration, availability, lineups and rule books. The tables have
// no client policies: every read and write goes through here, after the
// permission checks below, on the service client.

type Role = 'owner' | 'captain' | 'player';
type Side = 'home' | 'away';

interface SideInfo {
  side: Side;
  teamId: string | null;
  name: string;
  kitColour: string | null;
}

interface Subject {
  type: LineupSubject;
  id: string;
  title: string;
  startsAt: string | null;
  sport: string | null;
  format: string | null;
  organiserId: string | null;
  /** Pickup games have no teams: both sides come from the joined players. */
  pickup: boolean;
  sides: [SideInfo, SideInfo];
  participants: string[];
}

// --- Loading -------------------------------------------------------------------

async function sportName(service: SupabaseClient, sportId: string | null): Promise<string | null> {
  if (!sportId) return null;
  const { data } = await service.from('sports').select('name').eq('id', sportId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function teamInfo(service: SupabaseClient, ids: string[]): Promise<Map<string, { name: string; kit: string | null }>> {
  const out = new Map<string, { name: string; kit: string | null }>();
  if (ids.length === 0) return out;
  const { data } = await service.from('teams').select('id,name,kit_colour').in('id', ids);
  for (const t of (data ?? []) as { id: string; name: string; kit_colour?: string | null }[]) out.set(t.id, { name: t.name, kit: t.kit_colour ?? null });
  return out;
}

export async function loadSubject(service: SupabaseClient, type: LineupSubject, id: string): Promise<Subject> {
  if (type === 'fixture') {
    const { data: f } = await service
      .from('fixtures')
      .select('id,competition_id,home_team_id,away_team_id,starts_at')
      .eq('id', id)
      .maybeSingle();
    const fixture = f as { id: string; competition_id: string; home_team_id: string | null; away_team_id: string | null; starts_at: string | null } | null;
    if (!fixture) throw new ActionError(404, 'Fixture not found.');
    if (!fixture.home_team_id || !fixture.away_team_id) throw new ActionError(409, 'Both teams for this game are not known yet.');
    const homeId = fixture.home_team_id;
    const awayId = fixture.away_team_id;
    const { data: c } = await service.from('competitions').select('organiser_id,sport_id,name').eq('id', fixture.competition_id).maybeSingle();
    const comp = c as { organiser_id: string; sport_id: string; name: string } | null;
    const teams = await teamInfo(service, [homeId, awayId]);
    const h = teams.get(homeId);
    const a = teams.get(awayId);
    return {
      type,
      id,
      title: `${h?.name ?? 'Home'} vs ${a?.name ?? 'Away'}`,
      startsAt: fixture.starts_at,
      sport: await sportName(service, comp?.sport_id ?? null),
      format: null,
      organiserId: comp?.organiser_id ?? null,
      pickup: false,
      sides: [
        { side: 'home', teamId: homeId, name: h?.name ?? 'Home', kitColour: h?.kit ?? null },
        { side: 'away', teamId: awayId, name: a?.name ?? 'Away', kitColour: a?.kit ?? null },
      ],
      participants: [],
    };
  }
  const { data: m } = await service.from('matches').select('id,organiser_id,sport_id,title,kind,format,starts_at').eq('id', id).maybeSingle();
  const match = m as { id: string; organiser_id: string; sport_id: string; title: string; kind: string; format: string | null; starts_at: string } | null;
  if (!match) throw new ActionError(404, 'Game not found.');
  const sport = await sportName(service, match.sport_id);
  if (match.kind === 'team-vs-team') {
    const { data: ch } = await service.from('challenges').select('team_id,opponent_team_id').eq('match_id', match.id).maybeSingle();
    const c = ch as { team_id: string; opponent_team_id: string | null } | null;
    if (c?.opponent_team_id) {
      const teams = await teamInfo(service, [c.team_id, c.opponent_team_id]);
      const h = teams.get(c.team_id);
      const a = teams.get(c.opponent_team_id);
      return {
        type,
        id,
        title: match.title,
        startsAt: match.starts_at,
        sport,
        format: match.format,
        organiserId: match.organiser_id,
        pickup: false,
        sides: [
          { side: 'home', teamId: c.team_id, name: h?.name ?? 'Home', kitColour: h?.kit ?? null },
          { side: 'away', teamId: c.opponent_team_id, name: a?.name ?? 'Away', kitColour: a?.kit ?? null },
        ],
        participants: [],
      };
    }
  }
  const { data: parts } = await service.from('match_participants').select('user_id').eq('match_id', match.id).eq('status', 'joined');
  return {
    type,
    id,
    title: match.title,
    startsAt: match.starts_at,
    sport,
    format: match.format,
    organiserId: match.organiser_id,
    pickup: true,
    sides: [
      { side: 'home', teamId: null, name: 'Bibs', kitColour: '#f2c230' },
      { side: 'away', teamId: null, name: 'No bibs', kitColour: '#1d3f8f' },
    ],
    participants: ((parts ?? []) as { user_id: string }[]).map((p) => p.user_id),
  };
}

async function roleIn(service: SupabaseClient, teamId: string, userId: string): Promise<Role | null> {
  const { data } = await service.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return ((data as { role: Role } | null)?.role ?? null) as Role | null;
}

const isLeader = (r: Role | null) => r === 'owner' || r === 'captain';

async function membersOf(service: SupabaseClient, teamId: string): Promise<{ user_id: string; role: Role; position: string | null; shirt_number: number | null }[]> {
  const { data } = await service.from('team_members').select('user_id,role,position,shirt_number').eq('team_id', teamId);
  return (data ?? []) as { user_id: string; role: Role; position: string | null; shirt_number: number | null }[];
}

async function profilesOf(service: SupabaseClient, ids: string[]): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const out = new Map<string, { name: string; photoUrl: string | null }>();
  if (ids.length === 0) return out;
  const { data } = await service.from('profiles').select('id,name,photo_url').in('id', ids);
  for (const p of (data ?? []) as { id: string; name: string | null; photo_url: string | null }[]) {
    out.set(p.id, { name: p.name?.trim() || 'Player', photoUrl: p.photo_url });
  }
  return out;
}

async function canEditSide(service: SupabaseClient, subject: Subject, side: SideInfo, userId: string): Promise<boolean> {
  if (subject.pickup) return subject.organiserId === userId;
  return side.teamId ? isLeader(await roleIn(service, side.teamId, userId)) : false;
}

// --- Availability --------------------------------------------------------------

export interface SquadPlayer {
  userId: string;
  name: string;
  photoUrl: string | null;
  shirt: number | null;
  position: string | null;
  role: Role | null;
  status: Availability | null;
  note: string | null;
}

export interface SideSquad {
  side: Side;
  teamId: string | null;
  name: string;
  kitColour: string | null;
  canManage: boolean;
  players: SquadPlayer[];
  counts: Record<Availability | 'none', number>;
}

export interface AvailabilityView {
  subject: { type: LineupSubject; id: string; title: string; startsAt: string | null; sport: string | null; format: string | null; pickup: boolean };
  /** The sides this person can see: their own team, or both for the organiser. */
  sides: SideSquad[];
  me: { status: Availability | null; side: Side | null };
}

async function responsesFor(service: SupabaseClient, subject: Subject): Promise<Map<string, { status: Availability; note: string | null }>> {
  const { data } = await service
    .from('availability_responses')
    .select('user_id,status,note')
    .eq('subject_type', subject.type)
    .eq('subject_id', subject.id);
  const out = new Map<string, { status: Availability; note: string | null }>();
  for (const r of (data ?? []) as { user_id: string; status: Availability; note: string | null }[]) out.set(r.user_id, { status: r.status, note: r.note });
  return out;
}

async function squadFor(service: SupabaseClient, subject: Subject, side: SideInfo, responses: Map<string, { status: Availability; note: string | null }>, canManage: boolean): Promise<SideSquad> {
  let rows: { userId: string; role: Role | null; position: string | null; shirt: number | null }[];
  if (side.teamId) {
    rows = (await membersOf(service, side.teamId)).map((m) => ({ userId: m.user_id, role: m.role, position: m.position, shirt: m.shirt_number }));
  } else {
    rows = subject.participants.map((u) => ({ userId: u, role: null, position: null, shirt: null }));
  }
  const profiles = await profilesOf(service, rows.map((r) => r.userId));
  const players: SquadPlayer[] = rows.map((r) => {
    const resp = responses.get(r.userId);
    return {
      userId: r.userId,
      name: profiles.get(r.userId)?.name ?? 'Player',
      photoUrl: profiles.get(r.userId)?.photoUrl ?? null,
      shirt: r.shirt,
      position: r.position,
      role: r.role,
      // Joining a pickup game already means "in".
      status: resp?.status ?? (subject.pickup ? 'in' : null),
      note: resp?.note ?? null,
    };
  });
  const rank = { in: 0, maybe: 1, out: 3 } as const;
  players.sort((a, b) => (a.status ? rank[a.status] : 2) - (b.status ? rank[b.status] : 2) || (a.shirt ?? 999) - (b.shirt ?? 999) || a.name.localeCompare(b.name));
  const counts = { in: 0, maybe: 0, out: 0, none: 0 };
  for (const p of players) counts[p.status ?? 'none'] += 1;
  return { side: side.side, teamId: side.teamId, name: side.name, kitColour: side.kitColour, canManage, players, counts };
}

async function mySide(service: SupabaseClient, subject: Subject, userId: string): Promise<SideInfo | null> {
  if (subject.pickup) return subject.participants.includes(userId) || subject.organiserId === userId ? subject.sides[0] : null;
  for (const s of subject.sides) {
    if (s.teamId && (await roleIn(service, s.teamId, userId))) return s;
  }
  return null;
}

export async function getAvailability(service: SupabaseClient, userId: string, type: LineupSubject, id: string): Promise<AvailabilityView> {
  const subject = await loadSubject(service, type, id);
  const own = await mySide(service, subject, userId);
  const organiser = subject.organiserId === userId;
  if (!own && !organiser) throw new ActionError(403, 'Only the players in this game can see who is available.');
  const responses = await responsesFor(service, subject);
  const visible = subject.pickup ? [subject.sides[0]] : organiser ? subject.sides : own ? [own] : [];
  const sides: SideSquad[] = [];
  for (const s of visible) sides.push(await squadFor(service, subject, subject.pickup ? { ...s, name: 'Players' } : s, responses, await canEditSide(service, subject, s, userId)));
  const mine = responses.get(userId)?.status ?? (subject.pickup && own ? 'in' : null);
  return {
    subject: { type, id, title: subject.title, startsAt: subject.startsAt, sport: subject.sport, format: subject.format, pickup: subject.pickup },
    sides,
    me: { status: mine, side: own?.side ?? null },
  };
}

export async function respondAvailability(service: SupabaseClient, userId: string, input: AvailabilityResponseInput): Promise<{ status: Availability }> {
  const subject = await loadSubject(service, input.subjectType, input.subjectId);
  if (subject.pickup) throw new ActionError(409, 'For an open game, join or leave the game instead.');
  const own = await mySide(service, subject, userId);
  if (!own) throw new ActionError(403, 'Only players in one of these teams can answer.');
  if (subject.startsAt && new Date(subject.startsAt).getTime() < Date.now() - 3 * 3600 * 1000) {
    throw new ActionError(409, 'This game has already been played.');
  }
  const { error } = await service.from('availability_responses').upsert(
    {
      subject_type: subject.type,
      subject_id: subject.id,
      user_id: userId,
      team_id: own.teamId,
      status: input.status,
      note: input.note ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subject_type,subject_id,user_id' },
  );
  if (error) throw new ActionError(500, 'Could not save your answer.');
  return { status: input.status };
}

// Captains nudge everyone in their squad who has not answered yet.
export async function remindAvailability(service: SupabaseClient, userId: string, type: LineupSubject, id: string): Promise<{ reminded: number }> {
  const subject = await loadSubject(service, type, id);
  const own = await mySide(service, subject, userId);
  if (!own || !(await canEditSide(service, subject, own, userId)) || !own.teamId) {
    throw new ActionError(403, 'Only a captain can send reminders.');
  }
  const responses = await responsesFor(service, subject);
  const missing = (await membersOf(service, own.teamId)).map((m) => m.user_id).filter((u) => u !== userId && !responses.has(u));
  await notifyUsers(missing, 'availability_requested', { subjectType: type, subjectId: id, title: subject.title, teamId: own.teamId, startsAt: subject.startsAt });
  return { reminded: missing.length };
}

// --- Lineups ---------------------------------------------------------------------

interface LineupRow {
  id: string;
  subject_type: LineupSubject;
  subject_id: string;
  side: Side;
  team_id: string | null;
  formation: string;
  slots: LineupSlot[];
  bench: string[];
  published: boolean;
  updated_at: string;
}

export interface LineupSideView {
  side: Side;
  teamId: string | null;
  name: string;
  kitColour: string | null;
  canEdit: boolean;
  lineup: { formation: string; slots: (LineupSlot & { name: string | null; shirt: number | null })[]; bench: { userId: string; name: string; shirt: number | null }[]; published: boolean; updatedAt: string } | null;
  /** Who the captain can pick from (only sent to people who can edit). */
  pool: SquadPlayer[];
}

export interface LineupsView {
  subject: AvailabilityView['subject'];
  formations: Formation[];
  sides: LineupSideView[];
}

async function lineupRows(service: SupabaseClient, type: LineupSubject, id: string): Promise<LineupRow[]> {
  const { data } = await service.from('lineups').select('*').eq('subject_type', type).eq('subject_id', id);
  return (data ?? []) as LineupRow[];
}

export async function getLineups(service: SupabaseClient, userId: string, type: LineupSubject, id: string): Promise<LineupsView> {
  const subject = await loadSubject(service, type, id);
  const rows = await lineupRows(service, type, id);
  const responses = await responsesFor(service, subject);
  const allIds = new Set<string>();
  for (const r of rows) {
    for (const s of r.slots) if (s.userId) allIds.add(s.userId);
    for (const b of r.bench) allIds.add(b);
  }
  const shirts = new Map<string, number | null>();
  for (const s of subject.sides) {
    if (s.teamId) for (const m of await membersOf(service, s.teamId)) shirts.set(`${s.teamId}:${m.user_id}`, m.shirt_number);
  }
  const profiles = await profilesOf(service, [...allIds]);
  const sides: LineupSideView[] = [];
  for (const s of subject.sides) {
    const canEdit = await canEditSide(service, subject, s, userId);
    const row = rows.find((r) => r.side === s.side) ?? null;
    const shirtOf = (u: string) => (s.teamId ? (shirts.get(`${s.teamId}:${u}`) ?? null) : null);
    const lineup =
      row && (row.published || canEdit)
        ? {
            formation: row.formation,
            slots: row.slots.map((sl) => ({ ...sl, name: sl.userId ? (profiles.get(sl.userId)?.name ?? 'Player') : null, shirt: sl.userId ? shirtOf(sl.userId) : null })),
            bench: row.bench.map((u) => ({ userId: u, name: profiles.get(u)?.name ?? 'Player', shirt: shirtOf(u) })),
            published: row.published,
            updatedAt: row.updated_at,
          }
        : null;
    const pool = canEdit ? (await squadFor(service, subject, s, responses, true)).players : [];
    sides.push({ side: s.side, teamId: s.teamId, name: s.name, kitColour: s.kitColour, canEdit, lineup, pool });
  }
  return {
    subject: { type, id, title: subject.title, startsAt: subject.startsAt, sport: subject.sport, format: subject.format, pickup: subject.pickup },
    formations: formationsFor(subject.sport, subject.format),
    sides,
  };
}

export async function saveLineup(service: SupabaseClient, userId: string, input: SaveLineupInput): Promise<{ published: boolean; notified: number }> {
  const subject = await loadSubject(service, input.subjectType, input.subjectId);
  const side = subject.sides.find((s) => s.side === input.side);
  if (!side) throw new ActionError(400, 'Pick a side.');
  if (!(await canEditSide(service, subject, side, userId))) {
    throw new ActionError(403, subject.pickup ? 'Only the host can set the sides.' : 'Only a captain of this team can set its lineup.');
  }
  let eligible: Set<string>;
  if (side.teamId) {
    eligible = new Set((await membersOf(service, side.teamId)).map((m) => m.user_id));
  } else {
    // Pickup: a player can only be on one side.
    const other = (await lineupRows(service, subject.type, subject.id)).find((r) => r.side !== input.side);
    const taken = new Set([...(other?.slots ?? []).map((s) => s.userId).filter((x): x is string => !!x), ...(other?.bench ?? [])]);
    eligible = new Set(subject.participants.filter((p) => !taken.has(p)));
  }
  const problem = validateLineup(input, eligible, formationsFor(subject.sport, subject.format));
  if (problem) throw new ActionError(400, problem);

  const existing = (await lineupRows(service, subject.type, subject.id)).find((r) => r.side === input.side) ?? null;
  const row = {
    subject_type: subject.type,
    subject_id: subject.id,
    side: input.side,
    team_id: side.teamId,
    formation: input.formation,
    slots: input.slots,
    bench: input.bench,
    published: input.publish || (existing?.published ?? false),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await service.from('lineups').update(row).eq('id', existing.id)
    : await service.from('lineups').insert({ id: crypto.randomUUID(), ...row });
  if (error) throw new ActionError(500, 'Could not save the lineup.');

  let notified = 0;
  if (input.publish) {
    const picked = [...input.slots.map((s) => s.userId).filter((x): x is string => !!x), ...input.bench];
    const squad = side.teamId ? (await membersOf(service, side.teamId)).map((m) => m.user_id) : picked;
    const recipients = [...new Set(squad)].filter((u) => u !== userId);
    await notifyUsers(recipients, 'lineup_published', {
      subjectType: subject.type,
      subjectId: subject.id,
      title: subject.title,
      teamName: side.teamId ? side.name : null,
      matchId: subject.type === 'match' ? subject.id : null,
    });
    notified = recipients.length;
  }
  return { published: row.published, notified };
}

// --- Team admin ------------------------------------------------------------------

async function requireLeader(service: SupabaseClient, teamId: string, userId: string): Promise<Role> {
  const role = await roleIn(service, teamId, userId);
  if (!isLeader(role)) throw new ActionError(403, 'Only a team captain or owner can do that.');
  return role as Role;
}

async function teamRow(service: SupabaseClient, teamId: string): Promise<{ id: string; name: string; join_policy: JoinPolicy; kit_colour: string | null; sport_id: string }> {
  const { data } = await service.from('teams').select('id,name,join_policy,kit_colour,sport_id').eq('id', teamId).maybeSingle();
  if (!data) throw new ActionError(404, 'Team not found.');
  const t = data as { id: string; name: string; join_policy?: JoinPolicy | null; kit_colour?: string | null; sport_id: string };
  return { id: t.id, name: t.name, join_policy: t.join_policy ?? 'invite', kit_colour: t.kit_colour ?? null, sport_id: t.sport_id };
}

async function leadersOf(service: SupabaseClient, teamId: string): Promise<string[]> {
  return (await membersOf(service, teamId)).filter((m) => isLeader(m.role)).map((m) => m.user_id);
}

export interface TeamAdminView {
  joinPolicy: JoinPolicy;
  kitColour: string | null;
  myRole: Role | null;
  /** For people outside the team: their own pending request, if any. */
  myRequest: { id: string; createdAt: string } | null;
  /** For captains: everyone waiting to join. */
  requests: { id: string; userId: string; name: string; photoUrl: string | null; message: string | null; createdAt: string }[];
}

export async function getTeamAdmin(service: SupabaseClient, userId: string, teamId: string): Promise<TeamAdminView> {
  const team = await teamRow(service, teamId);
  const myRole = await roleIn(service, teamId, userId);
  const view: TeamAdminView = { joinPolicy: team.join_policy, kitColour: team.kit_colour, myRole, myRequest: null, requests: [] };
  const { data } = await service.from('team_join_requests').select('id,user_id,message,status,created_at').eq('team_id', teamId).eq('status', 'pending');
  const pending = (data ?? []) as { id: string; user_id: string; message: string | null; created_at: string }[];
  const mine = pending.find((r) => r.user_id === userId);
  if (mine) view.myRequest = { id: mine.id, createdAt: mine.created_at };
  if (isLeader(myRole)) {
    const profiles = await profilesOf(service, pending.map((r) => r.user_id));
    view.requests = pending
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ id: r.id, userId: r.user_id, name: profiles.get(r.user_id)?.name ?? 'Player', photoUrl: profiles.get(r.user_id)?.photoUrl ?? null, message: r.message, createdAt: r.created_at }));
  }
  return view;
}

export async function requestJoinTeam(service: SupabaseClient, userId: string, input: z.infer<typeof joinTeamSchema>): Promise<{ state: 'joined' | 'requested' }> {
  const team = await teamRow(service, input.teamId);
  if (await roleIn(service, team.id, userId)) throw new ActionError(409, 'You are already in this team.');
  if (team.join_policy === 'invite') throw new ActionError(403, 'This team takes new players by invite link only. Ask the captain.');
  const leaders = await leadersOf(service, team.id);
  if (team.join_policy === 'open') {
    const { error } = await service.from('team_members').insert({ team_id: team.id, user_id: userId, role: 'player' });
    if (error) throw new ActionError(500, 'Could not join the team.');
    await notifyUsers(leaders, 'team_joined', { teamId: team.id, teamName: team.name, userId });
    return { state: 'joined' };
  }
  const { data } = await service.from('team_join_requests').select('id').eq('team_id', team.id).eq('user_id', userId).eq('status', 'pending').maybeSingle();
  if (data) return { state: 'requested' };
  const { error } = await service.from('team_join_requests').insert({
    id: crypto.randomUUID(),
    team_id: team.id,
    user_id: userId,
    message: input.message ?? null,
    status: 'pending',
    created_at: new Date().toISOString(),
  });
  if (error) throw new ActionError(500, 'Could not send your request.');
  await notifyUsers(leaders, 'team_join_request', { teamId: team.id, teamName: team.name, userId });
  return { state: 'requested' };
}

export async function respondJoinRequest(service: SupabaseClient, userId: string, input: z.infer<typeof respondJoinRequestSchema>): Promise<{ state: 'accepted' | 'declined' }> {
  const { data } = await service.from('team_join_requests').select('id,team_id,user_id,status').eq('id', input.requestId).maybeSingle();
  const req = data as { id: string; team_id: string; user_id: string; status: string } | null;
  if (!req) throw new ActionError(404, 'Request not found.');
  await requireLeader(service, req.team_id, userId);
  if (req.status !== 'pending') throw new ActionError(409, 'This request was already answered.');
  if (input.decision === 'accept' && !(await roleIn(service, req.team_id, req.user_id))) {
    const { error } = await service.from('team_members').insert({ team_id: req.team_id, user_id: req.user_id, role: 'player' });
    if (error) throw new ActionError(500, 'Could not add the player.');
  }
  const state = input.decision === 'accept' ? 'accepted' : 'declined';
  const { error } = await service
    .from('team_join_requests')
    .update({ status: state, decided_by: userId, decided_at: new Date().toISOString() })
    .eq('id', req.id);
  if (error) throw new ActionError(500, 'Could not save the answer.');
  const team = await teamRow(service, req.team_id);
  await notifyUsers([req.user_id], 'team_join_answered', { teamId: team.id, teamName: team.name, decision: state });
  return { state };
}

export async function setShirtNumber(service: SupabaseClient, userId: string, input: z.infer<typeof setShirtNumberSchema>): Promise<void> {
  const actorRole = await roleIn(service, input.teamId, userId);
  if (input.userId !== userId && !isLeader(actorRole)) throw new ActionError(403, 'Only a captain can set someone else’s number.');
  if (!actorRole) throw new ActionError(403, 'Only team members can do that.');
  const members = await membersOf(service, input.teamId);
  if (!members.some((m) => m.user_id === input.userId)) throw new ActionError(404, 'That player is not in this team.');
  if (input.number != null) {
    const holder = members.find((m) => m.shirt_number === input.number && m.user_id !== input.userId);
    if (holder) {
      const names = await profilesOf(service, [holder.user_id]);
      throw new ActionError(409, `Number ${input.number} is already ${names.get(holder.user_id)?.name ?? 'taken'}’s.`);
    }
  }
  const { error } = await service.from('team_members').update({ shirt_number: input.number }).eq('team_id', input.teamId).eq('user_id', input.userId);
  if (error) throw new ActionError(500, 'Could not save the number.');
}

export async function transferOwnership(service: SupabaseClient, userId: string, input: z.infer<typeof transferOwnershipSchema>): Promise<void> {
  if ((await roleIn(service, input.teamId, userId)) !== 'owner') throw new ActionError(403, 'Only the team owner can hand over the team.');
  if (input.userId === userId) throw new ActionError(409, 'You already own this team.');
  if (!(await roleIn(service, input.teamId, input.userId))) throw new ActionError(404, 'That player is not in this team.');
  const a = await service.from('team_members').update({ role: 'owner' }).eq('team_id', input.teamId).eq('user_id', input.userId);
  if (a.error) throw new ActionError(500, 'Could not hand over the team.');
  const b = await service.from('team_members').update({ role: 'captain' }).eq('team_id', input.teamId).eq('user_id', userId);
  if (b.error) throw new ActionError(500, 'Could not hand over the team.');
  const team = await teamRow(service, input.teamId);
  await notifyUsers([input.userId], 'team_ownership', { teamId: team.id, teamName: team.name });
}

export async function updateTeamSettings(service: SupabaseClient, userId: string, input: z.infer<typeof teamSettingsSchema>): Promise<void> {
  await requireLeader(service, input.teamId, userId);
  const patch: Record<string, unknown> = {};
  if (input.joinPolicy !== undefined) patch['join_policy'] = input.joinPolicy;
  if (input.kitColour !== undefined) patch['kit_colour'] = input.kitColour;
  if (Object.keys(patch).length === 0) return;
  const { error } = await service.from('teams').update(patch).eq('id', input.teamId);
  if (error) throw new ActionError(500, 'Could not save the team settings.');
}

// --- Rule books --------------------------------------------------------------------

export interface RuleBookView {
  title: string;
  rules: RuleItem[];
  version: number;
  /** Where these rules come from: this game's own book, its competition's, or the sport's starter set. */
  source: 'own' | 'competition' | 'template';
  canEdit: boolean;
  /** What saving writes to. */
  target: { type: 'match' | 'competition' | 'team'; id: string };
}

async function bookFor(service: SupabaseClient, type: string, id: string): Promise<{ title: string; rules: RuleItem[]; version: number } | null> {
  const { data } = await service.from('rule_books').select('title,rules,version').eq('owner_type', type).eq('owner_id', id).maybeSingle();
  return (data as { title: string; rules: RuleItem[]; version: number } | null) ?? null;
}

export async function getRuleBook(
  service: SupabaseClient,
  userId: string,
  target: { type: 'match' | 'fixture' | 'competition' | 'team'; id: string },
): Promise<RuleBookView> {
  if (target.type === 'team') {
    const team = await teamRow(service, target.id);
    const own = await bookFor(service, 'team', team.id);
    const canEdit = isLeader(await roleIn(service, team.id, userId));
    const sport = await sportName(service, team.sport_id);
    const t = own ?? { ...ruleTemplateFor(sport), version: 0 };
    return { ...t, source: own ? 'own' : 'template', canEdit, target: { type: 'team', id: team.id } };
  }
  let competitionId: string | null = null;
  let sport: string | null = null;
  let format: string | null = null;
  let organiserId: string | null = null;
  if (target.type === 'competition') competitionId = target.id;
  if (target.type === 'fixture') {
    const { data } = await service.from('fixtures').select('competition_id').eq('id', target.id).maybeSingle();
    competitionId = (data as { competition_id: string } | null)?.competition_id ?? null;
    if (!competitionId) throw new ActionError(404, 'Fixture not found.');
  }
  if (competitionId) {
    const { data } = await service.from('competitions').select('organiser_id,sport_id').eq('id', competitionId).maybeSingle();
    const c = data as { organiser_id: string; sport_id: string } | null;
    if (!c) throw new ActionError(404, 'Competition not found.');
    organiserId = c.organiser_id;
    sport = await sportName(service, c.sport_id);
    const own = await bookFor(service, 'competition', competitionId);
    const t = own ?? { ...ruleTemplateFor(sport), version: 0 };
    return {
      ...t,
      source: own ? (target.type === 'competition' ? 'own' : 'competition') : 'template',
      canEdit: organiserId === userId,
      target: { type: 'competition', id: competitionId },
    };
  }
  const { data } = await service.from('matches').select('id,organiser_id,sport_id,format').eq('id', target.id).maybeSingle();
  const m = data as { id: string; organiser_id: string; sport_id: string; format: string | null } | null;
  if (!m) throw new ActionError(404, 'Game not found.');
  sport = await sportName(service, m.sport_id);
  format = m.format;
  const own = await bookFor(service, 'match', m.id);
  const t = own ?? { ...ruleTemplateFor(sport, format), version: 0 };
  return { ...t, source: own ? 'own' : 'template', canEdit: m.organiser_id === userId, target: { type: 'match', id: m.id } };
}

export async function saveRuleBook(service: SupabaseClient, userId: string, input: SaveRuleBookInput): Promise<{ version: number }> {
  const { type, id } = input.target;
  let sport: string | null = null;
  if (type === 'match') {
    const { data } = await service.from('matches').select('organiser_id,sport_id').eq('id', id).maybeSingle();
    const m = data as { organiser_id: string; sport_id: string } | null;
    if (!m) throw new ActionError(404, 'Game not found.');
    if (m.organiser_id !== userId) throw new ActionError(403, 'Only the host can set the rules for this game.');
    sport = await sportName(service, m.sport_id);
  } else if (type === 'competition') {
    const { data } = await service.from('competitions').select('organiser_id,sport_id').eq('id', id).maybeSingle();
    const c = data as { organiser_id: string; sport_id: string } | null;
    if (!c) throw new ActionError(404, 'Competition not found.');
    if (c.organiser_id !== userId) throw new ActionError(403, 'Only the organiser can set the competition rules.');
    sport = await sportName(service, c.sport_id);
  } else {
    await requireLeader(service, id, userId);
    sport = await sportName(service, (await teamRow(service, id)).sport_id);
  }
  const { data: existing } = await service.from('rule_books').select('id,version').eq('owner_type', type).eq('owner_id', id).maybeSingle();
  const prev = existing as { id: string; version: number } | null;
  const now = new Date().toISOString();
  const version = (prev?.version ?? 0) + 1;
  const row = { owner_type: type, owner_id: id, title: input.title, sport, version, rules: input.rules, created_by: userId, updated_at: now };
  const { error } = prev
    ? await service.from('rule_books').update(row).eq('id', prev.id)
    : await service.from('rule_books').insert({ id: crypto.randomUUID(), created_at: now, ...row });
  if (error) throw new ActionError(500, 'Could not save the rule book.');
  return { version };
}
