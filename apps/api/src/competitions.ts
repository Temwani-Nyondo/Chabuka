import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  competitionSchema,
  fixtureSchema,
  groupDraw,
  knockoutBracket,
  knockoutWinner,
  leagueRounds,
  leagueTable,
  nextSeriesDates,
  nextSlot,
  qualifiersToSeeds,
} from '@chabuka/shared';
import type {
  Competition,
  CreateCompetitionV2Input,
  CreateSeriesInput,
  Fixture,
  RegisterTeamInput,
  ReportResultInput,
  ScheduleFixtureInput,
  SponsorInput,
  UpdateCompetitionInput,
} from '@chabuka/shared';
import { ActionError, joinMatch, notifyUsers, recordFixtureResult, updateMatch } from './actions.js';

// Competitions v2 and recurring game series. Every function takes the service
// client and does its own permission checks first, like teamAdmin.ts.

type Role = 'owner' | 'captain' | 'player';

// --- Loading -----------------------------------------------------------------------

export async function loadCompetitionV2(service: SupabaseClient, id: string): Promise<Competition> {
  const { data } = await service.from('competitions').select('*').eq('id', id).maybeSingle();
  if (!data) throw new ActionError(404, 'Competition not found.');
  return competitionSchema.parse(data);
}

async function loadFixtureV2(service: SupabaseClient, id: string): Promise<Fixture> {
  const { data } = await service.from('fixtures').select('*').eq('id', id).maybeSingle();
  if (!data) throw new ActionError(404, 'Fixture not found.');
  return fixtureSchema.parse(data);
}

async function fixturesOf(service: SupabaseClient, competitionId: string): Promise<Fixture[]> {
  const { data } = await service.from('fixtures').select('*').eq('competition_id', competitionId);
  return ((data ?? []) as unknown[]).map((r) => fixtureSchema.parse(r));
}

interface EntryRow {
  competition_id: string;
  team_id: string;
  status: string;
  group_label: string | null;
  seed: number | null;
  created_at?: string;
}

async function entriesOf(service: SupabaseClient, competitionId: string): Promise<EntryRow[]> {
  const { data } = await service.from('competition_entries').select('*').eq('competition_id', competitionId);
  return ((data ?? []) as EntryRow[]).map((e) => ({ ...e, status: e.status === 'registered' ? 'approved' : e.status }));
}

async function roleIn(service: SupabaseClient, teamId: string, userId: string): Promise<Role | null> {
  const { data } = await service.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return ((data as { role: Role } | null)?.role ?? null) as Role | null;
}

const isLeader = (r: Role | null) => r === 'owner' || r === 'captain';

async function leadersOf(service: SupabaseClient, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const { data } = await service.from('team_members').select('user_id,role').in('team_id', teamIds);
  return [...new Set(((data ?? []) as { user_id: string; role: Role }[]).filter((m) => isLeader(m.role)).map((m) => m.user_id))];
}

async function membersOfTeams(service: SupabaseClient, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const { data } = await service.from('team_members').select('user_id').in('team_id', teamIds);
  return [...new Set(((data ?? []) as { user_id: string }[]).map((m) => m.user_id))];
}

function requireOrganiser(c: Competition, userId: string): void {
  if (c.organiser_id !== userId) throw new ActionError(403, 'Only the organiser can do that.');
}

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// --- Create and edit -------------------------------------------------------------------

function detailColumns(input: Partial<UpdateCompetitionInput>): Record<string, unknown> {
  const map: [keyof UpdateCompetitionInput, string][] = [
    ['description', 'description'],
    ['bannerUrl', 'banner_url'],
    ['location', 'location'],
    ['venueId', 'venue_id'],
    ['hostName', 'host_name'],
    ['hostLogoUrl', 'host_logo_url'],
    ['hostContact', 'host_contact'],
    ['hostWebsite', 'host_website'],
    ['causeName', 'cause_name'],
    ['causeDescription', 'cause_description'],
    ['causeUrl', 'cause_url'],
    ['fundraisingNote', 'fundraising_note'],
    ['entryFeeNote', 'entry_fee_note'],
    ['registrationClosesAt', 'registration_closes_at'],
    ['requiresApproval', 'requires_approval'],
    ['teamSizeMin', 'team_size_min'],
    ['teamSizeMax', 'team_size_max'],
    ['registrationQuestions', 'registration_questions'],
  ];
  const out: Record<string, unknown> = {};
  for (const [k, col] of map) {
    const v = input[k];
    if (v === undefined) continue;
    out[col] = typeof v === 'string' && v.trim() === '' ? null : v;
  }
  return out;
}

