-- historical teacher observation backfill: 정확한 관찰일이 없는 기록을 가짜 날짜 없이 저장하기 위해
--   1) academic_year(integer NULL) 추가
--   2) observed_at의 NOT NULL만 해제 — DEFAULT current_date는 유지(live 기록은 기존처럼 기본 날짜를 쓴다)
-- additive/non-destructive: 기존 행/RLS 정책은 바꾸지 않는다.
ALTER TABLE public.teacher_observations ADD COLUMN IF NOT EXISTS academic_year integer;
ALTER TABLE public.teacher_observations ALTER COLUMN observed_at DROP NOT NULL;
