-- research_plans에 2단계 승인 컬럼 추가
ALTER TABLE public.research_plans
  ADD COLUMN IF NOT EXISTS teacher_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS teacher_approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_approved_by uuid REFERENCES public.users(id);

-- status 흐름:
-- draft → submitted → teacher_approved → approved (관리자 최종)
--                  → rejected (지도교사 or 관리자가 반려)
