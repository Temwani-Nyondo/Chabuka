import { describe, expect, it } from 'vitest';
import {
  ageGroup,
  ageOn,
  climb,
  createRaceSchema,
  elevationProfile,
  enterRaceSchema,
  formatDuration,
  haversine,
  kmMarkers,
  nextBib,
  pace,
  parseDuration,
  parseGpx,
  parseResultsCsv,
  rankResults,
  raceDistanceInputSchema,
  routeLength,
  simplify,
  snapToRoute,
  toGpx,
  waveFor,
} from './races';
import type { RoutePoint } from './races';

// A straight line north from central Lusaka: 0.009 degrees of latitude is ~1 km.
const line = (km: number, step = 0.1): RoutePoint[] =>
  Array.from({ length: Math.round(km / step) + 1 }, (_, i) => [-15.4167 + i * step * 0.0089932, 28.2833] as RoutePoint);

describe('route maths', () => {
  it('measures distance like a GPS watch', () => {
    expect(haversine([-15.4167, 28.2833], [-15.4167 + 0.0089932, 28.2833])).toBeGreaterThan(995);
    expect(haversine([-15.4167, 28.2833], [-15.4167 + 0.0089932, 28.2833])).toBeLessThan(1005);
    expect(routeLength(line(5)) / 1000).toBeCloseTo(5, 1);
  });

  it('puts a km marker every kilometre, repeating on laps', () => {
    expect(kmMarkers(line(5)).map((m) => m.km)).toEqual([1, 2, 3, 4]);
    expect(kmMarkers(line(2.5), 1000, 2).map((m) => m.km)).toEqual([1, 2, 3, 4]);
  });

  it('snaps a water station to its km along the course', () => {
    const r = snapToRoute(-15.4167 + 3 * 0.0089932, 28.2835, line(5));
    expect(r.km).toBeCloseTo(3, 1);
    expect(r.offM).toBeLessThan(30);
  });

  it('adds up climb and ignores GPS wobble', () => {
    const pts: RoutePoint[] = [
      [0, 0, 1200],
      [0, 0.001, 1201],
      [0, 0.002, 1210],
      [0, 0.003, 1205],
      [0, 0.004, 1220],
    ];
    expect(climb(pts)).toBe(25);
    expect(elevationProfile(pts, 4)).toHaveLength(5);
    expect(elevationProfile(line(1))).toEqual([]);
  });

  it('simplifies a straight line to its ends', () => {
    expect(simplify(line(5, 0.01), 5)).toHaveLength(2);
  });
});

describe('GPX', () => {
  const strava = `<?xml version="1.0"?><gpx creator="StravaGPX" version="1.1"><trk><name>Lusaka Half</name><trkseg>
    <trkpt lat="-15.4167" lon="28.2833"><ele>1279.4</ele><time>2026-01-01T06:00:00Z</time></trkpt>
    <trkpt lat="-15.4100" lon="28.2900"><ele>1281.0</ele></trkpt>
    <trkpt lat="-15.4000" lon="28.3000"><ele>1290.2</ele></trkpt></trkseg></trk></gpx>`;
  it('reads a Strava track with elevation', () => {
    const g = parseGpx(strava);
    expect(g.name).toBe('Lusaka Half');
    expect(g.points[0]).toEqual([-15.4167, 28.2833, 1279.4]);
    expect(g.points).toHaveLength(3);
  });
  it('reads a route-only file and self-closing points', () => {
    const g = parseGpx(`<gpx><rte><rtept lat="1" lon="2"/><rtept lat="1.01" lon="2.01"/></rte></gpx>`);
    expect(g.points).toEqual([
      [1, 2],
      [1.01, 2.01],
    ]);
  });
  it('refuses files that are not GPX or have no route', () => {
    expect(() => parseGpx('hello')).toThrow(/not a GPX/);
    expect(() => parseGpx('<gpx><trk></trk></gpx>')).toThrow(/No route/);
  });
  it('round-trips through toGpx', () => {
    const g = parseGpx(strava);
    const again = parseGpx(toGpx('Lusaka Half', g.points, [{ type: 'water', lat: -15.41, lng: 28.29, km: 2.5 }]));
    expect(again.points).toEqual(g.points);
  });
});

