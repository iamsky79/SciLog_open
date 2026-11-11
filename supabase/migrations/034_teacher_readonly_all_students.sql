-- "학생 포트폴리오" 개편: 교사가 "전체 학생"(지도 여부 무관)의 포트폴리오를 조회할 수
-- 있어야 한다는 요구사항이 새로 생겼다. 그런데 지금 RLS는 관리자(is_admin)가 아닌
-- 일반 교사를 "자신이 지도교사로 연결된 학생"만 보이도록 좁혀 두고 있다
-- (users_select: id=auth.uid() OR is_supervising_teacher(id) OR shares_team_with(id)
-- OR is_admin_or_viewer() — 032에서 "담당 아닌 팀도 승인 가능했던" 쓰기 권한 상승을
-- 막을 때 조회 쪽은 건드리지 않아 그대로 남아 있던 제약이다).
--
-- 요청에 따라 "읽기(SELECT)만" 모든 교사에게 넓힌다 — 승인/수정/삭제 등 쓰기 권한은
-- 기존처럼 지도(담당) 교사·관리자로만 계속 제한된다.
--
-- 방법: 기존 정책을 바꾸거나 지우지 않고, 각 테이블에 "교사면 SELECT 허용"이라는
-- 새 permissive 정책을 추가만 한다. Postgres RLS는 같은 커맨드(SELECT)에 대한 여러
-- permissive 정책을 OR로 합치므로, 이 추가 정책은 오직 SELECT에만 적용되고
-- research_plans/research_reports의 기존 FOR ALL 정책(쓰기 포함)에는 전혀 영향을
-- 주지 않는다 — 즉 032에서 고친 "담당 아닌 팀 승인 불가" 보호는 그대로 유지된다.

create policy "teachers can read all students" on public.users
  for select
  using (public.is_teacher() and role = 'student');

create policy "teachers can read all teams" on public.teams
  for select
  using (public.is_teacher());

create policy "teachers can read all team_members" on public.team_members
  for select
  using (public.is_teacher());

create policy "teachers can read all research_plans" on public.research_plans
  for select
  using (public.is_teacher());

create policy "teachers can read all research_reports" on public.research_reports
  for select
  using (public.is_teacher());

-- 개인 일지(log_type='personal')는 학생 성찰 기록으로 별도 보호되는 영역(026 참고)이라
-- 이 확장에서 제외한다 — 팀/개인 연구용 연구일지(log_type<>'personal')만 넓힌다.
create policy "teachers can read all activity_logs" on public.activity_logs
  for select
  using (public.is_teacher() and log_type <> 'personal');

create policy "teachers can read all activity_log_participants" on public.activity_log_participants
  for select
  using (public.is_teacher());

create policy "teachers can read all individual_research" on public.individual_research
  for select
  using (public.is_teacher());

create policy "teachers can read all other_activities" on public.other_activities
  for select
  using (public.is_teacher());

create policy "teachers can read all awards" on public.awards
  for select
  using (public.is_teacher());

create policy "teachers can read all submission_snapshots" on public.submission_snapshots
  for select
  using (public.is_teacher());
