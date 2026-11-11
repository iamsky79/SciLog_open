-- 창의개인연구에 계획서 필드 추가 (teacher_id는 IF NOT EXISTS로 안전하게)
ALTER TABLE public.individual_research
  ADD COLUMN IF NOT EXISTS plan_title text,
  ADD COLUMN IF NOT EXISTS plan_motivation text,
  ADD COLUMN IF NOT EXISTS plan_method text,
  ADD COLUMN IF NOT EXISTS plan_expected text,
  ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS plan_feedback text,
  ADD COLUMN IF NOT EXISTS plan_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_reviewed_at timestamptz;

-- 교사가 자신에게 제출된 계획서 열람
DO $$ BEGIN
  CREATE POLICY "teachers can view assigned individual research"
    ON public.individual_research FOR SELECT
    USING (teacher_id = auth.uid() OR student_id = auth.uid() OR public.is_admin_or_viewer());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 교사가 plan_status, plan_feedback 업데이트
DO $$ BEGIN
  CREATE POLICY "teachers can review plan"
    ON public.individual_research FOR UPDATE
    USING (teacher_id = auth.uid() OR public.is_admin_or_viewer());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
