-- 버그: research_plans/research_reports의 "FOR ALL" 정책이 USING 절만 갖고 있어서
-- (WITH CHECK 생략 시 Postgres가 USING을 그대로 쓰기 검사에도 재사용한다),
-- 담당 교사가 아니라 "role = 'teacher'인 아무 계정"이면 다른 팀/다른 학생의
-- 계획서·결과보고서도 UPDATE(승인/수정요청)·DELETE 할 수 있었다.
-- UI(ReviewClient/PlanSection/ReportSection)는 teacher_id/team_id로 화면에는 걸러 보여줬지만,
-- 그건 클라이언트 필터일 뿐 서버(RLS)에서 막고 있지 않았다.
--
-- "해당 팀 담당교사" 또는 "해당 개인연구 지도교사"인 경우만 통과하도록 좁힌다.
-- 학생 본인 소유 행에 대한 기존 접근(제출/재제출)과 관리자 접근은 그대로 유지한다.

drop policy if exists "team or individual owner can manage plans" on public.research_plans;
create policy "team or individual owner can manage plans" on public.research_plans
  for all
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = research_plans.team_id and tm.student_id = auth.uid()
    )
    or (
      research_plans.entity_type = 'individual'
      and exists (
        select 1 from public.individual_research ir
        where ir.id = research_plans.entity_id and ir.student_id = auth.uid()
      )
    )
    or (research_plans.team_id is not null and public.is_team_teacher(research_plans.team_id))
    or (
      research_plans.entity_type = 'individual'
      and exists (
        select 1 from public.individual_research ir
        where ir.id = research_plans.entity_id and ir.teacher_id = auth.uid()
      )
    )
    or public.is_admin_or_viewer()
  );

drop policy if exists "members can manage reports" on public.research_reports;
create policy "members can manage reports" on public.research_reports
  for all
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = research_reports.team_id and tm.student_id = auth.uid()
    )
    or (
      research_reports.entity_type = 'individual'
      and exists (
        select 1 from public.individual_research ir
        where ir.id = research_reports.entity_id and ir.student_id = auth.uid()
      )
    )
    or (research_reports.team_id is not null and public.is_team_teacher(research_reports.team_id))
    or (
      research_reports.entity_type = 'individual'
      and exists (
        select 1 from public.individual_research ir
        where ir.id = research_reports.entity_id and ir.teacher_id = auth.uid()
      )
    )
    or public.is_admin_or_viewer()
  );
