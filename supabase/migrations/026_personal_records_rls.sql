ALTER TABLE public.personal_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own record or teacher/admin can manage personal records" ON public.personal_records
  FOR ALL USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.role = 'teacher' OR u.is_admin = true))
  );

-- activity_logs_select를 log_type 인지하도록 교체: 'personal'(개인 일지)은 작성자 본인 + 교사/관리자만 열람.
-- 기존 정책은 팀 멤버 누구나 can_access_entity를 통과해 팀 소속 개인 일지까지 열람할 수 있었음.
DROP POLICY IF EXISTS "activity_logs_select" ON public.activity_logs;
CREATE POLICY "activity_logs_select" ON public.activity_logs
  FOR SELECT USING (
    author_id = auth.uid()
    OR (log_type = 'team' AND public.can_access_entity(entity_type, entity_id))
    OR (log_type = 'personal' AND public.is_teacher() AND public.can_access_entity(entity_type, entity_id))
    OR public.is_admin_or_viewer()
  );
