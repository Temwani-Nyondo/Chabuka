import { useState } from 'react';
import type { VenueSlot } from '../lib/venues';
import { deleteVenueSlotAction, updateVenueSlotAction } from '../lib/api';

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

// datetime-local wants local time without a zone.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  slot: VenueSlot;
  confirmed: number;
  token: string | undefined;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

export default function SlotRow({ slot, confirmed, token, onChanged, onError }: Props) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toLocalInput(slot.starts_at));
  const [end, setEnd] = useState(toLocalInput(slot.ends_at));
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [price, setPrice] = useState(slot.price != null && slot.price > 0 ? String(slot.price) : '');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      setEditing(false);
      onChanged(ok);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!token) return;
    const trimmed = price.trim();
    if (trimmed && !Number.isFinite(Number(trimmed))) {
      onError('Price must be a number.');
      return;
    }
    void run(
      () =>
        updateVenueSlotAction(
          {
            slotId: slot.id,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            capacity: Math.max(1, Number(capacity) || 1),
            price: trimmed ? Number(trimmed) : null,
            ...(trimmed ? { currency: slot.currency ?? 'ZMW' } : {}),
          },
          token,
        ),
      'Slot saved.',
    );
  };

  if (!editing) {
    return (
      <div className="row slot-row">
        <span className="muted">
          {fmt.format(new Date(slot.starts_at))} – {fmt.format(new Date(slot.ends_at))} · {confirmed}/{slot.capacity} booked
          {slot.price != null && slot.price > 0 ? ` · ${slot.currency ?? ''} ${slot.price}` : ' · free'}
        </span>
        <span className="actions-row">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || !token}
            onClick={() => token && void run(() => deleteVenueSlotAction(slot.id, token), 'Slot deleted.')}
          >
            Delete
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="card">
      <label className="field">
        Starts
        <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="field">
        Ends
        <input className="input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label className="field">
        Capacity (how many bookings it takes)
        <input className="input" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </label>
      <label className="field">
        Price (empty for free)
        <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <div className="actions-row">
        <button className="btn btn-primary" type="button" disabled={busy || !token} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
