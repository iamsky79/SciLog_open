-- SciLog initial schema: tables + RLS
-- Access model:
--   student  -> own records + teams/individual research/other activities they belong to
--   teacher  -> records of teams/students they supervise
--   viewer / is_admin -> read (and admin: write) everything
--
-- Idempotent on purpose: every statement is safe to re-run, so a partial
-- failure part-way through (e.g. the SQL editor stopping on one error)
-- can simply be re-run from the top without manual cleanup.

create extension if not exists pgcrypto;

-- ============================================================
-- ENUM TYPES
-- ============================================================

do $$ begin
  create type user_role as enum ('student', 'teacher', 'viewer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type team_type as enum ('rne', 'club');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type semester_type as enum ('1-2', '2-1', '2-2', '3-1');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type other_activity_subtype as enum ('external_competition', 'performance', 'invention', 'idea');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type participation_type as enum ('individual', 'team');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type entity_type as enum ('team', 'individual', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type review_status as enum ('approved', 'rejected', 'pending');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  role user_role not null default 'student',
  is_admin boolean not null default false,
  grade smallint,
  class text,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  type team_type not null,
  subtype text,
  teacher_id uuid references public.users (id) on delete set null,
  name text not null,
  field text,
  start_date date,
  end_date date,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  is_leader boolean not null default false,
  drive_link text,
  joined_at timestamptz not null default now(),
  unique (team_id, student_id)
);

create table if not exists public.individual_research (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  teacher_id uuid references public.users (id) on delete set null,
  semester semester_type not null,
  title text not null,
  field text,
  start_date date,
  end_date date,
  description text,
  drive_link text,
  created_at timestamptz not null default now()
);

create table if not exists public.other_activities (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  subtype other_activity_subtype not null,
  title text not null,
  activity_date date,
  organizer text,
  content text,
  result text,
  drive_link text,
  created_at timestamptz not null default now()
);

create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  award_name text not null,
  competition text,
  organizer text,
  award_date date,
  grade text,
  participation participation_type not null default 'individual',
  team_members_text text,
  related_type entity_type,
  related_id uuid,
  drive_link text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type entity_type not null,
  entity_id uuid not null,
  author_id uuid not null references public.users (id) on delete cascade,
  log_date date not null default current_date,
  goal text,
  experiment text,
  result text,
  conclusion text,
  next_plan text,
  activity_content text,
  achievement text,
  free_memo text,
  drive_link text,
  status review_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_reviews (
  id uuid primary key default gen_random_uuid(),
  entity_type entity_type not null,
  entity_id uuid not null,
  teacher_id uuid not null references public.users (id) on delete cascade,
  status review_status not null default 'pending',
  feedback text,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.lab_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  teacher_id uuid references public.users (id) on delete set null,
  related_type entity_type,
  related_id uuid,
  lab_room text not null,
  requested_date date not null,
  time_start time not null,
  time_end time not null,
  purpose text,
  equipment_list text,
  safety_agreed boolean not null default false,
  status review_status not null default 'pending',
  reject_reason text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_teams_teacher_id on public.teams (teacher_id);
create index if not exists idx_team_members_team_id on public.team_members (team_id);
create index if not exists idx_team_members_student_id on public.team_members (student_id);
create index if not exists idx_individual_research_student_id on public.individual_research (student_id);
create index if not exists idx_individual_research_teacher_id on public.individual_research (teacher_id);
create index if not exists idx_other_activities_student_id on public.other_activities (student_id);
create index if not exists idx_awards_student_id on public.awards (student_id);
create index if not exists idx_activity_logs_entity on public.activity_logs (entity_type, entity_id);
create index if not exists idx_activity_logs_author_id on public.activity_logs (author_id);
create index if not exists idx_teacher_reviews_entity on public.teacher_reviews (entity_type, entity_id);
create index if not exists idx_teacher_reviews_teacher_id on public.teacher_reviews (teacher_id);
create index if not exists idx_lab_requests_student_id on public.lab_requests (student_id);
create index if not exists idx_lab_requests_teacher_id on public.lab_requests (teacher_id);

-- ============================================================
-- HELPER FUNCTIONS (security definer: bypass RLS to avoid
-- recursive policy evaluation when a policy queries another
-- RLS-protected table)
-- ============================================================

create or replace function public.is_admin_or_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and (is_admin = true or role = 'viewer')
  );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'teacher'
  );
