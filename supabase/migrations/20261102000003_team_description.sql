-- Team profile description (Amendment 4, team management).
-- Re-runnable. WRITTEN BUT NOT APPLIED — needs explicit approval before
-- running against the live project. Nullable, no backfill, safe default.
alter table teams add column if not exists description text;
