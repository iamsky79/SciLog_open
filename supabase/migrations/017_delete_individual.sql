-- 017_delete_individual.sql

-- 1. 창의개인연구 삭제 RLS (학생, 계획서/결과보고서 승인 완료 아닐 때)
CREATE POLICY "학생 창의개인 삭제" ON public.individual_research
  FOR DELETE USING (
    student_id = auth.uid()
    AND id NOT IN (
      SELECT entity_id FROM research_plans
        WHERE status = 'approved' AND entity_type = 'individual'
      UNION
      SELECT entity_id FROM research_reports
        WHERE status = 'approved' AND entity_type = 'individual'
    )
  );

-- 2. 학생이 자신의 활동 기록 삭제 허용
DROP POLICY IF EXISTS "author can delete own logs" ON public.activity_logs;
CREATE POLICY "author can delete own logs" ON public.activity_logs
  FOR DELETE USING (author_id = auth.uid());

-- 3. 학생이 자신이 제출한 계획서 삭제 허용 (승인 완료 제외)
DROP POLICY IF EXISTS "student can delete own plans" ON public.research_plans;
CREATE POLICY "student can delete own plans" ON public.research_plans
  FOR DELETE USING (
    created_by = auth.uid()
    AND status != 'approved'
  );

-- 4. 학생이 자신이 제출한 보고서 삭제 허용 (승인 완료 제외)
DROP POLICY IF EXISTS "student can delete own reports" ON public.research_reports;
CREATE POLICY "student can delete own reports" ON public.research_reports
  FOR DELETE USING (
    created_by = auth.uid()
    AND status != 'approved'
  );