$$;

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and student_id = auth.uid()
  );
$$;

create or replace function public.is_team_teacher(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams
    where id = p_team_id and teacher_id = auth.uid()
  );
$$;

-- Does the current user (a teacher) supervise this student, via any
-- team they teach or any individual research they advise?
create or replace function public.is_supervising_teacher(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.student_id = p_student_id and t.teacher_id = auth.uid()
  )
  or exists (
    select 1 from public.individual_research
    where student_id = p_student_id and teacher_id = auth.uid()
  );
$$;

-- Resolves access for the polymorphic entity_type/entity_id pair used
-- by activity_logs and teacher_reviews back to its owning team/student.
create or replace function public.can_access_entity(p_entity_type entity_type, p_entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  if public.is_admin_or_viewer() then
    return true;
  end if;

  if p_entity_type = 'team' then
    return public.is_team_member(p_entity_id) or public.is_team_teacher(p_entity_id);
  elsif p_entity_type = 'individual' then
    return exists (
      select 1 from public.individual_research
      where id = p_entity_id and (student_id = auth.uid() or teacher_id = auth.uid())
    );
  elsif p_entity_type = 'other' then
    select student_id into v_student_id from public.other_activities where id = p_entity_id;
    return v_student_id = auth.uid() or public.is_supervising_teacher(v_student_id);
  end if;

  return false;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.individual_research enable row level security;
alter table public.other_activities enable row level security;
alter table public.awards enable row level security;
alter table public.activity_logs enable row level security;
alter table public.teacher_reviews enable row level security;
alter table public.lab_requests enable row level security;

-- ---------- users ----------

drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select
  using (
    id = auth.uid()
    or public.is_supervising_teacher(id)
    or public.is_admin_or_viewer()
  );

drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users
  for insert
  with check (id = auth.uid());

drop policy if exists "users_update" on public.users;
create policy "users_update" on public.users
  for update
  using (id = auth.uid() or public.is_admin_or_viewer())
  with check (id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "users_delete_admin" on public.users;
create policy "users_delete_admin" on public.users
  for delete
  using (public.is_admin_or_viewer());

-- ---------- teams ----------

drop policy if exists "teams_select" on public.teams;
create policy "teams_select" on public.teams
  for select
  using (
    public.is_team_member(id)
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  );

drop policy if exists "teams_insert" on public.teams;
create policy "teams_insert" on public.teams
  for insert
  with check (
    (public.is_teacher() and teacher_id = auth.uid())
    or public.is_admin_or_viewer()
  );

drop policy if exists "teams_update" on public.teams;
create policy "teams_update" on public.teams
  for update
  using (teacher_id = auth.uid() or public.is_admin_or_viewer())
  with check (teacher_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "teams_delete" on public.teams;
create policy "teams_delete" on public.teams
  for delete
  using (teacher_id = auth.uid() or public.is_admin_or_viewer());

-- ---------- team_members ----------

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select
  using (
    student_id = auth.uid()
    or public.is_team_teacher(team_id)
    or public.is_admin_or_viewer()
  );

drop policy if exists "team_members_insert" on public.team_members;
create policy "team_members_insert" on public.team_members
  for insert
  with check (
    student_id = auth.uid()
    or public.is_team_teacher(team_id)
    or public.is_admin_or_viewer()
  );

drop policy if exists "team_members_update" on public.team_members;
create policy "team_members_update" on public.team_members
  for update
  using (public.is_team_teacher(team_id) or public.is_admin_or_viewer())
  with check (public.is_team_teacher(team_id) or public.is_admin_or_viewer());

drop policy if exists "team_members_delete" on public.team_members;
create policy "team_members_delete" on public.team_members
  for delete
  using (
    student_id = auth.uid()
    or public.is_team_teacher(team_id)
    or public.is_admin_or_viewer()
  );

-- ---------- individual_research ----------

drop policy if exists "individual_research_select" on public.individual_research;
create policy "individual_research_select" on public.individual_research
  for select
  using (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  );

drop policy if exists "individual_research_insert" on public.individual_research;
create policy "individual_research_insert" on public.individual_research
  for insert
  with check (student_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "individual_research_update" on public.individual_research;
create policy "individual_research_update" on public.individual_research
  for update
  using (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  )
  with check (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  );

drop policy if exists "individual_research_delete" on public.individual_research;
create policy "individual_research_delete" on public.individual_research
  for delete
  using (student_id = auth.uid() or public.is_admin_or_viewer());

-- ---------- other_activities ----------

drop policy if exists "other_activities_select" on public.other_activities;
create policy "other_activities_select" on public.other_activities
  for select
  using (
    student_id = auth.uid()
    or public.is_supervising_teacher(student_id)
    or public.is_admin_or_viewer()
  );

drop policy if exists "other_activities_insert" on public.other_activities;
create policy "other_activities_insert" on public.other_activities
  for insert
  with check (student_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "other_activities_update" on public.other_activities;
create policy "other_activities_update" on public.other_activities
  for update
  using (student_id = auth.uid() or public.is_admin_or_viewer())
  with check (student_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "other_activities_delete" on public.other_activities;
create policy "other_activities_delete" on public.other_activities
  for delete
  using (student_id = auth.uid() or public.is_admin_or_viewer());

-- ---------- awards ----------

drop policy if exists "awards_select" on public.awards;
create policy "awards_select" on public.awards
  for select
  using (
    student_id = auth.uid()
    or public.is_supervising_teacher(student_id)
    or public.is_admin_or_viewer()
  );

drop policy if exists "awards_insert" on public.awards;
create policy "awards_insert" on public.awards
  for insert
  with check (student_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "awards_update" on public.awards;
create policy "awards_update" on public.awards
  for update
  using (student_id = auth.uid() or public.is_admin_or_viewer())
  with check (student_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "awards_delete" on public.awards;
create policy "awards_delete" on public.awards
  for delete
  using (student_id = auth.uid() or public.is_admin_or_viewer());

-- ---------- activity_logs ----------

drop policy if exists "activity_logs_select" on public.activity_logs;
create policy "activity_logs_select" on public.activity_logs
  for select
  using (
    author_id = auth.uid()
    or public.can_access_entity(entity_type, entity_id)
  );

drop policy if exists "activity_logs_insert" on public.activity_logs;
create policy "activity_logs_insert" on public.activity_logs
  for insert
  with check (
    author_id = auth.uid()
    and public.can_access_entity(entity_type, entity_id)
  );

drop policy if exists "activity_logs_update" on public.activity_logs;
create policy "activity_logs_update" on public.activity_logs
  for update
  using (author_id = auth.uid() or public.is_admin_or_viewer())
  with check (author_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "activity_logs_delete" on public.activity_logs;
create policy "activity_logs_delete" on public.activity_logs
  for delete
  using (author_id = auth.uid() or public.is_admin_or_viewer());

-- ---------- teacher_reviews ----------

drop policy if exists "teacher_reviews_select" on public.teacher_reviews;
create policy "teacher_reviews_select" on public.teacher_reviews
  for select
  using (public.can_access_entity(entity_type, entity_id));

drop policy if exists "teacher_reviews_insert" on public.teacher_reviews;
create policy "teacher_reviews_insert" on public.teacher_reviews
  for insert
  with check (
    teacher_id = auth.uid()
    and public.is_teacher()
    and public.can_access_entity(entity_type, entity_id)
  );

drop policy if exists "teacher_reviews_update" on public.teacher_reviews;
create policy "teacher_reviews_update" on public.teacher_reviews
  for update
  using (teacher_id = auth.uid() or public.is_admin_or_viewer())
  with check (teacher_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "teacher_reviews_delete" on public.teacher_reviews;
create policy "teacher_reviews_delete" on public.teacher_reviews
  for delete
  using (teacher_id = auth.uid() or public.is_admin_or_viewer());

-- ---------- lab_requests ----------

drop policy if exists "lab_requests_select" on public.lab_requests;
create policy "lab_requests_select" on public.lab_requests
  for select
  using (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  );

drop policy if exists "lab_requests_insert" on public.lab_requests;
create policy "lab_requests_insert" on public.lab_requests
  for insert
  with check (student_id = auth.uid() or public.is_admin_or_viewer());

drop policy if exists "lab_requests_update" on public.lab_requests;
create policy "lab_requests_update" on public.lab_requests
  for update
  using (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  )
  with check (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_admin_or_viewer()
  );

drop policy if exists "lab_requests_delete" on public.lab_requests;
create policy "lab_requests_delete" on public.lab_requests
  for delete
  using (student_id = auth.uid() or public.is_admin_or_viewer());
