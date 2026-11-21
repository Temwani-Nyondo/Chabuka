import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@chabuka/shared';
import { useParams } from 'react-router-dom';
import { MapPin, Navigation, Phone, Settings2 } from 'lucide-react';
import type { Venue } from '@chabuka/shared';
import VenuePhoto from '../components/VenuePhoto';
import SpacePicker from '../components/SpacePicker';
import { FollowButton } from '../components/Social';
import { useAuth } from '../auth/AuthContext';
import { claimVenueAction, requestBookingAction, runAction } from '../lib/api';
import { fetchSlotLoad, fetchVenueById, fetchVenueSlots } from '../lib/venues';
import type { VenueSlot } from '../lib/venues';
import { fetchMyBookingsAll, fetchMyVenues } from '../lib/venueBooking';
import type { MyBooking } from '../lib/venueBooking';
import { Badge, Button, ButtonLink, Card, ErrorNote, ListRow, PageHeader, Section } from '../components/ui';
import { fieldCls } from '../components/CompetitionForms';

const when = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const STATUS: Record<string, { label: string; tone: 'brand' | 'hl' | 'muted' }> = {
  requested: { label: 'Waiting for the venue', tone: 'hl' },
  confirmed: { label: 'Booked', tone: 'brand' },
  declined: { label: 'Declined', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

// A venue: who they are, where, and booking. Booking works the same whether the venue runs on Chabuka alone or is
// linked to WaitApp (which then takes payment).
export default function VenueProfilePage() {
  const { venueId = '' } = useParams();
  const { session, user } = useAuth();
  const token = session?.access_token;
  const [venue, setVenue] = useState<Venue | null>(null);
  const [legacy, setLegacy] = useState<VenueSlot[]>([]);
  const [load, setLoad] = useState<Map<string, number>>(new Map());
  const [mine, setMine] = useState<MyBooking[]>([]);
  const [manager, setManager] = useState(false);
  const [claimText, setClaimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!venueId || !user || !token) return;
    const [v, slots, l, bookings, managed] = await Promise.all([
      fetchVenueById(venueId),
      fetchVenueSlots(venueId).catch(() => [] as VenueSlot[]),
      fetchSlotLoad(venueId).catch(() => new Map<string, number>()),
      fetchMyBookingsAll(token).catch(() => [] as MyBooking[]),
      fetchMyVenues(token).catch(() => []),
    ]);
    setVenue(v);
    // Slots published before spaces existed keep working until their date passes.
    setLegacy(slots.filter((s) => new Date(s.starts_at) > new Date()));
    setLoad(l);
    setMine(bookings.filter((b) => b.venueId === venueId));
    setManager(managed.some((m) => m.id === venueId));
  }, [venueId, user, token]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this venue.'));
  }, [reload]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (!venue) {
    return <div className="mx-auto w-full max-w-3xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <p className="text-muted">Loading venue…</p>}</div>;
  }

  const directions = venue.lat != null && venue.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}` : null;
  const upcoming = mine.filter((b) => new Date(b.endsAt) > new Date() && (b.status === 'requested' || b.status === 'confirmed'));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-24 pt-4">
      <PageHeader
        title={venue.name}
        back="/explore"
        sub={[venue.area, venue.sports.join(', ')].filter(Boolean).join(' · ')}
        actions={manager ? <ButtonLink to={`/venues/${venue.id}/manage`} size="sm" icon={<Settings2 size={16} />}>Manage</ButtonLink> : <FollowButton subjectType="venue" subjectId={venue.id} />}
      />
      <VenuePhoto photos={venue.photos} name={venue.name} banner />

      {venue.status === 'pending' ? <Badge tone="hl">Waiting for approval: only you can see this venue</Badge> : null}
      {venue.status === 'rejected' ? <ErrorNote>Not approved. {venue.review_note ?? ''}</ErrorNote> : null}

      <Card className="flex flex-col gap-2 p-4 text-[14px]">
        {venue.area ? (
          <span className="inline-flex items-center gap-2"><MapPin size={16} className="text-muted" />{venue.area}</span>
        ) : null}
        {venue.contact ? (
          <span className="inline-flex items-center gap-2"><Phone size={16} className="text-muted" />{venue.contact}</span>
        ) : null}
        {venue.price_note ? <span className="text-muted">{venue.price_note}</span> : null}
        {venue.facility_types.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {venue.facility_types.map((f) => (
              <Badge key={f}>{f}</Badge>
            ))}
          </div>
        ) : null}
        {directions ? (
          <ButtonLink href={directions} size="sm" icon={<Navigation size={15} />} className="self-start">
            Directions
          </ButtonLink>
        ) : null}
      </Card>

      {upcoming.length > 0 ? (
        <Section title="Your bookings here" count={upcoming.length}>
          <Card>
            {upcoming.map((b) => (
              <ListRow
                key={b.id}
                title={`${when.format(new Date(b.startsAt))} · ${b.spaceName}`}
                sub={[STATUS[b.status]?.label ?? b.status, b.code ? `code ${b.code}` : null, b.payLine].filter(Boolean).join(' · ')}
                trailing={
                  b.checkoutUrl ? (
                    <ButtonLink href={b.checkoutUrl} size="sm" variant="primary">Pay</ButtonLink>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy || !token} onClick={() => token && void act(() => runAction('cancel_space_booking', { bookingId: b.id }, token), 'Booking cancelled.')}>
                      Cancel
                    </Button>
                  )
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {venue.status === 'approved' ? (
        <Section title="Book">
          <SpacePicker venueId={venue.id} onBooked={() => void reload()} />
        </Section>
      ) : null}

      {legacy.length > 0 && !venue.waitapp_restaurant_id ? (
        <Section title="Other listed times">
          <Card>
            {legacy.map((slot) => {
              const full = (load.get(slot.id) ?? 0) >= slot.capacity;
              const paid = slot.price != null && slot.price > 0;
              return (
                <ListRow
                  key={slot.id}
                  title={when.format(new Date(slot.starts_at))}
                  sub={paid ? `${formatMoney(slot.price, slot.currency)}, pay at the venue` : 'Free'}
                  trailing={
                    full ? (
                      <Badge tone="muted">Full</Badge>
                    ) : paid ? null : (
                      <Button size="sm" disabled={busy || !token} onClick={() => token && void act(() => requestBookingAction({ venueId: venue.id, slotId: slot.id }, token), 'Requested. The venue will confirm.')}>
                        Request
                      </Button>
                    )
                  }
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      {!venue.owner_id && venue.status === 'approved' ? (
        <Section title="Is this your venue?">
          <Card className="flex flex-col gap-2.5 p-4">
            <p className="m-0 text-[14px] text-muted">Nobody manages this listing yet. Tell us how you are connected to it and an admin will review your claim.</p>
            <input className={fieldCls} value={claimText} maxLength={500} onChange={(e) => setClaimText(e.target.value)} placeholder="I am the manager. You can reach me on 097..." aria-label="How you are connected" />
            <Button
              disabled={busy || !token || claimText.trim().length < 5}
              onClick={() => token && void act(() => claimVenueAction(venue.id, claimText.trim(), token), 'Claim sent. An admin will review it.').then(() => setClaimText(''))}
            >
              Claim this venue
            </Button>
          </Card>
        </Section>
      ) : null}

      {notice ? <p className="m-0 rounded-xl bg-brand-soft px-3 py-2 text-[14px] font-semibold text-brand-text">{notice}</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
