-- Golf G1: golf as a sport, and course cards (holes, par, stroke index) that tee times, golf days, scorecards and
-- records all read. A course usually belongs to a golf venue on Chabuka; an organiser can also enter a course that is
-- not on Chabuka (venue_id null) for a golf day there. API-only: RLS on, no policies, read and written by the service
-- client after its own checks.

insert into sports (name, formats)
values ('golf', array['18 holes', '9 holes', 'golf day'])
on conflict (name) do nothing;

create table if not exists golf_courses (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues (id) on delete cascade,
  name text not null,
  holes integer not null check (holes in (9, 18)),
  tee_set text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists golf_courses_venue on golf_courses (venue_id);

create table if not exists golf_holes (
  course_id uuid not null references golf_courses (id) on delete cascade,
  hole_no integer not null check (hole_no between 1 and 18),
  par integer not null check (par between 3 and 6),
  stroke_index integer not null check (stroke_index between 1 and 18),
  yards integer check (yards between 50 and 800),
  primary key (course_id, hole_no)
);

alter table golf_courses enable row level security;
alter table golf_holes enable row level security;
