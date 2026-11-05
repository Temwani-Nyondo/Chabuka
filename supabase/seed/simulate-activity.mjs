// Chabuka demo bustle: fresh activity so judges browsing the live site see
// a living product — games filling tonight, a just-posted result, a new
// team, a circle event and an open challenge. Re-runnable; each run plants
// another wave on top. Run AFTER seed.mjs (seed wipes domain rows).
// Run: node supabase/seed/simulate-activity.mjs
// Uses only SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the repo .env.
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.');

async function api(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

const HOUR = 3600 * 1000;
const fromNow = (hours) => new Date(Date.now() + hours * HOUR).toISOString();

async function main() {
  // --- demo cast -----------------------------------------------------------
  const { users } = await api('/auth/v1/admin/users?per_page=200');
  const byEmail = new Map((users ?? []).map((u) => [u.email, u.id]));
  const captain = byEmail.get('captain@demo.chabuka');
  const organiser = byEmail.get('organiser@demo.chabuka');
  if (!captain || !organiser) throw new Error('Demo users missing — run seed.mjs first.');
  const players = [];
  for (let i = 1; i <= 60 && players.length < 30; i += 1) {
    const id = byEmail.get(`player${i}@demo.chabuka`);
    if (id) players.push(id);
  }
  if (players.length < 12) throw new Error('Demo players missing — run seed.mjs first.');

  const sports = await api('/rest/v1/sports?select=id,name');
  const sportId = new Map(sports.map((s) => [s.name, s.id]));
  const venues = await api('/rest/v1/venues?select=id,name,sports');
  const venueFor = (sport) =>
    venues.find((v) => (v.sports ?? []).some((s) => s.toLowerCase() === sport.toLowerCase())) ?? null;

  const AREAS = [
    ['Kabulonga', -15.4189, 28.3489], ['Woodlands', -15.4395, 28.3512],
    ['Avondale', -15.405, 28.355], ['Northmead', -15.415, 28.305],
  ];

  // --- tonight: one seat left (judges can take it and hit Match Found) -----
  const [tonight] = await api('/rest/v1/matches', {
    method: 'POST',
    body: JSON.stringify({
      organiser_id: captain, sport_id: sportId.get('Football'), title: 'Tonight 5-a-side under lights',
      starts_at: fromNow(3), venue_id: venueFor('Football')?.id ?? null,
      venue_name: venueFor('Football')?.name ?? null,
      lat: AREAS[1][1], lng: AREAS[1][2], area: AREAS[1][0],
      format: null, capacity: 10, level: 'recreational',
      kind: 'players', visibility: 'public', status: 'open',
    }),
  });
  const tonightParts = [{ match_id: tonight.id, user_id: captain, status: 'joined' }];
  for (let f = 0; f < 8; f += 1) tonightParts.push({ match_id: tonight.id, user_id: players[f], status: 'joined' });
  await api('/rest/v1/match_participants', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(tonightParts) });
  console.log('tonight game ready: 9/10 joined, one seat left');

  // --- tomorrow morning run --------------------------------------------------
  const [morning] = await api('/rest/v1/matches', {
    method: 'POST',
    body: JSON.stringify({
      organiser_id: organiser, sport_id: sportId.get('basketball'), title: 'Sunrise basketball run',
      starts_at: fromNow(14), venue_id: venueFor('basketball')?.id ?? null,
      venue_name: venueFor('basketball')?.name ?? null,
      lat: AREAS[2][1], lng: AREAS[2][2], area: AREAS[2][0],
      format: null, capacity: 10, level: 'intermediate',
      kind: 'players', visibility: 'public', status: 'open',
    }),
  });
  const morningParts = [{ match_id: morning.id, user_id: organiser, status: 'joined' }];
  for (let f = 0; f < 3; f += 1) morningParts.push({ match_id: morning.id, user_id: players[10 + f], status: 'joined' });
  await api('/rest/v1/match_participants', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(morningParts) });
  console.log('morning game ready: 4/10 joined');

  // --- a just-posted tournament result ---------------------------------------
  const live = await api('/rest/v1/competitions?status=eq.live&order=created_at.desc&limit=1');
  if (live.length) {
    const fix = await api(`/rest/v1/fixtures?competition_id=eq.${live[0].id}&status=eq.scheduled&order=starts_at&limit=1`);
    if (fix.length) {
      const hs = 1 + Math.floor(Math.random() * 3);
      const as = Math.floor(Math.random() * 3);
      await api(`/rest/v1/fixtures?id=eq.${fix[0].id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'finished', home_score: hs, away_score: as }),
      });
      await api('/rest/v1/announcements', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          competition_id: live[0].id, author_id: live[0].organiser_id,
          type: 'result', text: `Full-time: ${hs}–${as}. What a finish — table updated.`,
        }),
      });
      console.log(`result posted: ${hs}-${as} on ${live[0].name}`);
    }
  }

  // --- a new team gathering its side ------------------------------------------
  const teamName = `Chilenje Strikers ${new Date().getHours()}${new Date().getMinutes()}`;
  const [team] = await api('/rest/v1/teams', {
    method: 'POST',
    body: JSON.stringify({
      name: teamName, sport_id: sportId.get('Football'), category: 'neighbourhood',
      city: 'Lusaka', area: 'Chilenje', created_by: captain,
    }),
  });
  const crew = [{ team_id: team.id, user_id: captain, role: 'owner' }];
  for (let f = 0; f < 5; f += 1) crew.push({ team_id: team.id, user_id: players[15 + f], role: f === 0 ? 'captain' : 'player' });
  await api('/rest/v1/team_members', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(crew) });
  await api('/rest/v1/challenges', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      team_id: team.id, sport_id: sportId.get('Football'), format: '7-a-side', level: 'recreational',
      window_start: fromNow(48), window_end: fromNow(54),
      area: 'Chilenje', radius_km: 10, status: 'open', created_by: captain,
    }),
  });
  console.log(`team + challenge ready: ${teamName}`);

  // --- circle event tonight -----------------------------------------------------
  const circles = await api('/rest/v1/circles?select=id,name&limit=5');
  const foot = circles.find((c) => /football/i.test(c.name)) ?? circles[0];
  if (foot) {
    const [evt] = await api('/rest/v1/matches', {
      method: 'POST',
      body: JSON.stringify({
        organiser_id: players[20], sport_id: sportId.get('Football'), title: `${foot.name} pickup tonight`,
        starts_at: fromNow(5), venue_id: venueFor('Football')?.id ?? null,
        venue_name: venueFor('Football')?.name ?? null,
        lat: AREAS[1][1], lng: AREAS[1][2], area: AREAS[1][0],
        format: null, capacity: 14, level: 'recreational',
        kind: 'players', visibility: 'public', status: 'open', circle_id: foot.id,
      }),
    });
    const evtParts = [{ match_id: evt.id, user_id: players[20], status: 'joined' }];
    for (let f = 0; f < 5; f += 1) evtParts.push({ match_id: evt.id, user_id: players[21 + f], status: 'joined' });
    await api('/rest/v1/match_participants', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(evtParts) });
    console.log(`circle event ready: ${foot.name} pickup tonight`);
  }
  console.log('BUSTLE_DONE');
}

main().catch((err) => {
  console.error('BUSTLE_FAILED', err.message);
  process.exit(1);
});