export async function createCompetitionV2(service: SupabaseClient, userId: string, input: CreateCompetitionV2Input): Promise<{ competitionId: string }> {
  const id = crypto.randomUUID();
  const { error } = await service.from('competitions').insert({
    id,
    organiser_id: userId,
    sport_id: input.sportId,
    name: input.name,
    kind: input.kind,
    format: input.format,
    category: input.category,
    area: input.area,
    starts_on: input.startsOn,
    ends_on: input.endsOn ?? null,
    max_entries: input.maxEntries,
    status: 'registration',
    group_count: input.format === 'groups_knockout' ? (input.groupCount ?? 2) : null,
    advance_per_group: input.format === 'groups_knockout' ? (input.advancePerGroup ?? 2) : null,
    points_win: input.pointsWin ?? 3,
    points_draw: input.pointsDraw ?? 1,
    points_loss: input.pointsLoss ?? 0,
    requires_approval: input.requiresApproval ?? true,
    registration_questions: input.registrationQuestions ?? [],
    ...detailColumns(input),
  });
  if (error) throw new ActionError(500, 'Could not create the competition.');
  return { competitionId: id };
}

export async function updateCompetition(service: SupabaseClient, userId: string, input: UpdateCompetitionInput): Promise<void> {
  const c = await loadCompetitionV2(service, input.competitionId);
  requireOrganiser(c, userId);
  if (c.status === 'cancelled') throw new ActionError(409, 'This competition was cancelled.');
  const patch: Record<string, unknown> = { ...detailColumns(input) };
  if (input.name !== undefined) patch['name'] = input.name;
  if (input.area !== undefined) patch['area'] = input.area;
  if (input.startsOn !== undefined) patch['starts_on'] = input.startsOn;
  if (input.endsOn !== undefined) patch['ends_on'] = input.endsOn;
  if (input.category !== undefined) patch['category'] = input.category;
  if (input.maxEntries !== undefined) {
    if (c.status !== 'registration') throw new ActionError(409, 'The draw is made; the number of teams is fixed.');
    const taken = (await entriesOf(service, c.id)).filter((e) => e.status === 'approved' || e.status === 'pending').length;
    if (input.maxEntries < taken) throw new ActionError(409, `${taken} teams have already entered.`);
    patch['max_entries'] = input.maxEntries;
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await service.from('competitions').update(patch).eq('id', c.id);
  if (error) throw new ActionError(500, 'Could not save the competition.');
}

export async function upsertSponsor(service: SupabaseClient, userId: string, input: SponsorInput): Promise<{ sponsorId: string }> {
  const c = await loadCompetitionV2(service, input.competitionId);
  requireOrganiser(c, userId);
  const row = { name: input.name, logo_url: input.logoUrl ?? null, url: input.url ?? null, tier: input.tier };
  if (input.sponsorId) {
    const { error } = await service.from('competition_sponsors').update(row).eq('id', input.sponsorId).eq('competition_id', c.id);
    if (error) throw new ActionError(500, 'Could not save the sponsor.');
    return { sponsorId: input.sponsorId };
  }
  const { data: existing } = await service.from('competition_sponsors').select('id').eq('competition_id', c.id);
  if (((existing ?? []) as unknown[]).length >= 30) throw new ActionError(409, 'That is plenty of sponsors (30 at most).');
  const id = crypto.randomUUID();
  const { error } = await service
    .from('competition_sponsors')
    .insert({ id, competition_id: c.id, ...row, sort: ((existing ?? []) as unknown[]).length, created_at: new Date().toISOString() });
  if (error) throw new ActionError(500, 'Could not add the sponsor.');
  return { sponsorId: id };
}

export async function removeSponsor(service: SupabaseClient, userId: string, input: { competitionId: string; sponsorId: string }): Promise<void> {
  const c = await loadCompetitionV2(service, input.competitionId);
  requireOrganiser(c, userId);
  await service.from('competition_sponsors').delete().eq('id', input.sponsorId).eq('competition_id', c.id);
}

export async function cancelCompetition(service: SupabaseClient, userId: string, competitionId: string): Promise<void> {
  const c = await loadCompetitionV2(service, competitionId);
  requireOrganiser(c, userId);
  if (c.status === 'finished' || c.status === 'cancelled') throw new ActionError(409, 'This competition is already over.');
  const { error } = await service.from('competitions').update({ status: 'cancelled' }).eq('id', c.id);
  if (error) throw new ActionError(500, 'Could not cancel the competition.');
  const teams = (await entriesOf(service, c.id)).filter((e) => e.status === 'approved' || e.status === 'pending').map((e) => e.team_id);
  await notifyUsers((await membersOfTeams(service, teams)).filter((u) => u !== userId), 'competition_cancelled', { competitionId: c.id, name: c.name });
}

// --- Registration ------------------------------------------------------------------------

export async function registerTeam(service: SupabaseClient, userId: string, input: RegisterTeamInput): Promise<{ status: 'pending' | 'approved' }> {
  const c = await loadCompetitionV2(service, input.competitionId);
  if (c.status !== 'registration') throw new ActionError(409, 'Entries are closed for this competition.');
  if (c.registration_closes_at && new Date(c.registration_closes_at).getTime() < Date.now()) {
    throw new ActionError(409, 'Registration has closed.');
  }
  if (!isLeader(await roleIn(service, input.teamId, userId))) throw new ActionError(403, 'Only a captain or owner can enter the team.');
  const { data: teamRow } = await service.from('teams').select('id,name,sport_id').eq('id', input.teamId).maybeSingle();
  const team = teamRow as { id: string; name: string; sport_id: string } | null;
  if (!team) throw new ActionError(404, 'Team not found.');
  if (team.sport_id !== c.sport_id) throw new ActionError(409, 'That team plays a different sport.');

  const required = c.registration_questions.filter((q) => q.required);
  for (const q of required) {
    const a = input.answers.find((x) => x.label === q.label);
    if (!a || !a.answer.trim()) throw new ActionError(400, `Please answer: ${q.label}`);
  }
  if (input.squadSize != null) {
    if (c.team_size_min && input.squadSize < c.team_size_min) throw new ActionError(400, `Squads need at least ${c.team_size_min} players.`);
    if (c.team_size_max && input.squadSize > c.team_size_max) throw new ActionError(400, `Squads can have at most ${c.team_size_max} players.`);
  }

  const entries = await entriesOf(service, c.id);
  const existing = entries.find((e) => e.team_id === team.id);
  if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
    return { status: existing.status as 'pending' | 'approved' };
  }
  const taken = entries.filter((e) => e.status === 'approved' || e.status === 'pending').length;
  if (taken >= c.max_entries) throw new ActionError(409, 'This competition is full.');

  const status: 'pending' | 'approved' = c.requires_approval ? 'pending' : 'approved';
  const now = new Date().toISOString();
  if (existing) {
    const { error } = await service
      .from('competition_entries')
      .update({ status, decided_at: status === 'approved' ? now : null })
      .eq('competition_id', c.id)
      .eq('team_id', team.id);
    if (error) throw new ActionError(500, 'Could not enter the team.');
  } else {
    const { error } = await service
      .from('competition_entries')
      .insert({ competition_id: c.id, team_id: team.id, status, created_at: now, decided_at: status === 'approved' ? now : null });
    if (error) throw new ActionError(500, 'Could not enter the team.');
  }
  const { error: detErr } = await service.from('competition_entry_details').upsert(
    {
      competition_id: c.id,
      team_id: team.id,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      squad_size: input.squadSize ?? null,
      answers: input.answers,
      note: input.note ?? null,
      created_by: userId,
      created_at: now,
    },
    { onConflict: 'competition_id,team_id' },
  );
  if (detErr) throw new ActionError(500, 'Could not save the registration details.');
  if (c.organiser_id !== userId) {
    await notifyUsers([c.organiser_id], 'entry_received', { competitionId: c.id, name: c.name, teamName: team.name, status });
  }
  return { status };
}

