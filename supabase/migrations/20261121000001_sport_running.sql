-- Running as an everyday sport (run clubs, group runs, a Saturday 5K), next to "marathon", which stays the sport for race
-- events. Formats are what a host picks when posting a run.
insert into sports (name, formats)
values ('running', array['run club', '5K', '10K', 'long run', 'trail run'])
on conflict (name) do nothing;
