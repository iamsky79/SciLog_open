-- 제출 폼 제목 필드: research_plans는 이미 title 컬럼 보유, 나머지 두 테이블에 추가
ALTER TABLE public.research_plans ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.research_reports ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS title text;
