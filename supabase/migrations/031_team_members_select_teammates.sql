-- 버그: team_members_select 정책이 "본인 행" 또는 "그 팀 담당교사/관리자"만 허용해서,
-- 학생이 자기 팀 목록을 조회해도 RLS가 팀원 각각의 행을 개별 검사한 뒤
-- student_id = auth.uid()가 아닌 팀원 행은 전부 걸러버렸다.
-- 그 결과 학생 화면 상단에는 "본인 한 명"만 남고, 담당교사(is_team_teacher가 통과)로
-- 보면 전체 팀원이 보이는 불일치가 생겼다.
--
-- 이미 존재하는 SECURITY DEFINER 헬퍼 public.is_team_member(team_id)
-- ("현재 로그인 사용자가 이 team_id의 멤버인가")를 재사용해 같은 팀 멤버 전원이
-- 서로의 team_members 행을 볼 수 있도록 고친다. 다른 팀의 team_members 행은
-- is_team_member(그 팀id)가 false이므로 여전히 보이지 않는다(팀 간 격리 유지).

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select
  using (
    public.is_team_member(team_id)
    or public.is_team_teacher(team_id)
    or public.is_admin_or_viewer()
  );
