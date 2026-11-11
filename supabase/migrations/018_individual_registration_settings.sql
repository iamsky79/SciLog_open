-- 창의개인연구 등록/계획서 제출 기간 설정 테이블
CREATE TABLE IF NOT EXISTS public.individual_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  type text NOT NULL,                       -- 'registration' | 'plan'
  is_active boolean DEFAULT false,
  start_at timestamptz,
  end_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (year, type)
);

-- RLS
ALTER TABLE public.individual_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_individual_settings" ON public.individual_settings
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "authenticated_read_individual_settings" ON public.individual_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- individual_research에 subject, year 컬럼 추가
ALTER TABLE public.individual_research
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS year int;
