import { z } from 'zod';
import { competitionDetails } from './competitions.js';
import { COMPETITION_CATEGORIES } from './competitions.js';

// --- Race events: marathons, fun runs, trail runs, walks -------------------------------------
// Pure logic, shared by the API and the web: route maths (length, km markers, elevation, GPX), bib numbers, age groups,
// waves, results ranking and CSV import. A race is a competition with kind 'race' and per-distance details.

// --- Routes -----------------------------------------------------------------------------------

/** [lat, lng] or [lat, lng, elevation in metres]. */
export type RoutePoint = [number, number] | [number, number, number];

export const POI_TYPES = ['start', 'finish', 'water', 'sponge', 'medical', 'toilets', 'cheer', 'bag_drop', 'turn'] as const;
export type PoiType = (typeof POI_TYPES)[number];
export const POI_LABELS: Record<PoiType, string> = {
  start: 'Start',
  finish: 'Finish',
  water: 'Water',
  sponge: 'Sponges',
  medical: 'Medical',
  toilets: 'Toilets',
  cheer: 'Cheer zone',
  bag_drop: 'Bag drop',
  turn: 'Turnaround',
};

export interface RoutePoi {
  type: PoiType;
  lat: number;
  lng: number;
  km: number;
  label?: string | null;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: RoutePoint, b: RoutePoint): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from the start to each point, in metres. */
export function cumulative(points: RoutePoint[]): number[] {
  const out: number[] = [];
  let d = 0;
  points.forEach((p, i) => {
    if (i > 0) d += haversine(points[i - 1]!, p);
    out.push(d);
  });
  return out;
}

export function routeLength(points: RoutePoint[]): number {
  const c = cumulative(points);
  return c[c.length - 1] ?? 0;
}

