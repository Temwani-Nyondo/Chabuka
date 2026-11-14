import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Brand ---------- */

// The original Chabuka whistle-and-ball artwork, shown as a rounded tile so it
// sits the same on light and dark backgrounds.
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/logo-mark.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cx('shrink-0', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    />
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink">
      <LogoMark size={size} />
      <span className="text-[19px] font-extrabold tracking-[-0.03em]">Chabuka</span>
    </span>
  );
}

/* ---------- Buttons ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand border-brand hover:brightness-[1.06]',
  secondary: 'bg-surface text-ink border-line hover:bg-surface-2',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-surface-2',
  danger: 'bg-transparent text-danger border-line hover:bg-surface-2',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-[10px] gap-1.5',
  md: 'h-11 px-4 text-[14px] rounded-xl gap-2',
  lg: 'h-12 px-5 text-[15px] rounded-xl gap-2',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', block = false): string {
  return cx(
    'inline-flex items-center justify-center border font-bold whitespace-nowrap no-underline transition-[filter,background-color] duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-default cursor-pointer',
    VARIANT[variant],
    SIZE[size],
    block && 'w-full',
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', block, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(buttonClass(variant, size, block), className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  to,
  href,
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  className,
  children,
}: {
  to?: string;
  href?: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const cls = cx(buttonClass(variant, size, block), className);
  if (href) {
    return (
      <a className={cls} href={href} target="_blank" rel="noreferrer">
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link className={cls} to={to ?? '#'}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, children, className, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number }) {
  return (
    <button
      type="button"
      aria-label={badge ? `${label}, ${badge} unread` : label}
      className={cx(
        'relative inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink hover:bg-surface-2 cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-brand',
        className,
      )}
      {...rest}
    >
      {children}
      {badge ? <CountBadge n={badge} /> : null}
    </button>
  );
}

export function CountBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cx(
        'absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-bg bg-live px-1 text-[10px] font-bold text-white',
        className,
      )}
    >
      {n > 9 ? '9+' : n}
    </span>
  );
}

/* ---------- Surfaces ---------- */