export async function reviewEntry(
  service: SupabaseClient,
  userId: string,
  input: { competitionId: string; teamId: string; decision: 'approve' | 'reject'; note?: string },
): Promise<{ status: 'approved' | 'rejected' }> {
  const c = await loadCompetitionV2(service, input.competitionId);
  requireOrganiser(c, userId);
  if (c.status !== 'registration') throw new ActionError(409, 'The draw is made; entries are fixed.');
  const entries = await entriesOf(service, c.id);
  const entry = entries.find((e) => e.team_id === input.teamId);
  if (!entry || entry.status === 'withdrawn') throw new ActionError(404, 'That team has not entered.');
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  if (status === 'approved' && entry.status !== 'approved') {
    const approved = entries.filter((e) => e.status === 'approved').length;
    if (approved >= c.max_entries) throw new ActionError(409, 'The competition is full.');
  }
  const { error } = await service
    .from('competition_entries')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('competition_id', c.id)
    .eq('team_id', input.teamId);
  if (error) throw new ActionError(500, 'Could not save the decision.');
  await service
    .from('competition_entry_details')
    .update({ decided_by: userId, decision_note: input.note ?? null })
    .eq('competition_id', c.id)
    .eq('team_id', input.teamId);
  const { data: t } = await service.from('teams').select('name').eq('id', input.teamId).maybeSingle();
  await notifyUsers(await leadersOf(service, [input.teamId]), 'entry_reviewed', {
    competitionId: c.id,
    name: c.name,
    teamName: (t as { name: string } | null)?.name ?? '',
    decision: status,
    note: input.note ?? '',
  });
  return { status };
}