/** A point `metres` along the route (interpolated), or null past the end. */
export function pointAt(points: RoutePoint[], metres: number, cum = cumulative(points)): [number, number] | null {
  if (points.length === 0) return null;
  for (let i = 1; i < points.length; i += 1) {
    if (cum[i]! >= metres) {
      const seg = cum[i]! - cum[i - 1]!;
      const t = seg > 0 ? (metres - cum[i - 1]!) / seg : 0;
      const a = points[i - 1]!;
      const b = points[i]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return null;
}

/** Km markers every `every` metres along the route (laps count: the course is repeated). */
export function kmMarkers(points: RoutePoint[], every = 1000, laps = 1): { km: number; lat: number; lng: number }[] {
  const cum = cumulative(points);
  const lap = cum[cum.length - 1] ?? 0;
  if (lap <= 0) return [];
  const out: { km: number; lat: number; lng: number }[] = [];
  const total = lap * Math.max(1, laps);
  for (let m = every; m < total; m += every) {
    const p = pointAt(points, m % lap, cum);
    if (p) out.push({ km: Math.round(m / 100) / 10, lat: p[0], lng: p[1] });
  }
  return out;
}

/** Where a point sits along the route: km from the start of the first lap, and how far off the line it is. */
export function snapToRoute(lat: number, lng: number, points: RoutePoint[]): { km: number; offM: number } {
  if (points.length === 0) return { km: 0, offM: 0 };
  const cum = cumulative(points);
  let best = { km: 0, offM: Infinity };
  // Project onto each segment in a local flat frame (fine at course scale).
  const cosLat = Math.cos(rad(lat));
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const ax = (a[1] - lng) * cosLat;
    const ay = a[0] - lat;
    const bx = (b[1] - lng) * cosLat;
    const by = b[0] - lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const offM = Math.sqrt(px * px + py * py) * (Math.PI / 180) * R;
    if (offM < best.offM) best = { km: (cum[i - 1]! + (cum[i]! - cum[i - 1]!) * t) / 1000, offM };
  }
  return { km: Math.round(best.km * 100) / 100, offM: best.offM };
}

const hasEle = (p: RoutePoint): p is [number, number, number] => p.length === 3 && Number.isFinite(p[2]);

/** Total climb in metres. Small wobbles under `threshold` are ignored (GPS elevation is noisy). */
export function climb(points: RoutePoint[], threshold = 3): number {
  const eles = points.filter(hasEle).map((p) => p[2]);
  if (eles.length < 2) return 0;
  let total = 0;
  let ref = eles[0]!;
  for (const e of eles.slice(1)) {
    const d = e - ref;
    if (d >= threshold) {
      total += d;
      ref = e;
    } else if (d <= -threshold) ref = e;
  }
  return Math.round(total);
}

export function hasElevation(points: RoutePoint[]): boolean {
  return points.filter(hasEle).length >= 2;
}

/** Elevation sampled along the route for a chart. */
export function elevationProfile(points: RoutePoint[], samples = 120): { km: number; ele: number }[] {
  if (!hasElevation(points)) return [];
  const cum = cumulative(points);
  const total = cum[cum.length - 1] ?? 0;
  const out: { km: number; ele: number }[] = [];
  let j = 1;
  for (let s = 0; s <= samples; s += 1) {
    const m = (total * s) / samples;
    while (j < points.length - 1 && cum[j]! < m) j += 1;
    const a = points[j - 1]!;
    const b = points[j]!;
    const seg = cum[j]! - cum[j - 1]!;
    const t = seg > 0 ? Math.min(1, Math.max(0, (m - cum[j - 1]!) / seg)) : 0;
    const ea = hasEle(a) ? a[2] : hasEle(b) ? b[2] : 0;
    const eb = hasEle(b) ? b[2] : ea;
    out.push({ km: Math.round(m / 10) / 100, ele: Math.round(ea + (eb - ea) * t) });
  }
  return out;
}

/** Douglas-Peucker simplification with a tolerance in metres. Keeps elevation on kept points. */
export function simplify(points: RoutePoint[], toleranceM = 5): RoutePoint[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const lat0 = points[0]![0];
  const k = Math.cos(rad(lat0));
  const xy = (p: RoutePoint) => [p[1] * k * (Math.PI / 180) * R, p[0] * (Math.PI / 180) * R] as const;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = xy(points[s]!);
    const [bx, by] = xy(points[e]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const [px, py] = xy(points[i]!);
      const d = len > 0 ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

export const MAX_ROUTE_POINTS = 5000;

/**
 * Track or route points from a GPX file (Strava, Garmin, Komoot, Google exports). Tolerant: reads trkpt, then rtept,
 * then wpt, with or without elevation. Long tracks are simplified to stay under MAX_ROUTE_POINTS.
 */
export function parseGpx(xml: string): { name: string | null; points: RoutePoint[] } {
  if (typeof xml !== 'string' || xml.length === 0) throw new Error('That file is empty.');
  if (xml.length > 15_000_000) throw new Error('That file is too big (15 MB at most).');
  if (!/<gpx[\s>]/i.test(xml)) throw new Error('That is not a GPX file.');
  const name = /<name>\s*(?:<!\[CDATA\[)?([^<\]]{1,120})/i.exec(xml)?.[1]?.trim() ?? null;
  const read = (tag: string): RoutePoint[] => {
    const out: RoutePoint[] = [];
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) && out.length < 200_000) {
      const attrs = m[1] ?? '';
      const lat = Number(/lat\s*=\s*["']([-\d.eE+]+)["']/.exec(attrs)?.[1]);
      const lon = Number(/lon\s*=\s*["']([-\d.eE+]+)["']/.exec(attrs)?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const ele = Number(/<ele>\s*([-\d.eE+]+)\s*<\/ele>/i.exec(m[2] ?? '')?.[1]);
      out.push(Number.isFinite(ele) ? [lat, lon, Math.round(ele * 10) / 10] : [lat, lon]);
    }
    return out;
  };
  let points = read('trkpt');
  if (points.length < 2) points = read('rtept');
  if (points.length < 2) points = read('wpt');
  if (points.length < 2) throw new Error('No route found in that file.');
  // Only thin out long tracks: a short file keeps every point (and its elevation).
  if (points.length <= MAX_ROUTE_POINTS) return { name, points };
  let tol = 2;
  let simple = simplify(points, tol);
  while (simple.length > MAX_ROUTE_POINTS && tol < 200) {
    tol *= 2;
    simple = simplify(points, tol);
  }
  return { name, points: simple };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toGpx(name: string, points: RoutePoint[], pois: RoutePoi[] = []): string {
  const wpts = pois.map((p) => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${esc(p.label || POI_LABELS[p.type])} (km ${p.km})</name></wpt>`).join('\n');
  const trk = points.map((p) => `      <trkpt lat="${p[0]}" lon="${p[1]}">${hasEle(p) ? `<ele>${p[2]}</ele>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Chabuka" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
  <trk><name>${esc(name)}</name><trkseg>
${trk}
  </trkseg></trk>
</gpx>
`;
}

// --- Race setup ---------------------------------------------------------------------------------

export const RACE_PRESETS = [
  { key: 'fun_run', label: 'Fun run', km: 3 },
  { key: '5k', label: '5K', km: 5 },
  { key: '10k', label: '10K', km: 10 },
  { key: 'half', label: 'Half marathon', km: 21.0975 },
  { key: 'full', label: 'Marathon', km: 42.195 },
  { key: 'trail', label: 'Trail run', km: 15 },
  { key: 'walk', label: 'Walk', km: 5 },
] as const;

export const GENDERS = ['female', 'male'] as const;
export type RaceGender = (typeof GENDERS)[number];

export interface AgeBand {
  label: string;
  min: number;
  max: number;
}
export const DEFAULT_AGE_BANDS: AgeBand[] = [
  { label: 'U20', min: 0, max: 19 },
  { label: '20-29', min: 20, max: 29 },
  { label: '30-39', min: 30, max: 39 },
  { label: '40-49', min: 40, max: 49 },
  { label: '50-59', min: 50, max: 59 },
  { label: '60+', min: 60, max: 150 },
];

export interface Wave {
  label: string;
  /** Runners expecting to finish within this many minutes go in this wave. Null = everyone left. */
  maxMinutes: number | null;
}

export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

/** Age on the race day (the usual rule for age groups). */
export function ageOn(birthDate: string, raceDate: string): number {
  const b = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  const r = new Date(`${raceDate.slice(0, 10)}T00:00:00Z`);
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  if (r.getUTCMonth() < b.getUTCMonth() || (r.getUTCMonth() === b.getUTCMonth() && r.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

export function ageGroup(birthDate: string, raceDate: string, bands: AgeBand[] = DEFAULT_AGE_BANDS): string {
  const age = ageOn(birthDate, raceDate);
  return bands.find((b) => age >= b.min && age <= b.max)?.label ?? 'Open';
}

export function waveFor(expectedMinutes: number | null | undefined, waves: Wave[]): string | null {
  if (waves.length === 0) return null;
  if (expectedMinutes == null) return waves[waves.length - 1]!.label;
  const sorted = [...waves].sort((a, b) => (a.maxMinutes ?? Infinity) - (b.maxMinutes ?? Infinity));
  return (sorted.find((w) => w.maxMinutes == null || expectedMinutes <= w.maxMinutes) ?? sorted[sorted.length - 1]!).label;
}

/** The next free bib in [from, to], starting at `pointer`; null when the range is used up. Bibs are never reused. */
export function nextBib(from: number, to: number, pointer: number | null, taken: Set<number>): number | null {
  for (let b = Math.max(from, pointer ?? from); b <= to; b += 1) if (!taken.has(b)) return b;
  return null;
}

// --- Results ----------------------------------------------------------------------------------

export const RESULT_STATUSES = ['finished', 'dnf', 'dns', 'dq'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = { finished: 'Finished', dnf: 'Did not finish', dns: 'Did not start', dq: 'Disqualified' };

export interface RankInput {
  entryId: string;
  gender: string;
  ageGroup: string | null;
  status: ResultStatus;
  seconds: number | null;
}

/** Overall, gender and age-group positions for finishers. Equal times share a position. Non-finishers get none. */
export function rankResults(rows: RankInput[]): Map<string, { overall: number | null; gender: number | null; age: number | null }> {
  const out = new Map<string, { overall: number | null; gender: number | null; age: number | null }>();
  const finishers = rows.filter((r) => r.status === 'finished' && r.seconds != null).sort((a, b) => a.seconds! - b.seconds!);
  const place = (list: RankInput[]) => {
    const pos = new Map<string, number>();
    list.forEach((r, i) => {
      const prev = list[i - 1];
      pos.set(r.entryId, prev && prev.seconds === r.seconds ? pos.get(prev.entryId)! : i + 1);
    });
    return pos;
  };
  const overall = place(finishers);
  const byGender = new Map<string, Map<string, number>>();
  const byAge = new Map<string, Map<string, number>>();
  for (const g of new Set(finishers.map((r) => r.gender))) byGender.set(g, place(finishers.filter((r) => r.gender === g)));
  for (const a of new Set(finishers.map((r) => `${r.gender}|${r.ageGroup ?? ''}`))) {
    byAge.set(a, place(finishers.filter((r) => `${r.gender}|${r.ageGroup ?? ''}` === a)));
  }
  for (const r of rows) {
    if (r.status !== 'finished' || r.seconds == null) {
      out.set(r.entryId, { overall: null, gender: null, age: null });
      continue;
    }
    out.set(r.entryId, {
      overall: overall.get(r.entryId) ?? null,
      gender: byGender.get(r.gender)?.get(r.entryId) ?? null,
      age: byAge.get(`${r.gender}|${r.ageGroup ?? ''}`)?.get(r.entryId) ?? null,
    });
  }
  return out;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** "1:23:45", "23:45", "83:12", "1:23:45.6" -> seconds; null when it isn't a time. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return Math.round(s * 10) / 10;
}

export function pace(seconds: number | null | undefined, km: number): string {
  if (seconds == null || !km) return '';
  const per = seconds / km;
  return `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, '0')} /km`;
}

export interface CsvResultRow {
  line: number;
  bib: number;
  gunSeconds: number | null;
  chipSeconds: number | null;
  status: ResultStatus;
}

/**
 * Results from a timing company's CSV. Looks for a bib column (bib, number, no, race number) and time columns
 * (gun / time / finish, chip / net), plus an optional status. Tolerates ; or , and quoted cells. Bad rows are reported,
 * never silently dropped.
 */
export function parseResultsCsv(text: string): { rows: CsvResultRow[]; errors: { line: number; message: string }[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: { line: number; message: string }[] = [];
  if (lines.length === 0) return { rows: [], errors: [{ line: 0, message: 'The file is empty.' }] };
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i]!;
      if (ch === '"') {
        if (q && l[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = !q;
      } else if (ch === sep && !q) {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const head = split(lines[0]!).map((h) => h.toLowerCase());
  const find = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)));
  const bibCol = find(/^bib/, /^(race )?(number|no\.?|#)$/);
  const gunCol = find(/gun/, /^(finish )?time$/, /^finish$/, /^official/);
  const chipCol = find(/chip/, /^net/);
  const statusCol = find(/^status$/, /^result$/);
  if (bibCol < 0) return { rows: [], errors: [{ line: 1, message: 'No bib column found. Name one column "bib".' }] };
  if (gunCol < 0 && chipCol < 0) return { rows: [], errors: [{ line: 1, message: 'No time column found. Name one column "time" or "chip".' }] };
  const rows: CsvResultRow[] = [];
  const seen = new Set<number>();
  lines.slice(1).forEach((l, i) => {
    const line = i + 2;
    const c = split(l);
    const bib = Number(c[bibCol]);
    if (!Number.isInteger(bib) || bib <= 0) {
      errors.push({ line, message: `"${c[bibCol] ?? ''}" is not a bib number.` });
      return;
    }
    if (seen.has(bib)) {
      errors.push({ line, message: `Bib ${bib} appears twice.` });
      return;
    }
    const rawStatus = (statusCol >= 0 ? c[statusCol] : '')?.toLowerCase() ?? '';
    const status: ResultStatus = /dnf/.test(rawStatus) ? 'dnf' : /dns/.test(rawStatus) ? 'dns' : /dq|disq/.test(rawStatus) ? 'dq' : 'finished';
    const gun = gunCol >= 0 && c[gunCol] ? parseDuration(c[gunCol]!) : null;
    const chip = chipCol >= 0 && c[chipCol] ? parseDuration(c[chipCol]!) : null;
    if (status === 'finished' && gun == null && chip == null) {
      errors.push({ line, message: `Bib ${bib} has no readable time.` });
      return;
    }
    seen.add(bib);
    rows.push({ line, bib, gunSeconds: gun, chipSeconds: chip, status });
  });
  return { rows, errors };
}

// --- Inputs -------------------------------------------------------------------------------------

const uuid = z.string().uuid();
const pointSchema = z.union([
  z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-500).max(9000)]),
]);

export const raceDistanceInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the distance').max(40),
    km: z.number().min(0.1).max(300),
    laps: z.number().int().min(1).max(50).default(1),
    startsAt: z.iso.datetime({ offset: true }),
    cutoffMinutes: z.number().int().min(10).max(48 * 60).nullable().optional(),
    minAge: z.number().int().min(0).max(100).nullable().optional(),
    fieldLimit: z.number().int().min(1).max(50_000),
    price: z.number().min(0).max(1_000_000).default(0),
    currency: z.string().trim().length(3).default('ZMW'),
    bibFrom: z.number().int().min(1).max(999_999),
    bibTo: z.number().int().min(1).max(999_999),
  })
  .refine((d) => d.bibTo >= d.bibFrom, { message: 'The last bib must be after the first', path: ['bibTo'] })
  .refine((d) => d.bibTo - d.bibFrom + 1 >= d.fieldLimit, { message: 'The bib range is smaller than the field limit', path: ['bibTo'] });
export type RaceDistanceInput = z.infer<typeof raceDistanceInputSchema>;

export const raceSettingsSchema = z.object({
  waiverText: z.string().trim().max(5000).default(''),
  ageBands: z.array(z.object({ label: z.string().trim().min(1).max(20), min: z.number().int().min(0), max: z.number().int().max(150) })).max(20).default(DEFAULT_AGE_BANDS),
  waves: z.array(z.object({ label: z.string().trim().min(1).max(30), maxMinutes: z.number().int().min(1).nullable() })).max(12).default([]),
  tshirts: z.boolean().default(true),
  packCollection: z.string().trim().max(500).default(''),
});
export type RaceSettings = z.infer<typeof raceSettingsSchema>;

export const createRaceSchema = z.object({
  name: z.string().trim().min(1, 'Name the race').max(80),
  sportId: uuid,
  category: z.enum(COMPETITION_CATEGORIES).default('community'),
  area: z.string().trim().min(1, 'Area is required').max(80),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the race date'),
  distances: z.array(raceDistanceInputSchema).min(1, 'Add at least one distance').max(8),
  settings: raceSettingsSchema.default(raceSettingsSchema.parse({})),
  ...competitionDetails,
});
export type CreateRaceInput = z.infer<typeof createRaceSchema>;

export const upsertDistanceSchema = z.object({ competitionId: uuid, distanceId: uuid.optional(), distance: raceDistanceInputSchema });
export const removeDistanceSchema = z.object({ competitionId: uuid, distanceId: uuid });
export const updateRaceSettingsSchema = z.object({ competitionId: uuid, settings: raceSettingsSchema });

export const poiSchema = z.object({
  type: z.enum(POI_TYPES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  km: z.number().min(0).max(1000),
  label: z.string().trim().max(60).nullable().optional(),
});
export const saveRouteSchema = z.object({
  distanceId: uuid,
  points: z.array(pointSchema).min(2, 'Draw at least two points').max(MAX_ROUTE_POINTS),
  source: z.enum(['drawn', 'gpx', 'roads']),
  pois: z.array(poiSchema).max(80).default([]),
});
export type SaveRouteInput = z.infer<typeof saveRouteSchema>;

export const enterRaceSchema = z.object({
  competitionId: uuid,
  distanceId: uuid,
  runnerName: z.string().trim().min(2, 'Runner name').max(80),
  gender: z.enum(GENDERS),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth'),
  phone: z.string().trim().min(6, 'A phone number for race-day messages').max(30),
  emergencyName: z.string().trim().min(2, 'Emergency contact name').max(80),
  emergencyPhone: z.string().trim().min(6, 'Emergency contact phone').max(30),
  tshirt: z.enum(TSHIRT_SIZES).nullable().optional(),
  club: z.string().trim().max(80).optional(),
  expectedMinutes: z.number().int().min(5).max(48 * 60).nullable().optional(),
  medicalNote: z.string().trim().max(500).optional(),
  answers: z.array(z.object({ label: z.string().max(120), answer: z.string().trim().max(1000) })).max(12).default([]),
  acceptWaiver: z.literal(true, { message: 'Accept the waiver to enter' }),
});
export type EnterRaceInput = z.infer<typeof enterRaceSchema>;

export const raceEntryIdSchema = z.object({ entryId: uuid });
export const moveRaceEntrySchema = z.object({ entryId: uuid, distanceId: uuid });
export const checkInRunnerSchema = z.object({ entryId: uuid, undo: z.boolean().default(false) });
export const startGunSchema = z.object({ distanceId: uuid, at: z.iso.datetime({ offset: true }).optional(), clear: z.boolean().default(false) });
export const finishMarkSchema = z.object({
  distanceId: uuid,
  bib: z.number().int().min(1).max(999_999).nullable(),
  clientId: z.string().min(6).max(64),
  deviceAt: z.iso.datetime({ offset: true }),
});
export type FinishMarkInput = z.infer<typeof finishMarkSchema>;
export const voidMarkSchema = z.object({ markId: uuid });
export const resolveMarkSchema = z.object({ markId: uuid, bib: z.number().int().min(1).max(999_999) });
export const importResultsSchema = z.object({
  distanceId: uuid,
  mode: z.enum(['merge', 'replace']).default('merge'),
  rows: z
    .array(
      z.object({
        bib: z.number().int().min(1),
        gunSeconds: z.number().min(0).max(7 * 86400).nullable(),
        chipSeconds: z.number().min(0).max(7 * 86400).nullable(),
        status: z.enum(RESULT_STATUSES),
      }),
    )
    .min(1)
    .max(50_000),
});
export const setResultSchema = z.object({
  entryId: uuid,
  status: z.enum(RESULT_STATUSES),
  gunSeconds: z.number().min(0).max(7 * 86400).nullable().optional(),
  chipSeconds: z.number().min(0).max(7 * 86400).nullable().optional(),
});
export const publishResultsSchema = z.object({ distanceId: uuid, publish: z.boolean().default(true) });
export const raceOfficialSchema = z.object({ competitionId: uuid, email: z.string().trim().email().max(120), role: z.enum(['finish', 'checkin']), remove: z.boolean().default(false) });
export const openRaceEntriesSchema = z.object({ competitionId: uuid });
