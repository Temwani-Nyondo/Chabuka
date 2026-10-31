-- Richer registration + new disciplines (user-directed expansion).
-- Age is stored as birth_year only; the UI shows bands, never exact age.
-- Gender is optional and self-described. Re-runnable.
alter table profiles add column if not exists birth_year integer;
alter table profiles add column if not exists gender text;

insert into sports (name, formats) values
  ('marathon', array['10K', 'half', 'full']),
  ('hiking', array['group hike', 'trail'])
on conflict (name) do update set formats = excluded.formats;
