import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { DEFAULT_MAP_CENTER, POI_LABELS, kmMarkers } from '@chabuka/shared';
import type { RoutePoi, RoutePoint } from '@chabuka/shared';
import 'leaflet/dist/leaflet.css';

// A race course on the map: the line, km markers and points of interest (water, medical, start, finish...).
// Read-only; the organiser edits it in RoutePlanner. OpenStreetMap tiles, same as Explore.

export const POI_COLOURS: Record<string, string> = {
  start: '#0B6B3A',
  finish: '#111827',
  water: '#2563EB',
  sponge: '#0891B2',
  medical: '#DC2626',
  toilets: '#7C3AED',
  cheer: '#D97706',
  bag_drop: '#4B5563',
  turn: '#DB2777',
};

export function FitBounds({ points }: { points: RoutePoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points.map((p) => [p[0], p[1]] as [number, number])), { padding: [24, 24] });
  }, [map, points]);
  return null;
}

export function KmLayer({ points, laps = 1, every }: { points: RoutePoint[]; laps?: number; every?: number }) {
  const markers = useMemo(() => {
    const all = kmMarkers(points, 1000, laps);
    // Long courses: label every 5 km so the map stays readable.
    const step = every ?? (all.length > 25 ? 5 : 1);
    return all.filter((m) => Math.round(m.km) % step === 0);
  }, [points, laps, every]);
  return (
    <>
      {markers.map((m) => (
        <CircleMarker key={m.km} center={[m.lat, m.lng]} radius={9} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#111827', fillOpacity: 0.9 }}>
          <Tooltip permanent direction="center" className="km-label">
            {Math.round(m.km)}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

export function PoiLayer({ pois }: { pois: RoutePoi[] }) {
  return (
    <>
      {pois.map((p, i) => (
        <CircleMarker key={`${p.type}-${i}`} center={[p.lat, p.lng]} radius={8} pathOptions={{ color: '#ffffff', weight: 2, fillColor: POI_COLOURS[p.type] ?? '#111827', fillOpacity: 1 }}>
          <Tooltip direction="top">{`${p.label || POI_LABELS[p.type]}, km ${p.km}`}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

export default function RouteMap({ points, pois, laps = 1, height = 360 }: { points: RoutePoint[]; pois: RoutePoi[]; laps?: number; height?: number }) {
  const centre: [number, number] = points[0] ? [points[0][0], points[0][1]] : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng];
  return (
    <div className="overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <MapContainer center={centre} zoom={13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {points.length >= 2 ? <Polyline positions={points.map((p) => [p[0], p[1]] as [number, number])} pathOptions={{ color: '#0B6B3A', weight: 5, opacity: 0.9 }} /> : null}
        <KmLayer points={points} laps={laps} />
        <PoiLayer pois={pois} />
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
