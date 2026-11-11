-- Schema/RLS additions needed by the student/teacher feature set:
--   1. teachers review individual activity_logs entries (status + feedback)
--   2. teachers see their supervised students' lab_requests, not just
--      requests already explicitly assigned to them
--   3. students can edit their own team_members row (drive_link)
--   4. a basic teacher directory + teammate visibility, so names resolve
--      in team member lists / activity log authorship without exposing
--      unrelated students' profiles

alter table public.activity_logs add column if not exists teacher_feedback text;

drop policy if exists "activity_logs_update" on public.activity_logs;
create policy "activity_logs_update" on public.activity_logs
  for update
  using (
    author_id = auth.uid()
    or (public.is_teacher() and public.can_access_entity(entity_type, entity_id))
    or public.is_admin_or_viewer()
  )
  with check (
    author_id = auth.uid()
    or (public.is_teacher() and public.can_access_entity(entity_type, entity_id))
    or public.is_admin_or_viewer()
  );

drop policy if exists "lab_requests_select" on public.lab_requests;
create policy "lab_requests_select" on public.lab_requests
  for select
  using (
    student_id = auth.uid()
    or teacher_id = auth.uid()
    or public.is_supervising_teacher(student_id)
    or public.is_admin_or_viewer()
  );

drop policy if exists "team_members_update" on public.team_members;
create policy "team_members_update" on public.team_members
  for update
  using (
    student_id = auth.uid()
    or public.is_team_teacher(team_id)
    or public.is_admin_or_viewer()
  )
  with check (
    student_id = auth.uid()
    or public.is_team_teacher(team_id)
    or public.is_admin_or_viewer()
  );

create or replace function public.shares_team_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm1
    join public.team_members tm2 on tm1.team_id = tm2.team_id
    where tm1.student_id = auth.uid() and tm2.student_id = p_user_id
  );
$$;

drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select
  using (
    id = auth.uid()
    or role = 'teacher'
    or public.is_supervising_teacher(id)
    or public.shares_team_with(id)
    or public.is_admin_or_viewer()
  );
