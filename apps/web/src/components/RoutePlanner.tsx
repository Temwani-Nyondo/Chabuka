import { useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Download, MapPin, Redo2, Repeat, Route, Trash2, Undo2, Upload } from 'lucide-react';
import { DEFAULT_MAP_CENTER, POI_LABELS, POI_TYPES, climb, parseGpx, routeLength, snapToRoute, toGpx } from '@chabuka/shared';
import type { PoiType, RoutePoi, RoutePoint } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { googleMapsKey } from '../lib/googleMaps';
import { downloadText, snapToRoads } from '../lib/races';
import type { RaceRoute } from '../lib/races';
import ElevationChart from './ElevationChart';
import { FitBounds, KmLayer, POI_COLOURS, PoiLayer } from './RouteMap';
import { Badge, Button, Card, Chip, ErrorNote, cx } from './ui';
import 'leaflet/dist/leaflet.css';

// Route planner for one race distance. Click the map to draw the course (straight lines, or following roads when that
// is on), drag the dots to adjust, or upload a GPX file from Strava, Garmin or Komoot. Add water, medical, toilets and
// other points; each gets its km along the course. The course is saved to the race and shown to runners.

const anchorIcon = L.divIcon({ className: 'route-anchor', iconSize: [14, 14] });

type Mode = 'draw' | PoiType;

function ClickLayer({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6) });
  return null;
}

