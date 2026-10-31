// Chabuka seed: a living Lusaka scene (brief section 12). Re-runnable:
// seeded users are found by email, and their domain rows are rebuilt, so
// dates always land in the coming week. Run: node supabase/seed/seed.mjs
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

const DEMO_PASSWORD = 'Chabuka demo 2026!';

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

const AREAS = [
  ['Kabulonga', -15.4189, 28.3489], ['Woodlands', -15.4395, 28.3512],
  ['Rhodes Park', -15.418, 28.295], ['Olympia', -15.4085, 28.3187],
  ['Roma', -15.395, 28.335], ['Chelston', -15.395, 28.375],
  ['Avondale', -15.405, 28.355], ['Northmead', -15.415, 28.305],
  ['Ibex Hill', -15.435, 28.365], ['Longacres', -15.425, 28.285],
  ['Chilenje', -15.4692, 28.3318], ['Libala', -15.455, 28.315],
];
const FIRST = ['Chanda', 'Mwila', 'Temwani', 'Bwalya', 'Nkandu', 'Joseph', 'Precious', 'Mutinta', 'Kabwe', 'Luyando', 'Misozi', 'Chileshe', 'Namukolo', 'Sibo', 'Kondwani', 'Thandiwe', 'Mubita', 'Nchimunya', 'Lweendo', 'Kasongo'];
const LAST = ['Phiri', 'Mwanza', 'Banda', 'Nyondo', 'Kunda', 'Sakala', 'Tembo', 'Zulu', 'Hamoonga', 'Lungu', 'Chipeta', 'Mwape', 'Nkole', 'Simwanza', 'Kasonde'];
const LEVELS = ['recreational', 'intermediate', 'competitive'];
const GENDERS = ['woman', 'man', 'woman', 'man', null];

const DAY = 24 * 3600 * 1000;
const at = (days, hour) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour - 2, 0, 0, 0); // CAT = UTC+2
  return d.toISOString();
};