export function Card({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' }) {
  return <Tag className={cx('rounded-2xl border border-line bg-surface', className)}>{children}</Tag>;
}

export function Section({ title, count, action, children, className }: { title: string; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2.5', className)} aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em]">
          {title}
          {count !== undefined ? <span className="ml-1.5 font-semibold text-muted">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-[13px] font-semibold text-brand-text no-underline hover:underline">
      {children}
    </Link>
  );
}

export function PageHeader({ title, sub, back, actions }: { title: string; sub?: ReactNode; back?: string; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start gap-2">
      {back ? (
        <Link to={back} aria-label="Back" className="-ml-2 mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink hover:bg-surface-2">
          <ChevronLeft size={22} />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="m-0">{title}</h1>
        {sub ? <p className="mt-0.5 text-[14px] text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

// A tappable row inside a Card. Rows are separated by a hairline.
export function ListRow({
  to,
  onClick,
  leading,
  title,
  sub,
  trailing,
  chevron = !!to,
}: {
  to?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  const inner = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{title}</span>
        {sub ? <span className="text-[13px] text-muted">{sub}</span> : null}
      </span>
      {trailing}
      {chevron ? <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" /> : null}
    </>
  );
  const cls = 'flex w-full items-center gap-3 px-3.5 py-3 text-left text-ink no-underline [&+&]:border-t [&+&]:border-line';
  if (to) return <Link to={to} className={cx(cls, 'hover:bg-surface-2/60')}>{inner}</Link>;
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx(cls, 'cursor-pointer border-0 bg-transparent font-[inherit] hover:bg-surface-2/60')}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

/* ---------- Small parts ---------- */

type Tone = 'neutral' | 'brand' | 'hl' | 'live' | 'muted';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink',
  brand: 'bg-brand-soft text-brand-text',
  hl: 'bg-hl text-hl-text',
  live: 'bg-live text-white',
  muted: 'bg-surface-2 text-muted',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-bold', TONE[tone], className)}>
      {children}
    </span>
  );
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

export function Avatar({ name, src, size = 36, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };
  if (src) return <img src={src} alt="" style={style} className={cx('shrink-0 rounded-full object-cover', className)} />;
  return (
    <span style={style} className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-bold text-ink', className)}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = 28 }: { people: { name?: string | null; src?: string | null }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.src} size={size} className={cx('border-2 border-surface', i > 0 && '-ml-2')} />
      ))}
      {extra > 0 ? <span className="ml-1.5 text-[12px] font-bold text-muted">+{extra}</span> : null}
    </span>
  );
}

// Team colours until teams carry a real kit colour (Phase 2): stable per id.
const KITS = ['#1d3f8f', '#b42318', '#0f766e', '#6b4e16', '#5b3fa8', '#9a3412', '#155e75', '#3f6212'];
export function kitColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return KITS[h % KITS.length] ?? KITS[0]!;
}

export function Crest({ name, id, src, size = 36, className }: { name: string; id: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28), fontSize: Math.max(10, Math.round(size * 0.34)) };
  if (src) return <img src={src} alt="" style={style} className={cx('shrink-0 object-cover', className)} />;
  return (
    <span style={{ ...style, background: kitColour(id) }} className={cx('inline-flex shrink-0 items-center justify-center font-extrabold text-white', className)}>
      {initials(name)}
    </span>
  );
}

export type Result = 'W' | 'D' | 'L';
const RESULT_CLS: Record<Result, string> = {
  W: 'bg-[var(--win)] text-[var(--win-ink)]',
  D: 'bg-[var(--draw)] text-[var(--draw-ink)]',
  L: 'bg-[var(--loss)] text-[var(--loss-ink)]',
};

export function ResultPill({ r, size = 18 }: { r: Result; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className={cx('inline-flex items-center justify-center rounded-[5px] text-[10px] font-extrabold', RESULT_CLS[r])}>
      {r}
    </span>
  );
}

export function FormGuide({ results, size }: { results: Result[]; size?: number }) {
  if (results.length === 0) return null;
  return (
    <span className="inline-flex gap-[3px]" aria-label={`Recent form: ${results.join(' ')}`}>
      {results.map((r, i) => (
        <ResultPill key={i} r={r} size={size} />
      ))}
    </span>
  );
}

export function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-line bg-surface px-2 py-3">
      <span className="tnum text-[22px] font-extrabold leading-tight">{value}</span>
      <span className="text-[11px] font-bold text-muted">{label}</span>
    </div>
  );
}

// Capacity meter: how full a game is.
export function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${value} of ${max}`}>
      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </span>
  );
}

/* ---------- Controls ---------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1 rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'h-9 flex-1 cursor-pointer whitespace-nowrap rounded-[9px] border-0 px-3 text-[13px] font-bold',
              on ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'bg-transparent text-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ on, onClick, children }: { on?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={!!on}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold',
        on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Feedback ---------- */

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center">
      {icon ? <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-text">{icon}</span> : null}
      <strong className="text-[15px]">{title}</strong>
      {body ? <p className="m-0 max-w-[34ch] text-[14px] text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('block animate-pulse rounded-xl bg-surface-2', className)} aria-hidden="true" />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="m-0 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-danger">
      {children}
    </p>
  );
}

/* ---------- Sheet ---------- */

// Bottom sheet on phones, centred panel on wide screens. Escape and the
// backdrop close it; focus moves into it on open.
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" role="presentation" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[var(--shadow-lg)] outline-none sm:rounded-3xl',
          wide ? 'sm:max-w-[640px]' : 'sm:max-w-[480px]',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <strong className="text-[16px]">{title}</strong>
          <IconButton label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-4">{children}</div>
      </div>
    </div>
  );
}
