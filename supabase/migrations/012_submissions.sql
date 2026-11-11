-- 연구계획서 테이블 (R&E, 동아리 팀 단위)
CREATE TABLE IF NOT EXISTS public.research_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text,
  motivation text,
  method text,
  expected_result text,
  status text DEFAULT 'draft',
  feedback text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.research_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  summary text,
  file_url text,
  file_name text,
  status text DEFAULT 'draft',
  feedback text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.research_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can manage plans" ON public.research_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = research_plans.team_id
      AND tm.student_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND (u.role = 'teacher' OR u.is_admin = true)
    )
  );

CREATE POLICY "team members can manage reports" ON public.research_reports
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = research_reports.team_id
      AND tm.student_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND (u.role = 'teacher' OR u.is_admin = true)
    )
  );
