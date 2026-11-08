import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  createTicketing,
  getWaitAppLink,
  priceLabel,
  refreshTicketing,
  rememberTicketingReturn,
  startWaitAppLink,
} from '../lib/waitapp';
import type { MatchTicketing, TierInput, WaitAppLink } from '../lib/waitapp';

interface Props {
  matchId: string;
  ticketing: MatchTicketing | null;
  onChanged: () => void;
}

const STATUS_TEXT: Record<MatchTicketing['status'], string> = {
  draft: 'Saved on WaitApp, not on sale yet. Finish setting up your WaitApp organiser account.',
  pending_review: 'Waiting for WaitApp to review the event. Tickets go on sale once it is approved.',
  on_sale: 'On sale through WaitApp.',
  cancelled: 'Cancelled on WaitApp.',
};

interface TierRow {
  name: string;
  price: string;
  capacity: string;
}

// Organiser-only: turn a game into a ticketed event on WaitApp, or check how
// sales are going. WaitApp sells, issues and scans the tickets and pays the
// organiser out; this panel never handles money.
export default function TicketingPanel({ matchId, ticketing, onChanged }: Props) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<WaitAppLink | null | undefined>(undefined);
  const [tiers, setTiers] = useState<TierRow[]>([{ name: 'General', price: '', capacity: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token || link !== undefined) return;
    getWaitAppLink(token)
      .then(setLink)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not check your WaitApp link.');
        setLink(null);
      });
  }, [open, token, link]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await startWaitAppLink(token);
      rememberTicketingReturn(matchId);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the WaitApp link.');
      setBusy(false);
    }
  };

  const setRow = (i: number, patch: Partial<TierRow>) =>
    setTiers((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  const create = async () => {
    setError(null);
    const parsed: TierInput[] = [];
    for (const t of tiers) {
      const price = Number(t.price);
      if (!t.name.trim() || t.price.trim() === '' || !Number.isFinite(price) || price < 0) {
        setError('Give each ticket type a name and a price (0 for free).');
        return;
      }
      const capacity = t.capacity.trim() === '' ? undefined : Number(t.capacity);
      if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
        setError('Capacity must be a whole number, or left blank.');
        return;
      }
      parsed.push({ name: t.name.trim(), price, ...(capacity ? { capacity } : {}) });
    }
    setBusy(true);
    try {
      await createTicketing(token, matchId, parsed);
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up tickets.');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await refreshTicketing(token, matchId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh.');
    } finally {
      setBusy(false);
    }
  };

  if (ticketing) {
    return (
      <div className="ticketing-panel">
        <p className="muted">
          <strong>Tickets: {priceLabel(ticketing)}</strong> &middot; {ticketing.sold_count} sold &middot;{' '}
          {ticketing.checked_in_count} checked in &middot; {ticketing.refunded_count} refunded
        </p>
        <p className="hint">{STATUS_TEXT[ticketing.status]}</p>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions-row">
          <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Checking...' : 'Refresh sales'}
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="actions-row">
        <button className="btn" type="button" onClick={() => setOpen(true)}>
          Sell tickets
        </button>
      </div>
    );
  }

  return (
    <div className="ticketing-panel">
      <p className="muted">
        Tickets are sold, scanned and paid out by WaitApp, into your own WaitApp organiser account.
      </p>
      {link === undefined ? <p className="loading">Checking your WaitApp link...</p> : null}
      {link === null ? (
        <div className="actions-row">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Opening WaitApp...' : 'Connect your WaitApp account'}
          </button>
        </div>
      ) : null}
      {link ? (
        <>
          <p className="hint">
            Linked to {link.organiserName || 'your WaitApp account'}. Prices are in {link.currency ?? 'your account currency'}.
          </p>
          {tiers.map((t, i) => (
            <div className="tier-row" key={i}>
              <input
                className="input"
                placeholder="Ticket type"
                value={t.name}
                maxLength={60}
                onChange={(e) => setRow(i, { name: e.target.value })}
                aria-label={`Ticket type ${i + 1} name`}
              />
              <input
                className="input"
                placeholder="Price"
                inputMode="decimal"
                value={t.price}
                onChange={(e) => setRow(i, { price: e.target.value })}
                aria-label={`Ticket type ${i + 1} price`}
              />
              <input
                className="input"
                placeholder="Limit (optional)"
                inputMode="numeric"
                value={t.capacity}
                onChange={(e) => setRow(i, { capacity: e.target.value })}
                aria-label={`Ticket type ${i + 1} limit`}
              />
            </div>
          ))}
          <div className="actions-row">
            {tiers.length < 3 ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setTiers((prev) => [...prev, { name: '', price: '', capacity: '' }])}
              >
                Add ticket type
              </button>
            ) : null}
          </div>
          <p className="hint">WaitApp reviews paid events before they go on sale. Joining the game becomes ticket-only.</p>
        </>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="actions-row">
        {link ? (
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void create()}>
            {busy ? 'Setting up...' : 'Create ticketed event'}
          </button>
        ) : null}
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