export async function withdrawEntry(service: SupabaseClient, userId: string, input: { competitionId: string; teamId: string }): Promise<void> {
  const c = await loadCompetitionV2(service, input.competitionId);
  const leader = isLeader(await roleIn(service, input.teamId, userId));
  if (!leader && c.organiser_id !== userId) throw new ActionError(403, 'Only the team’s captain or the organiser can withdraw it.');
  if (c.status !== 'registration') throw new ActionError(409, 'The draw is made. Ask the organiser.');
  const { error } = await service.from('competition_entries').update({ status: 'withdrawn' }).eq('competition_id', c.id).eq('team_id', input.teamId);
  if (error) throw new ActionError(500, 'Could not withdraw the team.');
  if (leader && c.organiser_id !== userId) {
    await notifyUsers([c.organiser_id], 'entry_withdrawn', { competitionId: c.id, name: c.name });
  }
}

export interface PrivateEntry {
  teamId: string;
  teamName: string;
  status: string;
  createdAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  squadSize: number | null;
  answers: { label: string; answer: string }[];
  note: string | null;
}

// Organiser only: everyone who entered, with their contact details and answers.
export async function entriesForOrganiser(service: SupabaseClient, userId: string, competitionId: string): Promise<PrivateEntry[]> {
  const c = await loadCompetitionV2(service, competitionId);
  requireOrganiser(c, userId);
  const entries = await entriesOf(service, c.id);
  const ids = entries.map((e) => e.team_id);
  const [{ data: teams }, { data: details }] = await Promise.all([
    ids.length ? service.from('teams').select('id,name').in('id', ids) : Promise.resolve({ data: [] }),
    service.from('competition_entry_details').select('*').eq('competition_id', c.id),
  ]);
  const names = new Map(((teams ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const det = new Map(
    ((details ?? []) as { team_id: string; contact_name: string; contact_phone: string; squad_size: number | null; answers: { label: string; answer: string }[]; note: string | null }[]).map(
      (d) => [d.team_id, d],
    ),
  );
  return entries
    .map((e) => {
      const d = det.get(e.team_id);
      return {
        teamId: e.team_id,
        teamName: names.get(e.team_id) ?? 'Team',
        status: e.status,
        createdAt: e.created_at ?? null,
        contactName: d?.contact_name ?? null,
        contactPhone: d?.contact_phone ?? null,
        squadSize: d?.squad_size ?? null,
        answers: d?.answers ?? [],
        note: d?.note ?? null,
      };
    })
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

// --- Draw and fixtures ----------------------------------------------------------------------

async function insertFixtures(service: SupabaseClient, rows: Record<string, unknown>[]): Promise<void> {
  for (const row of rows) {
    const { error } = await service.from('fixtures').insert({ id: crypto.randomUUID(), status: 'scheduled', created_at: new Date().toISOString(), ...row });
    if (error) throw new ActionError(500, 'Could not create the fixtures.');
  }
}

// Every round of a knockout as fixtures: round 1 from the seeds, later rounds
// as empty slots. A team drawn against a bye goes straight into round 2.
async function createBracket(service: SupabaseClient, competitionId: string, seeds: string[]): Promise<void> {
  const { rounds, first } = knockoutBracket(seeds);
  const later: Record<number, { home: string | null; away: string | null }[]> = {};
  for (let r = 2; r <= rounds; r += 1) later[r] = Array.from({ length: first.length / 2 ** (r - 1) }, () => ({ home: null, away: null }));
  const rows: Record<string, unknown>[] = [];
  for (const s of first) {
    if (s.home && s.away) {
      rows.push({ competition_id: competitionId, stage: 'knockout', round: 1, bracket_slot: s.slot, home_team_id: s.home, away_team_id: s.away });
    } else {
      const through = s.home ?? s.away;
      if (through && rounds >= 2) {
        const n = nextSlot(s.slot);
        const target = later[2]?.[n.slot - 1];
        if (target) target[n.side] = through;
      }
    }
  }
  for (let r = 2; r <= rounds; r += 1) {
    (later[r] ?? []).forEach((s, i) => rows.push({ competition_id: competitionId, stage: 'knockout', round: r, bracket_slot: i + 1, home_team_id: s.home, away_team_id: s.away }));
  }
  await insertFixtures(service, rows);
}

export async function generateFixtures(service: SupabaseClient, userId: string, competitionId: string): Promise<{ fixtures: number }> {
  const c = await loadCompetitionV2(service, competitionId);
  requireOrganiser(c, userId);
  if (c.status !== 'registration') throw new ActionError(409, 'The fixtures are already made.');
  const approved = (await entriesOf(service, c.id)).filter((e) => e.status === 'approved');
  const minimum = c.format === 'groups_knockout' ? (c.group_count ?? 2) * 2 : 2;
  if (approved.length < minimum) throw new ActionError(409, `At least ${minimum} approved teams are needed to make the fixtures.`);
  const drawn = shuffle(approved.map((e) => e.team_id));
  for (const [i, team] of drawn.entries()) {
    await service.from('competition_entries').update({ seed: i + 1 }).eq('competition_id', c.id).eq('team_id', team);
  }
  if (c.format === 'knockout') {
    await createBracket(service, c.id, drawn);
  } else if (c.format === 'groups_knockout') {
    const groups = groupDraw(drawn, c.group_count ?? 2);
    const rows: Record<string, unknown>[] = [];
    for (const [label, teams] of groups) {
      for (const t of teams) await service.from('competition_entries').update({ group_label: label }).eq('competition_id', c.id).eq('team_id', t);
      for (const p of leagueRounds(teams, 1)) {
        rows.push({ competition_id: c.id, stage: 'group', group_label: label, round: p.round, leg: p.leg, home_team_id: p.home, away_team_id: p.away });
      }
    }
    await insertFixtures(service, rows);
  } else {
    const legs = c.format === 'double_round_robin' ? 2 : 1;
    await insertFixtures(
      service,
      leagueRounds(drawn, legs).map((p) => ({ competition_id: c.id, stage: 'league', round: p.round, leg: p.leg, home_team_id: p.home, away_team_id: p.away })),
    );
  }
  const { error } = await service.from('competitions').update({ status: 'live' }).eq('id', c.id);
  if (error) throw new ActionError(500, 'Could not start the competition.');
  const fixtures = await fixturesOf(service, c.id);
  await notifyUsers((await membersOfTeams(service, drawn)).filter((u) => u !== userId), 'competition_started', { competitionId: c.id, name: c.name });
  return { fixtures: fixtures.length };
}

export async function startKnockout(service: SupabaseClient, userId: string, competitionId: string): Promise<{ fixtures: number }> {
  const c = await loadCompetitionV2(service, competitionId);
  requireOrganiser(c, userId);
  if (c.format !== 'groups_knockout' || c.status !== 'live') throw new ActionError(409, 'There is no group stage to finish.');
  const fixtures = await fixturesOf(service, c.id);
  if (fixtures.some((f) => f.stage === 'knockout')) throw new ActionError(409, 'The knockout is already drawn.');
  const open = fixtures.filter((f) => f.stage === 'group' && f.status !== 'finished' && f.status !== 'cancelled');
  if (open.length > 0) throw new ActionError(409, `${open.length} group game${open.length === 1 ? ' is' : 's are'} still to be played.`);
  const entries = (await entriesOf(service, c.id)).filter((e) => e.status === 'approved' && e.group_label);
  const byGroup = new Map<string, string[]>();
  for (const label of [...new Set(entries.map((e) => e.group_label as string))].sort()) {
    const teams = entries.filter((e) => e.group_label === label).map((e) => e.team_id);
    const table = leagueTable(teams, fixtures.filter((f) => f.group_label === label), { win: c.points_win, draw: c.points_draw, loss: c.points_loss });
    byGroup.set(label, table.map((r) => r.teamId));
  }
  const seeds = qualifiersToSeeds(byGroup, c.advance_per_group ?? 2);
  await createBracket(service, c.id, seeds);
  const made = (await fixturesOf(service, c.id)).filter((f) => f.stage === 'knockout').length;
  await notifyUsers(await membersOfTeams(service, seeds), 'knockout_drawn', { competitionId: c.id, name: c.name });
  return { fixtures: made };
}

export async function scheduleFixture(service: SupabaseClient, userId: string, input: ScheduleFixtureInput): Promise<void> {
  const f = await loadFixtureV2(service, input.fixtureId);
  const c = await loadCompetitionV2(service, f.competition_id);
  requireOrganiser(c, userId);
  if (f.status === 'finished') throw new ActionError(409, 'This game has a result.');
  const patch: Record<string, unknown> = {};
  if (input.startsAt !== undefined) patch['starts_at'] = input.startsAt;
  if (input.venueId !== undefined) patch['venue_id'] = input.venueId;
  if (input.venueName !== undefined) patch['venue_name'] = input.venueName || null;
  if (input.status !== undefined) patch['status'] = input.status;
  if (Object.keys(patch).length === 0) return;
  const { error } = await service.from('fixtures').update(patch).eq('id', f.id);
  if (error) throw new ActionError(500, 'Could not save the fixture.');
  const teams = [f.home_team_id, f.away_team_id].filter((x): x is string => !!x);
  await notifyUsers(await membersOfTeams(service, teams), input.status === 'cancelled' ? 'fixture_cancelled' : input.status === 'postponed' ? 'fixture_postponed' : 'fixture_scheduled', {
    competitionId: c.id,
    fixtureId: f.id,
    name: c.name,
    startsAt: (patch['starts_at'] as string | null | undefined) ?? f.starts_at ?? '',
  });
}

// --- Results ----------------------------------------------------------------------------------

async function finalise(service: SupabaseClient, f: Fixture, c: Competition, home: number, away: number, winner: string | null, actorId: string): Promise<void> {
  await recordFixtureResult(service, f.id, home, away, actorId, winner ?? undefined);
  const teams = [f.home_team_id, f.away_team_id].filter((x): x is string => !!x);
  await notifyUsers((await membersOfTeams(service, teams)).filter((u) => u !== actorId), 'game_result_final', {
    competitionId: c.id,
    fixtureId: f.id,
    name: c.name,
    home,
    away,
  });
}

// A captain reports; the other side confirms. The organiser's report is final.
export async function reportResult(service: SupabaseClient, userId: string, input: ReportResultInput): Promise<{ state: 'final' | 'awaiting_confirmation' | 'disputed' }> {
  const f = await loadFixtureV2(service, input.fixtureId);
  const c = await loadCompetitionV2(service, f.competition_id);
  if (c.status !== 'live' && c.status !== 'finished') throw new ActionError(409, 'This competition is not running.');
  if (!f.home_team_id || !f.away_team_id) throw new ActionError(409, 'Both teams are not known yet.');
  if (f.status === 'cancelled') throw new ActionError(409, 'This game was cancelled.');
  const level = input.homeScore === input.awayScore;
  let winner: string | null = null;
  if (f.stage === 'knockout' && level) {
    if (!input.winnerTeamId || (input.winnerTeamId !== f.home_team_id && input.winnerTeamId !== f.away_team_id)) {
      throw new ActionError(400, 'A knockout game needs a winner: say who won on penalties.');
    }
    winner = input.winnerTeamId;
  }

  if (c.organiser_id === userId) {
    if (f.status === 'finished' && f.stage === 'knockout') {
      // Correcting a knockout result is only safe before the next round is played.
      const later = (await fixturesOf(service, c.id)).find((x) => x.stage === 'knockout' && (x.round ?? 0) === (f.round ?? 0) + 1 && x.bracket_slot === nextSlot(f.bracket_slot ?? 1).slot);
      if (later && later.status === 'finished') throw new ActionError(409, 'The next round is already played; this result can no longer change.');
    }
    await finalise(service, f, c, input.homeScore, input.awayScore, winner, userId);
    return { state: 'final' };
  }

  const homeLeader = isLeader(await roleIn(service, f.home_team_id, userId));
  const awayLeader = isLeader(await roleIn(service, f.away_team_id, userId));
  if (!homeLeader && !awayLeader) throw new ActionError(403, 'Only a captain of one of these teams can report the score.');
  if (f.status === 'finished') throw new ActionError(409, 'This result is already in. Ask the organiser to correct it.');
  const side: 'home' | 'away' = homeLeader ? 'home' : 'away';

  if (f.reported_side && f.reported_side !== side && f.reported_home != null && f.reported_away != null) {
    const same = f.reported_home === input.homeScore && f.reported_away === input.awayScore && (f.reported_winner ?? null) === winner;
    if (same) {
      await finalise(service, f, c, input.homeScore, input.awayScore, winner, userId);
      return { state: 'final' };
    }
    await service.from('fixtures').update({ status: 'disputed' }).eq('id', f.id);
    await notifyUsers([c.organiser_id, ...(await leadersOf(service, [f.home_team_id, f.away_team_id]))].filter((u) => u !== userId), 'result_disputed', {
      competitionId: c.id,
      fixtureId: f.id,
      name: c.name,
    });
    return { state: 'disputed' };
  }

  const { error } = await service
    .from('fixtures')
    .update({
      reported_by: userId,
      reported_side: side,
      reported_home: input.homeScore,
      reported_away: input.awayScore,
      reported_winner: winner,
      reported_at: new Date().toISOString(),
    })
    .eq('id', f.id);
  if (error) throw new ActionError(500, 'Could not save the score.');
  const other = side === 'home' ? f.away_team_id : f.home_team_id;
  await notifyUsers(await leadersOf(service, [other]), 'result_to_confirm', {
    competitionId: c.id,
    fixtureId: f.id,
    name: c.name,
    home: input.homeScore,
    away: input.awayScore,
  });
  return { state: 'awaiting_confirmation' };
}

export async function confirmResult(service: SupabaseClient, userId: string, fixtureId: string): Promise<{ state: 'final' }> {
  const f = await loadFixtureV2(service, fixtureId);
  const c = await loadCompetitionV2(service, f.competition_id);
  if (!f.home_team_id || !f.away_team_id || !f.reported_side || f.reported_home == null || f.reported_away == null) {
    throw new ActionError(409, 'There is no score waiting to be confirmed.');
  }
  if (f.status !== 'scheduled' && f.status !== 'postponed') throw new ActionError(409, 'This result is no longer waiting for confirmation.');
  const otherTeam = f.reported_side === 'home' ? f.away_team_id : f.home_team_id;
  if (!isLeader(await roleIn(service, otherTeam, userId))) throw new ActionError(403, 'Only a captain of the other team can confirm.');
  await finalise(service, f, c, f.reported_home, f.reported_away, f.reported_winner ?? null, userId);
  return { state: 'final' };
}

// Called after any result: moves a knockout winner into the next round.
export async function advanceKnockout(service: SupabaseClient, fixtureId: string): Promise<{ champion: string | null }> {
  const f = await loadFixtureV2(service, fixtureId);
  if (f.stage !== 'knockout' || f.status !== 'finished') return { champion: null };
  const winner = knockoutWinner(f);
  if (!winner) return { champion: null };
  const all = await fixturesOf(service, f.competition_id);
  const rounds = Math.max(...all.filter((x) => x.stage === 'knockout').map((x) => x.round ?? 1));
  if ((f.round ?? 1) >= rounds) return { champion: winner };
  const n = nextSlot(f.bracket_slot ?? 1);
  const target = all.find((x) => x.stage === 'knockout' && x.round === (f.round ?? 1) + 1 && x.bracket_slot === n.slot);
  if (target) {
    await service.from('fixtures').update({ [n.side === 'home' ? 'home_team_id' : 'away_team_id']: winner }).eq('id', target.id);
  }
  return { champion: null };
}

// --- Recurring weekly games ---------------------------------------------------------------------

interface SeriesRow {
  id: string;
  organiser_id: string;
  sport_id: string;
  title: string;
  weekday: number;
  local_time: string;
  interval_weeks: 1 | 2;
  starts_on: string;
  until: string | null;
  area: string;
  venue_id: string | null;
  venue_name: string | null;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
  format: string | null;
  capacity: number;
  level: string | null;
  notes: string | null;
  visibility: 'public' | 'private';
  circle_id: string | null;
  status: 'active' | 'ended';
}

async function loadSeries(service: SupabaseClient, id: string): Promise<SeriesRow> {
  const { data } = await service.from('match_series').select('*').eq('id', id).maybeSingle();
  if (!data) throw new ActionError(404, 'Series not found.');
  return data as SeriesRow;
}

const UPCOMING = 4;

// Keep the next four games in place. Dates already used (even a skipped,
// cancelled one) are never recreated.
export async function topUpSeries(service: SupabaseClient, seriesId: string, now: Date = new Date()): Promise<string[]> {
  const s = await loadSeries(service, seriesId);
  if (s.status !== 'active') return [];
  const dates = nextSeriesDates({ weekday: s.weekday, time: s.local_time, intervalWeeks: s.interval_weeks, startsOn: s.starts_on, until: s.until }, now, UPCOMING);
  const { data } = await service.from('matches').select('id,starts_at').eq('series_id', s.id);
  const used = new Set(((data ?? []) as { starts_at: string }[]).map((m) => new Date(m.starts_at).toISOString()));
  const { data: regs } = await service.from('series_regulars').select('user_id').eq('series_id', s.id);
  const regulars = ((regs ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((u) => u !== s.organiser_id);
  const created: string[] = [];
  for (const at of dates) {
    if (used.has(at)) continue;
    const id = crypto.randomUUID();
    const { error } = await service.from('matches').insert({
      id,
      organiser_id: s.organiser_id,
      sport_id: s.sport_id,
      title: s.title,
      starts_at: at,
      venue_id: s.venue_id,
      venue_name: s.venue_name,
      place_id: s.place_id,
      lat: s.lat,
      lng: s.lng,
      area: s.area,
      format: s.format,
      capacity: s.capacity,
      level: s.level,
      kind: 'players',
      visibility: s.visibility,
      status: 'open',
      notes: s.notes,
      circle_id: s.circle_id,
      series_id: s.id,
    });
    if (error) throw new ActionError(500, 'Could not create the next game in the series.');
    const joiners = [s.organiser_id, ...regulars].slice(0, s.capacity);
    for (const u of joiners) {
      await service.from('match_participants').upsert({ match_id: id, user_id: u, status: 'joined' }, { onConflict: 'match_id,user_id' });
    }
    if (joiners.length >= s.capacity) await service.from('matches').update({ status: 'full' }).eq('id', id);
    created.push(id);
  }
  if (created.length && regulars.length) {
    await notifyUsers(regulars, 'series_game_added', { seriesId: s.id, title: s.title, matchId: created[0] });
  }
  return created;
}

export async function createSeries(service: SupabaseClient, userId: string, input: CreateSeriesInput): Promise<{ seriesId: string; matchIds: string[] }> {
  const id = crypto.randomUUID();
  const { error } = await service.from('match_series').insert({
    id,
    organiser_id: userId,
    sport_id: input.sportId,
    title: input.title,
    weekday: input.weekday,
    local_time: input.time,
    interval_weeks: input.intervalWeeks,
    starts_on: input.startsOn,
    until: input.until ?? null,
    area: input.area,
    venue_id: input.venueId ?? null,
    venue_name: input.venueName ?? null,
    place_id: input.placeId ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    format: input.format ?? null,
    capacity: input.capacity,
    level: input.level,
    notes: input.notes ?? null,
    visibility: input.visibility,
    circle_id: input.circleId ?? null,
    status: 'active',
    created_at: new Date().toISOString(),
  });
  if (error) throw new ActionError(500, 'Could not create the series.');
  const matchIds = await topUpSeries(service, id);
  if (matchIds.length === 0) throw new ActionError(409, 'No games fall between the start and end dates.');
  return { seriesId: id, matchIds };
}

export async function endSeries(service: SupabaseClient, userId: string, seriesId: string): Promise<void> {
  const s = await loadSeries(service, seriesId);
  if (s.organiser_id !== userId) throw new ActionError(403, 'Only the host can end the series.');
  await service.from('match_series').update({ status: 'ended' }).eq('id', s.id);
}

export async function skipOccurrence(service: SupabaseClient, userId: string, input: { matchId: string; reason?: string }): Promise<void> {
  const { data } = await service.from('matches').select('series_id').eq('id', input.matchId).maybeSingle();
  const seriesId = (data as { series_id: string | null } | null)?.series_id;
  if (!seriesId) throw new ActionError(409, 'This game is not part of a weekly series.');
  await updateMatch(service, userId, { matchId: input.matchId, status: 'cancelled', reason: input.reason ?? 'Skipping this week' });
}

export async function joinSeries(service: SupabaseClient, userId: string, seriesId: string): Promise<{ joined: number }> {
  const s = await loadSeries(service, seriesId);
  if (s.status !== 'active') throw new ActionError(409, 'This series has ended.');
  await service.from('series_regulars').upsert({ series_id: s.id, user_id: userId, created_at: new Date().toISOString() }, { onConflict: 'series_id,user_id' });
  const { data } = await service.from('matches').select('id,starts_at,status').eq('series_id', s.id).gt('starts_at', new Date().toISOString());
  let joined = 0;
  for (const m of (data ?? []) as { id: string; status: string }[]) {
    if (m.status !== 'open') continue;
    try {
      await joinMatch(service, userId, m.id);
      joined += 1;
    } catch {
      // Full or ticketed: the regular simply is not in that one.
    }
  }
  return { joined };
}

export async function leaveSeries(service: SupabaseClient, userId: string, seriesId: string): Promise<void> {
  await service.from('series_regulars').delete().eq('series_id', seriesId).eq('user_id', userId);
}

export interface SeriesView {
  id: string;
  title: string;
  weekday: number;
  time: string;
  intervalWeeks: number;
  until: string | null;
  status: 'active' | 'ended';
  isHost: boolean;
  isRegular: boolean;
  regulars: number;
  upcoming: { matchId: string; startsAt: string; status: string }[];
}

export async function getSeries(service: SupabaseClient, userId: string, seriesId: string): Promise<SeriesView> {
  await topUpSeries(service, seriesId).catch(() => []);
  const s = await loadSeries(service, seriesId);
  const [{ data: regs }, { data: games }] = await Promise.all([
    service.from('series_regulars').select('user_id').eq('series_id', s.id),
    service.from('matches').select('id,starts_at,status').eq('series_id', s.id).gt('starts_at', new Date(Date.now() - 3 * 3600 * 1000).toISOString()),
  ]);
  const regulars = (regs ?? []) as { user_id: string }[];
  return {
    id: s.id,
    title: s.title,
    weekday: s.weekday,
    time: s.local_time,
    intervalWeeks: s.interval_weeks,
    until: s.until,
    status: s.status,
    isHost: s.organiser_id === userId,
    isRegular: regulars.some((r) => r.user_id === userId),
    regulars: regulars.length,
    upcoming: ((games ?? []) as { id: string; starts_at: string; status: string }[])
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((g) => ({ matchId: g.id, startsAt: g.starts_at, status: g.status })),
  };
}
