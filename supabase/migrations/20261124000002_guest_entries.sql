-- Guest entries: a runner or golfer can enter a Chabuka race or golf day from WaitApp without a Chabuka account.
-- WaitApp collects the same details (rules checked by the same Chabuka code), then the entry is paid on WaitApp.
-- Such an entry has no user_id; guest_email (the WaitApp customer) is how the organiser reaches them.
-- Re-runnable.

alter table race_entries alter column user_id drop not null;
alter table race_entries add column if not exists guest_email text;
alter table race_entries add column if not exists source text not null default 'chabuka' check (source in ('chabuka', 'waitapp'));
alter table race_entries drop constraint if exists race_entries_owner;
alter table race_entries add constraint race_entries_owner check (user_id is not null or guest_email is not null);

alter table golf_entries alter column user_id drop not null;
alter table golf_entries add column if not exists guest_email text;
alter table golf_entries add column if not exists source text not null default 'chabuka' check (source in ('chabuka', 'waitapp'));
alter table golf_entries drop constraint if exists golf_entries_owner;
alter table golf_entries add constraint golf_entries_owner check (user_id is not null or guest_email is not null);
