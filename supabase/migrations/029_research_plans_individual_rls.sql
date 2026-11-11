-- research_plans는 팀 소속(team_members) 또는 교사/관리자만 쓸 수 있었고,
-- research_reports와 달리 "본인 소유의 창의개인연구" 케이스가 빠져 있었음.
-- 그 결과 창의개인연구 학생이 계획서를 저장/제출할 때 research_plans 미러 행
-- INSERT가 RLS에 막혀 403이 나고, 앱 코드가 에러를 무시해 조용히 실패했음.
DROP POLICY IF EXISTS "team members can manage plans" ON public.research_plans;

CREATE POLICY "team or individual owner can manage plans" ON public.research_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = research_plans.team_id AND tm.student_id = auth.uid()
    )
    OR (
      research_plans.entity_type = 'individual'
      AND EXISTS (
        SELECT 1 FROM public.individual_research ir
        WHERE ir.id = research_plans.entity_id AND ir.student_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND (u.role = 'teacher' OR u.is_admin = true)
    )
  );
