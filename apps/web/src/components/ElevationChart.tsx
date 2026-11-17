import { elevationProfile } from '@chabuka/shared';
import type { RoutePoint } from '@chabuka/shared';

// Course elevation as a simple filled line (inline SVG, theme colours). Shows nothing when the route has no heights.
export default function ElevationChart({ points, height = 96 }: { points: RoutePoint[]; height?: number }) {
  const prof = elevationProfile(points, 120);
  if (prof.length < 2) return null;
  const W = 600;
  const H = height;
  const pad = 18;
  const min = Math.min(...prof.map((p) => p.ele));
  const max = Math.max(...prof.map((p) => p.ele));
  const span = Math.max(10, max - min);
  const km = prof[prof.length - 1]!.km || 1;
  const x = (k: number) => (k / km) * W;
  const y = (e: number) => H - pad - ((e - min) / span) * (H - pad * 2);
  const line = prof.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <figure className="m-0" aria-label={`Elevation from ${min} m to ${max} m`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" preserveAspectRatio="none" role="img">
        <path d={area} fill="var(--brand-soft)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[12px] text-muted">
        <span>0 km</span>
        <span>
          {min} m to {max} m
        </span>
        <span>{km.toFixed(1)} km</span>
      </figcaption>
    </figure>
  );
}
