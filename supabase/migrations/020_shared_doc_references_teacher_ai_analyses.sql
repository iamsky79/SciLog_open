-- Feature 1: 공유 문서 링크
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS shared_doc_url text;
ALTER TABLE public.individual_research
  ADD COLUMN IF NOT EXISTS shared_doc_url text;

-- Feature 2: 논문/자료 스크랩
CREATE TABLE IF NOT EXISTS public.references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  authors text,
  source text,
  url text,
  file_url text,
  memo text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Feature 4: 기타활동 지도교사 선택 옵션
ALTER TABLE public.other_activities
  ADD COLUMN IF NOT EXISTS teacher_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.other_activities
  ADD COLUMN IF NOT EXISTS has_teacher boolean DEFAULT false;

-- Feature 6: AI 분석 결과 저장
CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- references 테이블 RLS (필요시 활성화)
-- ALTER TABLE public.references ENABLE ROW LEVEL SECURITY;
-- ai_analyses 테이블 RLS (필요시 활성화)
-- ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;
