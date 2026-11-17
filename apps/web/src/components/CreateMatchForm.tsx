import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMatchSchema, LEVEL_LABELS, LEVELS } from '@chabuka/shared';
import type { Level, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { createMatchAction, runAction } from '../lib/api';
import { fetchSports } from '../lib/matches';
import { fetchCircles } from '../lib/circles';
import { fetchSlotLoad, fetchVenueSlots } from '../lib/venues';
import type { VenueSlot } from '../lib/venues';
import type { CircleListing } from '../lib/circles';
import { fetchFreePreview } from '../lib/records';
import VenuePicker from './VenuePicker';
import type { VenuePick } from './VenuePicker';

export default function CreateMatchForm({ onDone }: { onDone: () => void }) {
  const { session, profile, user } = useAuth();
  const navigate = useNavigate();
  const [sports, setSports] = useState<Sport[]>([]);
  const [sportId, setSportId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [area, setArea] = useState(profile?.area ?? '');
  const [format, setFormat] = useState('');
  const [capacity, setCapacity] = useState(10);
  const [level, setLevel] = useState<Level>('recreational');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [notes, setNotes] = useState('');
  const [venuePick, setVenuePick] = useState<VenuePick>({});
  const [circles, setCircles] = useState<CircleListing[]>([]);
  const [circleId, setCircleId] = useState('');
  const [slots, setSlots] = useState<VenueSlot[]>([]);
  const [slotId, setSlotId] = useState('');
  const [repeat, setRepeat] = useState<0 | 1 | 2>(0);
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freeCount, setFreeCount] = useState(0);

  useEffect(() => {
    fetchSports()
      .then((list) => {
        setSports(list);
        if (list[0]) setSportId(list[0].id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load sports.'),
      );
    if (user) {
      fetchCircles(user.id)
        .then((all) => setCircles(all.filter((c) => c.isMember)))
        .catch(() => undefined);
    }
  }, [user]);

  // Offer the venue's open free slots, so the game and its booking request go together.
  useEffect(() => {
    setSlotId('');
    setSlots([]);
    const venueId = venuePick.venueId;
    if (!venueId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [all, load] = await Promise.all([fetchVenueSlots(venueId), fetchSlotLoad(venueId)]);
        if (cancelled) return;
        setSlots(
          all.filter(
            (sl) => !(sl.price != null && sl.price > 0) && (load.get(sl.id) ?? 0) < sl.capacity,
          ),
        );
      } catch {
        // No slots to offer: the game can still be created without one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venuePick.venueId]);

  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Free tonight: a game later today, in public, with a place set shows how many players nearby are free for this sport.
  useEffect(() => {
    const token = session?.access_token;
    const hasPlace = (venuePick.lat != null && venuePick.lng != null) || !!venuePick.venueId;
    if (!token || !sportId || !startsAt || visibility !== 'public' || !hasPlace) { setFreeCount(0); return; }
    const iso = new Date(startsAt).toISOString();
    let stop = false;
    const t = window.setTimeout(() => {
      fetchFreePreview(token, { sportId, startsAt: iso, lat: venuePick.lat, lng: venuePick.lng, venueId: venuePick.venueId })
        .then((r) => { if (!stop) setFreeCount(r.eligible ? r.count : 0); })
        .catch(() => { if (!stop) setFreeCount(0); });
    }, 400);
    return () => { stop = true; window.clearTimeout(t); };
  }, [session, sportId, startsAt, visibility, venuePick.lat, venuePick.lng, venuePick.venueId]);

  const sport = sports.find((s) => s.id === sportId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    const parsed = createMatchSchema.safeParse({
      sportId,
      title: title.trim(),
      startsAt: startsAt ? new Date(startsAt).toISOString() : '',
      area: area.trim(),
      venueId: venuePick.venueId,
      placeId: venuePick.placeId,
      venueName: venuePick.venueName,
      lat: venuePick.lat,
      lng: venuePick.lng,
      format: format || undefined,
      capacity,
      level,
      visibility,
      notes: notes.trim() || undefined,
      circleId: circleId || undefined,
      slotId: slotId || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    if (new Date(parsed.data.startsAt).getTime() <= Date.now()) {
      setError('Pick a start time in the future.');
      return;
    }
    setBusy(true);
    try {
      if (repeat) {
        // startsAt is the local "YYYY-MM-DDTHH:MM" from the picker: Lusaka time.
        const [datePart = '', timePart = ''] = startsAt.split('T');
        const [y, m, d] = datePart.split('-').map(Number) as [number, number, number];
        const res = await runAction<{ seriesId: string; matchIds: string[] }>(
          'create_series',
          {
            sportId: parsed.data.sportId,
            title: parsed.data.title,
            weekday: new Date(y, m - 1, d).getDay(),
            time: timePart.slice(0, 5),
            intervalWeeks: repeat,
            startsOn: datePart,
            until: until || null,
            area: parsed.data.area,
            venueId: parsed.data.venueId,
            venueName: parsed.data.venueName,
            placeId: parsed.data.placeId,
            lat: parsed.data.lat,
            lng: parsed.data.lng,
            format: parsed.data.format,
            capacity: parsed.data.capacity,
            level: parsed.data.level,
            notes: parsed.data.notes,
            visibility: parsed.data.visibility,
            circleId: parsed.data.circleId,
          },
          token,
        );
        onDone();
        navigate(res.matchIds[0] ? `/games/${res.matchIds[0]}` : '/explore');
        return;
      }
      const res = await createMatchAction(parsed.data, token);
      onDone();
      navigate(res.matchId ? `/games/${res.matchId}` : '/explore');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the match.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <label className="field">
        Title
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Saturday football"
          maxLength={80}
        />
      </label>
      <label className="field">
        Sport
        <select
          className="input"
          value={sportId}
          onChange={(e) => {
            setSportId(e.target.value);
            setFormat('');
          }}
        >
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {sport && sport.formats.length > 0 ? (
        <label className="field">
          Format
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Any</option>
            {sport.formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        Starts
        <input
          className="input"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </label>
      <VenuePicker
        sportName={sport?.name}
        area={area}
        onAreaChange={setArea}
        onPick={setVenuePick}
      />
      {freeCount > 0 ? (
        <p className="hint" role="status">
          {freeCount} players near here are free tonight for {sport?.name?.toLowerCase() ?? 'this sport'}. Once the game is created, you can let them know from the game page.
        </p>
      ) : null}
      <label className="field">
        Repeats
        <select className="input" value={repeat} onChange={(e) => setRepeat(Number(e.target.value) as 0 | 1 | 2)}>
          <option value={0}>Just this once</option>
          <option value={1}>Every week, same day and time</option>
          <option value={2}>Every 2 weeks</option>
        </select>
        {repeat ? <span className="hint">The next 4 games are always listed so people can join ahead. Regulars can join every week in one tap.</span> : null}
      </label>
      {repeat ? (
        <label className="field">
          Until (optional)
          <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      ) : null}
      {slots.length > 0 && !repeat ? (
        <label className="field">
          Book a slot at this venue (optional)
          <select
            className="input"
            value={slotId}
            onChange={(e) => {
              setSlotId(e.target.value);
              const picked = slots.find((sl) => sl.id === e.target.value);
              if (picked) setStartsAt(toLocalInput(picked.starts_at));
            }}
          >
            <option value="">No slot, I will arrange it</option>
            {slots.map((sl) => (
              <option key={sl.id} value={sl.id}>
                {new Date(sl.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {' - '}
                {new Date(sl.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </option>
            ))}
          </select>
          {slotId ? <span className="hint">The venue gets a booking request tied to this game and confirms it.</span> : null}
        </label>
      ) : null}
      <label className="field">
        Players needed (including you)
        <input
          className="input"
          type="number"
          min={2}
          max={100}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
        />
      </label>
      <div className="field">
        <span>Level</span>
        <div className="chips">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className={level === l ? 'chip chip-active' : 'chip'}
              onClick={() => setLevel(l)}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Who can see it
        <select
          className="input"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
        >
          <option value="public">Public — anyone can join</option>
          <option value="private">Private — not listed on Explore</option>
        </select>
      </label>
      <label className="field">
        Notes (optional)
        <input
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Bring a dark and a light shirt"
          maxLength={500}
        />
      </label>
      {circles.length > 0 ? (
        <label className="field">
          Share to a circle (optional)
          <select className="input" value={circleId} onChange={(e) => setCircleId(e.target.value)}>
            <option value="">No circle — Explore only</option>
            {circles.map(({ circle }) => (
              <option key={circle.id} value={circle.id}>
                {circle.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : repeat ? 'Create weekly game' : 'Create game'}
      </button>
    </form>
  );
}
