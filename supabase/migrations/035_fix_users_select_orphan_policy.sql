-- 포트폴리오 RLS 점검 중 발견: public.users에 마이그레이션 파일에 없는
-- "users_select_policy"(qual = true)가 남아 있어, 로그인한 사용자면 누구나(학생 포함)
-- users 테이블 전체를 읽을 수 있었다.
--
-- 추가로 확인된 사실: 003_feature_support.sql이 프로덕션에 전혀 적용되지 않았다
-- (그 파일이 만드는 public.shares_team_with() 함수 자체가 없음). 그동안 그 orphan
-- true 정책이 "학생이 같은 팀 동료 이름을 본다" 같은 정상 기능을 우연히 대신
-- 떠받치고 있었던 것으로 보인다 — orphan 정책만 지우면 그 기능이 깨진다.
--
-- 그래서 이 마이그레이션은: 1) 003이 만들려던 shares_team_with() 함수를 추가하고,
-- 2) users_select를 003이 의도했던 조건으로 교체한 다음, 3) orphan 정책을 지운다.
-- 003의 나머지 변경(activity_logs_update/lab_requests_select/team_members_update)은
-- 이번 포트폴리오 작업과 무관하므로 여기서 건드리지 않는다 — 별도 점검이 필요하다.

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

drop policy if exists "users_select_policy" on public.users;
