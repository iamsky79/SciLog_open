-- references, ai_analyses는 client에서 직접 조회하는 테이블이므로 RLS 활성화
ALTER TABLE public.references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team or teacher can manage references" ON public.references
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND (u.role = 'teacher' OR u.is_admin = true)
    )
    OR (
      entity_type IN ('rne', 'club') AND EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = entity_id AND tm.student_id = auth.uid()
      )
    )
    OR (
      entity_type = 'individual' AND EXISTS (
        SELECT 1 FROM public.individual_research ir
        WHERE ir.id = entity_id AND ir.student_id = auth.uid()
      )
    )
  );

CREATE POLICY "teacher or admin can manage ai_analyses" ON public.ai_analyses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND (u.role = 'teacher' OR u.is_admin = true)
    )
  );
