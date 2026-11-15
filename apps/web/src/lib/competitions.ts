import {
  announcementSchema,
  competitionEntrySchema,
  competitionSchema,
  fixtureSchema,
  leagueTable,
  sportListSchema,
  teamSchema,
} from '@chabuka/shared';
import type { Announcement, Competition, CompetitionEntry, Fixture, Sport, TableRow, Team, TeamRole } from '@chabuka/shared';
import { supabase } from './supabase';
import { API_BASE } from './api';
import { fetchMyTeams, isCaptainRole } from './teams';

export interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  url: string | null;
  tier: 'title' | 'gold' | 'partner' | 'supporter';
  sort: number;
}

export interface CompetitionListing {
  competition: Competition;
  teamNames: Map<string, string>;
  /** Approved teams. */
  entryTeamIds: string[];
  pending: number;
}

function parseAll<T>(rows: unknown[] | null | undefined, schema: { safeParse: (r: unknown) => { success: boolean; data?: T } }): T[] {
  return (rows ?? []).map((r) => schema.safeParse(r)).filter((p) => p.success).map((p) => p.data as T);
}

export async function fetchCompetitions(): Promise<CompetitionListing[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('competitions').select('*').order('created_at', { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  const competitions = parseAll<Competition>(data, competitionSchema);
  if (competitions.length === 0) return [];
  const { data: entryRows } = await supabase
    .from('competition_entries')
    .select('competition_id,team_id,status')
    .in('competition_id', competitions.map((c) => c.id));
  const entries = parseAll<CompetitionEntry>(entryRows, competitionEntrySchema);
  const teamIds = [...new Set(entries.map((e) => e.team_id))];
  const teamNames = new Map<string, string>();
  if (teamIds.length) {
    const { data: t } = await supabase.from('teams').select('id,name').in('id', teamIds);
    for (const row of (t ?? []) as { id: string; name: string }[]) teamNames.set(row.id, row.name);
  }
  return competitions.map((competition) => {
    const mine = entries.filter((e) => e.competition_id === competition.id);
    return {
      competition,
      teamNames,
      entryTeamIds: mine.filter((e) => e.status === 'approved').map((e) => e.team_id),
      pending: mine.filter((e) => e.status === 'pending').length,
    };
  });
}

export interface CompetitionView {
  competition: Competition;
  sport: Sport | null;
  teams: Map<string, Team>;
  entries: CompetitionEntry[];
  fixtures: Fixture[];
  sponsors: Sponsor[];
  announcements: Announcement[];
  following: boolean;
  isOrganiser: boolean;
  organiserName: string | null;
  myTeams: { team: Team; role: TeamRole }[];
  myCaptainTeamIds: string[];
  /** The first of my teams that entered, with its status. */
  myEntry: { teamId: string; status: CompetitionEntry['status'] } | null;
  tables: { label: string | null; rows: TableRow[] }[];
  knockout: { rounds: number; byRound: Fixture[][] } | null;
  venueName: string | null;
}

export async function fetchCompetitionView(id: string, userId: string): Promise<CompetitionView> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const db = supabase;
  const { data: row, error } = await db.from('competitions').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const parsed = competitionSchema.safeParse(row);
  if (!parsed.success) throw new Error('Competition not found.');
  const competition = parsed.data;

  const [entryRes, fixtureRes, sponsorRes, annRes, followRes, sportRes, organiserRes, myTeams, venueRes] = await Promise.all([
    db.from('competition_entries').select('competition_id,team_id,status,group_label,seed').eq('competition_id', id),
    db.from('fixtures').select('*').eq('competition_id', id),
    db.from('competition_sponsors').select('*').eq('competition_id', id).order('sort'),
    db.from('announcements').select('*').eq('competition_id', id).order('created_at', { ascending: false }),
    db.from('follows').select('user_id').eq('competition_id', id).eq('user_id', userId).maybeSingle(),
    db.from('sports').select('id,name,formats').eq('id', competition.sport_id),
    db.from('profiles').select('name').eq('id', competition.organiser_id).maybeSingle(),
    fetchMyTeams(userId).catch(() => []),
    competition.venue_id ? db.from('venues').select('name').eq('id', competition.venue_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const entries = parseAll<CompetitionEntry>(entryRes.data, competitionEntrySchema).filter((e) => e.status !== 'withdrawn');
  const fixtures = parseAll<Fixture>(fixtureRes.data, fixtureSchema);
  const teamIds = [...new Set([...entries.map((e) => e.team_id), ...fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]).filter((x): x is string => !!x)])];
  const teams = new Map<string, Team>();
  if (teamIds.length) {
    const { data: t } = await db.from('teams').select('*').in('id', teamIds);
    for (const team of parseAll<Team>(t, teamSchema)) teams.set(team.id, team);
  }
  const sport = parseAll<Sport>(sportRes.data, { safeParse: (r) => sportListSchema.element.safeParse(r) })[0] ?? null;

  const approved = entries.filter((e) => e.status === 'approved');
  const points = { win: competition.points_win, draw: competition.points_draw, loss: competition.points_loss };
  const tables: CompetitionView['tables'] = [];
  if (competition.format === 'groups_knockout') {
    const labels = [...new Set(approved.map((e) => e.group_label).filter((x): x is string => !!x))].sort();
    for (const label of labels) {
      tables.push({
        label,
        rows: leagueTable(
          approved.filter((e) => e.group_label === label).map((e) => e.team_id),
          fixtures.filter((f) => f.stage === 'group' && f.group_label === label),
          points,
        ),
      });
    }
  } else if (competition.format !== 'knockout') {
    tables.push({ label: null, rows: leagueTable(approved.map((e) => e.team_id), fixtures.filter((f) => f.stage === 'league'), points) });
  }
  const ko = fixtures.filter((f) => f.stage === 'knockout');
  const rounds = ko.length ? Math.max(...ko.map((f) => f.round ?? 1)) : 0;
  const knockout = ko.length
    ? {
        rounds,
        byRound: Array.from({ length: rounds }, (_, i) => ko.filter((f) => (f.round ?? 1) === i + 1).sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0))),
      }
    : null;

  const myCaptainTeamIds = myTeams.filter((m) => isCaptainRole(m.role)).map((m) => m.team.id);
  const mine = entries.find((e) => myTeams.some((m) => m.team.id === e.team_id) && e.status !== 'rejected') ?? entries.find((e) => myTeams.some((m) => m.team.id === e.team_id));
  return {
    competition,
    sport,
    teams,
    entries,
    fixtures,
    sponsors: (sponsorRes.data ?? []) as Sponsor[],
    announcements: parseAll<Announcement>(annRes.data, announcementSchema),
    following: Boolean(followRes.data),
    isOrganiser: competition.organiser_id === userId,
    organiserName: (organiserRes.data as { name: string | null } | null)?.name ?? null,
    myTeams,
    myCaptainTeamIds,
    myEntry: mine ? { teamId: mine.team_id, status: mine.status } : null,
    tables,
    knockout,
    venueName: (venueRes.data as { name: string } | null)?.name ?? null,
  };
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

// Organiser only: registration details (contact, answers) from the API.
export async function fetchOrganiserEntries(token: string, competitionId: string): Promise<PrivateEntry[]> {
  const res = await fetch(`${API_BASE}/api/competitions/${competitionId}/entries`, { headers: { authorization: `Bearer ${token}` } });
  const data = (await res.json().catch(() => null)) as (PrivateEntry[] & { error?: string }) | { error?: string } | null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? 'Could not load the entries.');
  return data as PrivateEntry[];
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

export async function fetchSeries(token: string, seriesId: string): Promise<SeriesView> {
  const res = await fetch(`${API_BASE}/api/series/${seriesId}`, { headers: { authorization: `Bearer ${token}` } });
  const data = (await res.json().catch(() => null)) as (SeriesView & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? 'Could not load the series.');
  return data as SeriesView;
}
