import type { RaceSettings, ResultStatus, RoutePoi, RoutePoint } from '@chabuka/shared';
import { API_BASE } from './api';
import { loadGoogleMaps } from './googleMaps';

// Race events: reads for the race page, the organiser, the finish line and My races, plus the browser-side
// "follow roads" lookup for the route planner (Google Directions with the browser key; straight lines if unavailable).

export interface RaceDistance {
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
  bib_from: number;
  bib_to: number;
  gun_started_at: string | null;
  results_published: boolean;
  entered: number;
  held: number;
}

export interface RaceRoute {
  distance_id: string;
  points: RoutePoint[];
  source: string;
  distance_m: number;
  climb_m: number;
  pois: RoutePoi[];
}

export interface RaceEntry {
  id: string;
  distance_id: string;
  user_id: string;
  runner_name: string;
  gender: 'female' | 'male';
  birth_date: string;
  age_group: string | null;
  club: string | null;
  wave: string | null;
  tshirt: string | null;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded';
  bib: number | null;
  paid_ref: string | null;
  checked_in_at: string | null;
  result?: { gun_seconds: number | null; chip_seconds: number | null; status: ResultStatus; overall_pos: number | null } | null;
  private?: { phone: string; emergency_name: string; emergency_phone: string; medical_note: string | null } | null;
}

export interface RaceView {
  race: {
    id: string;
    name: string;
    organiser_id: string;
    organiser_name: string | null;
    status: string;
    category: string;
    starts_on: string;
    area: string | null;
    location: string | null;
    description: string | null;
    banner_url: string | null;
    host_name: string | null;
    host_logo_url: string | null;
    host_contact: string | null;
    host_website: string | null;
    cause_name: string | null;
    cause_description: string | null;
    cause_url: string | null;
    fundraising_note: string | null;
    registration_closes_at: string | null;
    registration_questions: { label: string; required: boolean }[] | null;
    waitapp_checkout_url: string | null;
    sport_id: string;
    circle_id?: string | null;
  };
  settings: RaceSettings;
  isOrganiser: boolean;
  roles: string[];
  distances: RaceDistance[];
  routes: RaceRoute[];
  sponsors: { id: string; name: string; logo_url: string | null; url: string | null; tier: string }[];
  startList: { bib: number | null; name: string; club: string | null; distanceId: string; wave: string | null }[];
  mine: (RaceEntry & { result: { gun_seconds: number | string | null; chip_seconds: number | string | null; status: ResultStatus; overall_pos: number | null } | null })[];
}

export interface ResultRow {
  entryId: string;
  distanceId: string;
  bib: number | null;
  name: string;
  club: string | null;
  gender: 'female' | 'male' | null;
  ageGroup: string | null;
  gunSeconds: number | null;
  chipSeconds: number | null;
  status: ResultStatus;
  overall: number | null;
  genderPos: number | null;
  agePos: number | null;
  mine: boolean;
}

export interface LineState {
  race: { id: string; name: string };
  distance: { id: string; name: string; gunStartedAt: string | null; km: number };
  otherDistances: { id: string; name: string; gunStartedAt: string | null }[];
  finished: number;
  starters: number;
  marks: { id: string; bib: number | null; position: number | null; runner: string | null; wrongDistance: boolean; time: string | null; recordedAt: string }[];
}

export interface MyRace {
  entryId: string;
  race: { id: string; name: string; starts_on: string; area: string | null; banner_url: string | null } | null;
  distance: { id: string; name: string; km: number; startsAt: string } | null;
  runner: string;
  bib: number | null;
  wave: string | null;
  status: string;
  result: { seconds: number | null; status: ResultStatus; overall: number | null; genderPos: number | null; agePos: number | null } | null;
}

async function get<T>(path: string, token: string, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach the Chabuka server.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? fallback);
  return data as T;
}

export const fetchRace = (token: string, id: string) => get<RaceView>(`/api/races/${id}`, token, 'Could not load the race.');
export const fetchRaceEntries = (token: string, id: string) => get<{ entries: RaceEntry[] }>(`/api/races/${id}/entries`, token, 'Could not load entries.').then((r) => r.entries);
export const fetchRaceResults = (token: string, id: string) =>
  get<{ distances: { id: string; name: string; km: number; published: boolean }[]; results: ResultRow[] }>(`/api/races/${id}/results`, token, 'Could not load results.');
export const fetchLine = (token: string, distanceId: string) => get<LineState>(`/api/race-distances/${distanceId}/line`, token, 'Could not open the finish line.');
export const fetchMyRaces = (token: string) => get<{ races: MyRace[] }>('/api/my/races', token, 'Could not load your races.').then((r) => r.races);

/**
 * Follow roads between the drawn points (walking directions), up to 25 points per lookup. Returns null when Google
 * isn't available (no key, or the Directions service isn't switched on for it): the planner then keeps straight lines.
 */
export async function snapToRoads(points: RoutePoint[]): Promise<RoutePoint[] | null> {
  if (points.length < 2) return points;
  const g = await loadGoogleMaps();
  if (!g?.maps?.DirectionsService) return null;
  const svc = new g.maps.DirectionsService();
  const out: RoutePoint[] = [];
  const CHUNK = 25;
  for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
    const part = points.slice(i, i + CHUNK);
    if (part.length < 2) break;
    try {
      const res = await svc.route({
        origin: { lat: part[0]![0], lng: part[0]![1] },
        destination: { lat: part[part.length - 1]![0], lng: part[part.length - 1]![1] },
        waypoints: part.slice(1, -1).map((p) => ({ location: { lat: p[0], lng: p[1] }, stopover: false })),
        travelMode: g.maps.TravelMode.WALKING,
      });
      const path = res.routes[0]?.overview_path ?? [];
      for (const ll of path) {
        const p: RoutePoint = [Math.round(ll.lat() * 1e6) / 1e6, Math.round(ll.lng() * 1e6) / 1e6];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
    } catch {
      return null;
    }
  }
  return out.length >= 2 ? out : null;
}

export function downloadText(filename: string, text: string, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
