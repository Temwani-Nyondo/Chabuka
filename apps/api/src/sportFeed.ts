import type { SupabaseClient } from '@supabase/supabase-js';
import { distanceKm } from '@chabuka/shared';

// The public sport feed WaitApp's Discover reads (Activities tab: one card per sport, then that sport's page). Like the
// landing page read (landing.ts): service client, trimmed here, and never a person's name or id. Only things anyone may
// see: public open games, events taking entries, approved venues with something to book.
//
// Where a tap goes: a paid race checks out on WaitApp (checkoutUrl), a venue linked to WaitApp books on its WaitApp page
// (bookingUrl), and everything else opens on Chabuka (chabukaUrl).

export type FeedKind = 'game' | 'event' | 'race' | 'venue';

export interface FeedItem {
  id: string;
  kind: FeedKind;
  sport: string;
  title: string;
  area: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  startsAt: string | null;
  priceLabel: string | null;
  spotsLeft: number | null;
  image: string | null;
  chabukaUrl: string;
  checkoutUrl: string | null;
  bookingUrl: string | null;
  /** Who it's for and what it asks, in short plain lines: "Intermediate", "5v5", "Half marathon: 16+". */
  rules: string[];
  /**
   * Races and golf days are entered through a form (runner's age, a golfer's handicap...), never a bare ticket:
   * WaitApp shows that form itself (GET /api/public/entry-form/:id) and sends it to POST /api/partner/waitapp/entries.
   */
  entry: 'race' | 'golf_day' | null;
}

export interface SportFeed {
  sports: { name: string; count: number; image: string | null }[];
  items: FeedItem[];
}

const ITEM_CAP = 200;

function money(amount: number, currency: string | null | undefined): string {
  const c = (currency ?? 'ZMW').toUpperCase();
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return c === 'ZMW' ? `K${n}` : `${c} ${n}`;
}

const LEVELS: Record<string, string> = { recreational: 'Recreational', intermediate: 'Intermediate', competitive: 'Competitive' };
const CATEGORIES: Record<string, string> = {
  community: 'Community', competitive: 'Competitive', charity: 'Charity', corporate: 'Corporate teams', school: 'School teams', social: 'Social',
};
const categoryLabel = (c: string) => CATEGORIES[c] ?? c;

/** A game's level, format and the start of the organiser's note: what someone checks before they turn up. */
function gameRules(g: { level?: string | null; format?: string | null; notes?: string | null }): string[] {
  const note = (g.notes ?? '').replace(/\s+/g, ' ').trim();
  return [
    g.level ? LEVELS[g.level] ?? g.level : null,
    g.format?.trim() || null,
    note ? (note.length > 90 ? `${note.slice(0, 87).trimEnd()}...` : note) : null,
  ].filter((x): x is string => !!x);
}

function raceLabel(meta: { min: number | null; max: number; currency: string | null } | undefined): string {
  if (!meta || !meta.max) return 'Free entry';
  if (!meta.min) return `Free to ${money(meta.max, meta.currency)}`;
  return meta.min === meta.max ? money(meta.min, meta.currency) : `From ${money(meta.min, meta.currency)}`;
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://chabuka.waitapp.online').replace(/\/+$/, '');
}