describe('runners', () => {
  it('works out age on race day and the age group', () => {
    expect(ageOn('1990-06-15', '2026-06-14')).toBe(35);
    expect(ageOn('1990-06-15', '2026-06-15')).toBe(36);
    expect(ageGroup('2008-01-01', '2026-06-01')).toBe('U20');
    expect(ageGroup('1960-01-01', '2026-06-01')).toBe('60+');
  });
  it('puts runners in waves by expected time', () => {
    const waves = [
      { label: 'A', maxMinutes: 100 },
      { label: 'B', maxMinutes: 130 },
      { label: 'C', maxMinutes: null },
    ];
    expect(waveFor(95, waves)).toBe('A');
    expect(waveFor(120, waves)).toBe('B');
    expect(waveFor(200, waves)).toBe('C');
    expect(waveFor(null, waves)).toBe('C');
    expect(waveFor(90, [])).toBeNull();
  });
  it('hands out bibs in range and never reuses one', () => {
    expect(nextBib(100, 102, null, new Set())).toBe(100);
    expect(nextBib(100, 102, 101, new Set([101]))).toBe(102);
    expect(nextBib(100, 102, 103, new Set())).toBeNull();
  });
});

describe('results', () => {
  it('ranks overall, by gender and age group; ties share a place; DNFs get none', () => {
    const r = rankResults([
      { entryId: 'a', gender: 'male', ageGroup: '30-39', status: 'finished', seconds: 3600 },
      { entryId: 'b', gender: 'female', ageGroup: '30-39', status: 'finished', seconds: 3700 },
      { entryId: 'c', gender: 'male', ageGroup: '40-49', status: 'finished', seconds: 3600 },
      { entryId: 'd', gender: 'male', ageGroup: '30-39', status: 'finished', seconds: 3900 },
      { entryId: 'e', gender: 'female', ageGroup: '30-39', status: 'dnf', seconds: null },
    ]);
    expect(r.get('a')).toEqual({ overall: 1, gender: 1, age: 1 });
    expect(r.get('c')).toEqual({ overall: 1, gender: 1, age: 1 });
    expect(r.get('b')).toEqual({ overall: 3, gender: 1, age: 1 });
    expect(r.get('d')).toEqual({ overall: 4, gender: 3, age: 2 });
    expect(r.get('e')).toEqual({ overall: null, gender: null, age: null });
  });
  it('formats and parses times and pace', () => {
    expect(formatDuration(5530)).toBe('1:32:10');
    expect(formatDuration(1425)).toBe('23:45');
    expect(parseDuration('1:32:10')).toBe(5530);
    expect(parseDuration('23:45')).toBe(1425);
    expect(parseDuration('abc')).toBeNull();
    expect(pace(3000, 10)).toBe('5:00 /km');
  });
  it('imports a timing CSV and reports bad rows', () => {
    const csv = 'Bib;Name;Gun Time;Chip Time;Status\n101;Ann;1:32:10;1:31:40;\n102;Ben;;;DNF\nxx;Bad;1:00:00;;\n103;Cat;nope;;\n101;Dup;1:40:00;;';
    const { rows, errors } = parseResultsCsv(csv);
    expect(rows).toEqual([
      { line: 2, bib: 101, gunSeconds: 5530, chipSeconds: 5500, status: 'finished' },
      { line: 3, bib: 102, gunSeconds: null, chipSeconds: null, status: 'dnf' },
    ]);
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(parseResultsCsv('name,time\nA,1:00').errors[0]!.message).toMatch(/bib/);
  });
});

describe('inputs', () => {
  const d = { name: '10K', km: 10, startsAt: '2026-12-06T05:30:00+02:00', fieldLimit: 500, bibFrom: 1000, bibTo: 1499 };
  it('needs a bib range big enough for the field', () => {
    expect(raceDistanceInputSchema.safeParse(d).success).toBe(true);
    expect(raceDistanceInputSchema.safeParse({ ...d, bibTo: 1100 }).success).toBe(false);
  });
  it('builds a race with defaults and requires the waiver on entry', () => {
    const race = createRaceSchema.parse({ name: 'Lusaka Marathon', sportId: '00000000-0000-4000-8000-000000000001', area: 'Lusaka', startsOn: '2026-12-06', distances: [d] });
    expect(race.settings.ageBands).toHaveLength(6);
    expect(
      enterRaceSchema.safeParse({
        competitionId: '00000000-0000-4000-8000-000000000001',
        distanceId: '00000000-0000-4000-8000-000000000002',
        runnerName: 'Ann',
        gender: 'female',
        birthDate: '1990-01-01',
        phone: '0977000000',
        emergencyName: 'Bob',
        emergencyPhone: '0977000001',
      }).success,
    ).toBe(false);
  });
});
