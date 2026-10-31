import {
  announcementSchema,
  competitionEntrySchema,
  competitionSchema,
  computeStandings,
  fixtureSchema,
  teamSchema,
} from '@chabuka/shared';
import type { Announcement, Competition, Fixture, StandingRow, Team } from '@chabuka/shared';
import { supabase } from './supabase';

export interface Board {
  competition: Competition;
  teams: Map<string, Team>;
  entries: string[];
  fixtures: Fixture[];
  announcements: Announcement[];
  standings: StandingRow[];
  following: boolean;
}

function errorMessage(error: { message: string }): Error {
  return new Error(error.message);
}

export async function fetchCompetitions(): Promise<{ competition: Competition; teamNames: Map<string, string>; entryTeamIds: string[] }[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('competitions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw errorMessage(error);
  const competitions = (data ?? [])
    .map((row) => {
      const parsed = competitionSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((c): c is Competition => c !== null);
  if (competitions.length === 0) return [];

  const ids = competitions.map((c) => c.id);
  const { data: entryRows } = await supabase
    .from('competition_entries')
    .select('competition_id,team_id,status')
    .in('competition_id', ids);
  const entries = (entryRows ?? [])
    .map((row) => {
      const parsed = competitionEntrySchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const teamIds = [...new Set(entries.map((e) => e.team_id))];
  const teamNames = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teamRows } = await supabase.from('teams').select('id,name').in('id', teamIds);
    for (const t of (teamRows ?? []) as { id: string; name: string }[]) teamNames.set(t.id, t.name);
  }

  const byComp = new Map<string, string[]>();
  for (const e of entries) {
    const list = byComp.get(e.competition_id) ?? [];
    list.push(e.team_id);
    byComp.set(e.competition_id, list);
  }
  return competitions.map((competition) => ({
    competition,
    teamNames,
    entryTeamIds: byComp.get(competition.id) ?? [],
  }));
}

export async function fetchBoard(competitionId: string, userId: string): Promise<Board> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: compRow, error: compErr } = await supabase
    .from('competitions')
    .select('*')
    .eq('id', competitionId)
    .maybeSingle();
  if (compErr) throw errorMessage(compErr);
  const parsed = competitionSchema.safeParse(compRow);
  if (!parsed.success) throw new Error('Tournament not found.');
  const competition = parsed.data;

  const { data: entryRows, error: entryErr } = await supabase
    .from('competition_entries')
    .select('competition_id,team_id,status')
    .eq('competition_id', competitionId);
  if (entryErr) throw errorMessage(entryErr);
  const entries = (entryRows ?? [])
    .map((row) => {
      const p = competitionEntrySchema.safeParse(row);
      return p.success ? p.data : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const entryIds = entries.map((e) => e.team_id);

  const teams = new Map<string, Team>();
  if (entryIds.length > 0) {
    const { data: teamRows } = await supabase.from('teams').select('*').in('id', entryIds);
    for (const row of teamRows ?? []) {
      const p = teamSchema.safeParse(row);
      if (p.success) teams.set(p.data.id, p.data);
    }
  }

  const { data: fixtureRows } = await supabase
    .from('fixtures')
    .select('*')
    .eq('competition_id', competitionId)
    .order('created_at');
  const fixtures = (fixtureRows ?? [])
    .map((row) => {
      const p = fixtureSchema.safeParse(row);
      return p.success ? p.data : null;
    })
    .filter((f): f is Fixture => f !== null);

  const { data: annRows } = await supabase
    .from('announcements')
    .select('*')
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: false });
  const announcements = (annRows ?? [])
    .map((row) => {
      const p = announcementSchema.safeParse(row);
      return p.success ? p.data : null;
    })
    .filter((a): a is Announcement => a !== null);

  const { data: followRow } = await supabase
    .from('follows')
    .select('user_id')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .maybeSingle();

  return {
    competition,
    teams,
    entries: entryIds,
    fixtures,
    announcements,
    standings: computeStandings(entryIds, fixtures),
    following: Boolean(followRow),
  };
}
