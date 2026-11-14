import type { ReactNode } from 'react';
import { cx } from './ui';

type Surface = 'football' | 'basketball' | 'netball';

export function surfaceFor(sport: string | null | undefined): Surface {
  const s = (sport ?? '').toLowerCase();
  if (s.includes('basket')) return 'basketball';
  if (s.includes('netball')) return 'netball';
  return 'football';
}

const LINE = 'rgba(255,255,255,0.62)';

function Markings({ surface, variant }: { surface: Surface; variant: 'half' | 'full' }) {
  const line = { borderColor: LINE };
  if (surface === 'basketball') {
    const key = (top: boolean) => (
      <>
        <div className={cx('absolute left-[33%] right-[33%] h-[19%] border-2', top ? 'top-0 border-t-0' : 'bottom-0 border-b-0')} style={line} />
        <div
          className={cx('absolute left-[12%] right-[12%] h-[30%] border-2', top ? 'top-0 rounded-b-[50%] border-t-0' : 'bottom-0 rounded-t-[50%] border-b-0')}
          style={line}
        />
      </>
    );
    return (
      <>
        <div className="absolute inset-2 rounded-sm border-2" style={line} />
        {variant === 'full' ? (
          <>
            <div className="absolute left-2 right-2 top-1/2 h-0.5" style={{ background: LINE }} />
            <div className="absolute left-1/2 top-1/2 h-[14%] w-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={line} />
            {key(true)}
          </>
        ) : null}
        {key(false)}
      </>
    );
  }
  if (surface === 'netball') {
    return (
      <>
        <div className="absolute inset-2 rounded-sm border-2" style={line} />
        <div className="absolute left-2 right-2 top-1/3 h-0.5" style={{ background: LINE }} />
        <div className="absolute left-2 right-2 top-2/3 h-0.5" style={{ background: LINE }} />
        <div className="absolute left-1/2 top-1/2 h-[7%] w-[12%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={line} />
        <div className="absolute left-[24%] right-[24%] top-2 h-[16%] rounded-b-full border-2 border-t-0" style={line} />
        <div className="absolute bottom-2 left-[24%] right-[24%] h-[16%] rounded-t-full border-2 border-b-0" style={line} />
      </>
    );
  }
  // Football and futsal.
  const box = (top: boolean) => (
    <>
      <div className={cx('absolute left-[22%] right-[22%] h-[15%] border-2', top ? 'top-2 border-t-0' : 'bottom-2 border-b-0')} style={line} />
      <div className={cx('absolute left-[38%] right-[38%] h-[6%] border-2', top ? 'top-2 border-t-0' : 'bottom-2 border-b-0')} style={line} />
    </>
  );
  return (
    <>
      <div className="absolute inset-2 rounded-sm border-2" style={line} />
      {variant === 'full' ? (
        <>
          <div className="absolute left-2 right-2 top-1/2 h-0.5" style={{ background: LINE }} />
          <div className="absolute left-1/2 top-1/2 aspect-square w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={line} />
          {box(true)}
        </>
      ) : (
        <div className="absolute -top-[11%] left-1/2 aspect-square w-[26%] -translate-x-1/2 rounded-full border-2" style={line} />
      )}
      {box(false)}
    </>
  );
}

const SURFACE_BG: Record<Surface, string> = {
  football: 'var(--pitch)',
  basketball: '#9a5b2e',
  netball: '#24577a',
};

// A playing surface in portrait. Children are absolutely positioned tokens.
export function PitchSurface({
  sport,
  variant,
  children,
  className,
  label,
}: {
  sport: string | null | undefined;
  variant: 'half' | 'full';
  children?: ReactNode;
  className?: string;
  label: string;
}) {
  const surface = surfaceFor(sport);
  const stripes = surface === 'football' ? 'repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 10%, rgba(0,0,0,0) 10% 20%)' : undefined;
  return (
    <div
      role="img"
      aria-label={label}
      className={cx('relative w-full overflow-hidden rounded-2xl', variant === 'full' ? 'aspect-[3/4.3]' : 'aspect-[4/3.6]', className)}
      style={{ background: SURFACE_BG[surface], backgroundImage: stripes }}
    >
      <Markings surface={surface} variant={variant} />
      {children}
    </div>
  );
}

// A shirt (football) or a vest (court sports) in the team's colour.
export function Shirt({ colour, number, size = 34, vest, light }: { colour: string; number?: number | string | null; size?: number; vest?: boolean; light?: boolean }) {
  const ink = light ? '#0e1411' : '#ffffff';
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path
        d={
          vest
            ? 'M12 3 L15 3 Q20 9 25 3 L28 3 L31 12 L31 37 L9 37 L9 12 Z'
            : 'M13 4 L7 6.5 L1.5 12.5 L6.5 18.5 L10 16.5 L10 36 L30 36 L30 16.5 L33.5 18.5 L38.5 12.5 L33 6.5 L27 4 Q20 9.5 13 4 Z'
        }
        fill={colour}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {number != null && number !== '' ? (
        <text x="20" y="28.5" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="800" fill={ink}>
          {number}
        </text>
      ) : null}
    </svg>
  );
}

function isLight(hex: string): boolean {
  const m = hex.replace('#', '');
  if (m.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) > 0.6;
}

// One player (or empty position) placed on the surface by percentage.
export function PlayerToken({
  x,
  y,
  colour,
  number,
  name,
  role,
  sport,
  selected,
  empty,
  onClick,
  size = 34,
}: {
  x: number;
  y: number;
  colour: string;
  number?: number | null;
  name?: string | null;
  role?: string;
  sport?: string | null;
  selected?: boolean;
  empty?: boolean;
  onClick?: () => void;
  size?: number;
}) {
  const vest = surfaceFor(sport) !== 'football';
  const content = empty ? (
    <>
      <span
        className={cx(
          'flex items-center justify-center rounded-full border-2 border-dashed text-[18px] font-bold text-white',
          selected ? 'border-white bg-white/25' : 'border-white/75 bg-white/5',
        )}
        style={{ width: size, height: size }}
      >
        +
      </span>
      <span className="text-[10px] font-extrabold tracking-[0.06em] text-white">{role}</span>
    </>
  ) : (
    <>
      <span className={cx('rounded-full', selected && 'outline outline-2 outline-offset-2 outline-white')}>
        <Shirt colour={colour} number={number ?? (role && !name ? role : null)} size={size} vest={vest} light={isLight(colour)} />
      </span>
      <span className="max-w-[78px] truncate rounded-md bg-black/55 px-1.5 text-[11px] font-bold text-white">{name ?? role}</span>
    </>
  );
  const pos = { left: `${x}%`, top: `${y}%` };
  const cls = 'absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={pos}
        aria-label={empty ? `Empty ${role ?? ''} position` : `${name ?? 'Player'}${number ? `, number ${number}` : ''}, ${role ?? ''}`}
        className={cx(cls, 'min-h-[48px] min-w-[52px] cursor-pointer border-0 bg-transparent p-1')}
      >
        {content}
      </button>
    );
  }
  return (
    <div style={pos} className={cls}>
      {content}
    </div>
  );
}

// Map a half-pitch position (team attacking up) onto the full surface.
export function toFull(side: 'home' | 'away', x: number, y: number): { x: number; y: number } {
  return side === 'home' ? { x, y: 50 + y / 2 } : { x: 100 - x, y: (100 - y) / 2 };
}
