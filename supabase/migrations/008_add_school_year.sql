-- 008_add_school_year.sql
-- teams 테이블에 school_year 컬럼 추가 (start_date/end_date는 유지)
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS school_year text;