async function main() {
  // --- users -------------------------------------------------------------
  const existing = await api('/auth/v1/admin/users?per_page=200');
  const byEmail = new Map((existing.users ?? []).map((u) => [u.email, u.id]));

  const people = [];
  people.push({ email: 'captain@demo.chabuka', name: 'Demo Captain', area: AREAS[1], birthYear: 1994, gender: 'man' });
  people.push({ email: 'organiser@demo.chabuka', name: 'Demo Organiser', area: AREAS[0], birthYear: 1989, gender: 'woman' });
  for (let i = 0; i < 60; i += 1) {
    people.push({
      email: `player${i + 1}@demo.chabuka`,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      area: AREAS[i % AREAS.length],
      birthYear: 1985 + (i % 25),
      gender: GENDERS[i % GENDERS.length],
    });
  }
  const userIds = [];
  for (const p of people) {
    let id = byEmail.get(p.email);
    if (!id) {
      const created = await api('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email: p.email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { name: p.name } }),
      });
      id = created.id;
    }
    userIds.push(id);
    p.id = id;
  }
  console.log('users ready:', userIds.length);

  // --- profiles + sports --------------------------------------------------
  const sports = await api('/rest/v1/sports?select=id,name');
  const sportId = new Map(sports.map((s) => [s.name, s.id]));
  await api('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(
      people.map((p) => ({
        id: p.id, name: p.name, area: p.area[0], city: 'Lusaka', country: 'Zambia',
        lat: p.area[1], lng: p.area[2], birth_year: p.birthYear, gender: p.gender,
      })),
    ),
  });
  const sportNames = [...sportId.keys()];
  await api(`/rest/v1/user_sports?user_id=in.(${userIds.join(',')})`, { method: 'DELETE' });
  const userSportRows = [];
  people.forEach((p, i) => {
    userSportRows.push({ user_id: p.id, sport_id: sportId.get(sportNames[i % sportNames.length]), level: LEVELS[i % 3] });
    if (i % 3 === 0) userSportRows.push({ user_id: p.id, sport_id: sportId.get(sportNames[(i + 3) % sportNames.length]), level: LEVELS[(i + 1) % 3] });
  });
  await api('/rest/v1/user_sports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(userSportRows) });
  console.log('profiles + user_sports ready');

  // --- rebuild domain rows owned by seeded users --------------------------
  const inIds = `(${userIds.join(',')})`;
  await api(`/rest/v1/matches?organiser_id=in.${inIds}`, { method: 'DELETE' });
  await api(`/rest/v1/challenges?created_by=in.${inIds}`, { method: 'DELETE' });
  await api(`/rest/v1/competitions?organiser_id=in.${inIds}`, { method: 'DELETE' });
  await api(`/rest/v1/circles?created_by=in.${inIds}`, { method: 'DELETE' });
  await api(`/rest/v1/teams?created_by=in.${inIds}`, { method: 'DELETE' });

  // --- teams (15) -----------------------------------------------------------
  const teamDefs = [
    ['Finance FC', 'Football', 'corporate', 2], ['Woodlands Warriors', 'Football', 'neighbourhood', 1],
    ['Avondale Hoops', 'basketball', 'neighbourhood', 6], ['Kabulonga Tennis Club', 'tennis', 'club', 0],
    ['Roma Runners', 'marathon', 'social', 4], ['Lusaka Trail Circle', 'hiking', 'social', 5],
    ['Chelston United', 'Football', 'neighbourhood', 10], ['Northmead Netball', 'netball', 'social', 7],
    ['Ibex Veterans', 'Football', 'veterans', 8], ['Longacres Alumni', 'Football', 'alumni', 9],
    ['Chilenje Futsal Kings', 'futsal', 'competitive', 10], ['Olympia Padel Crew', 'padel', 'social', 3],
    ['Rhodes Park Rovers', 'Football', 'corporate', 2], ['Matero Ballers', 'basketball', 'competitive', 6],
    ['Libala Ladies FC', 'Football', 'neighbourhood', 11],
  ];
  const teams = [];
  for (let t = 0; t < teamDefs.length; t += 1) {
    const [name, sport, category, areaIdx] = teamDefs[t];
    const owner = people[(t * 4) % people.length];
    const [row] = await api('/rest/v1/teams', {
      method: 'POST',
      body: JSON.stringify({ name, sport_id: sportId.get(sport), category, city: 'Lusaka', area: AREAS[areaIdx][0], lat: AREAS[areaIdx][1], lng: AREAS[areaIdx][2], created_by: owner.id }),
    });
    teams.push({ ...row, sport, ownerId: owner.id });
    const memberRows = [{ team_id: row.id, user_id: owner.id, role: 'owner' }];
    for (let m = 1; m <= 6; m += 1) {
      memberRows.push({ team_id: row.id, user_id: people[(t * 4 + m) % people.length].id, role: m === 1 ? 'captain' : 'player' });
    }
    await api('/rest/v1/team_members', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(memberRows) });
  }
  // Demo Captain captains Finance FC (already its owner on most runs).
  await api('/rest/v1/team_members', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ team_id: teams[0].id, user_id: people[0].id, role: 'captain' }),
  });
  console.log('teams ready:', teams.length);

  // --- venues: top the seeded six up to eight -------------------------------
  for (const v of [
    { name: 'Libala Community Ground', area: 'Libala', lat: -15.455, lng: 28.315, sports: ['Football', 'netball'], facility_types: ['grass pitch'], price_note: 'Free - community ground' },
    { name: 'Ibex Hill Trail Gate', area: 'Ibex Hill', lat: -15.435, lng: 28.365, sports: ['hiking', 'marathon'], facility_types: ['trailhead'], price_note: 'Free - public trail' },
  ]) {
    const found = await api(`/rest/v1/venues?name=eq.${encodeURIComponent(v.name)}&select=id`);
    if (!found.length) await api('/rest/v1/venues', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(v) });
  }
  const venues = await api('/rest/v1/venues?select=id,name,area,lat,lng,sports');

  // --- open matches (10, next 7 days, varied fill) ---------------------------
  const matchDefs = [
    ['Saturday 5-a-side', 'Football', 1, 1, 10, 18, 10], ['Sunday basketball run', 'basketball', 6, 2, 10, 9, 10],
    ['Morning tennis doubles', 'tennis', 0, 3, 9, 4, 4], ['Wednesday futsal', 'futsal', 10, 4, 19, 8, 10],
    ['Netball social', 'netball', 7, 5, 17, 12, 14], ['Weekend hike: Lusaka trails', 'hiking', 8, 6, 7, 15, 30],
    ['Sunrise 10K run', 'marathon', 4, 7, 6, 11, 40], ['Friday night football', 'Football', 2, 2, 20, 16, 22],
    ['Padel social doubles', 'padel', 3, 3, 18, 3, 4], ['Veterans friendly', 'Football', 8, 4, 16, 14, 22],
  ];
  const matches = [];
  for (let i = 0; i < matchDefs.length; i += 1) {
    const [title, sport, areaIdx, inDays, hour, fill, capacity] = matchDefs[i];
    const organiser = people[(i * 5 + 2) % people.length];
    const venue = venues.find((v) => (v.sports ?? []).some((s) => s.toLowerCase() === sport.toLowerCase())) ?? null;
    const [row] = await api('/rest/v1/matches', {
      method: 'POST',
      body: JSON.stringify({
        organiser_id: organiser.id, sport_id: sportId.get(sport), title, starts_at: at(inDays, hour),
        venue_id: venue?.id ?? null, venue_name: venue?.name ?? null,
        lat: AREAS[areaIdx][1], lng: AREAS[areaIdx][2], area: AREAS[areaIdx][0],
        format: null, capacity, level: LEVELS[i % 3], kind: 'players', visibility: 'public', status: 'open',
      }),
    });
    matches.push(row);
    const parts = [{ match_id: row.id, user_id: organiser.id, status: 'joined' }];
    for (let f = 1; f < fill; f += 1) parts.push({ match_id: row.id, user_id: people[(i * 5 + 2 + f) % people.length].id, status: 'joined' });
    await api('/rest/v1/match_participants', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(parts) });
  }
  console.log('matches ready:', matches.length);

  // --- open challenges (3; one near Woodlands) --------------------------------
  for (let i = 0; i < 3; i += 1) {
    const team = teams[[1, 6, 10][i]];
    await api('/rest/v1/challenges', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        team_id: team.id, sport_id: team.sport_id, format: '11-a-side', level: LEVELS[i % 3],
        window_start: at(2 + i, 9), window_end: at(2 + i, 13),
        area: i === 0 ? 'Woodlands' : team.area, radius_km: 10, status: 'open', created_by: team.ownerId,
      }),
    });
  }
  console.log('challenges ready: 3');

  // --- tournaments: one live, one open, one past --------------------------------
  const organiser = people[1]; // Demo Organiser
  const [live] = await api('/rest/v1/competitions', {
    method: 'POST',
    body: JSON.stringify({ organiser_id: organiser.id, sport_id: sportId.get('Football'), name: 'Lusaka Saturday League', kind: 'tournament', format: 'round_robin', area: 'Lusaka', starts_on: at(-7, 9).slice(0, 10), max_entries: 6, status: 'live' }),
  });
  const liveTeams = teams.filter((t) => t.sport === 'Football').slice(0, 6);
  await api('/rest/v1/competition_entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(liveTeams.map((t) => ({ competition_id: live.id, team_id: t.id, status: 'registered' }))) });
  const pairs = [];
  for (let a = 0; a < liveTeams.length; a += 1) for (let b = a + 1; b < liveTeams.length; b += 1) pairs.push([liveTeams[a], liveTeams[b]]);
  const fixtureRows = pairs.map(([h, a], idx) => ({
    competition_id: live.id, home_team_id: h.id, away_team_id: a.id,
    starts_at: at(-3 + (idx % 4), 10), status: idx < 7 ? 'finished' : 'scheduled',
    home_score: idx < 7 ? (idx * 2) % 4 : null, away_score: idx < 7 ? idx % 3 : null,
  }));
  await api('/rest/v1/fixtures', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fixtureRows) });

  const [open] = await api('/rest/v1/competitions', {
    method: 'POST',
    body: JSON.stringify({ organiser_id: organiser.id, sport_id: sportId.get('basketball'), name: 'Avondale Hoops Cup', kind: 'tournament', format: 'round_robin', area: 'Avondale', starts_on: at(9, 9).slice(0, 10), max_entries: 8, status: 'registration' }),
  });
  await api('/rest/v1/competition_entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(teams.filter((t) => t.sport === 'basketball').slice(0, 2).map((t) => ({ competition_id: open.id, team_id: t.id, status: 'registered' }))) });

  const [past] = await api('/rest/v1/competitions', {
    method: 'POST',
    body: JSON.stringify({ organiser_id: organiser.id, sport_id: sportId.get('Football'), name: 'September Community Cup', kind: 'tournament', format: 'round_robin', area: 'Lusaka', starts_on: at(-40, 9).slice(0, 10), max_entries: 4, status: 'finished' }),
  });
  const pastTeams = teams.filter((t) => t.sport === 'Football').slice(0, 4);
  await api('/rest/v1/competition_entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(pastTeams.map((t) => ({ competition_id: past.id, team_id: t.id, status: 'registered' }))) });
  const pastFixtures = [];
  for (let a = 0; a < pastTeams.length; a += 1) for (let b = a + 1; b < pastTeams.length; b += 1) pastFixtures.push({ competition_id: past.id, home_team_id: pastTeams[a].id, away_team_id: pastTeams[b].id, starts_at: at(-35, 10), status: 'finished', home_score: (a + b) % 3, away_score: (a + 1) % 2 });
  await api('/rest/v1/fixtures', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(pastFixtures) });
  console.log('tournaments ready: live + open + past');

  // --- circles ------------------------------------------------------------------
  const [hike] = await api('/rest/v1/circles', {
    method: 'POST',
    body: JSON.stringify({ name: 'Lusaka Hiking', sport_id: sportId.get('hiking'), area: 'Lusaka', description: 'Weekend hikes and trail walks around Lusaka.', age_bands: [], genders: [], levels: [], created_by: people[5].id }),
  });
  const [foot] = await api('/rest/v1/circles', {
    method: 'POST',
    body: JSON.stringify({ name: 'Woodlands Football', sport_id: sportId.get('Football'), area: 'Woodlands', description: 'Pickup and league football in Woodlands.', age_bands: ['18–24', '25–34'], genders: [], levels: ['recreational', 'intermediate'], created_by: people[1].id }),
  });
  const circleMembers = [];
  for (let i = 0; i < 18; i += 1) circleMembers.push({ circle_id: hike.id, user_id: people[i % people.length].id });
  for (let i = 0; i < 12; i += 1) circleMembers.push({ circle_id: foot.id, user_id: people[(i + 3) % people.length].id });
  await api('/rest/v1/circle_members', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(circleMembers) });
  await api(`/rest/v1/matches?title=eq.${encodeURIComponent('Weekend hike: Lusaka trails')}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ circle_id: hike.id }) }).catch(() => {});
  console.log('circles ready: 2');
  console.log('SEED_DONE');
}

main().catch((err) => {
  console.error('SEED_FAILED', err.message);
  process.exit(1);
});