export default function RoutePlanner({
  distance,
  initial,
  centre,
  onSaved,
}: {
  distance: { id: string; name: string; distance_km: number; laps: number };
  initial: RaceRoute | null;
  centre?: { lat: number; lng: number } | null;
  onSaved?: () => void;
}) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  // The course is a list of segments; anchors[i] is where segment i ends (the dot you can drag). A saved or uploaded
  // course comes in as one locked segment: you can carry on drawing from its end, but not drag inside it.
  const [segments, setSegments] = useState<RoutePoint[][]>(initial?.points.length ? [initial.points] : []);
  const [anchors, setAnchors] = useState<RoutePoint[]>(initial?.points.length ? [initial.points[initial.points.length - 1]!] : []);
  const [locked, setLocked] = useState(initial?.points.length ? 1 : 0);
  const [redo, setRedo] = useState<{ anchor: RoutePoint; segment: RoutePoint[] }[]>([]);
  const [source, setSource] = useState<'drawn' | 'gpx' | 'roads'>((initial?.source as 'drawn' | 'gpx' | 'roads') ?? 'drawn');
  const [pois, setPois] = useState<RoutePoi[]>(initial?.pois ?? []);
  const [roads, setRoads] = useState(false);
  const [mode, setMode] = useState<Mode>('draw');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const canRoads = !!googleMapsKey();

  const path = useMemo(() => segments.flat(), [segments]);
  const lapM = useMemo(() => routeLength(path), [path]);
  const totalKm = (lapM * Math.max(1, distance.laps)) / 1000;
  const target = distance.distance_km;
  const off = target > 0 ? (totalKm - target) / target : 0;
  const climbM = useMemo(() => climb(path) * Math.max(1, distance.laps), [path, distance.laps]);
  const start: [number, number] = path[0]
    ? [path[0][0], path[0][1]]
    : centre
      ? [centre.lat, centre.lng]
      : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng];

  const segmentTo = async (from: RoutePoint | undefined, to: RoutePoint): Promise<RoutePoint[]> => {
    if (!from) return [to];
    if (!roads) return [to];
    const snapped = await snapToRoads([from, to]);
    if (!snapped) {
      setRoads(false);
      setNotice('Following roads is not available right now, so the line is drawn straight.');
      return [to];
    }
    setSource('roads');
    return snapped.slice(1);
  };

  const addPoint = async (lat: number, lng: number) => {
    setError(null);
    if (mode !== 'draw') {
      const km = path.length >= 2 ? snapToRoute(lat, lng, path).km : 0;
      setPois((list) => [...list, { type: mode, lat, lng, km }].sort((a, b) => a.km - b.km));
      setMode('draw');
      return;
    }
    const p: RoutePoint = [lat, lng];
    setBusy(true);
    const seg = await segmentTo(anchors[anchors.length - 1], p);
    setBusy(false);
    setAnchors((a) => [...a, p]);
    setSegments((s) => [...s, seg]);
    setRedo([]);
  };

  const moveAnchor = async (i: number, lat: number, lng: number) => {
    if (i < locked) return;
    const next = anchors.slice();
    next[i] = [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
    const s = segments.slice();
    setBusy(true);
    s[i] = await segmentTo(next[i - 1], next[i]!);
    if (i + 1 < s.length) s[i + 1] = await segmentTo(next[i], next[i + 1]!);
    setBusy(false);
    setAnchors(next);
    setSegments(s);
  };

  const undo = () => {
    if (segments.length === 0) return;
    setRedo((r) => [...r, { anchor: anchors[anchors.length - 1] ?? path[path.length - 1]!, segment: segments[segments.length - 1]! }]);
    setSegments((s) => s.slice(0, -1));
    setAnchors((a) => a.slice(0, -1));
    setLocked((l) => Math.min(l, segments.length - 1));
  };
  const redoOne = () => {
    const last = redo[redo.length - 1];
    if (!last) return;
    setRedo((r) => r.slice(0, -1));
    setSegments((s) => [...s, last.segment]);
    setAnchors((a) => [...a, last.anchor]);
  };
  const clear = () => {
    setSegments([]);
    setAnchors([]);
    setRedo([]);
    setPois([]);
    setLocked(0);
    setSource('drawn');
  };
  const reverse = () => {
    const rev = path.slice().reverse();
    setSegments(rev.length ? [rev] : []);
    setAnchors(rev.length ? [rev[rev.length - 1]!] : []);
    setLocked(rev.length ? 1 : 0);
    setPois((list) => list.map((p) => ({ ...p, km: snapToRoute(p.lat, p.lng, rev).km })).sort((a, b) => a.km - b.km));
  };
  const closeLoop = async () => {
    if (path.length < 2) return;
    const first = path[0]!;
    setBusy(true);
    const seg = await segmentTo(anchors[anchors.length - 1], first);
    setBusy(false);
    setSegments((s) => [...s, seg]);
    setAnchors((a) => [...a, first]);
  };

  const onGpx = async (file: File) => {
    setError(null);
    try {
      const { points } = parseGpx(await file.text());
      setSegments([points]);
      setAnchors([points[points.length - 1]!]);
      setLocked(1);
      setRedo([]);
      setSource('gpx');
      setPois((list) => list.map((p) => ({ ...p, km: snapToRoute(p.lat, p.lng, points).km })));
      setFitKey((k) => k + 1);
      setNotice(`Loaded ${points.length} points from ${file.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await runAction<{ warning: string | null }>('save_route', { distanceId: distance.id, points: path, source, pois }, token);
      setNotice(r.warning ? `Saved. ${r.warning}` : 'Course saved.');
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the course.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={<Undo2 size={15} />} onClick={undo} disabled={segments.length === 0}>Undo</Button>
          <Button size="sm" icon={<Redo2 size={15} />} onClick={redoOne} disabled={redo.length === 0}>Redo</Button>
          <Button size="sm" icon={<Repeat size={15} />} onClick={() => void closeLoop()} disabled={path.length < 2}>Close loop</Button>
          <Button size="sm" icon={<Route size={15} />} onClick={reverse} disabled={path.length < 2}>Reverse</Button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-bold hover:bg-surface-2">
            <Upload size={15} /> GPX
            <input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onGpx(f); }} />
          </label>
          <Button size="sm" icon={<Download size={15} />} disabled={path.length < 2} onClick={() => downloadText(`${distance.name}.gpx`, toGpx(distance.name, path, pois))}>Download</Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={15} />} onClick={clear} disabled={path.length === 0 && pois.length === 0}>Clear</Button>
          {canRoads ? (
            <label className="ml-auto inline-flex items-center gap-2 text-[13px] font-semibold">
              <input type="checkbox" checked={roads} onChange={(e) => setRoads(e.target.checked)} className="h-4 w-4" />
              Follow roads
            </label>
          ) : null}
        </div>
        <div className={cx('relative overflow-hidden rounded-2xl border border-line', mode !== 'draw' && 'ring-2 ring-[var(--hl-text)]')} style={{ height: 'min(62vh, 520px)' }}>
          <MapContainer center={start} zoom={14} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ClickLayer onClick={(lat, lng) => void addPoint(lat, lng)} />
            {path.length >= 2 ? <Polyline positions={path.map((p) => [p[0], p[1]] as [number, number])} pathOptions={{ color: '#0B6B3A', weight: 5 }} /> : null}
            {anchors.map((a, i) => i < locked ? null : (
              <Marker
                key={`${i}-${a[0]}-${a[1]}`}
                position={[a[0], a[1]]}
                icon={anchorIcon}
                draggable
                eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); void moveAnchor(i, ll.lat, ll.lng); } }}
              />
            ))}
            <KmLayer points={path} laps={distance.laps} />
            <PoiLayer pois={pois} />
            <FitBounds key={fitKey} points={fitKey ? path : []} />
          </MapContainer>
          {busy ? <span className="absolute right-3 top-3 z-[1000] rounded-full bg-surface px-3 py-1 text-[12px] font-bold shadow">Working…</span> : null}
          {mode !== 'draw' ? (
            <span className="absolute left-3 top-3 z-[1000] rounded-full bg-hl px-3 py-1 text-[12px] font-bold text-hl-text">Tap the map to place: {POI_LABELS[mode]}</span>
          ) : path.length === 0 ? (
            <span className="absolute left-3 top-3 z-[1000] rounded-full bg-surface px-3 py-1 text-[12px] font-bold shadow">Tap the map at the start line, then along the course</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Card className="flex flex-col gap-1 p-3.5">
          <span className="text-[13px] font-semibold text-muted">{distance.name}{distance.laps > 1 ? `, ${distance.laps} laps` : ''}</span>
          <span className="text-[26px] font-bold leading-tight">{totalKm.toFixed(2)} km</span>
          <span className={cx('text-[13px] font-semibold', Math.abs(off) <= 0.02 ? 'text-brand-text' : 'text-muted')}>
            {path.length < 2 ? `Target ${target} km` : Math.abs(off) <= 0.02 ? `On target (${target} km)` : `${off > 0 ? '+' : ''}${(totalKm - target).toFixed(2)} km against ${target} km`}
          </span>
          {climbM > 0 ? <span className="text-[13px] text-muted">{climbM} m of climb</span> : null}
          <Badge tone="muted" className="self-start">{source === 'gpx' ? 'From GPX' : source === 'roads' ? 'Follows roads' : 'Drawn'}</Badge>
        </Card>
        <ElevationChart points={path} height={80} />
        <Card className="flex flex-col gap-2 p-3.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold"><MapPin size={15} />Add to the course</span>
          <div className="flex flex-wrap gap-1.5">
            {POI_TYPES.map((t) => (
              <Chip key={t} on={mode === t} onClick={() => setMode(mode === t ? 'draw' : t)}>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: POI_COLOURS[t] }} />
                {POI_LABELS[t]}
              </Chip>
            ))}
          </div>
          {pois.length > 0 ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {pois.map((p, i) => (
                <li key={`${p.type}-${i}`} className="flex items-center gap-2 border-line py-1.5 text-[13px] [&+&]:border-t">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: POI_COLOURS[p.type] }} />
                  <span className="flex-1">{POI_LABELS[p.type]}</span>
                  <span className="text-muted">km {p.km}</span>
                  <button type="button" className="cursor-pointer border-0 bg-transparent p-1 text-muted" aria-label={`Remove ${POI_LABELS[p.type]}`} onClick={() => setPois((l) => l.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[12px] text-muted">Pick a type, then tap where it goes.</p>
          )}
        </Card>
        <Button variant="primary" block disabled={busy || path.length < 2} onClick={() => void save()}>
          Save course
        </Button>
        {notice ? <p className="m-0 text-[13px] text-brand-text">{notice}</p> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </div>
  );
}
