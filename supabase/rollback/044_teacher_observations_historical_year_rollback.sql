-- 주의: observed_at이 NULL인 행이 있으면 SET NOT NULL이 실패한다(먼저 정리). academic_year 값은 삭제된다.
ALTER TABLE public.teacher_observations ALTER COLUMN observed_at SET NOT NULL;
ALTER TABLE public.teacher_observations DROP COLUMN IF EXISTS academic_year;
