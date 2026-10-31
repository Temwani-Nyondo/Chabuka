-- Seed venues for the venue picker (brief: fictional names for seeded
-- venues). Re-runnable: each venue is inserted only when its name is new.
-- Coordinates are the area centres in Lusaka, launch city; a venue's own
-- confirmed pin replaces them when a partner registers it for real.
insert into venues (name, area, lat, lng, sports, facility_types, price_note)
select v.name, v.area, v.lat, v.lng, v.sports, v.facility_types, v.price_note
from (values
  ('Woodlands Community Pitch', 'Woodlands', -15.4395, 28.3512,
   array['Football', 'futsal', 'netball'], array['grass pitch', 'floodlights'], 'Free - community pitch'),
  ('Kabulonga Sports Ground', 'Kabulonga', -15.4189, 28.3489,
   array['Football', 'tennis'], array['grass pitch', 'tennis courts'], 'K150 per hour'),
  ('Chilenje Five-a-Side Arena', 'Chilenje', -15.4692, 28.3318,
   array['Football', 'futsal'], array['astro turf', 'cage pitch'], 'K200 per hour'),
  ('UNZA Great East Courts', 'University of Zambia', -15.3912, 28.3285,
   array['basketball', 'netball', 'tennis'], array['outdoor courts'], 'K50 per session'),
  ('Olympia Park Padel Club', 'Olympia Park', -15.4085, 28.3187,
   array['padel', 'tennis'], array['padel courts', 'clubhouse'], 'K250 per hour'),
  ('Matero Community Courts', 'Matero', -15.3938, 28.2612,
   array['basketball', 'netball'], array['outdoor courts', 'floodlights'], 'Free - community courts')
) as v(name, area, lat, lng, sports, facility_types, price_note)
where not exists (select 1 from venues existing where existing.name = v.name);