export async function readSportFeed(
  svc: SupabaseClient,
  q: { sport?: string; lat?: number | null; lng?: number | null; days?: number } = {},
  now = new Date(),
): Promise<SportFeed> {
  const days = Math.min(30, Math.max(1, q.days ?? 14));
  const until = new Date(now.getTime() + days * 86_400_000).toISOString();
  const base = appUrl();

  const { data: sportRows, error: sportErr } = await svc.from('sports').select('id,name');
  if (sportErr) throw new Error(sportErr.message);
  const sports = (sportRows ?? []) as { id: string; name: string }[];
  const sportName = new Map(sports.map((s) => [s.id, s.name]));
  const wanted = q.sport ? sports.find((s) => s.name.toLowerCase() === q.sport!.toLowerCase()) ?? null : null;
  if (q.sport && !wanted) return { sports: [], items: [] };

  const items: FeedItem[] = [];

  // --- Games: public, open, coming up. One per weekly series (the next one), so a series doesn't fill the page. ---
  let gq = svc
    .from('matches')
    .select('id,title,sport_id,starts_at,area,venue_name,lat,lng,capacity,visibility,status,series_id,level,format,notes')
    .eq('status', 'open')
    .eq('visibility', 'public')
    .gte('starts_at', now.toISOString())
    .lte('starts_at', until);
  if (wanted) gq = gq.eq('sport_id', wanted.id);
  const { data: gameRows, error: gameErr } = await gq.order('starts_at').limit(300);
  if (gameErr) throw new Error(gameErr.message);
  const games = (gameRows ?? []) as {
    id: string; title: string; sport_id: string; starts_at: string; area: string | null; venue_name: string | null;
    lat: number | null; lng: number | null; capacity: number; series_id: string | null;
    level?: string | null; format?: string | null; notes?: string | null;
  }[];
  const seenSeries = new Set<string>();
  const firstOfSeries = games.filter((g) => {
    if (!g.series_id) return true;
    if (seenSeries.has(g.series_id)) return false;
    seenSeries.add(g.series_id);
    return true;
  });
  const gameIds = firstOfSeries.map((g) => g.id);
  const joined = new Map<string, number>();
  const ticketing = new Map<string, { checkout_url: string; currency: string; tiers: { price?: number }[] }>();
  if (gameIds.length) {
    const [{ data: parts }, { data: tix }] = await Promise.all([
      svc.from('match_participants').select('match_id,status').in('match_id', gameIds),
      svc.from('match_ticketing').select('match_id,status,checkout_url,currency,tiers').in('match_id', gameIds),
    ]);
    for (const p of (parts ?? []) as { match_id: string; status: string }[]) if (p.status === 'joined') joined.set(p.match_id, (joined.get(p.match_id) ?? 0) + 1);
    for (const t of (tix ?? []) as { match_id: string; status: string; checkout_url: string; currency: string; tiers: { price?: number }[] | null }[]) {
      if (t.status === 'on_sale') ticketing.set(t.match_id, { checkout_url: t.checkout_url, currency: t.currency, tiers: t.tiers ?? [] });
    }
  }
  for (const g of firstOfSeries) {
    if (!g.area && (g.lat == null || g.lng == null)) continue;
    const tix = ticketing.get(g.id);
    const prices = (tix?.tiers ?? []).map((t) => Number(t.price ?? 0)).filter((n) => Number.isFinite(n));
    const min = prices.length ? Math.min(...prices) : 0;
    items.push({
      id: g.id,
      kind: 'game',
      sport: sportName.get(g.sport_id) ?? 'Sport',
      title: g.title,
      area: g.area,
      placeName: g.venue_name,
      lat: g.lat,
      lng: g.lng,
      startsAt: g.starts_at,
      priceLabel: tix ? (min > 0 ? `From ${money(min, tix.currency)}` : 'Free') : 'Free',
      spotsLeft: Math.max(0, g.capacity - (joined.get(g.id) ?? 0)),
      image: null,
      chabukaUrl: `${base}/games/${g.id}`,
      checkoutUrl: tix?.checkout_url ?? null,
      bookingUrl: null,
      rules: gameRules(g),
      entry: null,
    });
  }

  // --- Events: tournaments and leagues taking entries, races with entries open (events are always public). ---
  let cq = svc
    .from('competitions')
    .select('id,name,kind,sport_id,starts_on,status,area,location,banner_url,max_entries,waitapp_checkout_url,golf_settings,category')
    .eq('status', 'registration')
    .lte('starts_on', until.slice(0, 10))
    .gte('starts_on', now.toISOString().slice(0, 10));
  if (wanted) cq = cq.eq('sport_id', wanted.id);
  const { data: compRows, error: compErr } = await cq.order('starts_on').limit(100);
  if (compErr) throw new Error(compErr.message);
  const comps = ((compRows ?? []) as {
    id: string; name: string; kind: string; sport_id: string; starts_on: string; area: string | null; location: string | null;
    banner_url: string | null; max_entries: number; waitapp_checkout_url: string | null;
    golf_settings?: { entryFee?: number; currency?: string; firstTeeAt?: string; fieldLimit?: number; maxHandicap?: number; scoring?: string } | null;
    category?: string | null;
  }[]);
  const raceIds = comps.filter((c) => c.kind === 'race').map((c) => c.id);
  const raceMeta = new Map<string, { starts: string | null; min: number | null; max: number; currency: string | null; ages: string[] }>();
  if (raceIds.length) {
    const { data: dists } = await svc.from('race_distances').select('competition_id,name,starts_at,price,currency,min_age').in('competition_id', raceIds);
    for (const d of (dists ?? []) as { competition_id: string; name?: string; starts_at: string; price: number | string; currency: string; min_age?: number | null }[]) {
      const cur = raceMeta.get(d.competition_id) ?? { starts: null, min: null, max: 0, currency: d.currency, ages: [] };
      const price = Number(d.price);
      raceMeta.set(d.competition_id, {
        starts: !cur.starts || d.starts_at < cur.starts ? d.starts_at : cur.starts,
        min: cur.min == null ? price : Math.min(cur.min, price),
        max: Math.max(cur.max, price),
        currency: d.currency,
        ages: d.min_age ? [...cur.ages, `${d.name ?? 'Race'}: ${d.min_age}+`] : cur.ages,
      });
    }
  }
  const golfIds = comps.filter((c) => c.kind === 'golf_day').map((c) => c.id);
  const golfEntered = new Map<string, number>();
  if (golfIds.length) {
    const { data: ge } = await svc.from('golf_entries').select('competition_id,status').in('competition_id', golfIds);
    for (const e of (ge ?? []) as { competition_id: string; status: string }[]) {
      if (e.status === 'confirmed' || e.status === 'pending_payment') golfEntered.set(e.competition_id, (golfEntered.get(e.competition_id) ?? 0) + 1);
    }
  }
  const teamComps = comps.filter((c) => c.kind !== 'race' && c.kind !== 'golf_day').map((c) => c.id);
  const entered = new Map<string, number>();
  if (teamComps.length) {
    const { data: entries } = await svc.from('competition_entries').select('competition_id,status').in('competition_id', teamComps);
    for (const e of (entries ?? []) as { competition_id: string; status: string }[]) {
      if (e.status === 'approved' || e.status === 'pending') entered.set(e.competition_id, (entered.get(e.competition_id) ?? 0) + 1);
    }
  }
  for (const c of comps) {
    if (c.kind === 'golf_day') {
      const gs = c.golf_settings ?? {};
      const fee = Number(gs.entryFee ?? 0);
      items.push({
        id: c.id,
        kind: 'event',
        sport: sportName.get(c.sport_id) ?? 'golf',
        title: c.name,
        area: c.area,
        placeName: c.location,
        lat: null,
        lng: null,
        startsAt: gs.firstTeeAt ?? `${c.starts_on}T00:00:00.000Z`,
        priceLabel: fee > 0 ? money(fee, gs.currency) : 'Free entry',
        spotsLeft: Math.max(0, (gs.fieldLimit ?? c.max_entries) - (golfEntered.get(c.id) ?? 0)),
        image: c.banner_url,
        chabukaUrl: `${base}/golf/${c.id}`,
        // Entered through the form (handicap, phone), never a bare ticket: see `entry`.
        checkoutUrl: null,
        bookingUrl: null,
        rules: [
          gs.maxHandicap != null && Number(gs.maxHandicap) < 54 ? `Handicap ${gs.maxHandicap} or under` : 'Any handicap',
          gs.scoring === 'stroke' ? 'Stroke play' : 'Stableford',
        ],
        entry: 'golf_day',
      });
      continue;
    }
    const race = c.kind === 'race';
    const meta = raceMeta.get(c.id);
    items.push({
      id: c.id,
      kind: race ? 'race' : 'event',
      sport: sportName.get(c.sport_id) ?? 'Sport',
      title: c.name,
      area: c.area,
      placeName: c.location,
      lat: null,
      lng: null,
      startsAt: meta?.starts ?? `${c.starts_on}T00:00:00.000Z`,
      // A race with a free and a paid distance is neither "free" nor "from K0": say both ends.
      priceLabel: race ? raceLabel(meta) : null,
      spotsLeft: race ? null : Math.max(0, c.max_entries - (entered.get(c.id) ?? 0)),
      image: c.banner_url,
      chabukaUrl: `${base}/${race ? 'races' : 'competitions'}/${c.id}`,
      // Races are entered through the form (date of birth for the age rule), never a bare ticket: see `entry`.
      checkoutUrl: null,
      bookingUrl: null,
      rules: race ? (meta?.ages.length ? meta.ages : ['All ages']) : c.category ? [categoryLabel(c.category)] : [],
      entry: race ? 'race' : null,
    });
  }

  // --- Venues: approved, with at least one active space to book. ---
  const { data: venueRows, error: venueErr } = await svc.from('venues').select('id,name,area,lat,lng,sports,photos,price_note,status').eq('status', 'approved').limit(300);
  if (venueErr) throw new Error(venueErr.message);
  const venues = (venueRows ?? []) as { id: string; name: string; area: string | null; lat: number | null; lng: number | null; sports: string[] | null; photos: string[] | null; price_note: string | null }[];
  const venueIds = venues.map((v) => v.id);
  const spaceMin = new Map<string, { price: number | null; currency: string | null }>();
  // Golf venues selling tee times: priced per player, paid at the course.
  const teeVenues = new Map<string, { price: number | null; currency: string | null }>();
  const booking = new Map<string, string>();
  if (venueIds.length) {
    const [{ data: spaces }, { data: links }] = await Promise.all([
      svc.from('venue_spaces').select('venue_id,hourly_price,currency,active,booking_kind,tee').in('venue_id', venueIds),
      svc.from('venue_waitapp_links').select('venue_id,booking_page').in('venue_id', venueIds),
    ]);
    for (const s of (spaces ?? []) as { venue_id: string; hourly_price: number | string | null; currency: string | null; active: boolean; booking_kind?: string | null; tee?: { pricePerPlayer?: number | null } | null }[]) {
      if (!s.active) continue;
      if (s.booking_kind === 'tee') {
        const p = s.tee?.pricePerPlayer ?? null;
        teeVenues.set(s.venue_id, { price: p == null ? null : Number(p), currency: s.currency });
        continue;
      }
      const cur = spaceMin.get(s.venue_id);
      const p = s.hourly_price == null ? null : Number(s.hourly_price);
      if (!cur) spaceMin.set(s.venue_id, { price: p, currency: s.currency });
      else if (p != null && (cur.price == null || p < cur.price)) spaceMin.set(s.venue_id, { price: p, currency: s.currency });
    }
    for (const l of (links ?? []) as { venue_id: string; booking_page: string | null }[]) if (l.booking_page) booking.set(l.venue_id, l.booking_page);
  }
  for (const v of venues) {
    const tee = teeVenues.get(v.id);
    if (tee && (!wanted || wanted.name.toLowerCase() === 'golf')) {
      items.push({
        id: `${v.id}:golf`,
        kind: 'venue',
        sport: 'golf',
        title: v.name,
        area: v.area,
        placeName: v.name,
        lat: v.lat,
        lng: v.lng,
        startsAt: null,
        priceLabel: tee.price ? `${money(tee.price, tee.currency)} per player, pay at the course` : 'Tee times',
        spotsLeft: null,
        image: v.photos?.[0] ?? null,
        chabukaUrl: `${base}/venues/${v.id}`,
        checkoutUrl: null,
        bookingUrl: null,
        rules: [],
        entry: null,
      });
    }
    const space = spaceMin.get(v.id);
    if (!space) continue;
    const vSports = (v.sports ?? []).map((s) => s.toLowerCase());
    const sportsHere = wanted ? (vSports.includes(wanted.name.toLowerCase()) ? [wanted.name] : []) : sports.filter((s) => vSports.includes(s.name.toLowerCase())).map((s) => s.name);
    for (const sport of sportsHere) {
      items.push({
        id: `${v.id}:${sport}`,
        kind: 'venue',
        sport,
        title: v.name,
        area: v.area,
        placeName: v.name,
        lat: v.lat,
        lng: v.lng,
        startsAt: null,
        priceLabel: space.price != null && space.price > 0 ? `From ${money(space.price, space.currency)} an hour` : v.price_note,
        spotsLeft: null,
        image: v.photos?.[0] ?? null,
        chabukaUrl: `${base}/venues/${v.id}`,
        checkoutUrl: null,
        bookingUrl: booking.get(v.id) ?? null,
        rules: [],
        entry: null,
      });
    }
  }

  // Sort: dated things soonest first (then nearest), venues after them, nearest first.
  const here = q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null;
  const km = (i: FeedItem) => (here && i.lat != null && i.lng != null ? distanceKm(here, { lat: i.lat, lng: i.lng }) : Number.POSITIVE_INFINITY);
  items.sort((a, b) => {
    if (!!a.startsAt !== !!b.startsAt) return a.startsAt ? -1 : 1;
    if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt) return a.startsAt.localeCompare(b.startsAt);
    return km(a) - km(b);
  });
  const capped = items.slice(0, ITEM_CAP);

  // One card per sport with something on: dated items count ("12 this week"), a venue alone still earns a card.
  const bySport = new Map<string, { count: number; image: string | null; venues: number }>();
  for (const i of items) {
    const cur = bySport.get(i.sport) ?? { count: 0, image: null, venues: 0 };
    if (i.kind === 'venue') cur.venues += 1;
    else cur.count += 1;
    cur.image = cur.image ?? i.image;
    bySport.set(i.sport, cur);
  }
  const sportCards = [...bySport.entries()]
    .map(([name, v]) => ({ name, count: v.count, image: v.image }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { sports: sportCards, items: capped };
}
