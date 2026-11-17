import { useMemo } from 'react';
import { addDaysYmd, hourCells, openWindowFor, venueYmd } from '@chabuka/shared';
import type { CellState, HourCell } from '@chabuka/shared';
import type { CalendarView } from '../lib/venueBooking';
import { dayChip } from '../lib/venueBooking';
import { cx } from './ui';

// The owner's calendar: a week strip (with how busy each day is), then the chosen day as an hour grid with one column
// per space. The same grid for a Chabuka-only venue and a WaitApp-linked one.

const CELL: Record<CellState, string> = {
  free: 'bg-surface border-line text-muted hover:border-brand',
  partly: 'bg-brand-soft border-brand-soft text-brand-text',
  requested: 'bg-hl border-hl text-hl-text',
  booked: 'bg-brand border-brand text-on-brand',
  closed: 'bg-surface-3 border-line text-muted line-through',
  past: 'bg-surface-2 border-line text-muted opacity-60',
  shut: 'bg-surface-2 border-transparent text-muted opacity-50',
};

const LABEL: Record<CellState, string> = {
  free: 'Free',
  partly: 'Part booked',
  requested: 'Requested',
  booked: 'Booked',
  closed: 'Closed',
  past: '',
  shut: '',
};

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[12px] text-muted">
      {(['free', 'partly', 'requested', 'booked', 'closed'] as CellState[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cx('h-3 w-3 rounded border', CELL[s].split(' hover:')[0])} />
          {LABEL[s]}
        </span>
      ))}
    </div>
  );
}

export default function VenueCalendar({
  cal,
  from,
  date,
  onDate,
  onCell,
}: {
  cal: CalendarView;
  from: string;
  date: string;
  onDate: (d: string) => void;
  onCell: (spaceId: string, cell: HourCell) => void;
}) {
  const spaces = cal.spaces.filter((s) => s.active);
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(from, i));
  const today = venueYmd(new Date());

  const perDay = useMemo(() => {
    const m = new Map<string, { booked: number; requested: number }>();
    for (const b of cal.bookings) {
      const d = venueYmd(b.startsAt);
      const cur = m.get(d) ?? { booked: 0, requested: 0 };
      if (b.status === 'confirmed') cur.booked += 1;
      if (b.status === 'requested') cur.requested += 1;
      m.set(d, cur);
    }
    return m;
  }, [cal.bookings]);

  // One hour range for every space on the day, so rows line up.
  const window = openWindowFor(date, cal.hours);
  const fromHour = window ? Math.floor(window.open / 60) : 8;
  const toHour = window ? Math.ceil(window.close / 60) : 22;
  const columns = spaces.map((s) => ({
    space: s,
    cells: hourCells({
      date,
      hours: cal.hours,
      spaceId: s.id,
      unitCount: s.unit_count,
      bookings: cal.bookings
        .filter((b) => b.spaceId === s.id && (b.status === 'confirmed' || b.status === 'requested'))
        .map((b) => ({ id: b.id, unit_no: b.unitNo, starts_at: b.startsAt, ends_at: b.endsAt, status: b.status })),
      closures: cal.closures.map((c) => ({ space_id: c.space_id, starts_at: c.starts_at, ends_at: c.ends_at })),
      fromHour: window ? fromHour : 8,
      toHour: window ? toHour : 22,
    }),
  }));
  const hours = columns[0]?.cells.map((c) => c.start) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Choose a day">
        {days.map((d) => {
          const c = dayChip(d);
          const n = perDay.get(d);
          const on = d === date;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDate(d)}
              aria-pressed={on}
              className={cx(
                'flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border py-2 text-[12px] font-semibold',
                on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink hover:bg-surface-2',
              )}
            >
              <span className={on ? '' : 'text-muted'}>{d === today ? 'Today' : c.dow}</span>
              <span className="text-[17px] font-bold leading-none">{c.day}</span>
              <span className={cx('text-[11px]', on ? '' : 'text-muted')}>
                {n ? `${n.booked} in${n.requested ? `, ${n.requested} ?` : ''}` : ' '}
              </span>
            </button>
          );
        })}
      </div>

      {spaces.length === 0 ? null : !window ? (
        <p className="m-0 text-[14px] text-muted">Closed all day under your opening hours.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1" style={{ minWidth: 72 + spaces.length * 110 }}>
            <thead>
              <tr>
                <th className="w-14" />
                {columns.map(({ space }) => (
                  <th key={space.id} className="truncate px-1 pb-1 text-left text-[13px] font-bold">
                    {space.name}
                    {space.unit_count > 1 ? <span className="ml-1 font-semibold text-muted">x{space.unit_count}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h, row) => (
                <tr key={h}>
                  <td className="pr-1 text-right align-top text-[12px] font-semibold text-muted">{h}</td>
                  {columns.map(({ space, cells }) => {
                    const cell = cells[row]!;
                    const clickable = cell.state !== 'shut';
                    return (
                      <td key={space.id} className="p-0">
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={() => onCell(space.id, cell)}
                          className={cx(
                            'flex h-11 w-full cursor-pointer items-center justify-between rounded-lg border px-2 text-left text-[12px] font-semibold disabled:cursor-default',
                            CELL[cell.state],
                          )}
                          aria-label={`${space.name} ${cell.start}: ${LABEL[cell.state] || 'unavailable'}`}
                        >
                          <span className="truncate">{LABEL[cell.state]}</span>
                          {space.unit_count > 1 && (cell.booked > 0 || cell.requested > 0) ? (
                            <span>
                              {cell.booked}/{cell.units}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
